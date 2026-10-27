package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRewriteHTMLTiraScriptsEReescreveRecursos(t *testing.T) {
	base, _ := url.Parse("https://exemplo.com/pasta/pagina.html")
	src := `<html><head><title> Minha página </title><base href="https://cdn.exemplo.com/x/">
<script>alert(1)</script><link rel="stylesheet" href="estilo.css"><link rel="preload" href="a.js"><link rel="icon" href="f.ico">
<meta http-equiv="refresh" content="0;url=http://mal"><style>body{background:url(fundo.png)}</style></head>
<body onload="x()" background="bg.gif"><a href="/b" onclick="roubar()" target="_blank">ok</a><a href="javascript:alert(2)">mau</a>
<img src="foto.jpg" srcset="a 1x, b 2x" onerror="x()"><img src="data:image/gif;base64,R0lG" data-src="/real.png">
<iframe src="http://x"></iframe><object data="x"></object><video src="v.mp4"></video><form action="/busca"><input name="q"></form>
<p style="background:url('p.png');width:expression(alert(1))">x</p></body></html>`
	out, title := rewriteHTML(src, base)
	if title != "Minha página" {
		t.Errorf("título: %q", title)
	}
	for _, bad := range []string{"<script", "alert(1)", "onclick", "onload", "onerror", "<iframe", "<object", "<video", "javascript:", "preload", "f.ico", "refresh", "srcset", "target=", "expression("} {
		if strings.Contains(out, bad) {
			t.Errorf("a saída não pode conter %q:\n%s", bad, out)
		}
	}
	want := []string{
		`href="/api/desk/browse?r=1&amp;url=` + url.QueryEscape("https://cdn.exemplo.com/x/estilo.css") + `"`, // CSS pelo base href
		`href="https://cdn.exemplo.com/b"`, // link absoluto, quem navega é a janela
		`src="/api/desk/browse?r=1&amp;url=` + url.QueryEscape("https://cdn.exemplo.com/x/foto.jpg") + `"`,
		`src="/api/desk/browse?r=1&amp;url=` + url.QueryEscape("https://cdn.exemplo.com/real.png") + `"`, // imagem preguiçosa
		`background="/api/desk/browse?r=1&amp;url=` + url.QueryEscape("https://cdn.exemplo.com/x/bg.gif") + `"`,
		`action="https://cdn.exemplo.com/busca"`,
		`Content-Security-Policy`, `charset="utf-8"`,
	}
	for _, w := range want {
		if !strings.Contains(out, w) {
			t.Errorf("faltou %q na saída:\n%s", w, out)
		}
	}
	if !strings.Contains(out, "fundo.png") || strings.Contains(out, "url(fundo.png)") {
		t.Errorf("url() do <style> deveria passar pelo proxy:\n%s", out)
	}
}

func TestRewriteCSS(t *testing.T) {
	base, _ := url.Parse("https://exemplo.com/css/site.css")
	out := rewriteCSS(`@import "outro.css"; a{background:url( "../img/a.png" )} b{background:url(data:image/png;base64,AAA)} c{width:expression(1)} d{background:url(javascript:x)}`, base)
	if !strings.Contains(out, `@import "`+proxyURL("https://exemplo.com/css/outro.css")+`"`) {
		t.Errorf("@import: %s", out)
	}
	if !strings.Contains(out, `url("`+proxyURL("https://exemplo.com/img/a.png")+`")`) {
		t.Errorf("url relativo: %s", out)
	}
	if !strings.Contains(out, "url(data:image/png;base64,AAA)") || strings.Contains(out, "expression(") || strings.Contains(out, "javascript:") {
		t.Errorf("data: fica, expression e javascript saem: %s", out)
	}
}

func TestToUTF8(t *testing.T) {
	if got := toUTF8([]byte("a\xe7\xe3o \x93x\x94"), "iso-8859-1"); got != "ação “x”" {
		t.Errorf("latin1/cp1252: %q", got)
	}
	if got := toUTF8([]byte("ação"), ""); got != "ação" {
		t.Errorf("utf8: %q", got)
	}
	if got := toUTF8([]byte("<meta charset=windows-1252>caf\xe9"), ""); !strings.Contains(got, "café") {
		t.Errorf("charset no meta: %q", got)
	}
}

