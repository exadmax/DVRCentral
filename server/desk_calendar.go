// Agregador de calendários do Desktop: cada usuário cadastra as próprias agendas iCal (Google Agenda, Outlook, Nextcloud...), que
// ficam só dele. O servidor guarda as URLs (são segredos: quem tem a URL lê a agenda), baixa o iCal com cache e entrega o texto
// ao Desktop, que monta o calendário e dispara os avisos. As agendas da casa (agenda do painel) continuam sendo lidas de /api/ics.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const deskCalendarMigration = `CREATE TABLE IF NOT EXISTS desk_calendars (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	color TEXT NOT NULL DEFAULT '#4DA3FF',
	url TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS desk_calendars_user ON desk_calendars (user_id);
CREATE TABLE IF NOT EXISTS desk_prefs (
	user_id INTEGER PRIMARY KEY,
	data TEXT NOT NULL
);`

const (
	deskMaxCalendars = 12
	deskCalTTL       = 5 * time.Minute
	deskCalMaxBytes  = 8 << 20
	deskMaxPrefs     = 8192
)

var deskColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type deskCal struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Color   string `json:"color"`
	URL     string `json:"url"` // mascarada nas respostas
	Enabled bool   `json:"enabled"`
	url     string // URL completa (nunca sai pela API)
}

func (s *store) deskCalendars(ctx context.Context, userID int64) ([]deskCal, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, color, url, enabled FROM desk_calendars WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []deskCal{}
	for rows.Next() {
		var c deskCal
		var en int
		if err := rows.Scan(&c.ID, &c.Name, &c.Color, &c.url, &en); err != nil {
			return nil, err
		}
		c.Enabled, c.URL = en == 1, maskURL(c.url)
		out = append(out, c)
	}
	return out, rows.Err()
}

// deskCalendar filtra por dono: um usuário nunca alcança a agenda de outro.
func (s *store) deskCalendar(ctx context.Context, userID, id int64) (*deskCal, error) {
	var c deskCal
	var en int
	err := s.db.QueryRowContext(ctx, `SELECT id, name, color, url, enabled FROM desk_calendars WHERE id = ? AND user_id = ?`, id, userID).
		Scan(&c.ID, &c.Name, &c.Color, &c.url, &en)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errDeskNotFound
	}
	c.Enabled, c.URL = en == 1, maskURL(c.url)
	return &c, err
}

// normalizeICalURL aceita http(s) e webcal:// (o esquema que o Google e o Apple oferecem).
func normalizeICalURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if rest, ok := strings.CutPrefix(strings.ToLower(raw), "webcal://"); ok {
		raw = "https://" + raw[len(raw)-len(rest):]
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || len(raw) > 500 {
		return "", errors.New("informe o endereço iCal da agenda (começa com https:// ou webcal://, até 500 caracteres)")
	}
	return raw, nil
}

// isPublicIP: o servidor só baixa agendas da internet. Endereços da rede da casa, do próprio servidor e de nuvem (metadados)
// ficam de fora, para o campo de URL não virar um jeito de sondar a rede interna.
func isPublicIP(ip net.IP) bool {
	if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1]&0xC0 == 64 { // 100.64.0.0/10 (CGNAT)
		return false
	}
	return true
}

func newCalClient() *http.Client {
	d := &net.Dialer{Timeout: 10 * time.Second, Control: func(network, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil || !isPublicIP(net.ParseIP(host)) {
			return fmt.Errorf("endereço não permitido: %s", address)
		}
		return nil
	}}
	return &http.Client{
		Timeout:   20 * time.Second,
		Transport: &http.Transport{DialContext: d.DialContext, TLSHandshakeTimeout: 10 * time.Second, MaxIdleConns: 4},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("redirecionamentos demais")
			}
			return nil
		},
	}
}

type calCacheEntry struct {
	text string
	at   time.Time
}

type deskCalCache struct {
	mu sync.Mutex
	m  map[int64]calCacheEntry
}

func (c *deskCalCache) get(id int64) (calCacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[id]
	return e, ok
}

func (c *deskCalCache) set(id int64, text string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.m == nil {
		c.m = map[int64]calCacheEntry{}
	}
	c.m[id] = calCacheEntry{text, time.Now()}
}

func (c *deskCalCache) drop(id int64) {
	c.mu.Lock()
	delete(c.m, id)
	c.mu.Unlock()
}

func (d *deskAPI) fetchICal(ctx context.Context, rawURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := d.calClient.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err // o texto da URL é um segredo: não vai para a mensagem
		}
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("o servidor da agenda respondeu HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, deskCalMaxBytes))
	if err != nil {
		return "", err
	}
	if !strings.Contains(string(b[:min(len(b), 400)]), "BEGIN:VCALENDAR") {
		return "", errors.New("o endereço não devolveu uma agenda iCal")
	}
	return string(b), nil
}

func (d *deskAPI) registerCalendar(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/desk/calendars", d.guard(false, false, d.calList))
	mux.HandleFunc("POST /api/desk/calendars", d.guard(false, false, d.calCreate))
	mux.HandleFunc("PUT /api/desk/calendars/{id}", d.guard(false, false, d.calUpdate))
	mux.HandleFunc("DELETE /api/desk/calendars/{id}", d.guard(false, false, d.calDelete))
	mux.HandleFunc("GET /api/desk/calendars/feed", d.guard(false, false, d.calFeed))
	mux.HandleFunc("GET /api/desk/prefs", d.guard(false, false, d.prefsGet))
	mux.HandleFunc("PUT /api/desk/prefs", d.guard(false, false, d.prefsPut))
}

func (d *deskAPI) calList(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	list, err := d.st.deskCalendars(r.Context(), u.ID)
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha lendo as agendas")
		return
	}
	writeStatus(w, http.StatusOK, list)
}

type calInput struct {
	Name    string `json:"name"`
	Color   string `json:"color"`
	URL     string `json:"url"`
	Enabled *bool  `json:"enabled"`
}

func (in *calInput) clean() error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len([]rune(in.Name)) > 40 {
		return errors.New("dê um nome à agenda (até 40 caracteres)")
	}
	if !deskColorRe.MatchString(in.Color) {
		in.Color = "#4DA3FF"
	}
	return nil
}

func (d *deskAPI) calCreate(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in calInput
	if !deskDecode(w, r, &in) {
		return
	}
	if err := in.clean(); err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	raw, err := normalizeICalURL(in.URL)
	if err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if n, _ := d.st.deskCalendars(r.Context(), u.ID); len(n) >= deskMaxCalendars {
		deskErr(w, http.StatusBadRequest, "no máximo "+strconv.Itoa(deskMaxCalendars)+" agendas por usuário")
		return
	}
	// confere a URL antes de guardar: um endereço errado só daria uma agenda vazia sem explicação
	if _, err := d.fetchICal(r.Context(), raw); err != nil {
		deskErr(w, http.StatusBadRequest, "não foi possível ler a agenda: "+err.Error())
		return
	}
	res, err := d.st.db.ExecContext(r.Context(), `INSERT INTO desk_calendars (user_id, name, color, url, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
		u.ID, in.Name, in.Color, raw, time.Now().Unix())
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha salvando a agenda")
		return
	}
	id, _ := res.LastInsertId()
	c, _ := d.st.deskCalendar(r.Context(), u.ID, id)
	writeStatus(w, http.StatusCreated, c)
}

