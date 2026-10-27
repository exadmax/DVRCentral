package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestDeskMensagens(t *testing.T) {
	e := newDK(t, DeskConfig{MaxUploadMB: 1})
	ana, bia, cid := e.addUser("ana", "senha-ana-1", false, false, false), e.addUser("bia", "senha-bia-1", false, false, false), e.addUser("cid", "senha-cid-1", false, false, false)
	ca, cb, cc := e.login("ana", "senha-ana-1"), e.login("bia", "senha-bia-1"), e.login("cid", "senha-cid-1")
	to := func(id int64) string { return "?to=" + strconv.FormatInt(id, 10) }
	with := func(id int64) string { return "?with=" + strconv.FormatInt(id, 10) }

	// administrador não recebe nada, mas pode escrever para os usuários
	adm := e.addUser("root", "senha-root-1", true, false, false)
	if w := e.req("POST", "/api/desk/chat/send"+to(adm), map[string]string{"text": "oi"}, ca); w.Code != 403 {
		t.Errorf("mensagem para o administrador: %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/chat/upload"+to(adm)+"&name=a.txt", []byte("x"), ca); w.Code != 403 {
		t.Errorf("arquivo para o administrador: %d", w.Code)
	}
	cr := e.login("root", "senha-root-1")
	if w := e.req("POST", "/api/desk/chat/send"+to(ana), map[string]string{"text": "aviso do admin"}, cr); w.Code != 201 {
		t.Errorf("administrador escrevendo a usuário: %d", w.Code)
	}
	for _, c := range []string{ca, cr} {
		var ps []map[string]any
		_ = json.Unmarshal(e.req("GET", "/api/desk/chat/peers", nil, c).Body.Bytes(), &ps)
		for _, p := range ps {
			if p["username"] == "root" {
				t.Errorf("administrador aparece na lista de conversas")
			}
		}
	}
	e.d.chatPurgeUser(t.Context(), adm)
	// sem sessão e sem X-Desk
	if w := e.req("GET", "/api/desk/chat/peers", nil, ""); w.Code != 401 {
		t.Fatalf("peers sem sessão: %d", w.Code)
	}
	// texto
	if w := e.req("POST", "/api/desk/chat/send"+to(bia), map[string]string{"text": "  oi, bia  "}, ca); w.Code != 201 {
		t.Fatalf("send: %d %s", w.Code, w.Body.String())
	}
	for _, bad := range []string{"", "   "} {
		if w := e.req("POST", "/api/desk/chat/send"+to(bia), map[string]string{"text": bad}, ca); w.Code != 400 {
			t.Errorf("texto vazio deveria dar 400, deu %d", w.Code)
		}
	}
	if w := e.req("POST", "/api/desk/chat/send"+to(ana), map[string]string{"text": "x"}, ca); w.Code != 400 {
		t.Errorf("mensagem para si mesmo: %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/chat/send?to=999", map[string]string{"text": "x"}, ca); w.Code != 404 {
		t.Errorf("destinatário inexistente: %d", w.Code)
	}
	// anexo (imagem) e arquivo comum com nome malicioso
	png := []byte("\x89PNG\r\n\x1a\nfake")
	w := e.req("POST", "/api/desk/chat/upload"+to(bia)+"&name=foto.png&text=olha", png, ca)
	if w.Code != 201 {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	imgID := int64(dkJSON(t, w)["id"].(float64))
	w = e.req("POST", "/api/desk/chat/upload"+to(bia)+"&name=..%2F..%2Fetc%2Fsegredo.txt", []byte("conteudo"), ca)
	if w.Code != 201 {
		t.Fatalf("upload 2: %d %s", w.Code, w.Body.String())
	}
	if f := dkJSON(t, w)["file"].(map[string]any); f["name"] != "segredo.txt" || f["image"] != false {
		t.Errorf("nome não saneado: %v", f)
	}
	if w := e.req("POST", "/api/desk/chat/upload"+to(bia)+"&name=a.bin", []byte{}, ca); w.Code != 400 {
		t.Errorf("arquivo vazio: %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/chat/upload"+to(bia)+"&name=grande.bin", make([]byte, 1<<20+10), ca); w.Code != 413 {
		t.Errorf("acima do limite: %d", w.Code)
	}
	if ents, _ := os.ReadDir(e.d.chatDir()); len(ents) != 2 {
		t.Errorf("sobraram arquivos temporários: %d", len(ents))
	}

	// bia vê 3 não lidas de ana, cid nada
	w = e.req("GET", "/api/desk/chat/peers", nil, cb)
	var peers []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &peers); err != nil {
		t.Fatal(err)
	}
	for _, p := range peers {
		if p["username"] == "ana" && p["unread"].(float64) != 3 {
			t.Errorf("não lidas de ana: %v", p["unread"])
		}
		if p["username"] == "cid" && p["unread"].(float64) != 0 {
			t.Errorf("não lidas de cid: %v", p["unread"])
		}
	}
	// cid não alcança a conversa nem o anexo
	if w := e.req("GET", "/api/desk/chat/file?id="+strconv.FormatInt(imgID, 10), nil, cc); w.Code != 404 {
		t.Errorf("terceiro baixando anexo: %d", w.Code)
	}
	if w := e.req("GET", "/api/desk/chat/messages"+with(ana), nil, cc); dkJSON(t, w)["messages"] != nil && len(dkJSON(t, w)["messages"].([]any)) != 0 {
		t.Errorf("cid viu mensagens alheias")
	}
	// bia lê: marca como lida
	w = e.req("GET", "/api/desk/chat/messages"+with(ana), nil, cb)
	if n := len(dkJSON(t, w)["messages"].([]any)); n != 3 {
		t.Fatalf("mensagens: %d", n)
	}
	w = e.req("GET", "/api/desk/chat/messages"+with(bia), nil, ca)
	if dkJSON(t, w)["read_upto"].(float64) == 0 {
		t.Errorf("ana deveria ver as mensagens como lidas")
	}
	w = e.req("GET", "/api/desk/chat/messages"+with(bia)+"&after="+strconv.FormatInt(imgID, 10), nil, ca)
	if n := len(dkJSON(t, w)["messages"].([]any)); n != 1 {
		t.Errorf("after: %d", n)
	}
	// imagem: inline só em mode=view; arquivo comum sempre baixa
	w = e.req("GET", "/api/desk/chat/file?id="+strconv.FormatInt(imgID, 10)+"&mode=view", nil, cb)
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("view: %d %v", w.Code, w.Header())
	}
	w = e.req("GET", "/api/desk/chat/file?id="+strconv.FormatInt(imgID+1, 10)+"&mode=view", nil, cb)
	if w.Header().Get("Content-Type") != "application/octet-stream" || w.Header().Get("Content-Disposition") == "" {
		t.Errorf("arquivo comum deveria baixar: %v", w.Header())
	}
	// salvar em Meus arquivos (duas vezes: não sobrescreve)
	for _, want := range []string{"/Recebidos/segredo.txt", "/Recebidos/segredo (2).txt"} {
		w = e.req("POST", "/api/desk/chat/save", map[string]int64{"id": imgID + 1}, cb)
		if w.Code != 200 || dkJSON(t, w)["path"] != want {
			t.Fatalf("save: %d %s (queria %s)", w.Code, w.Body.String(), want)
		}
	}
	if _, err := os.Stat(filepath.Join(e.d.userDir(bia), "Recebidos", "segredo (2).txt")); err != nil {
		t.Error(err)
	}
	// só quem enviou apaga
	if w := e.req("DELETE", "/api/desk/chat/messages/"+strconv.FormatInt(imgID, 10), nil, cb); w.Code != 404 {
		t.Errorf("apagar mensagem alheia: %d", w.Code)
	}
	if w := e.req("DELETE", "/api/desk/chat/messages/"+strconv.FormatInt(imgID, 10), nil, ca); w.Code != 200 {
		t.Errorf("apagar a própria: %d", w.Code)
	}
	if ents, _ := os.ReadDir(e.d.chatDir()); len(ents) != 1 {
		t.Errorf("anexo não foi removido: %d", len(ents))
	}
	// remover usuário leva as conversas e os anexos
	e.d.chatPurgeUser(t.Context(), ana)
	if ents, _ := os.ReadDir(e.d.chatDir()); len(ents) != 0 {
		t.Errorf("anexos de usuário removido ficaram: %d", len(ents))
	}
	_ = cid
}
