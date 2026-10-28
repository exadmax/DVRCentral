// Casa do Diogows: planta da casa (andares, cômodos em retângulos) com os aparelhos inteligentes colocados nela, e o estado de cada um
// (ligado, em espera, desligado). Por enquanto só TVs Samsung (Tizen), que respondem em http://IP:8001/api/v2/ enquanto estão na rede.
// Todos os usuários veem a planta e o estado; só o administrador altera a planta e os endereços (o hub só consulta os IPs que estão salvos).
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const deskHomeMigration = `CREATE TABLE IF NOT EXISTS desk_home (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	layout TEXT NOT NULL
);`

const (
	homeMaxFloors  = 8
	homeMaxRooms   = 24 // por andar
	homeMaxDevices = 32
	homeMaxName    = 40
	homeStatusTTL  = 4 * time.Second
)

var (
	homeIDRe    = regexp.MustCompile(`^[a-z0-9_-]{1,24}$`)
	homeColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

// Medidas em porcentagem da área desenhada (0 a 100), para a planta valer em qualquer tamanho de janela.
type homeRoom struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Color string  `json:"color,omitempty"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
}

type homeFloor struct {
	ID    string     `json:"id"`
	Name  string     `json:"name"`
	Rooms []homeRoom `json:"rooms"`
}

type homeDevice struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Brand string  `json:"brand"`          // por enquanto só "samsung"
	Host  string  `json:"host,omitempty"` // IPv4 da rede local; só o administrador recebe
	Floor string  `json:"floor"`          // "" = ainda sem lugar na planta
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
}

type homeLayout struct {
	Floors  []homeFloor  `json:"floors"`
	Devices []homeDevice `json:"devices"`
}

type homeState struct {
	State string `json:"state"`           // on | standby | off
	Model string `json:"model,omitempty"` // modelo informado pela própria TV
}

func homeText(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "" || utf8.RuneCountInString(s) > homeMaxName || !utf8.ValidString(s) {
		return "", false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return s, true
}

func homePct(v float64) bool { return v >= 0 && v <= 100 }

// homeHostOK aceita só IPv4 da rede local: o hub não deve consultar a internet nem a si mesmo a pedido de ninguém.
func homeHostOK(host string) bool {
	a, err := netip.ParseAddr(host)
	return err == nil && a.Is4() && (a.IsPrivate() || a.IsLinkLocalUnicast()) && host == a.String()
}

// clean confere e normaliza a planta recebida; devolve o texto do erro (vazio se estiver certa).
func (l *homeLayout) clean() string {
	if len(l.Floors) > homeMaxFloors {
		return "no máximo 8 andares"
	}
	if len(l.Devices) > homeMaxDevices {
		return "no máximo 32 aparelhos"
	}
	seen := map[string]bool{}
	floors := map[string]bool{}
	use := func(id string) bool {
		if !homeIDRe.MatchString(id) || seen[id] {
			return false
		}
		seen[id] = true
		return true
	}
	if l.Floors == nil {
		l.Floors = []homeFloor{}
	}
	if l.Devices == nil {
		l.Devices = []homeDevice{}
	}
	for i := range l.Floors {
		f := &l.Floors[i]
		var ok bool
		if f.Name, ok = homeText(f.Name); !ok || !use(f.ID) {
			return "andar inválido (nome de 1 a 40 caracteres e código único)"
		}
		floors[f.ID] = true
		if len(f.Rooms) > homeMaxRooms {
			return "no máximo 24 cômodos por andar"
		}
		if f.Rooms == nil {
			f.Rooms = []homeRoom{}
		}
		for j := range f.Rooms {
			r := &f.Rooms[j]
			if r.Name, ok = homeText(r.Name); !ok || !use(r.ID) {
				return "cômodo inválido (nome de 1 a 40 caracteres e código único)"
			}
			if !homePct(r.X) || !homePct(r.Y) || r.W < 2 || r.H < 2 || r.X+r.W > 100.01 || r.Y+r.H > 100.01 {
				return "cômodo " + r.Name + " fora da área da planta"
			}
			if r.Color != "" && !homeColorRe.MatchString(r.Color) {
				return "cor inválida no cômodo " + r.Name
			}
		}
	}
	for i := range l.Devices {
		v := &l.Devices[i]
		var ok bool
		if v.Name, ok = homeText(v.Name); !ok || !use(v.ID) {
			return "aparelho inválido (nome de 1 a 40 caracteres e código único)"
		}
		if v.Brand != "samsung" {
			return "marca não suportada em " + v.Name + " (por enquanto só Samsung)"
		}
		v.Host = strings.TrimSpace(v.Host)
		if !homeHostOK(v.Host) {
			return "endereço de " + v.Name + " deve ser um IP da rede local (ex.: 192.168.0.40)"
		}
		if v.Floor != "" && !floors[v.Floor] {
			return v.Name + ": andar inexistente"
		}
		if !homePct(v.X) || !homePct(v.Y) {
			return v.Name + ": posição fora da planta"
		}
	}
	return ""
}

func (s *store) homeLayout(ctx context.Context) (homeLayout, error) {
	l := homeLayout{Floors: []homeFloor{}, Devices: []homeDevice{}}
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT layout FROM desk_home WHERE id = 1`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return l, nil
	}
	if err != nil {
		return l, err
	}
	if err := json.Unmarshal([]byte(raw), &l); err != nil {
		return homeLayout{Floors: []homeFloor{}, Devices: []homeDevice{}}, err
	}
	return l, nil
}

