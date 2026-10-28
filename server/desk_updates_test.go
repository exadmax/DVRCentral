package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha512"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSemCmp(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"2.3.1", "2.3.1", 0}, {"2.3.2", "2.3.1", 1}, {"2.10.0", "2.9.9", 1}, {"v1.2.0", "1.2.0", 0},
		{"2.0.0", "2.0.0-beta.8", 1}, {"2.0.0-beta.9", "2.0.0-beta.8", 1}, {"2.0.0-beta.10", "2.0.0-beta.9", 1}, {"2.0.0-beta.8", "2.0.0-rc.1", -1},
		{"v0.0.0-20241020182733-b788ff22d5a6", "v0.0.0-20240101000000-aaaaaaaaaaaa", 1}, {"1.0", "1.0.0", 0},
	}
	for _, c := range cases {
		if got := semCmp(c.a, c.b); got != c.want {
			t.Errorf("semCmp(%q, %q) = %d, queria %d", c.a, c.b, got, c.want)
		}
	}
}

func updTarball(t *testing.T, js string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, f := range []struct{ name, body string }{{"package/package.json", `{"name":"webamp"}`}, {"package/built/webamp.bundle.min.js", js}} {
		if err := tw.WriteHeader(&tar.Header{Name: f.name, Mode: 0o644, Size: int64(len(f.body))}); err != nil {
			t.Fatal(err)
		}
		tw.Write([]byte(f.body))
	}
	tw.Close()
	gz.Close()
	return buf.Bytes()
}

