// Atualizações dos componentes de terceiros do Diogows (Webamp, JS Paint, js-dos, ZetaJS, EmulatorJS e as bibliotecas Go de e-mail): uma tela
// em Administração, no estilo do Windows Update, que consulta os registros públicos (npm, GitHub e proxy.golang.org) e mostra o que tem versão nova.
//
// Só o administrador vê e usa. A consulta vai a três endereços fixos (nada vem de página nem de usuário) e só lê. Instalar é diferente:
//   - o Webamp é um arquivo único e tem "Atualizar" de um clique: o hub baixa o pacote do npm, confere o hash (sha512) e guarda o arquivo em
//     desk/_vendor/, que tem prioridade sobre o do pacote do Diogows e SOBREVIVE a uma nova instalação (o install.sh refaz só a pasta www);
//   - os demais ficam como aviso, com o que fazer: o JS Paint tem ajustes nossos no index.html, o js-dos e o ZetaJS precisam combinar com os
//     arquivos que os acompanham e as bibliotecas Go exigem recompilar o hub.
package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	updNPMBase     = "https://registry.npmjs.org"
	updGitHubBase  = "https://api.github.com"
	updGoProxyBase = "https://proxy.golang.org"
)

// UpdatesConfig é a seção "updates" de "desk" no hub.config.json.
type UpdatesConfig struct {
	Disabled  bool `json:"disabled"`  // true tira a tela e a verificação (nenhuma consulta sai do servidor)
	CheckDays int  `json:"checkDays"` // verificação automática a cada N dias (padrão 7; negativo desliga e deixa só o botão)
}

type updComp struct {
	ID, Name, License string
	Kind              string // npm | commit | release | go
	Ref               string // pacote npm, "dono/repositório" do GitHub ou caminho do módulo Go
	Mode              string // auto (instala pelo Diogows) | manual (só avisa)
	Manifest          string // chave em vendor/components.json (versão do que vem no pacote)
	CDN               bool   // vem do CDN, sem versão fixada aqui
	How               string // o que fazer quando o modo é manual
}

var updCatalog = []updComp{
	{ID: "webamp", Name: "Webamp (Player de Música)", License: "MIT", Kind: "npm", Ref: "webamp", Mode: "auto", Manifest: "webamp"},
	{ID: "jspaint", Name: "JS Paint (Paint)", License: "MIT", Kind: "commit", Ref: "1j01/jspaint", Mode: "manual", Manifest: "jspaint",
		How: "Copie de novo as pastas listadas em docs/licencas.md e refaça o ajuste do index.html (política de conteúdo fechada e remoções). Depois teste abrir e salvar no Paint."},
	{ID: "js-dos", Name: "js-dos (programas DOS)", License: "GPL-2.0", Kind: "npm", Ref: "js-dos", Mode: "manual", Manifest: "js-dos",
		How: "Rode npm pack js-dos emulators e troque os arquivos de src/vendor/js-dos/ (o js-dos e o pacote emulators andam juntos). Teste um programa DOS e um sistema virtual."},
	{ID: "emulators", Name: "emulators (DOSBox e DOSBox-X em WebAssembly)", License: "GPL-2.0", Kind: "npm", Ref: "emulators", Mode: "manual", Manifest: "emulators",
		How: "Vem junto com o js-dos: atualize os dois juntos (npm pack js-dos emulators)."},
	{ID: "zetajs", Name: "ZetaJS (LiteOffice Completo)", License: "MIT", Kind: "npm", Ref: "zetajs", Mode: "manual", Manifest: "zetajs",
		How: "Troque src/vendor/zetajs/zeta.js pelo do pacote npm zetajs. O ZetaOffice em si vem do CDN (sempre a versão mais nova)."},
	{ID: "emulatorjs", Name: "EmulatorJS (Emuladores de consoles)", License: "GPL-3.0", Kind: "release", Ref: "EmulatorJS/EmulatorJS", Mode: "manual", CDN: true,
		How: "O Diogows carrega a versão estável do CDN do EmulatorJS, então já usa a mais nova sem você fazer nada. Só vale agir se você copiou uma versão local para vendor/emulatorjs/data/."},
	{ID: "go-imap", Name: "go-imap (e-mail, no hub)", License: "MIT", Kind: "go", Ref: "github.com/emersion/go-imap/v2", Mode: "manual",
		How: "Exige recompilar o hub: cd server && go get github.com/emersion/go-imap/v2@latest && go mod tidy && go vet ./... && go test ./... e então empacotar e instalar."},
	{ID: "go-message", Name: "go-message (e-mail, no hub)", License: "MIT", Kind: "go", Ref: "github.com/emersion/go-message", Mode: "manual",
		How: "Exige recompilar o hub (go get, go mod tidy, go vet e go test, depois empacotar e instalar)."},
	{ID: "go-sasl", Name: "go-sasl (e-mail, no hub)", License: "MIT", Kind: "go", Ref: "github.com/emersion/go-sasl", Mode: "manual",
		How: "Exige recompilar o hub (go get, go mod tidy, go vet e go test, depois empacotar e instalar)."},
}

