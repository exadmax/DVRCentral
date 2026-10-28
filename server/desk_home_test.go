package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func homeLayoutFixture() map[string]any {
	return map[string]any{
		"floors": []any{map[string]any{"id": "terreo", "name": "Térreo", "rooms": []any{
			map[string]any{"id": "sala", "name": "Sala", "color": "#cce5ff", "x": 5, "y": 5, "w": 50, "h": 40},
		}}},
		"devices": []any{
			map[string]any{"id": "tv-sala", "name": "TV da sala", "brand": "samsung", "host": "192.168.0.40", "floor": "terreo", "x": 20, "y": 20},
			map[string]any{"id": "tv-quarto", "name": "TV do quarto", "brand": "samsung", "host": "192.168.0.41", "floor": "", "x": 0, "y": 0},
		},
	}
}

func TestDeskHome(t *testing.T) {
	var probes atomic.Int32
	old := homeProbe
	homeProbe = func(ctx context.Context, host string) homeState {
		probes.Add(1)
		if host == "192.168.0.40" {
			return homeState{State: "on", Model: "UN55"}
		}
		return homeState{State: "off"}
	}
	t.Cleanup(func() { homeProbe = old })

	e := newDK(t, DeskConfig{})
	e.addUser("adm", "senha-do-adm", true, false, false)
	e.addUser("ana", "senha-da-ana", false, false, false)
	adm := e.login("adm", "senha-do-adm")
	ana := e.login("ana", "senha-da-ana")

	// sem planta ainda: listas vazias, não nulas
	w := e.req("GET", "/api/desk/home", nil, ana)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"floors":[]`) || !strings.Contains(w.Body.String(), `"devices":[]`) {
		t.Fatalf("planta vazia: %d %s", w.Code, w.Body)
	}

	// só o administrador grava
	if w := e.req("PUT", "/api/desk/admin/home", homeLayoutFixture(), ana); w.Code != http.StatusForbidden {
		t.Fatalf("usuário comum gravou a planta: %d", w.Code)
	}
	if w := e.req("PUT", "/api/desk/admin/home", homeLayoutFixture(), adm); w.Code != 200 {
		t.Fatalf("admin não gravou: %d %s", w.Code, w.Body)
	}

	// o administrador vê o IP; o usuário comum não
	var got homeLayout
	w = e.req("GET", "/api/desk/home", nil, adm)
	json.Unmarshal(w.Body.Bytes(), &got)
	if len(got.Devices) != 2 || got.Devices[0].Host != "192.168.0.40" || got.Floors[0].Rooms[0].Name != "Sala" {
		t.Fatalf("planta do admin: %s", w.Body)
	}
	w = e.req("GET", "/api/desk/home", nil, ana)
	if strings.Contains(w.Body.String(), "192.168.0") || !strings.Contains(w.Body.String(), "TV da sala") {
		t.Fatalf("usuário comum recebeu o IP (ou perdeu a planta): %s", w.Body)
	}

	// estado: a TV 40 está ligada, a 41 desligada; a segunda leitura sai do cache
	var st map[string]homeState
	w = e.req("GET", "/api/desk/home/status", nil, ana)
	json.Unmarshal(w.Body.Bytes(), &st)
	if w.Code != 200 || st["tv-sala"].State != "on" || st["tv-sala"].Model != "UN55" || st["tv-quarto"].State != "off" {
		t.Fatalf("estado: %d %s", w.Code, w.Body)
	}
	e.req("GET", "/api/desk/home/status", nil, ana)
	if n := probes.Load(); n != 2 {
		t.Errorf("consultas às TVs = %d, esperava 2 (o cache deveria evitar repetir)", n)
	}

	// sem login nada vale
	if w := e.req("GET", "/api/desk/home/status", nil, ""); w.Code != http.StatusUnauthorized {
		t.Errorf("status sem login: %d", w.Code)
	}
}

func TestDeskHomeValidation(t *testing.T) {
	e := newDK(t, DeskConfig{})
	e.addUser("adm", "senha-do-adm", true, false, false)
	adm := e.login("adm", "senha-do-adm")

	cases := map[string]func(m map[string]any){
		"IP público":         func(m map[string]any) { m["devices"].([]any)[0].(map[string]any)["host"] = "8.8.8.8" },
		"o próprio hub":      func(m map[string]any) { m["devices"].([]any)[0].(map[string]any)["host"] = "127.0.0.1" },
		"nome de host":       func(m map[string]any) { m["devices"].([]any)[0].(map[string]any)["host"] = "tv.local" },
		"marca desconhecida": func(m map[string]any) { m["devices"].([]any)[0].(map[string]any)["brand"] = "lg" },
		"andar inexistente":  func(m map[string]any) { m["devices"].([]any)[0].(map[string]any)["floor"] = "sotao" },
		"posição fora":       func(m map[string]any) { m["devices"].([]any)[0].(map[string]any)["x"] = 140 },
		"código repetido":    func(m map[string]any) { m["devices"].([]any)[0].(map[string]any)["id"] = "sala" },
		"cômodo fora": func(m map[string]any) {
			m["floors"].([]any)[0].(map[string]any)["rooms"].([]any)[0].(map[string]any)["w"] = 99
		},
		"cor inválida": func(m map[string]any) {
			m["floors"].([]any)[0].(map[string]any)["rooms"].([]any)[0].(map[string]any)["color"] = "red"
		},
		"nome vazio": func(m map[string]any) { m["floors"].([]any)[0].(map[string]any)["name"] = "  " },
	}
	for name, mut := range cases {
		m := homeLayoutFixture()
		mut(m)
		if w := e.req("PUT", "/api/desk/admin/home", m, adm); w.Code != http.StatusBadRequest {
			t.Errorf("%s: esperava 400, veio %d %s", name, w.Code, w.Body)
		}
	}
	// nada foi gravado pelas tentativas recusadas
	w := e.req("GET", "/api/desk/home", nil, adm)
	if !strings.Contains(w.Body.String(), `"floors":[]`) {
		t.Errorf("planta recusada foi gravada: %s", w.Body)
	}
}

func TestHomeProbeSamsung(t *testing.T) {
	cases := map[string]struct {
		code int
		body string
		want string
	}{
		"ligada":       {200, `{"device":{"PowerState":"on","modelName":"UN55AU7700"}}`, "on"},
		"em espera":    {200, `{"device":{"PowerState":"standby"}}`, "standby"},
		"sem campo":    {200, `{"device":{}}`, "on"},
		"corpo ruim":   {200, `isso não é json`, "on"},
		"erro da TV":   {500, ``, "off"},
		"redirecionou": {302, ``, "off"},
	}
	for name, c := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/v2/" {
				t.Errorf("%s: caminho %s", name, r.URL.Path)
			}
			if c.code == 302 {
				w.Header().Set("Location", "http://10.0.0.1/")
			}
			w.WriteHeader(c.code)
			w.Write([]byte(c.body))
		}))
		st := samsungState(context.Background(), srv.URL+"/api/v2/")
		srv.Close()
		if st.State != c.want {
			t.Errorf("%s: estado %q, esperava %q", name, st.State, c.want)
		}
	}
}