func (d *deskAPI) calUpdate(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	old, err := d.st.deskCalendar(r.Context(), u.ID, id)
	if err != nil {
		deskErr(w, http.StatusNotFound, "agenda não encontrada")
		return
	}
	var in calInput
	if !deskDecode(w, r, &in) {
		return
	}
	if err := in.clean(); err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	raw := old.url
	if t := strings.TrimSpace(in.URL); t != "" && !isMasked(t) { // em branco ou mascarada = manter a atual
		if raw, err = normalizeICalURL(t); err != nil {
			deskErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if _, err := d.fetchICal(r.Context(), raw); err != nil {
			deskErr(w, http.StatusBadRequest, "não foi possível ler a agenda: "+err.Error())
			return
		}
	}
	en := old.Enabled
	if in.Enabled != nil {
		en = *in.Enabled
	}
	if _, err := d.st.db.ExecContext(r.Context(), `UPDATE desk_calendars SET name = ?, color = ?, url = ?, enabled = ? WHERE id = ? AND user_id = ?`,
		in.Name, in.Color, raw, b2i(en), id, u.ID); err != nil {
		deskErr(w, http.StatusInternalServerError, "falha salvando a agenda")
		return
	}
	d.calCache.drop(id)
	c, _ := d.st.deskCalendar(r.Context(), u.ID, id)
	writeStatus(w, http.StatusOK, c)
}

func (d *deskAPI) calDelete(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	res, err := d.st.db.ExecContext(r.Context(), `DELETE FROM desk_calendars WHERE id = ? AND user_id = ?`, id, u.ID)
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha removendo a agenda")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		deskErr(w, http.StatusNotFound, "agenda não encontrada")
		return
	}
	d.calCache.drop(id)
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}