type updResult struct {
	Latest string `json:"latest"`
	Err    string `json:"error,omitempty"`
}

type deskUpdates struct {
	mu        sync.Mutex
	checkedAt time.Time
	res       map[string]updResult
	busy      bool
	cli       *http.Client
	loaded    bool
}

func newDeskUpdates() *deskUpdates {
	return &deskUpdates{res: map[string]updResult{}, cli: newSafeClient(20 * time.Second)}
}

// ---------- versões ----------

func semParse(v string) (core []int, pre string) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.Index(v, "+"); i >= 0 {
		v = v[:i]
	}
	if i := strings.Index(v, "-"); i >= 0 {
		v, pre = v[:i], v[i+1:]
	}
	for _, p := range strings.Split(v, ".") {
		n, _ := strconv.Atoi(p)
		core = append(core, n)
	}
	return
}

// semCmp compara duas versões (2.3.1, v1.2.0, 2.0.0-beta.8): -1, 0 ou 1.
func semCmp(a, b string) int {
	ca, pa := semParse(a)
	cb, pb := semParse(b)
	for i := 0; i < len(ca) || i < len(cb); i++ {
		var x, y int
		if i < len(ca) {
			x = ca[i]
		}
		if i < len(cb) {
			y = cb[i]
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	if pa == pb {
		return 0
	}
	if pa == "" { // sem sufixo é a versão final: vale mais que beta e rc
		return 1
	}
	if pb == "" {
		return -1
	}
	ia, ib := strings.Split(pa, "."), strings.Split(pb, ".")
	for i := 0; i < len(ia) && i < len(ib); i++ {
		na, ea := strconv.Atoi(ia[i])
		nb, eb := strconv.Atoi(ib[i])
		switch {
		case ea == nil && eb == nil && na != nb:
			if na < nb {
				return -1
			}
			return 1
		case ea == nil && eb != nil:
			return -1
		case ea != nil && eb == nil:
			return 1
		case ea != nil && eb != nil && ia[i] != ib[i]:
			if ia[i] < ib[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case len(ia) < len(ib):
		return -1
	case len(ia) > len(ib):
		return 1
	}
	return 0
}

func updStatus(c updComp, installed, latest, errText string) string {
	switch {
	case latest == "" && errText != "":
		return "erro"
	case latest == "":
		return "nao-verificado"
	case installed == "":
		return "informativo"
	case c.Kind == "commit":
		if strings.HasPrefix(latest, installed) || strings.HasPrefix(installed, latest) {
			return "atual"
		}
		return "disponivel"
	case semCmp(latest, installed) > 0:
		return "disponivel"
	}
	return "atual"
}

// vendorManifest lê vendor/components.json: a versão de cada componente que vem no pacote do Diogows.
func (d *deskAPI) vendorManifest() map[string]string {
	m := map[string]string{}
	if d.staticDir == "" {
		return m
	}
	if b, err := os.ReadFile(filepath.Join(d.staticDir, "vendor", "components.json")); err == nil {
		_ = json.Unmarshal(b, &m)
	}
	return m
}

func (d *deskAPI) overlayDir() string { return filepath.Join(d.dir, "_vendor") }

func (d *deskAPI) overlayVersion() string {
	b, err := os.ReadFile(filepath.Join(d.overlayDir(), "state.json"))
	if err != nil {
		return ""
	}
	var m map[string]string
	if json.Unmarshal(b, &m) != nil {
		return ""
	}
	if _, err := os.Stat(filepath.Join(d.overlayDir(), "webamp.bundle.min.js")); err != nil {
		return ""
	}
	return m["webamp"]
}

func (d *deskAPI) writeOverlayState(ver string) error {
	b, _ := json.Marshal(map[string]string{"webamp": ver})
	return os.WriteFile(filepath.Join(d.overlayDir(), "state.json"), b, 0o600)
}

func (d *deskAPI) removeOverlay() {
	_ = os.Remove(filepath.Join(d.overlayDir(), "webamp.bundle.min.js"))
	_ = os.Remove(filepath.Join(d.overlayDir(), "state.json"))
}

// updInstalled devolve a versão em uso e se ela vem da sobreposição (atualizada pelo Diogows).
func (d *deskAPI) updInstalled(c updComp) (ver string, overlay bool) {
	switch {
	case c.Kind == "go":
		if bi, ok := debug.ReadBuildInfo(); ok {
			for _, dep := range bi.Deps {
				if dep.Path == c.Ref {
					return dep.Version, false
				}
			}
		}
		return "", false
	case c.CDN:
		return "", false
	}
	pk := d.vendorManifest()[c.Manifest]
	if c.ID == "webamp" {
		if ov := d.overlayVersion(); ov != "" {
			if pk == "" || semCmp(ov, pk) >= 0 {
				return ov, true
			}
			d.removeOverlay() // o pacote instalado depois é mais novo que o arquivo guardado: a sobreposição não vale mais
		}
	}
	return pk, false
}

// ---------- consulta ----------

func (u *deskUpdates) getJSON(ctx context.Context, url string, v any) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	req.Header.Set("User-Agent", "CentralDiogo-updates")
	req.Header.Set("Accept", "application/json")
	resp, err := u.cli.Do(req)
	if err != nil {
		return fmt.Errorf("sem resposta: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("o servidor respondeu %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(v)
}

type npmDist struct {
	Version string `json:"version"`
	Dist    struct {
		Tarball   string `json:"tarball"`
		Integrity string `json:"integrity"`
	} `json:"dist"`
}

func (u *deskUpdates) latestOf(ctx context.Context, c updComp) (string, error) {
	switch c.Kind {
	case "npm":
		var m npmDist
		if err := u.getJSON(ctx, updNPMBase+"/"+c.Ref+"/latest", &m); err != nil {
			return "", err
		}
		return m.Version, nil
	case "commit":
		var m struct {
			SHA string `json:"sha"`
		}
		if err := u.getJSON(ctx, updGitHubBase+"/repos/"+c.Ref+"/commits/HEAD", &m); err != nil {
			return "", err
		}
		if len(m.SHA) < 7 {
			return "", errors.New("resposta inesperada do GitHub")
		}
		return m.SHA[:7], nil
	case "release":
		var m struct {
			Tag string `json:"tag_name"`
		}
		if err := u.getJSON(ctx, updGitHubBase+"/repos/"+c.Ref+"/releases/latest", &m); err != nil {
			return "", err
		}
		return m.Tag, nil
	case "go":
		var m struct {
			Version string `json:"Version"`
		}
		if err := u.getJSON(ctx, updGoProxyBase+"/"+c.Ref+"/@latest", &m); err != nil {
			return "", err
		}
		return m.Version, nil
	}
	return "", errors.New("tipo desconhecido")
}

func (d *deskAPI) updLoad() {
	d.upd.mu.Lock()
	defer d.upd.mu.Unlock()
	if d.upd.loaded {
		return
	}
	d.upd.loaded = true
	b, err := os.ReadFile(filepath.Join(d.dir, "_updates.json"))
	if err != nil {
		return
	}
	var f struct {
		CheckedAt int64                `json:"checked_at"`
		Res       map[string]updResult `json:"results"`
	}
	if json.Unmarshal(b, &f) == nil && f.Res != nil {
		d.upd.res, d.upd.checkedAt = f.Res, time.Unix(f.CheckedAt, 0)
	}
}

// updCheck consulta todos os componentes (até 4 ao mesmo tempo) e guarda o resultado.
func (d *deskAPI) updCheck(ctx context.Context) error {
	d.updLoad()
	d.upd.mu.Lock()
	if d.upd.busy {
		d.upd.mu.Unlock()
		return errors.New("já tem uma verificação em andamento")
	}
	d.upd.busy = true
	d.upd.mu.Unlock()
	defer func() { d.upd.mu.Lock(); d.upd.busy = false; d.upd.mu.Unlock() }()

	out := make([]updResult, len(updCatalog))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, c := range updCatalog {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			cx, cancel := context.WithTimeout(ctx, 15*time.Second)
			defer cancel()
			v, err := d.upd.latestOf(cx, c)
			if err != nil {
				out[i] = updResult{Err: err.Error()}
				return
			}
			out[i] = updResult{Latest: v}
		}()
	}
	wg.Wait()
	d.upd.mu.Lock()
	for i, c := range updCatalog {
		if out[i].Err != "" { // se esta consulta falhou, mantém a versão que já se sabia
			prev := d.upd.res[c.ID]
			out[i].Latest = prev.Latest
		}
		d.upd.res[c.ID] = out[i]
	}
	d.upd.checkedAt = time.Now()
	snap := struct {
		CheckedAt int64                `json:"checked_at"`
		Res       map[string]updResult `json:"results"`
	}{d.upd.checkedAt.Unix(), d.upd.res}
	d.upd.mu.Unlock()
	if b, err := json.Marshal(snap); err == nil {
		_ = os.MkdirAll(d.dir, 0o700)
		_ = os.WriteFile(filepath.Join(d.dir, "_updates.json"), b, 0o600)
	}
	return nil
}

// ---------- instalar o Webamp ----------

const updWebampMax = 20 << 20

// updApplyWebamp baixa o webamp mais novo do npm, confere o hash e o guarda na sobreposição.
func (d *deskAPI) updApplyWebamp(ctx context.Context) (string, error) {
	var m npmDist
	if err := d.upd.getJSON(ctx, updNPMBase+"/webamp/latest", &m); err != nil {
		return "", err
	}
	if m.Version == "" || !strings.HasPrefix(m.Dist.Tarball, updNPMBase+"/webamp/-/") || !strings.HasPrefix(m.Dist.Integrity, "sha512-") {
		return "", errors.New("o registro não trouxe um pacote verificável")
	}
	want, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(m.Dist.Integrity, "sha512-"))
	if err != nil || len(want) != sha512.Size {
		return "", errors.New("hash do pacote inválido")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, m.Dist.Tarball, nil)
	req.Header.Set("User-Agent", "CentralDiogo-updates")
	resp, err := d.upd.cli.Do(req)
	if err != nil {
		return "", fmt.Errorf("não consegui baixar o pacote: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("o download respondeu %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 40<<20+1))
	if err != nil || len(raw) > 40<<20 {
		return "", errors.New("pacote grande demais ou incompleto")
	}
	if sum := sha512.Sum512(raw); string(sum[:]) != string(want) {
		return "", errors.New("o hash do pacote não confere: não instalei")
	}
	gz, err := gzip.NewReader(strings.NewReader(string(raw)))
	if err != nil {
		return "", errors.New("pacote ilegível")
	}
	tr := tar.NewReader(gz)
	var js []byte
	for {
		h, err := tr.Next()
		if err != nil {
			break
		}
		if h.Name == "package/built/webamp.bundle.min.js" {
			js, err = io.ReadAll(io.LimitReader(tr, updWebampMax+1))
			if err != nil || len(js) > updWebampMax {
				return "", errors.New("arquivo do player grande demais")
			}
			break
		}
	}
	if len(js) < 1024 || !strings.Contains(string(js), "Webamp") {
		return "", errors.New("o pacote não tem o arquivo do player esperado")
	}
	dir := d.overlayDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	tmp := filepath.Join(dir, "webamp.bundle.min.js.tmp")
	if err := os.WriteFile(tmp, js, 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, filepath.Join(dir, "webamp.bundle.min.js")); err != nil {
		return "", err
	}
	if err := d.writeOverlayState(m.Version); err != nil {
		return "", err
	}
	return m.Version, nil
}

// ---------- rotas ----------

type updView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	License   string `json:"license"`
	Installed string `json:"installed"`
	Latest    string `json:"latest"`
	Status    string `json:"status"` // atual | disponivel | informativo | erro | nao-verificado
	Mode      string `json:"mode"`   // auto | manual
	How       string `json:"how,omitempty"`
	Overlay   bool   `json:"overlay"`
	CDN       bool   `json:"cdn,omitempty"`
	Error     string `json:"error,omitempty"`
}

func (d *deskAPI) updList(w http.ResponseWriter) {
	d.updLoad()
	d.upd.mu.Lock()
	res, at, busy := make(map[string]updResult, len(d.upd.res)), d.upd.checkedAt, d.upd.busy
	for k, v := range d.upd.res {
		res[k] = v
	}
	d.upd.mu.Unlock()
	list := make([]updView, 0, len(updCatalog))
	n := 0
	for _, c := range updCatalog {
		ins, ov := d.updInstalled(c)
		r := res[c.ID]
		v := updView{ID: c.ID, Name: c.Name, License: c.License, Installed: ins, Latest: r.Latest, Mode: c.Mode, How: c.How, Overlay: ov, CDN: c.CDN, Error: r.Err}
		v.Status = updStatus(c, ins, r.Latest, r.Err)
		if v.Status == "disponivel" {
			n++
		}
		list = append(list, v)
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].Status == "disponivel" && list[j].Status != "disponivel" })
	var checked int64
	if !at.IsZero() {
		checked = at.Unix()
	}
	writeStatus(w, http.StatusOK, map[string]any{"components": list, "available": n, "checked_at": checked, "checking": busy, "auto_days": d.updDays()})
}