// ---------- estado das TVs ----------

// homeProbe pergunta à TV Samsung pela API de rede dela. Sem resposta = desligada (ou fora da rede).
// É variável para os testes trocarem a consulta; em produção sempre aponta para a TV na porta 8001.
var homeProbe = func(ctx context.Context, host string) homeState {
	return samsungState(ctx, "http://"+net.JoinHostPort(host, "8001")+"/api/v2/")
}

func samsungState(ctx context.Context, apiURL string) homeState {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return homeState{State: "off"}
	}
	cl := &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := cl.Do(req)
	if err != nil {
		return homeState{State: "off"}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return homeState{State: "off"}
	}
	var info struct {
		Device struct {
			PowerState string `json:"PowerState"`
			ModelName  string `json:"modelName"`
		} `json:"device"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&info) != nil {
		return homeState{State: "on"} // respondeu mas em formato inesperado: está acordada
	}
	st := homeState{State: "on", Model: info.Device.ModelName}
	if strings.EqualFold(info.Device.PowerState, "standby") {
		st.State = "standby"
	}
	return st
}

type homeCacheEntry struct {
	st homeState
	at time.Time
}

type homeCache struct {
	mu sync.Mutex
	m  map[string]homeCacheEntry
}

// statuses consulta as TVs em paralelo; duas pessoas com a janela aberta não dobram as consultas (guarda o resultado por alguns segundos).
func (c *homeCache) statuses(ctx context.Context, devs []homeDevice) map[string]homeState {
	out := make(map[string]homeState, len(devs))
	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, v := range devs {
		c.mu.Lock()
		e, ok := c.m[v.Host]
		c.mu.Unlock()
		if ok && time.Since(e.at) < homeStatusTTL {
			out[v.ID] = e.st
			continue
		}
		wg.Add(1)
		go func(v homeDevice) {
			defer wg.Done()
			st := homeProbe(ctx, v.Host)
			c.mu.Lock()
			if c.m == nil {
				c.m = map[string]homeCacheEntry{}
			}
			c.m[v.Host] = homeCacheEntry{st, time.Now()}
			c.mu.Unlock()
			mu.Lock()
			out[v.ID] = st
			mu.Unlock()
		}(v)
	}
	wg.Wait()
	return out
}

// ---------- rotas ----------

func (d *deskAPI) registerHome(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/desk/home", d.guard(false, false, d.homeGet))
	mux.HandleFunc("GET /api/desk/home/status", d.guard(false, false, d.homeStatus))
	mux.HandleFunc("PUT /api/desk/admin/home", d.guard(true, false, d.homePut))
}

func (d *deskAPI) homeGet(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	l, err := d.st.homeLayout(r.Context())
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha lendo a planta da casa")
		return
	}
	if !u.IsAdmin { // o IP das TVs só serve a quem edita
		for i := range l.Devices {
			l.Devices[i].Host = ""
		}
	}
	writeStatus(w, http.StatusOK, l)
}

func (d *deskAPI) homeStatus(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	l, err := d.st.homeLayout(r.Context())
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha lendo a planta da casa")
		return
	}
	writeStatus(w, http.StatusOK, d.home.statuses(r.Context(), l.Devices))
}

func (d *deskAPI) homePut(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var l homeLayout
	if !deskDecode(w, r, &l) {
		return
	}
	if msg := l.clean(); msg != "" {
		deskErr(w, http.StatusBadRequest, msg)
		return
	}
	raw, _ := json.Marshal(l)
	if _, err := d.st.db.ExecContext(r.Context(), `INSERT INTO desk_home (id, layout) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET layout = excluded.layout`, string(raw)); err != nil {
		deskErr(w, http.StatusInternalServerError, "falha salvando a planta da casa")
		return
	}
	writeStatus(w, http.StatusOK, l)
}