func newWebFixture(t *testing.T) (*dkEnv, string, string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte(`<html><head><title>Início</title><script>x()</script></head><body><img src="/i.png"><a href="/p.zip">baixar</a></body></html>`))
		case "/i.png":
			w.Header().Set("Content-Type", "image/png")
			w.Write([]byte("\x89PNG\r\n\x1a\n"))
		case "/p.zip":
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Disposition", `attachment; filename="programa v1.zip"`)
			w.Write([]byte("PK-conteudo-do-zip"))
		case "/s.svg":
			w.Header().Set("Content-Type", "image/svg+xml")
			w.Write([]byte(`<svg onload="x()"/>`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	e := newDK(t, DeskConfig{})
	e.d.webClient, e.d.dlClient = http.DefaultClient, http.DefaultClient // o servidor de teste está em 127.0.0.1
	e.addUser("ana", "senha-da-ana", false, false, false)
	e.addUser("beto", "senha-do-beto", false, false, false)
	return e, e.login("ana", "senha-da-ana"), srv.URL
}

func TestDeskNavegador(t *testing.T) {
	e, c, base := newWebFixture(t)
	get := func(target string, cookie string) *httptest.ResponseRecorder {
		return e.req("GET", "/api/desk/browse?url="+url.QueryEscape(target), nil, cookie)
	}
	w := get(base+"/", c)
	if w.Code != 200 || w.Header().Get("X-Browse-Kind") != "page" || strings.Contains(w.Body.String(), "<script") || !strings.Contains(w.Body.String(), "/api/desk/browse?r=1") {
		t.Fatalf("página: %d %v %s", w.Code, w.Header(), w.Body.String())
	}
	if tt, _ := url.QueryUnescape(w.Header().Get("X-Browse-Title")); tt != "Início" {
		t.Errorf("título: %q", tt)
	}
	if !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("cabeçalhos de segurança: %v", w.Header())
	}
	// subrecurso: imagem passa; página e SVG não
	if w := e.req("GET", "/api/desk/browse?r=1&url="+url.QueryEscape(base+"/i.png"), nil, c); w.Code != 200 || w.Header().Get("Content-Type") != "image/png" {
		t.Errorf("imagem: %d %v", w.Code, w.Header())
	}
	if w := e.req("GET", "/api/desk/browse?r=1&url="+url.QueryEscape(base+"/"), nil, c); w.Code != 415 {
		t.Errorf("página como subrecurso: %d", w.Code)
	}
	if w := e.req("GET", "/api/desk/browse?r=1&url="+url.QueryEscape(base+"/s.svg"), nil, c); w.Code != 200 || !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Errorf("SVG como imagem da página deve passar com CSP sandbox: %d %v", w.Code, w.Header())
	}
	if w := get(base+"/s.svg", c); w.Header().Get("X-Browse-Kind") != "file" || w.Body.Len() != 0 {
		t.Errorf("SVG aberto direto não pode ser exibido (pode ter script): %v", w.Header())
	}
	// arquivo: não passa pelo navegador, só informa
	w = get(base+"/p.zip", c)
	nm, _ := url.QueryUnescape(w.Header().Get("X-Browse-Name"))
	if w.Header().Get("X-Browse-Kind") != "file" || nm != "programa v1.zip" || w.Body.Len() != 0 {
		t.Errorf("arquivo: %v %q", w.Header(), w.Body.String())
	}
	// entradas inválidas e sem sessão
	for _, bad := range []string{"", "ftp://x/y", "file:///etc/passwd", "javascript:alert(1)"} {
		if w := get(bad, c); w.Code != 400 {
			t.Errorf("%q deveria dar 400, deu %d", bad, w.Code)
		}
	}
	if w := get(base+"/", ""); w.Code != 401 {
		t.Errorf("sem sessão: %d", w.Code)
	}
	if w := get(base+"/nao-existe", c); w.Code != 200 || w.Header().Get("X-Browse-Status") != "404" {
		t.Errorf("404 do site: %d %v", w.Code, w.Header())
	}
}

func TestDeskNavegadorBloqueiaRedeInterna(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("segredo da rede")) }))
	defer srv.Close()
	e := newDK(t, DeskConfig{}) // cliente de produção
	e.addUser("ana", "senha-da-ana", false, false, false)
	c := e.login("ana", "senha-da-ana")
	w := e.req("GET", "/api/desk/browse?url="+url.QueryEscape(srv.URL), nil, c)
	if w.Code != 502 || strings.Contains(w.Body.String(), "segredo da rede") || !strings.Contains(w.Body.String(), "não é permitido") {
		t.Errorf("deveria recusar 127.0.0.1: %d %s", w.Code, w.Body.String())
	}
	if w := e.req("POST", "/api/desk/downloads", map[string]string{"url": srv.URL + "/x.bin"}, c); w.Code != 202 {
		t.Fatalf("o pedido é aceito e falha no job: %d", w.Code)
	}
	var list []dlView
	for i := 0; i < 50; i++ {
		json.Unmarshal(e.req("GET", "/api/desk/downloads", nil, c).Body.Bytes(), &list)
		if len(list) == 1 && list[0].Status != "running" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if len(list) != 1 || list[0].Status != "error" || !strings.Contains(list[0].Error, "não é permitido") {
		t.Errorf("download para rede interna deveria falhar: %+v", list)
	}
}

