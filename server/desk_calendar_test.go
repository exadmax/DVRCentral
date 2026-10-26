package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const dkICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20261030T120000Z\r\nSUMMARY:Reuniao\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"

func TestDeskCalendarios(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ruim" {
			w.Write([]byte("<html>não é agenda</html>"))
			return
		}
		w.Write([]byte(dkICS))
	}))
	defer srv.Close()
	e := newDK(t, DeskConfig{})
	e.d.calClient = http.DefaultClient // o servidor de teste está em 127.0.0.1, que o cliente de produção recusa
	e.addUser("ana", "senha-da-ana", false, false, false)
	e.addUser("beto", "senha-do-beto", false, false, false)
	ca, cb := e.login("ana", "senha-da-ana"), e.login("beto", "senha-do-beto")

	// URL inválida, que não é iCal, ou com esquema estranho
	for _, u := range []string{"", "ftp://x/y.ics", srv.URL + "/ruim"} {
		if w := e.req("POST", "/api/desk/calendars", map[string]string{"name": "X", "url": u}, ca); w.Code != 400 {
			t.Errorf("url %q deveria dar 400, deu %d", u, w.Code)
		}
	}
	if w := e.req("POST", "/api/desk/calendars", map[string]string{"name": " ", "url": srv.URL + "/a.ics"}, ca); w.Code != 400 {
		t.Errorf("sem nome deveria dar 400, deu %d", w.Code)
	}
	secret := srv.URL + "/private/token-secreto-123456/basic.ics"
	w := e.req("POST", "/api/desk/calendars", map[string]string{"name": "Trabalho", "color": "#ff0000", "url": secret}, ca)
	if w.Code != 201 {
		t.Fatalf("criar agenda: %d %s", w.Code, w.Body.String())
	}
	cal := dkJSON(t, w)
	if strings.Contains(w.Body.String(), "token-secreto") || !strings.Contains(cal["url"].(string), "…") {
		t.Errorf("a URL tem que sair mascarada: %v", cal["url"])
	}
	id := itoa(int64(cal["id"].(float64)))

	// só a dona enxerga e mexe
	if w := e.req("GET", "/api/desk/calendars", nil, cb); strings.TrimSpace(w.Body.String()) != "[]" {
		t.Errorf("a lista do Beto deveria ser vazia: %q", w.Body.String())
	}
	if w := e.req("PUT", "/api/desk/calendars/"+id, map[string]any{"name": "Roubada"}, cb); w.Code != 404 {
		t.Errorf("editar agenda de outro: %d", w.Code)
	}
	if w := e.req("DELETE", "/api/desk/calendars/"+id, nil, cb); w.Code != 404 {
		t.Errorf("apagar agenda de outro: %d", w.Code)
	}
	if w := e.req("GET", "/api/desk/calendars/feed", nil, cb); strings.Contains(w.Body.String(), "Reuniao") {
		t.Error("o feed do Beto não pode trazer a agenda da Ana")
	}

	// o feed traz o iCal; URL mascarada ao salvar de novo = mantém a URL
	feed := func(c string) (map[string]any, *httptest.ResponseRecorder) {
		w := e.req("GET", "/api/desk/calendars/feed", nil, c)
		return dkJSON(t, w), w
	}
	f, w := feed(ca)
	src := f["sources"].([]any)
	if len(src) != 1 || !strings.Contains(src[0].(map[string]any)["text"].(string), "Reuniao") || src[0].(map[string]any)["label"] != "Trabalho" {
		t.Fatalf("feed: %s", w.Body.String())
	}
	if w := e.req("PUT", "/api/desk/calendars/"+id, map[string]any{"name": "Trabalho 2", "color": "#00ff00", "url": cal["url"], "enabled": true}, ca); w.Code != 200 {
		t.Fatalf("editar: %d %s", w.Code, w.Body.String())
	}
	if f, _ := feed(ca); f["sources"].([]any)[0].(map[string]any)["label"] != "Trabalho 2" {
		t.Error("o nome novo deveria aparecer no feed")
	}

	// sem a origem, usa a última cópia boa (stale)
	cid := int64(cal["id"].(float64))
	e.d.calCache.set(cid, dkICS)
	e.d.calCache.m[cid] = calCacheEntry{text: dkICS, at: time.Now().Add(-time.Hour)}
	srv.Close()
	f, _ = feed(ca)
	if s := f["sources"].([]any)[0].(map[string]any); s["stale"] != true || !strings.Contains(s["text"].(string), "Reuniao") {
		t.Errorf("deveria usar a cópia antiga: %v", s)
	}
	// desligar tira do feed; apagar tira de vez
	if w := e.req("PUT", "/api/desk/calendars/"+id, map[string]any{"name": "Trabalho 2", "enabled": false}, ca); w.Code != 200 {
		t.Fatalf("desligar: %d", w.Code)
	}
	if f, _ := feed(ca); len(f["sources"].([]any)) != 0 {
		t.Error("agenda desligada não entra no feed")
	}
	if w := e.req("DELETE", "/api/desk/calendars/"+id, nil, ca); w.Code != 200 {
		t.Errorf("apagar: %d", w.Code)
	}
}