func (d *deskAPI) updDays() int {
	if d.cfg.Updates.CheckDays == 0 {
		return 7
	}
	return d.cfg.Updates.CheckDays
}

func (d *deskAPI) updGuard(next deskHandler) deskHandler {
	return func(w http.ResponseWriter, r *http.Request, u *DeskUser) {
		if d.cfg.Updates.Disabled {
			deskErr(w, http.StatusNotFound, "as atualizações estão desligadas neste servidor")
			return
		}
		next(w, r, u)
	}
}

func (d *deskAPI) registerUpdates(mux *http.ServeMux) {
	d.upd = newDeskUpdates()
	mux.HandleFunc("GET /api/desk/updates", d.guard(true, false, d.updGuard(func(w http.ResponseWriter, r *http.Request, u *DeskUser) { d.updList(w) })))
	mux.HandleFunc("POST /api/desk/updates/check", d.guard(true, false, d.updGuard(func(w http.ResponseWriter, r *http.Request, u *DeskUser) {
		if err := d.updCheck(r.Context()); err != nil {
			deskErr(w, http.StatusConflict, err.Error())
			return
		}
		log.Printf("desktop: atualizações: %s verificou as versões dos componentes", u.Username)
		d.updList(w)
	})))
	mux.HandleFunc("POST /api/desk/updates/{id}/apply", d.guard(true, false, d.updGuard(func(w http.ResponseWriter, r *http.Request, u *DeskUser) {
		if r.PathValue("id") != "webamp" {
			deskErr(w, http.StatusBadRequest, "este componente é atualizado à mão (veja o que fazer na tela)")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		ver, err := d.updApplyWebamp(ctx)
		if err != nil {
			deskErr(w, http.StatusBadGateway, err.Error())
			return
		}
		d.upd.mu.Lock()
		d.upd.res["webamp"] = updResult{Latest: ver}
		d.upd.mu.Unlock()
		log.Printf("desktop: atualizações: %s atualizou o Webamp para %s", u.Username, ver)
		d.updList(w)
	})))
	mux.HandleFunc("POST /api/desk/updates/{id}/revert", d.guard(true, false, d.updGuard(func(w http.ResponseWriter, r *http.Request, u *DeskUser) {
		if r.PathValue("id") != "webamp" {
			deskErr(w, http.StatusBadRequest, "nada para desfazer neste componente")
			return
		}
		d.removeOverlay()
		log.Printf("desktop: atualizações: %s voltou o Webamp à versão do pacote", u.Username)
		d.updList(w)
	})))
	// o Webamp atualizado tem prioridade sobre o arquivo do pacote
	mux.HandleFunc("GET /vendor/webamp/webamp.bundle.min.js", func(w http.ResponseWriter, r *http.Request) {
		if d.overlayVersion() != "" {
			h := w.Header()
			h.Set("Content-Type", "text/javascript; charset=utf-8")
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, filepath.Join(d.overlayDir(), "webamp.bundle.min.js"))
			return
		}
		h := w.Header()
		h.Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(d.staticDir, "vendor", "webamp", "webamp.bundle.min.js"))
	})
}

// startUpdates liga a verificação automática (só o hub de verdade; os testes não chamam): a primeira 2 minutos depois de subir e depois confere a cada hora se já
// passaram os dias configurados.
func (d *deskAPI) startUpdates() {
	if d.cfg.Disabled || d.cfg.Updates.Disabled || d.updDays() < 0 {
		return
	}
	go func() {
		time.Sleep(2 * time.Minute)
		for {
			d.updLoad()
			d.upd.mu.Lock()
			due := time.Since(d.upd.checkedAt) > time.Duration(d.updDays())*24*time.Hour
			d.upd.mu.Unlock()
			if due {
				if err := d.updCheck(context.Background()); err != nil {
					log.Printf("desktop: atualizações: %v", err)
				}
			}
			time.Sleep(time.Hour)
		}
	}()
}
