package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

// ---------- ambiente de teste ----------

type dkEnv struct {
	t    *testing.T
	d    *deskAPI
	h    http.Handler
	tmp  string
	vids string
}

const dkLAN = "192.168.1.20:5000" // aparelho da rede da casa

func newDK(t *testing.T, cfg DeskConfig) *dkEnv {
	t.Helper()
	old := deskPBKDF2Iter
	deskPBKDF2Iter = 1000 // senhas de teste não precisam de 600 mil iterações
	t.Cleanup(func() { deskPBKDF2Iter = old })
	tmp := t.TempDir()
	st, err := openStore(filepath.Join(tmp, "t.db"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.db.Close() })
	vids := filepath.Join(tmp, "videos")
	os.MkdirAll(vids, 0o755)
	d := newDesk(Config{Desk: cfg, Videos: VideosConfig{Dir: vids}}, st, nil, nil, tmp)
	mux := http.NewServeMux()
	d.register(mux)
	return &dkEnv{t: t, d: d, h: d.protectSettings(mux), tmp: tmp, vids: vids}
}

// req faz um pedido como o navegador faria (X-Desk e, se houver, o cookie). Corpo []byte vai cru; outro valor vira JSON.
func (e *dkEnv) req(method, target string, body any, cookie string, remote ...string) *httptest.ResponseRecorder {
	e.t.Helper()
	var rd *bytes.Reader
	ct := ""
	switch b := body.(type) {
	case nil:
		rd = bytes.NewReader(nil)
	case []byte:
		rd = bytes.NewReader(b)
	default:
		j, _ := json.Marshal(b)
		rd, ct = bytes.NewReader(j), "application/json"
	}
	r := httptest.NewRequest(method, target, rd)
	r.Header.Set("X-Desk", "1")
	if ct != "" {
		r.Header.Set("Content-Type", ct)
	}
	if cookie != "" {
		r.AddCookie(&http.Cookie{Name: deskCookie, Value: cookie})
	}
	r.RemoteAddr = dkLAN
	if len(remote) > 0 {
		r.RemoteAddr = remote[0]
	}
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, r)
	return w
}

func dkJSON(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("resposta não é um objeto JSON (%d): %q", w.Code, w.Body.String())
	}
	return m
}

func (e *dkEnv) addUser(name, pass string, admin, term, expl bool) int64 {
	e.t.Helper()
	h, _ := hashDeskPassword(pass)
	id, err := e.d.st.deskCreateUser(context.Background(), DeskUser{Username: name, PassHash: h, IsAdmin: admin, CanTerminal: term, CanExplorer: expl})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *dkEnv) login(name, pass string) string {
	e.t.Helper()
	w := e.req("POST", "/api/desk/login", map[string]string{"username": name, "password": pass}, "")
	if w.Code != 200 {
		e.t.Fatalf("login de %s: %d %s", name, w.Code, w.Body.String())
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == deskCookie {
			return c.Value
		}
	}
	e.t.Fatal("login sem cookie de sessão")
	return ""
}