type calFeedSource struct {
	Who   string `json:"who"`
	Label string `json:"label"`
	Color string `json:"color"`
	Text  string `json:"text"`
	Stale bool   `json:"stale,omitempty"`
	Error string `json:"error,omitempty"`
}

// calFeed devolve o iCal de cada agenda ligada do usuário (mesmo formato de /api/ics, que o Desktop já sabe ler). Com
// falha na origem, usa a última cópia boa (stale); sem cópia, informa o erro dessa agenda sem derrubar as outras.
func (d *deskAPI) calFeed(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	list, err := d.st.deskCalendars(r.Context(), u.ID)
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha lendo as agendas")
		return
	}
	enabled := []deskCal{}
	for _, c := range list {
		if c.Enabled {
			enabled = append(enabled, c)
		}
	}
	out := make([]calFeedSource, len(enabled))
	var wg sync.WaitGroup
	for i, c := range enabled {
		out[i] = calFeedSource{Who: "u" + strconv.FormatInt(c.ID, 10), Label: c.Name, Color: c.Color}
		wg.Add(1)
		go func(s *calFeedSource, c deskCal) {
			defer wg.Done()
			if e, ok := d.calCache.get(c.ID); ok && time.Since(e.at) < deskCalTTL {
				s.Text = e.text
				return
			}
			text, err := d.fetchICal(r.Context(), c.url)
			if err == nil {
				d.calCache.set(c.ID, text)
				s.Text = text
				return
			}
			if e, ok := d.calCache.get(c.ID); ok {
				s.Text, s.Stale = e.text, true
				return
			}
			s.Error = err.Error()
		}(&out[i], c)
	}
	wg.Wait()
	writeStatus(w, http.StatusOK, map[string]any{"sources": out})
}

// ---------- preferências (por usuário) ----------

// Um objeto JSON opaco (até 8 KB): quem sabe o que cada campo significa é a tela (avisos do calendário, agendas da casa...).
func (d *deskAPI) prefsGet(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var data string
	err := d.st.db.QueryRowContext(r.Context(), `SELECT data FROM desk_prefs WHERE user_id = ?`, u.ID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		data = "{}"
	} else if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha lendo as preferências")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	io.WriteString(w, data)
}

func (d *deskAPI) prefsPut(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in map[string]any
	if !deskDecode(w, r, &in) {
		return
	}
	b, err := json.Marshal(in)
	if err != nil || len(b) > deskMaxPrefs {
		deskErr(w, http.StatusRequestEntityTooLarge, "preferências grandes demais")
		return
	}
	if _, err := d.st.db.ExecContext(r.Context(), `INSERT INTO desk_prefs (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`, u.ID, string(b)); err != nil {
		deskErr(w, http.StatusInternalServerError, "falha salvando as preferências")
		return
	}
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}