func TestDeskCalendariosLimiteEUsuarioRemovido(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(dkICS)) }))
	defer srv.Close()
	e := newDK(t, DeskConfig{})
	e.d.calClient = http.DefaultClient
	e.addUser("admin", "senha-admin1", true, false, false)
	uid := e.addUser("ana", "senha-da-ana", false, false, false)
	ca, cadm := e.login("ana", "senha-da-ana"), e.login("admin", "senha-admin1")
	for i := 0; i < deskMaxCalendars; i++ {
		if w := e.req("POST", "/api/desk/calendars", map[string]string{"name": "A", "url": srv.URL + "/" + itoa(int64(i)) + ".ics"}, ca); w.Code != 201 {
			t.Fatalf("agenda %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	if w := e.req("POST", "/api/desk/calendars", map[string]string{"name": "A", "url": srv.URL + "/extra.ics"}, ca); w.Code != 400 {
		t.Errorf("passou do limite: %d", w.Code)
	}
	e.req("PUT", "/api/desk/prefs", map[string]any{"remindMinutes": 15}, ca)
	if w := e.req("DELETE", "/api/desk/admin/users/"+itoa(uid), nil, cadm); w.Code != 200 {
		t.Fatalf("remover usuário: %d", w.Code)
	}
	var n int
	e.d.st.db.QueryRow(`SELECT (SELECT COUNT(*) FROM desk_calendars) + (SELECT COUNT(*) FROM desk_prefs) + (SELECT COUNT(*) FROM desk_sessions WHERE user_id = ?)`, uid).Scan(&n)
	if n != 0 {
		t.Errorf("sobraram %d registros do usuário removido", n)
	}
}

func TestDeskBloqueiaEnderecosInternos(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(dkICS)) }))
	defer srv.Close()
	e := newDK(t, DeskConfig{}) // cliente de produção
	_, err := e.d.fetchICal(context.Background(), srv.URL+"/segredo.ics")
	if err == nil || !strings.Contains(err.Error(), "não permitido") {
		t.Fatalf("o servidor não pode baixar de 127.0.0.1: %v", err)
	}
	if strings.Contains(fmt.Sprint(err), "segredo") {
		t.Error("a mensagem de erro não pode repetir a URL (é um segredo)")
	}
	for ip, want := range map[string]bool{"8.8.8.8": true, "142.250.0.1": true, "127.0.0.1": false, "10.0.0.5": false, "192.168.0.10": false,
		"172.16.0.1": false, "169.254.169.254": false, "100.64.0.1": false, "0.0.0.0": false, "::1": false, "fe80::1": false, "fd00::1": false, "2001:4860:4860::8888": true} {
		if got := isPublicIP(net.ParseIP(ip)); got != want {
			t.Errorf("isPublicIP(%s) = %v, esperava %v", ip, got, want)
		}
	}
	if u, err := normalizeICalURL("webcal://calendar.google.com/x.ics"); err != nil || u != "https://calendar.google.com/x.ics" {
		t.Errorf("webcal: %q %v", u, err)
	}
	if _, err := normalizeICalURL("file:///etc/passwd"); err == nil {
		t.Error("file:// deveria ser recusado")
	}
}

func TestDeskPreferencias(t *testing.T) {
	e := newDK(t, DeskConfig{})
	e.addUser("ana", "senha-da-ana", false, false, false)
	e.addUser("beto", "senha-do-beto", false, false, false)
	ca, cb := e.login("ana", "senha-da-ana"), e.login("beto", "senha-do-beto")
	if w := e.req("GET", "/api/desk/prefs", nil, ca); strings.TrimSpace(w.Body.String()) != "{}" {
		t.Errorf("preferências novas: %q", w.Body.String())
	}
	e.req("PUT", "/api/desk/prefs", map[string]any{"remindMinutes": 15, "house": true}, ca)
	if w := e.req("GET", "/api/desk/prefs", nil, ca); !strings.Contains(w.Body.String(), `"remindMinutes":15`) {
		t.Errorf("ler de volta: %q", w.Body.String())
	}
	if w := e.req("GET", "/api/desk/prefs", nil, cb); strings.TrimSpace(w.Body.String()) != "{}" {
		t.Errorf("as do Beto não podem ser as da Ana: %q", w.Body.String())
	}
	big := map[string]any{"x": strings.Repeat("a", deskMaxPrefs)}
	if w := e.req("PUT", "/api/desk/prefs", big, ca); w.Code != 413 {
		t.Errorf("preferências enormes: %d", w.Code)
	}
}