// apiPath converte uma pasta do sistema no caminho da API ("/C:/x" no Windows, "/tmp/x" no Linux).
func apiPath(dir string) string {
	p := filepath.ToSlash(dir)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

// ---------- sessão, senhas e usuários ----------

func TestDeskPrimeiraInstalacaoESenha(t *testing.T) {
	e := newDK(t, DeskConfig{})
	var logs bytes.Buffer
	log.SetOutput(&logs)
	defer log.SetOutput(os.Stderr)
	e.d.ensureFirstInstall(context.Background())
	m := regexp.MustCompile(`senha inicial "([^"]+)"`).FindStringSubmatch(logs.String())
	if m == nil {
		t.Fatalf("a senha inicial deveria sair no log: %q", logs.String())
	}
	initial := m[1]
	if len(initial) < 12 || initial == "Samsung@123" {
		t.Errorf("senha inicial fraca ou fixa: %q", initial)
	}
	// depois de existir um usuário, não cria outro
	logs.Reset()
	e.d.ensureFirstInstall(context.Background())
	if logs.Len() != 0 {
		t.Error("a primeira instalação não pode se repetir")
	}

	// senha errada, 5 vezes: bloqueia
	for i := 0; i < 5; i++ {
		if w := e.req("POST", "/api/desk/login", map[string]string{"username": "admin", "password": "errada"}, ""); w.Code != 401 {
			t.Fatalf("senha errada deveria dar 401, deu %d", w.Code)
		}
	}
	if w := e.req("POST", "/api/desk/login", map[string]string{"username": "admin", "password": initial}, ""); w.Code != 429 {
		t.Fatalf("depois de 5 falhas deveria bloquear (429), deu %d", w.Code)
	}
}

func TestDeskTrocaObrigatoria(t *testing.T) {
	e := newDK(t, DeskConfig{})
	h, _ := hashDeskPassword("provisoria1")
	e.d.st.deskCreateUser(context.Background(), DeskUser{Username: "ana", PassHash: h, IsAdmin: true, MustChange: true})
	c := e.login("ana", "provisoria1")

	if w := e.req("GET", "/api/desk/me", nil, c); w.Code != 200 || dkJSON(t, w)["must_change"] != true {
		t.Fatalf("/me deveria funcionar e avisar must_change: %d %s", w.Code, w.Body.String())
	}
	if w := e.req("GET", "/api/desk/fs/list?space=home&path=/", nil, c); w.Code != 403 {
		t.Errorf("com a senha provisória o resto fica bloqueado, deu %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/password", map[string]string{"current": "provisoria1", "new": "curta"}, c); w.Code != 400 {
		t.Errorf("senha curta deveria dar 400, deu %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/password", map[string]string{"current": "provisoria1", "new": "provisoria1"}, c); w.Code != 400 {
		t.Errorf("repetir a senha deveria dar 400, deu %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/password", map[string]string{"current": "provisoria1", "new": "definitiva99"}, c); w.Code != 200 {
		t.Fatalf("troca de senha: %d %s", w.Code, w.Body.String())
	}
	if w := e.req("GET", "/api/desk/fs/list?space=home&path=/", nil, c); w.Code != 200 {
		t.Errorf("depois de trocar a senha deveria liberar, deu %d %s", w.Code, w.Body.String())
	}
}

func TestDeskCSRFeSessao(t *testing.T) {
	e := newDK(t, DeskConfig{})
	e.addUser("ana", "senha-da-ana", true, false, false)
	if w := e.req("GET", "/api/desk/me", nil, ""); w.Code != 401 {
		t.Errorf("sem sessão deveria dar 401, deu %d", w.Code)
	}
	c := e.login("ana", "senha-da-ana")

	// POST sem X-Desk (como um formulário de outro site)
	r := httptest.NewRequest("POST", "/api/desk/logout", nil)
	r.AddCookie(&http.Cookie{Name: deskCookie, Value: c})
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Errorf("POST sem X-Desk deveria dar 403, deu %d", w.Code)
	}
	// origem diferente
	r = httptest.NewRequest("POST", "/api/desk/logout", nil)
	r.Header.Set("X-Desk", "1")
	r.Header.Set("Origin", "https://outro.site")
	r.AddCookie(&http.Cookie{Name: deskCookie, Value: c})
	w = httptest.NewRecorder()
	e.h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Errorf("origem estranha deveria dar 403, deu %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/logout", nil, c); w.Code != 200 {
		t.Errorf("logout: %d", w.Code)
	}
	if w := e.req("GET", "/api/desk/me", nil, c); w.Code != 401 {
		t.Errorf("depois de sair a sessão deveria ter acabado, deu %d", w.Code)
	}
}

func TestDeskUsuarios(t *testing.T) {
	e := newDK(t, DeskConfig{})
	e.addUser("admin", "senha-admin1", true, false, false)
	e.addUser("beto", "senha-do-beto", false, false, false)
	ca, cb := e.login("admin", "senha-admin1"), e.login("beto", "senha-do-beto")

	if w := e.req("GET", "/api/desk/admin/users", nil, cb); w.Code != 403 {
		t.Errorf("usuário comum não administra usuários: %d", w.Code)
	}
	w := e.req("POST", "/api/desk/admin/users", map[string]any{"username": "carla", "password": "provisoria1", "can_explorer": true}, ca)
	if w.Code != 201 {
		t.Fatalf("criar usuário: %d %s", w.Code, w.Body.String())
	}
	u := dkJSON(t, w)
	if u["must_change"] != true || u["can_explorer"] != true || u["is_admin"] != false {
		t.Errorf("usuário novo: %v", u)
	}
	if _, has := u["pass_hash"]; has {
		t.Error("o hash da senha não pode sair na API")
	}
	if w := e.req("POST", "/api/desk/admin/users", map[string]any{"username": "carla", "password": "provisoria1"}, ca); w.Code != 409 {
		t.Errorf("nome repetido deveria dar 409, deu %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/admin/users", map[string]any{"username": "a b", "password": "provisoria1"}, ca); w.Code != 400 {
		t.Errorf("nome inválido deveria dar 400, deu %d", w.Code)
	}
	id := int64(u["id"].(float64))
	if w := e.req("PATCH", "/api/desk/admin/users/"+itoa(id), map[string]any{"can_terminal": true}, ca); w.Code != 200 {
		t.Fatalf("liberar o terminal: %d", w.Code)
	}
	got, _ := e.d.st.deskUserBy(context.Background(), "id", id)
	if !got.CanTerminal || !got.CanExplorer {
		t.Errorf("permissões: %+v", got)
	}
	// o último administrador e o próprio não saem
	adm, _ := e.d.st.deskUserBy(context.Background(), "username", "admin")
	if w := e.req("DELETE", "/api/desk/admin/users/"+itoa(adm.ID), nil, ca); w.Code != 400 {
		t.Errorf("remover a si mesmo: %d", w.Code)
	}
	if w := e.req("DELETE", "/api/desk/admin/users/"+itoa(id), nil, ca); w.Code != 200 {
		t.Errorf("remover usuário: %d", w.Code)
	}
	// redefinir a senha exige trocar no próximo login e derruba as sessões do usuário
	beto, _ := e.d.st.deskUserBy(context.Background(), "username", "beto")
	if w := e.req("POST", "/api/desk/admin/users/"+itoa(beto.ID)+"/password", map[string]string{"password": "nova-provisoria"}, ca); w.Code != 200 {
		t.Fatalf("redefinir: %d", w.Code)
	}
	if w := e.req("GET", "/api/desk/me", nil, cb); w.Code != 401 {
		t.Errorf("a sessão antiga do beto deveria ter caído, deu %d", w.Code)
	}
}

// ---------- Meus arquivos (espaço home) ----------

func TestDeskHomeArquivos(t *testing.T) {
	e := newDK(t, DeskConfig{})
	e.addUser("ana", "senha-da-ana", false, false, false)
	e.addUser("beto", "senha-do-beto", false, false, false)
	ca, cb := e.login("ana", "senha-da-ana"), e.login("beto", "senha-do-beto")
	put := func(p, body string, extra string) *httptest.ResponseRecorder {
		return e.req("PUT", "/api/desk/fs/file?space=home&path="+p+extra, []byte(body), ca)
	}

	if w := put("/notas.txt", "hello world", "&text=1"); w.Code != 200 {
		t.Fatalf("gravar: %d %s", w.Code, w.Body.String())
	}
	if w := put("/notas.txt", "outro", "&text=1"); w.Code != 409 {
		t.Errorf("sem overwrite deveria dar 409, deu %d", w.Code)
	}
	if w := put("/notas.txt", "novo texto", "&text=1&overwrite=1"); w.Code != 200 {
		t.Errorf("com overwrite: %d", w.Code)
	}
	if w := put("/ruim.txt", "\xff\xfe", "&text=1"); w.Code != 400 {
		t.Errorf("texto que não é UTF-8 deveria dar 400, deu %d", w.Code)
	}
	if w := put("/sem-pasta/x.txt", "x", ""); w.Code != 400 {
		t.Errorf("pasta de destino inexistente deveria dar 400, deu %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/fs/mkdir", map[string]string{"space": "home", "path": "/docs"}, ca); w.Code != 201 {
		t.Fatalf("mkdir: %d %s", w.Code, w.Body.String())
	}
	if w := put("/docs/dados.bin", "0123456789", ""); w.Code != 200 {
		t.Fatalf("envio: %d %s", w.Code, w.Body.String())
	}

	// leitura inteira e por intervalo (o player de vídeo depende disso)
	w := e.req("GET", "/api/desk/fs/read?space=home&path=/notas.txt&mode=text", nil, ca)
	if w.Code != 200 || w.Body.String() != "novo texto" || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/plain") {
		t.Errorf("ler texto: %d %q %q", w.Code, w.Body.String(), w.Header().Get("Content-Type"))
	}
	r := httptest.NewRequest("GET", "/api/desk/fs/read?space=home&path=/docs/dados.bin&mode=download", nil)
	r.AddCookie(&http.Cookie{Name: deskCookie, Value: ca})
	r.Header.Set("Range", "bytes=3-6")
	w = httptest.NewRecorder()
	e.h.ServeHTTP(w, r)
	if w.Code != 206 || w.Body.String() != "3456" || w.Header().Get("Content-Range") != "bytes 3-6/10" {
		t.Errorf("Range: %d %q %q", w.Code, w.Body.String(), w.Header().Get("Content-Range"))
	}
	r.Header.Set("Range", "bytes=50-")
	w = httptest.NewRecorder()
	e.h.ServeHTTP(w, r)
	if w.Code != 416 {
		t.Errorf("Range fora do arquivo deveria dar 416, deu %d", w.Code)
	}
	// imagens e PDF abrem inline; HTML e SVG nunca
	put("/a.svg", "<svg/>", "")
	if w := e.req("GET", "/api/desk/fs/read?space=home&path=/a.svg&mode=view", nil, ca); w.Code != 415 {
		t.Errorf("SVG não pode ser servido inline, deu %d", w.Code)
	}

	// listar: pastas primeiro
	w = e.req("GET", "/api/desk/fs/list?space=home&path=/", nil, ca)
	ents := dkJSON(t, w)["entries"].([]any)
	if len(ents) < 3 || ents[0].(map[string]any)["name"] != "docs" {
		t.Errorf("listagem: %v", ents)
	}

	// mover/renomear e apagar
	if w := e.req("POST", "/api/desk/fs/move", map[string]string{"space": "home", "from": "/notas.txt", "to": "/docs/notas.txt"}, ca); w.Code != 200 {
		t.Errorf("mover: %d %s", w.Code, w.Body.String())
	}
	if w := e.req("POST", "/api/desk/fs/move", map[string]string{"space": "home", "from": "/docs", "to": "/docs/dentro"}, ca); w.Code != 400 {
		t.Errorf("mover pasta para dentro de si mesma deveria dar 400, deu %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/fs/move", map[string]string{"space": "home", "from": "/a.svg", "to": "/docs/dados.bin"}, ca); w.Code != 409 {
		t.Errorf("mover sobre um item existente deveria dar 409, deu %d", w.Code)
	}
	if w := e.req("DELETE", "/api/desk/fs?space=home&path=/", nil, ca); w.Code != 400 {
		t.Errorf("apagar a raiz deveria dar 400, deu %d", w.Code)
	}
	if w := e.req("DELETE", "/api/desk/fs?space=home&path=/docs", nil, ca); w.Code != 200 {
		t.Errorf("apagar pasta: %d", w.Code)
	}

	// o Beto não vê nada da Ana, e "../" não escapa da pasta
	w = e.req("GET", "/api/desk/fs/list?space=home&path=/", nil, cb)
	if n := len(dkJSON(t, w)["entries"].([]any)); n != 0 {
		t.Errorf("a pasta do Beto deveria estar vazia, tem %d itens", n)
	}
	w = e.req("GET", "/api/desk/fs/list?space=home&path=/../../../etc", nil, cb)
	if w.Code != 404 {
		t.Errorf("../ deveria ficar dentro da pasta do usuário (404), deu %d", w.Code)
	}
}

func TestDeskHomeLinkSimbolicoNaoEscapa(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("link simbólico exige privilégio no Windows")
	}
	e := newDK(t, DeskConfig{})
	id := e.addUser("ana", "senha-da-ana", false, false, false)
	c := e.login("ana", "senha-da-ana")
	e.req("GET", "/api/desk/fs/list?space=home&path=/", nil, c) // cria a pasta
	fora := t.TempDir()
	os.WriteFile(filepath.Join(fora, "segredo.txt"), []byte("x"), 0o644)
	if err := os.Symlink(fora, filepath.Join(e.d.userDir(id), "files", "atalho")); err != nil {
		t.Skip(err)
	}
	if w := e.req("GET", "/api/desk/fs/list?space=home&path=/atalho", nil, c); w.Code != 403 {
		t.Errorf("link para fora da pasta deveria dar 403, deu %d %s", w.Code, w.Body.String())
	}
}

func TestParseRange(t *testing.T) {
	cases := []struct {
		h    string
		s, e int64
		ok   bool
	}{
		{"bytes=0-9", 0, 9, true}, {"bytes=5-", 5, 99, true}, {"bytes=-10", 90, 99, true}, {"bytes=90-500", 90, 99, true},
		{"bytes=100-", 0, 0, false}, {"bytes=9-3", 0, 0, false}, {"bytes=a-b", 0, 0, false}, {"items=0-1", 0, 0, false}, {"bytes=0-1,5-6", 0, 0, false},
	}
	for _, c := range cases {
		s, e, ok := parseRange(c.h, 100)
		if ok != c.ok || (ok && (s != c.s || e != c.e)) {
			t.Errorf("%q: %d-%d %v, esperava %d-%d %v", c.h, s, e, ok, c.s, c.e, c.ok)
		}
	}
}

func TestParseSaidaDoSudo(t *testing.T) {
	raw := []byte("d\t4096\t1700000000.5\tpasta\x00f\t12\t1700000001.0\tarq com espaço.txt\x00N\t0\t1.0\tquebrado\x00lixo\x00")
	got := parseFindList("/etc", raw)
	if len(got) != 3 || got[0].Type != "dir" || got[1].Name != "arq com espaço.txt" || got[1].Size != 12 || got[1].Path != "/etc/arq com espaço.txt" || got[2].Type != "other" {
		t.Errorf("find: %+v", got)
	}
	st, err := parseStat("/etc/hosts", "regular file|220|1700000000\n")
	if err != nil || st.Type != "file" || st.Size != 220 || st.Name != "hosts" {
		t.Errorf("stat: %+v %v", st, err)
	}
	if st, _ := parseStat("/x", "directory|4096|1"); st.Type != "dir" {
		t.Errorf("stat de pasta: %+v", st)
	}
}

// ---------- terminal e arquivos do computador ----------

func TestDeskComputadorPortoes(t *testing.T) {
	// desligado por padrão, mesmo para o administrador
	off := newDK(t, DeskConfig{})
	off.addUser("admin", "senha-admin1", true, false, false)
	c := off.login("admin", "senha-admin1")
	if w := off.req("POST", "/api/desk/shell/unlock", map[string]string{"password": "senha-admin1"}, c); w.Code != 403 {
		t.Errorf("com desk.shell desligado o desbloqueio deveria dar 403, deu %d", w.Code)
	}
	if w := off.req("GET", "/api/desk/fs/list?space=machine&path=/", nil, c); w.Code != 403 {
		t.Errorf("computador com desk.shell desligado: %d", w.Code)
	}

	e := newDK(t, DeskConfig{Shell: true})
	e.addUser("admin", "senha-admin1", true, false, false)
	e.addUser("beto", "senha-do-beto", false, false, false)  // sem permissão
	e.addUser("carla", "senha-da-carla", false, false, true) // só arquivos
	e.addUser("davi", "senha-do-davi", false, true, false)   // só terminal
	ca, cb, cc, cd := e.login("admin", "senha-admin1"), e.login("beto", "senha-do-beto"), e.login("carla", "senha-da-carla"), e.login("davi", "senha-do-davi")
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "oi.txt"), []byte("oi"), 0o644)
	list := "/api/desk/fs/list?space=machine&path=" + apiPath(dir)

	if w := e.req("GET", list, nil, cb); w.Code != 403 || !strings.Contains(w.Body.String(), "permissão") {
		t.Errorf("sem permissão: %d %s", w.Code, w.Body.String())
	}
	if w := e.req("POST", "/api/desk/shell/unlock", map[string]string{"password": "senha-do-beto"}, cb); w.Code != 403 {
		t.Errorf("sem permissão nem desbloqueia: %d", w.Code)
	}
	if w := e.req("GET", list, nil, cd); w.Code != 403 {
		t.Errorf("terminal liberado não dá arquivos: %d", w.Code)
	}
	if w := e.req("GET", list, nil, cc); w.Code != 403 || !strings.Contains(w.Body.String(), "locked") {
		t.Errorf("sem desbloquear: %d %s", w.Code, w.Body.String())
	}
	// internet em HTTP puro é recusada
	if w := e.req("POST", "/api/desk/shell/unlock", map[string]string{"password": "senha-da-carla"}, cc, "8.8.8.8:4000"); w.Code != 403 || !strings.Contains(w.Body.String(), "rede") {
		t.Errorf("IP público em HTTP: %d %s", w.Code, w.Body.String())
	}
	// ...mas um proxy no próprio servidor que repassa o IP da rede privada passa
	if w := e.req("POST", "/api/desk/shell/unlock", map[string]string{"password": "errada"}, cc); w.Code != 401 {
		t.Errorf("senha errada: %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/shell/unlock", map[string]string{"password": "senha-da-carla"}, cc); w.Code != 200 {
		t.Fatalf("desbloqueio: %d %s", w.Code, w.Body.String())
	}
	w := e.req("GET", list, nil, cc)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "oi.txt") {
		t.Fatalf("listar o computador: %d %s", w.Code, w.Body.String())
	}
	// o administrador também precisa desbloquear
	if w := e.req("GET", list, nil, ca); w.Code != 403 {
		t.Errorf("admin sem desbloquear: %d", w.Code)
	}
	e.req("POST", "/api/desk/shell/unlock", map[string]string{"password": "senha-admin1"}, ca)

	// manipular: criar, gravar, renomear e apagar no computador
	novo := apiPath(filepath.Join(dir, "sub"))
	if w := e.req("POST", "/api/desk/fs/mkdir", map[string]string{"space": "machine", "path": novo}, ca); w.Code != 201 {
		t.Fatalf("mkdir no computador: %d %s", w.Code, w.Body.String())
	}
	if w := e.req("PUT", "/api/desk/fs/file?space=machine&path="+novo+"/a.txt&text=1", []byte("abc"), ca); w.Code != 200 {
		t.Fatalf("gravar no computador: %d %s", w.Code, w.Body.String())
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "sub", "a.txt")); string(b) != "abc" {
		t.Errorf("arquivo gravado: %q", b)
	}
	if w := e.req("POST", "/api/desk/fs/move", map[string]string{"space": "machine", "from": novo + "/a.txt", "to": novo + "/b.txt"}, ca); w.Code != 200 {
		t.Errorf("renomear: %d %s", w.Code, w.Body.String())
	}
	if w := e.req("DELETE", "/api/desk/fs?space=machine&path="+novo, nil, ca); w.Code != 200 {
		t.Errorf("apagar: %d", w.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, "sub")); err == nil {
		t.Error("a pasta deveria ter sido apagada")
	}
	// pastas do primeiro nível nunca são apagadas
	first := "/etc"
	if runtime.GOOS == "windows" {
		first = "/C:"
	}
	if w := e.req("DELETE", "/api/desk/fs?space=machine&path="+first, nil, ca); w.Code != 400 {
		t.Errorf("apagar %s deveria ser recusado, deu %d", first, w.Code)
	}
	if w := e.req("POST", "/api/desk/fs/move", map[string]string{"space": "machine", "from": first, "to": first + "x"}, ca); w.Code != 400 {
		t.Errorf("renomear %s deveria ser recusado, deu %d", first, w.Code)
	}

	// o terminal executa de verdade
	cmd := map[string]any{"command": "echo ola-do-terminal", "cwd": dir}
	w = e.req("POST", "/api/desk/shell/run", cmd, cc)
	if w.Code != 403 { // a Carla só tem arquivos
		t.Errorf("terminal sem permissão: %d", w.Code)
	}
	e.req("POST", "/api/desk/shell/unlock", map[string]string{"password": "senha-do-davi"}, cd)
	w = e.req("POST", "/api/desk/shell/run", cmd, cd)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "ola-do-terminal") || !strings.Contains(w.Body.String(), "__DESKEND__") {
		t.Errorf("terminal: %d %q", w.Code, w.Body.String())
	}

	// trancar de novo
	e.req("POST", "/api/desk/shell/lock", nil, cd)
	if w := e.req("POST", "/api/desk/shell/run", cmd, cd); w.Code != 403 {
		t.Errorf("depois de trancar: %d", w.Code)
	}
}