func TestUpdates(t *testing.T) {
	js := "/* Webamp 9.9.9 */ " + strings.Repeat("window.Webamp=function(){};", 80)
	tgz := updTarball(t, js)
	sum := sha512.Sum512(tgz)
	good := "sha512-" + base64.StdEncoding.EncodeToString(sum[:])
	integrity := good
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch p := r.URL.Path; {
		case p == "/webamp/latest":
			w.Write([]byte(`{"version":"9.9.9","dist":{"tarball":"` + srv.URL + `/webamp/-/webamp-9.9.9.tgz","integrity":"` + integrity + `"}}`))
		case p == "/webamp/-/webamp-9.9.9.tgz":
			w.Write(tgz)
		case p == "/js-dos/latest":
			w.Write([]byte(`{"version":"8.5.3"}`))
		case p == "/emulators/latest":
			w.Write([]byte(`{"version":"8.9.0"}`))
		case p == "/zetajs/latest":
			http.Error(w, "fora do ar", 503)
		case p == "/repos/1j01/jspaint/commits/HEAD":
			w.Write([]byte(`{"sha":"abcdef1234567890"}`))
		case p == "/repos/EmulatorJS/EmulatorJS/releases/latest":
			w.Write([]byte(`{"tag_name":"v4.2.3"}`))
		case strings.HasSuffix(p, "/@latest"):
			w.Write([]byte(`{"Version":"v9.0.0"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	oN, oG, oP := updNPMBase, updGitHubBase, updGoProxyBase
	updNPMBase, updGitHubBase, updGoProxyBase = srv.URL, srv.URL, srv.URL
	defer func() { updNPMBase, updGitHubBase, updGoProxyBase = oN, oG, oP }()

	e := newDK(t, DeskConfig{})
	e.d.upd.cli = http.DefaultClient
	www := filepath.Join(e.tmp, "www")
	os.MkdirAll(filepath.Join(www, "vendor", "webamp"), 0o755)
	os.WriteFile(filepath.Join(www, "vendor", "components.json"), []byte(`{"webamp":"2.3.1","js-dos":"8.5.3","emulators":"8.5.2","zetajs":"1.2.0","jspaint":"53be67a"}`), 0o644)
	os.WriteFile(filepath.Join(www, "vendor", "webamp", "webamp.bundle.min.js"), []byte("PACOTE"), 0o644)
	e.d.staticDir = www
	e.addUser("adm", "senha-do-adm", true, false, false)
	e.addUser("ana", "senha-da-ana", false, false, false)
	ca, cadm := e.login("ana", "senha-da-ana"), e.login("adm", "senha-do-adm")

	for _, r := range [][2]string{{"GET", "/api/desk/updates"}, {"POST", "/api/desk/updates/check"}, {"POST", "/api/desk/updates/webamp/apply"}, {"POST", "/api/desk/updates/webamp/revert"}} {
		if w := e.req(r[0], r[1], nil, ca); w.Code != 403 {
			t.Errorf("%s %s como usuário comum: %d", r[0], r[1], w.Code)
		}
	}
	status := func(j map[string]any, id string) map[string]any {
		for _, c := range j["components"].([]any) {
			if m := c.(map[string]any); m["id"] == id {
				return m
			}
		}
		t.Fatalf("componente %s ausente", id)
		return nil
	}
	// antes de verificar: versões do pacote, nada sabido sobre o mais novo
	j := dkJSON(t, e.req("GET", "/api/desk/updates", nil, cadm))
	if s := status(j, "webamp"); s["installed"] != "2.3.1" || s["status"] != "nao-verificado" {
		t.Errorf("antes de verificar: %v", s)
	}
	j = dkJSON(t, e.req("POST", "/api/desk/updates/check", nil, cadm))
	if s := status(j, "webamp"); s["status"] != "disponivel" || s["latest"] != "9.9.9" || s["mode"] != "auto" {
		t.Errorf("webamp: %v", s)
	}
	if s := status(j, "js-dos"); s["status"] != "atual" {
		t.Errorf("js-dos: %v", s)
	}
	if s := status(j, "emulators"); s["status"] != "disponivel" {
		t.Errorf("emulators: %v", s)
	}
	if s := status(j, "jspaint"); s["status"] != "disponivel" || s["latest"] != "abcdef1" {
		t.Errorf("jspaint: %v", s)
	}
	if s := status(j, "zetajs"); s["status"] != "erro" || s["error"] == "" {
		t.Errorf("zetajs deveria registrar o erro: %v", s)
	}
	if s := status(j, "emulatorjs"); s["status"] != "informativo" || s["latest"] != "v4.2.3" {
		t.Errorf("emulatorjs (CDN): %v", s)
	}
	if s := status(j, "go-imap"); s["latest"] != "v9.0.0" {
		t.Errorf("go-imap: %v", s)
	}
	if int(j["available"].(float64)) < 3 {
		t.Errorf("available: %v", j["available"])
	}
	if _, err := os.Stat(filepath.Join(e.d.dir, "_updates.json")); err != nil {
		t.Errorf("o resultado deveria ficar guardado: %v", err)
	}

	// só o Webamp se instala pelo Diogows
	if w := e.req("POST", "/api/desk/updates/js-dos/apply", nil, cadm); w.Code != 400 {
		t.Errorf("js-dos é manual: %d", w.Code)
	}
	// pacote com hash errado: não instala
	integrity = "sha512-" + base64.StdEncoding.EncodeToString(make([]byte, sha512.Size))
	if w := e.req("POST", "/api/desk/updates/webamp/apply", nil, cadm); w.Code != 502 || !strings.Contains(w.Body.String(), "hash") {
		t.Errorf("hash errado: %d %s", w.Code, w.Body.String())
	}
	if w := e.req("GET", "/vendor/webamp/webamp.bundle.min.js", nil, ""); w.Body.String() != "PACOTE" {
		t.Errorf("sem instalação, deveria servir o do pacote: %q", w.Body.String())
	}
	// hash certo: instala na sobreposição
	integrity = good
	j = dkJSON(t, e.req("POST", "/api/desk/updates/webamp/apply", nil, cadm))
	if s := status(j, "webamp"); s["installed"] != "9.9.9" || s["overlay"] != true || s["status"] != "atual" {
		t.Errorf("depois de atualizar: %v", s)
	}
	w := e.req("GET", "/vendor/webamp/webamp.bundle.min.js", nil, "")
	if w.Body.String() != js || !strings.Contains(w.Header().Get("Content-Type"), "javascript") || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("deveria servir o arquivo novo: %d %q %v", w.Code, w.Body.String()[:20], w.Header())
	}
	// um pacote do Diogows mais novo que a sobreposição a torna inválida
	os.WriteFile(filepath.Join(www, "vendor", "components.json"), []byte(`{"webamp":"10.0.0"}`), 0o644)
	j = dkJSON(t, e.req("GET", "/api/desk/updates", nil, cadm))
	if s := status(j, "webamp"); s["installed"] != "10.0.0" || s["overlay"] != false {
		t.Errorf("pacote mais novo: %v", s)
	}
	if w := e.req("GET", "/vendor/webamp/webamp.bundle.min.js", nil, ""); w.Body.String() != "PACOTE" {
		t.Errorf("a sobreposição velha não deveria mais valer: %q", w.Body.String()[:10])
	}
	// voltar à versão do pacote
	os.WriteFile(filepath.Join(www, "vendor", "components.json"), []byte(`{"webamp":"2.3.1"}`), 0o644)
	e.req("POST", "/api/desk/updates/webamp/apply", nil, cadm)
	if w := e.req("POST", "/api/desk/updates/webamp/revert", nil, cadm); w.Code != 200 {
		t.Errorf("revert: %d", w.Code)
	}
	if w := e.req("GET", "/vendor/webamp/webamp.bundle.min.js", nil, ""); w.Body.String() != "PACOTE" {
		t.Errorf("depois de voltar: %q", w.Body.String()[:10])
	}
	// uma consulta que falha depois de uma boa mantém a versão que já se sabia
	srv.Close()
	j = dkJSON(t, e.req("POST", "/api/desk/updates/check", nil, cadm))
	if s := status(j, "js-dos"); s["error"] == "" || s["latest"] != "8.5.3" {
		t.Errorf("falha deveria manter o último resultado: %v", s)
	}
}

func TestUpdatesDisabled(t *testing.T) {
	e := newDK(t, DeskConfig{Updates: UpdatesConfig{Disabled: true}})
	e.addUser("adm", "senha-do-adm", true, false, false)
	if w := e.req("GET", "/api/desk/updates", nil, e.login("adm", "senha-do-adm")); w.Code != 404 {
		t.Errorf("desligado: %d", w.Code)
	}
}
