package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"strconv"
	"strings"
	"testing"
)

func testPNG(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.RGBA{200, 30, 30, 255})
	var b bytes.Buffer
	png.Encode(&b, img)
	return b.Bytes()
}

func TestDeskPerfil(t *testing.T) {
	e := newDK(t, DeskConfig{})
	e.addUser("ana", "senha-da-ana", false, false, false)
	idBeto := e.addUser("beto", "senha-do-beto", false, false, false)
	ca, cb := e.login("ana", "senha-da-ana"), e.login("beto", "senha-do-beto")

	// sem perfil: o nome de exibição é o de usuário
	me := dkJSON(t, e.req("GET", "/api/desk/me", nil, ca))
	if p := me["profile"].(map[string]any); p["display_name"] != "ana" || p["photo_ver"].(float64) != 0 {
		t.Errorf("perfil vazio: %v", p)
	}
	// validação
	for _, bad := range []map[string]any{
		{"first_name": strings.Repeat("a", 41)},
		{"first_name": "Ana\nBia"},
		{"last_name": "x\x00y"},
		{"signature": strings.Repeat("z", 501)},
		{"signature": strings.Repeat("l\n", 9)},
	} {
		if w := e.req("PUT", "/api/desk/profile", bad, ca); w.Code != 400 {
			t.Errorf("perfil inválido %v: %d", bad, w.Code)
		}
	}
	w := e.req("PUT", "/api/desk/profile", map[string]any{"first_name": "  Ana ", "last_name": "Souza", "sign_email": true, "signature": "Ana Souza\nDiretora"}, ca)
	if w.Code != 200 {
		t.Fatalf("salvar: %d %s", w.Code, w.Body.String())
	}
	if p := dkJSON(t, w); p["display_name"] != "Ana Souza" || p["sign_email"] != true || p["signature"] != "Ana Souza\nDiretora" {
		t.Errorf("perfil: %v", p)
	}

	// foto: só JPEG/PNG de verdade, e pequena
	if w := e.req("PUT", "/api/desk/profile/photo", []byte("isto não é imagem"), ca); w.Code != 400 {
		t.Errorf("lixo como foto: %d", w.Code)
	}
	if w := e.req("PUT", "/api/desk/profile/photo", []byte("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), ca); w.Code != 400 {
		t.Errorf("SVG como foto: %d", w.Code)
	}
	if w := e.req("PUT", "/api/desk/profile/photo", testPNG(3000, 2), ca); w.Code != 400 {
		t.Errorf("foto larga demais: %d", w.Code)
	}
	if w := e.req("PUT", "/api/desk/profile/photo", append(testPNG(4, 4), make([]byte, profileMaxPhoto)...), ca); w.Code != 400 {
		t.Errorf("foto grande demais: %d", w.Code)
	}
	w = e.req("PUT", "/api/desk/profile/photo", testPNG(8, 8), ca)
	if w.Code != 200 {
		t.Fatalf("foto: %d %s", w.Code, w.Body.String())
	}
	ver := int(dkJSON(t, w)["photo_ver"].(float64))
	if ver == 0 {
		t.Fatal("a versão da foto deveria ser > 0")
	}
	// outro usuário vê a foto, como imagem inerte; sem sessão, não
	var idAna int64
	e.d.st.db.QueryRow(`SELECT id FROM desk_users WHERE username = 'ana'`).Scan(&idAna)
	aw := e.req("GET", "/api/desk/avatar/"+strconv.FormatInt(idAna, 10), nil, cb)
	if aw.Code != 200 || aw.Header().Get("Content-Type") != "image/png" || !strings.Contains(aw.Header().Get("Content-Security-Policy"), "sandbox") || aw.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("avatar: %d %v", aw.Code, aw.Header())
	}
	if w := e.req("GET", "/api/desk/avatar/"+strconv.FormatInt(idAna, 10), nil, ""); w.Code != 401 {
		t.Errorf("avatar sem sessão: %d", w.Code)
	}
	if w := e.req("GET", "/api/desk/avatar/"+strconv.FormatInt(idBeto, 10), nil, ca); w.Code != 404 {
		t.Errorf("quem não tem foto: %d", w.Code)
	}
	// a lista de conversas do Beto traz nome e foto da Ana
	var peers []map[string]any
	json.Unmarshal(e.req("GET", "/api/desk/chat/peers", nil, cb).Body.Bytes(), &peers)
	if len(peers) != 1 || peers[0]["display_name"] != "Ana Souza" || int(peers[0]["photo_ver"].(float64)) != ver || peers[0]["username"] != "ana" {
		t.Errorf("peers: %v", peers)
	}
	// e a lista da Ana mostra o Beto só pelo nome de usuário
	json.Unmarshal(e.req("GET", "/api/desk/chat/peers", nil, ca).Body.Bytes(), &peers)
	if len(peers) != 1 || peers[0]["display_name"] != "beto" || peers[0]["photo_ver"].(float64) != 0 {
		t.Errorf("peers da Ana: %v", peers)
	}
	// remover a foto; limpar o nome volta ao usuário
	if p := dkJSON(t, e.req("DELETE", "/api/desk/profile/photo", nil, ca)); p["photo_ver"].(float64) != 0 {
		t.Errorf("remover foto: %v", p)
	}
	if w := e.req("GET", "/api/desk/avatar/"+strconv.FormatInt(idAna, 10), nil, cb); w.Code != 404 {
		t.Errorf("foto removida: %d", w.Code)
	}
	if p := dkJSON(t, e.req("PUT", "/api/desk/profile", map[string]any{"first_name": "", "last_name": ""}, ca)); p["display_name"] != "ana" {
		t.Errorf("sem nome: %v", p)
	}
	// remover o usuário apaga o perfil
	var n int
	e.d.st.deskDeleteUser(t.Context(), idAna)
	e.d.st.db.QueryRow(`SELECT COUNT(*) FROM desk_profiles WHERE user_id = ?`, idAna).Scan(&n)
	if n != 0 {
		t.Error("o perfil deveria ir junto com o usuário")
	}
}