func TestDeskSudoPedeSenhaDeAdmin(t *testing.T) {
	e := newDK(t, DeskConfig{Shell: true})
	e.addUser("admin", "senha-admin1", true, false, false)
	e.addUser("davi", "senha-do-davi", false, true, true)
	cd := e.login("davi", "senha-do-davi")
	e.req("POST", "/api/desk/shell/unlock", map[string]string{"password": "senha-do-davi"}, cd)

	if runtime.GOOS != "linux" {
		w := e.req("POST", "/api/desk/shell/run", map[string]any{"command": "id", "sudo": true}, cd)
		if w.Code != 501 {
			t.Errorf("sudo fora do Linux deveria dar 501, deu %d", w.Code)
		}
		return
	}
	// a senha do próprio Davi não vale como senha de administrador
	if w := e.req("POST", "/api/desk/shell/sudo", map[string]string{"admin": "davi", "password": "senha-do-davi"}, cd); w.Code != 401 {
		t.Errorf("senha de não administrador: %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/shell/sudo", map[string]string{"admin": "admin", "password": "errada"}, cd); w.Code != 401 {
		t.Errorf("senha errada do admin: %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/shell/run", map[string]any{"command": "id", "sudo": true}, cd); w.Code != 403 || !strings.Contains(w.Body.String(), "sudo_locked") {
		t.Errorf("sudo sem liberar: %d %s", w.Code, w.Body.String())
	}
	if w := e.req("POST", "/api/desk/shell/sudo", map[string]string{"admin": "admin", "password": "senha-admin1"}, cd); w.Code != 200 {
		t.Errorf("sudo com a senha do admin: %d %s", w.Code, w.Body.String())
	}
}

// ---------- câmeras, Config e vídeos ----------

func TestDeskCamerasSoAdmin(t *testing.T) {
	e := newDK(t, DeskConfig{})
	e.addUser("admin", "senha-admin1", true, false, false)
	e.addUser("beto", "senha-do-beto", false, true, true) // mesmo com terminal e arquivos
	ca, cb := e.login("admin", "senha-admin1"), e.login("beto", "senha-do-beto")
	body := []map[string]string{{"name": "Sala", "url": "rtsp://x/1"}}
	if w := e.req("PUT", "/api/desk/admin/cameras", body, cb); w.Code != 403 {
		t.Errorf("usuário comum não altera câmeras: %d", w.Code)
	}
	if w := e.req("GET", "/api/desk/admin/cameras", nil, cb); w.Code != 403 {
		t.Errorf("usuário comum não lê a configuração das câmeras: %d", w.Code)
	}
	// o administrador passa do portão (aqui não há gerenciador de configurações: 503)
	if w := e.req("PUT", "/api/desk/admin/cameras", body, ca); w.Code != 503 {
		t.Errorf("admin sem gerenciador de configurações: %d", w.Code)
	}
}

func TestDeskProtegerConfig(t *testing.T) {
	e := newDK(t, DeskConfig{ProtectSettings: true})
	e.addUser("admin", "senha-admin1", true, false, false)
	e.addUser("beto", "senha-do-beto", false, false, false)
	ca, cb := e.login("admin", "senha-admin1"), e.login("beto", "senha-do-beto")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/settings/cameras", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	h := e.d.protectSettings(mux)
	try := func(method, cookie string) int {
		r := httptest.NewRequest(method, "/api/settings/cameras", nil)
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: deskCookie, Value: cookie})
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	if c := try("PUT", ""); c != 401 {
		t.Errorf("gravar sem sessão: %d", c)
	}
	if c := try("PUT", cb); c != 401 {
		t.Errorf("gravar como usuário comum: %d", c)
	}
	if c := try("PUT", ca); c != 200 {
		t.Errorf("gravar como administrador: %d", c)
	}
	if c := try("GET", ""); c != 200 {
		t.Errorf("ler continua aberto: %d", c)
	}
	// sem a opção, nada muda para a página Config de sempre
	off := newDK(t, DeskConfig{})
	if h := off.d.protectSettings(mux); h != http.Handler(mux) {
		t.Error("sem protectSettings o hub deve ficar exatamente como era")
	}
}

func TestDeskVideos(t *testing.T) {
	e := newDK(t, DeskConfig{})
	e.addUser("ana", "senha-da-ana", false, false, false)
	c := e.login("ana", "senha-da-ana")
	os.WriteFile(filepath.Join(e.vids, "filme.mp4"), []byte("0123456789"), 0o644)
	os.WriteFile(filepath.Join(e.vids, "nota.txt"), []byte("não é vídeo"), 0o644)

	w := e.req("GET", "/api/desk/videos", nil, c)
	var list []map[string]any
	json.Unmarshal(w.Body.Bytes(), &list)
	if w.Code != 200 || len(list) != 1 || list[0]["name"] != "filme.mp4" {
		t.Fatalf("lista de vídeos: %d %s", w.Code, w.Body.String())
	}
	r := httptest.NewRequest("GET", "/api/desk/videos/file?name=filme.mp4", nil)
	r.AddCookie(&http.Cookie{Name: deskCookie, Value: c})
	r.Header.Set("Range", "bytes=2-4")
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, r)
	if rec.Code != 206 || rec.Body.String() != "234" || rec.Header().Get("Content-Type") != "video/mp4" {
		t.Errorf("vídeo com Range: %d %q %q", rec.Code, rec.Body.String(), rec.Header().Get("Content-Type"))
	}
	// o nome da URL nunca vira caminho
	for _, n := range []string{"../t.db", "nota.txt", "..%2Ft.db"} {
		if w := e.req("GET", "/api/desk/videos/file?name="+n, nil, c); w.Code != 404 {
			t.Errorf("name=%s deveria dar 404, deu %d", n, w.Code)
		}
	}
	if w := e.req("GET", "/api/desk/videos", nil, ""); w.Code != 401 {
		t.Errorf("sem sessão: %d", w.Code)
	}
}

func TestDeskComputador(t *testing.T) {
	e := newDK(t, DeskConfig{})
	e.addUser("ana", "senha-da-ana", false, false, false)
	c := e.login("ana", "senha-da-ana")
	w := e.req("GET", "/api/desk/computer", nil, c)
	m := dkJSON(t, w)
	if w.Code != 200 || m["hostname"] == "" || m["os"] != runtime.GOOS || m["cpus"].(float64) < 1 {
		t.Fatalf("computador: %d %s", w.Code, w.Body.String())
	}
	if _, ok := m["disks"].([]any); !ok {
		t.Error("a lista de discos deve existir (mesmo vazia)")
	}
}