func waitDL(t *testing.T, e *dkEnv, c string, want string) []dlView {
	t.Helper()
	var list []dlView
	for i := 0; i < 100; i++ {
		list = nil
		json.Unmarshal(e.req("GET", "/api/desk/downloads", nil, c).Body.Bytes(), &list)
		done := len(list) > 0
		for _, j := range list {
			if j.Status == "running" {
				done = false
			}
		}
		if done {
			return list
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("download não terminou: %+v", list)
	return nil
}

func TestDeskDownloads(t *testing.T) {
	e, c, base := newWebFixture(t)
	cb := e.login("beto", "senha-do-beto")
	start := func() *httptest.ResponseRecorder {
		return e.req("POST", "/api/desk/downloads", map[string]string{"url": base + "/p.zip"}, c)
	}
	if w := start(); w.Code != 202 {
		t.Fatalf("iniciar: %d %s", w.Code, w.Body.String())
	}
	list := waitDL(t, e, c, "done")
	if list[0].Status != "done" || list[0].Name != "programa v1.zip" || list[0].Path != "/Downloads/programa v1.zip" || list[0].Done != int64(len("PK-conteudo-do-zip")) {
		t.Fatalf("download: %+v", list)
	}
	id, _ := e.d.st.deskUserBy(context.Background(), "username", "ana")
	got, err := os.ReadFile(filepath.Join(e.d.userDir(id.ID), "files", "Downloads", "programa v1.zip"))
	if err != nil || string(got) != "PK-conteudo-do-zip" {
		t.Errorf("arquivo gravado: %q %v", got, err)
	}
	// o mesmo arquivo de novo não sobrescreve
	start()
	list = waitDL(t, e, c, "done")
	if len(list) != 2 || list[1].Name != "programa v1 (2).zip" {
		t.Errorf("segundo download: %+v", list)
	}
	// aparece na API de arquivos do próprio usuário e só nela
	if w := e.req("GET", "/api/desk/fs/list?space=home&path=/Downloads", nil, c); !strings.Contains(w.Body.String(), "programa v1 (2).zip") {
		t.Errorf("Downloads em Meus arquivos: %s", w.Body.String())
	}
	if w := e.req("GET", "/api/desk/downloads", nil, cb); strings.TrimSpace(w.Body.String()) != "[]" {
		t.Errorf("o Beto não pode ver os downloads da Ana: %s", w.Body.String())
	}
	// remover da lista
	if w := e.req("DELETE", "/api/desk/downloads/"+list[0].ID, nil, c); w.Code != 200 {
		t.Errorf("remover: %d", w.Code)
	}
	if w := e.req("DELETE", "/api/desk/downloads/"+list[0].ID, nil, cb); w.Code != 404 {
		t.Errorf("remover de outro usuário: %d", w.Code)
	}
	// limites: arquivo maior que o permitido e endereço inválido
	e.d.maxUp = 5
	e.req("POST", "/api/desk/downloads", map[string]string{"url": base + "/p.zip"}, cb)
	l := waitDL(t, e, cb, "error")
	if l[0].Status != "error" || !strings.Contains(l[0].Error, "limite") {
		t.Errorf("limite de tamanho: %+v", l)
	}
	if w := e.req("POST", "/api/desk/downloads", map[string]string{"url": "ftp://x/y"}, c); w.Code != 400 {
		t.Errorf("url inválida: %d", w.Code)
	}
	if entries, _ := os.ReadDir(filepath.Join(e.d.userDir(id.ID), "files", "Downloads")); len(entries) != 2 {
		t.Errorf("não podem sobrar arquivos .part: %v", entries)
	}
}

func TestDeskNavegadorDesligado(t *testing.T) {
	e := newDK(t, DeskConfig{NoBrowser: true})
	e.addUser("ana", "senha-da-ana", false, false, false)
	c := e.login("ana", "senha-da-ana")
	if w := e.req("GET", "/api/desk/browse?url=https://example.com", nil, c); w.Code != 404 {
		t.Errorf("com noBrowser a rota some: %d", w.Code)
	}
	if w := e.req("GET", "/api/desk/me", nil, c); dkJSON(t, w)["browser"] != false {
		t.Errorf("/me deveria avisar browser=false: %s", w.Body.String())
	}
}