func TestDeskPerfilNoRemetenteDoEmail(t *testing.T) {
	m := newMailEnv(t)
	id := strconv.Itoa(int(dkJSON(t, m.req("POST", "/api/desk/mail/accounts", m.addBody("senha-certa"), m.ca))["id"].(float64)))
	send := func() string {
		m.smtp.mu.Lock()
		n := len(m.smtp.msgs)
		m.smtp.mu.Unlock()
		if w := m.req("POST", "/api/desk/mail/accounts/"+id+"/send", map[string]any{"to": []string{"dani@example.com"}, "subject": "x", "text": "y"}, m.ca); w.Code != 200 {
			t.Fatalf("enviar: %d %s", w.Code, w.Body.String())
		}
		m.smtp.mu.Lock()
		defer m.smtp.mu.Unlock()
		if len(m.smtp.msgs) != n+1 {
			t.Fatal("mensagem não chegou")
		}
		return m.smtp.msgs[n]
	}
	if raw := send(); strings.Contains(raw, "Ana Souza") {
		t.Error("sem o perfil ligado o remetente é só o e-mail")
	}
	m.req("PUT", "/api/desk/profile", map[string]any{"first_name": "Ana", "last_name": "Souza", "sign_email": false}, m.ca)
	if raw := send(); strings.Contains(raw, "Ana Souza") {
		t.Error("com o nome mas sem 'usar nos e-mails', o remetente continua só o e-mail")
	}
	m.req("PUT", "/api/desk/profile", map[string]any{"first_name": "Ana", "last_name": "Souza", "sign_email": true}, m.ca)
	if raw := send(); !strings.Contains(raw, "From: \"Ana Souza\" <ana@example.com>") {
		t.Errorf("remetente com nome:\n%s", raw)
	}
}
