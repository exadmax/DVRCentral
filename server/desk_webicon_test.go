package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func mustURL(s string) *url.URL { u, _ := url.Parse(s); return u }

func TestDeskWebIcon(t *testing.T) {
	png := testPNG(4, 4)
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Write([]byte(`<html><head><link rel="icon" href="/pequeno.png" sizes="16x16"><link rel="apple-touch-icon" href="/grande.png" sizes="180x180"></head><body></body></html>`))
		case "/grande.png", "/pequeno.png", "/favicon.ico":
			w.Write(png)
		case "/mentira.png":
			w.Write([]byte("<html>não sou imagem</html>"))
		case "/sem/":
			w.Write([]byte(`<html><head><link rel="icon" href="/mentira.png"></head></html>`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer site.Close()
	e := newDK(t, DeskConfig{})
	e.d.webClient = http.DefaultClient // o servidor de teste está em 127.0.0.1, que o cliente de produção recusa
	e.addUser("ana", "senha-da-ana", false, false, false)
	c := e.login("ana", "senha-da-ana")
	get := func(u string) *httptest.ResponseRecorder {
		return e.req("GET", "/api/desk/webicon?url="+url.QueryEscape(u), nil, c)
	}
	w := get(site.URL + "/")
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" || !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatalf("ícone: %d %v", w.Code, w.Header())
	}
	cs := iconCandidates([]byte(`<link rel="icon" href="/a.png" sizes="16x16"><link rel="apple-touch-icon" href="/b.png" sizes="180x180"><link rel="icon" href="/c.png" sizes="64x64"><link rel="icon" href="/d.svg">`), mustURL(site.URL+"/"))
	if len(cs) != 4 || !strings.HasSuffix(cs[0].url.Path, "/c.png") || !strings.HasSuffix(cs[3].url.Path, "/d.svg") {
		t.Errorf("ordem dos candidatos: %v", cs)
	}
	if w := get(site.URL + "/sem/"); w.Code != 200 { // o <link> mentiroso é ignorado e cai no /favicon.ico
		t.Errorf("fallback para /favicon.ico: %d", w.Code)
	}
	for _, bad := range []string{"", "ftp://x/y", "javascript:alert(1)", "file:///etc/passwd"} {
		if w := get(bad); w.Code != 400 {
			t.Errorf("url %q: %d", bad, w.Code)
		}
	}
	if w := e.req("GET", "/api/desk/webicon?url="+url.QueryEscape(site.URL), nil, ""); w.Code != 401 {
		t.Errorf("sem sessão: %d", w.Code)
	}
	e.d.webClient = newSafeClient(5 * time.Second) // com o cliente de produção, a rede interna fica de fora
	if w := get(site.URL + "/"); w.Code != 404 {
		t.Errorf("o servidor não pode buscar em endereços da rede interna: %d", w.Code)
	}
}
