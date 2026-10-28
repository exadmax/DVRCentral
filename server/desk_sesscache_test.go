package main

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestSessCache(t *testing.T) {
	var c sessCache
	now := time.Now().Unix()
	u := &DeskUser{ID: 7, Username: "ana", IsAdmin: true}

	if _, ok := c.get("h1", now); ok {
		t.Fatal("cache vazio não deveria ter nada")
	}
	c.put("h1", u, now+3600, c.generation())
	got, ok := c.get("h1", now)
	if !ok || got.Username != "ana" || !got.IsAdmin {
		t.Fatalf("esperava o usuário em cache, veio %+v %v", got, ok)
	}
	got.Username = "mudou" // quem recebe uma cópia não pode alterar o cache
	if again, _ := c.get("h1", now); again.Username != "ana" {
		t.Errorf("o cache devolveu a própria entrada em vez de uma cópia")
	}

	if _, ok := c.get("h1", now+3601); ok {
		t.Errorf("sessão expirada não pode sair do cache")
	}

	c.put("h2", u, now+3600, c.generation())
	c.ttl = 20 * time.Millisecond
	time.Sleep(60 * time.Millisecond)
	if _, ok := c.get("h2", now); ok {
		t.Errorf("passou do prazo do cache: deveria reler do banco")
	}
	c.ttl = 0

	c.put("a", &DeskUser{ID: 1}, now+3600, c.generation())
	c.put("b", &DeskUser{ID: 1}, now+3600, c.generation())
	c.put("c", &DeskUser{ID: 2}, now+3600, c.generation())
	c.dropUser(1, "b") // mantém só a sessão b do usuário 1
	if _, ok := c.get("a", now); ok {
		t.Errorf("a sessão a deveria ter caído")
	}
	if _, ok := c.get("b", now); !ok {
		t.Errorf("a sessão b (keep) deveria continuar")
	}
	if _, ok := c.get("c", now); !ok {
		t.Errorf("a sessão de outro usuário não pode cair")
	}
	c.drop("c")
	if _, ok := c.get("c", now); ok {
		t.Errorf("drop deveria esquecer a sessão")
	}
}

func TestSessCacheLeituraAntigaNaoGrava(t *testing.T) {
	var c sessCache
	now := time.Now().Unix()
	gen := c.generation() // a leitura do banco começa aqui...
	c.dropUser(9, "")     // ...e a invalidação acontece antes de ela terminar
	c.put("h", &DeskUser{ID: 9}, now+3600, gen)
	if _, ok := c.get("h", now); ok {
		t.Errorf("uma leitura iniciada antes da invalidação não pode gravar o usuário velho")
	}
}

func TestSessCacheLimite(t *testing.T) {
	var c sessCache
	now := time.Now().Unix()
	for i := 0; i < sessCacheMax+5; i++ {
		c.put(string(rune('A'+i%26))+itoa(int64(i)), &DeskUser{ID: int64(i)}, now+3600, c.generation())
	}
	c.mu.Lock()
	n := len(c.m)
	c.mu.Unlock()
	if n > sessCacheMax {
		t.Errorf("o cache passou do teto: %d > %d", n, sessCacheMax)
	}
}

func TestDeskSessaoEmCache(t *testing.T) {
	e := newDK(t, DeskConfig{})
	e.addUser("admin", "senha-admin1", true, false, false)
	e.addUser("beto", "senha-do-beto", false, false, false)
	ca, cb := e.login("admin", "senha-admin1"), e.login("beto", "senha-do-beto")

	if w := e.req("GET", "/api/desk/me", nil, cb); w.Code != 200 || dkJSON(t, w)["can_terminal"] == true {
		t.Fatalf("beto começa sem terminal: %d", w.Code)
	}
	// apagar a sessão direto no banco (sem passar pelo store) não derruba na hora: quem responde é o cache
	if _, err := e.d.st.db.Exec(`DELETE FROM desk_sessions WHERE token_hash = ?`, deskTokenHash(cb)); err != nil {
		t.Fatal(err)
	}
	if w := e.req("GET", "/api/desk/me", nil, cb); w.Code != 200 {
		t.Errorf("dentro do prazo, a sessão em cache deveria valer (%d)", w.Code)
	}
	// ...até o prazo do cache vencer
	e.d.st.sess.ttl = 20 * time.Millisecond
	time.Sleep(60 * time.Millisecond)
	if w := e.req("GET", "/api/desk/me", nil, cb); w.Code != 401 {
		t.Errorf("depois do prazo a sessão apagada precisa dar 401, deu %d", w.Code)
	}
	e.d.st.sess.ttl = 0

	// mudar permissões (pela API) vale já no pedido seguinte, sem esperar o prazo
	cb = e.login("beto", "senha-do-beto")
	e.req("GET", "/api/desk/me", nil, cb) // põe no cache
	beto, _ := e.d.st.deskUserBy(context.Background(), "username", "beto")
	if w := e.req("PATCH", "/api/desk/admin/users/"+itoa(beto.ID), map[string]any{"can_terminal": true}, ca); w.Code != 200 {
		t.Fatalf("liberar terminal: %d", w.Code)
	}
	if w := e.req("GET", "/api/desk/me", nil, cb); w.Code != 200 || dkJSON(t, w)["can_terminal"] != true {
		t.Errorf("a permissão nova deveria aparecer no pedido seguinte (%d)", w.Code)
	}

	// logout derruba na hora, mesmo com a sessão em cache
	if w := e.req("POST", "/api/desk/logout", nil, cb); w.Code != 200 {
		t.Fatalf("logout: %d", w.Code)
	}
	if w := e.req("GET", "/api/desk/me", nil, cb); w.Code != 401 {
		t.Errorf("depois do logout a sessão não pode valer, deu %d", w.Code)
	}

	// remover o usuário derruba a sessão dele na hora
	cb = e.login("beto", "senha-do-beto")
	e.req("GET", "/api/desk/me", nil, cb)
	if w := e.req("DELETE", "/api/desk/admin/users/"+itoa(beto.ID), nil, ca); w.Code != 200 {
		t.Fatalf("remover: %d", w.Code)
	}
	if w := e.req("GET", "/api/desk/me", nil, cb); w.Code != 401 {
		t.Errorf("usuário removido: a sessão em cache não pode valer, deu %d", w.Code)
	}
}

func TestStoreLeituraNaoEsperaGravacao(t *testing.T) {
	s, err := openStore(filepath.Join(t.TempDir(), "leitura.db"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if s.rdb == s.db {
		t.Fatal("banco em arquivo deveria ter um pool de leitura separado")
	}
	if _, err := s.db.Exec(`INSERT INTO contatos (nome, tipo_servico, contato) VALUES ('Ana', 'Eletricista', '1111')`); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.rdb.QueryRow(`SELECT COUNT(*) FROM contatos`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("a leitura deveria ver o que já foi gravado: n=%d err=%v", n, err)
	}

	// uma gravação em andamento (transação aberta na única conexão de escrita) não pode travar as leituras
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO contatos (nome, tipo_servico, contato) VALUES ('Beto', 'Encanador', '2222')`); err != nil {
		t.Fatal(err)
	}
	type leitura struct {
		n   int
		err error
	}
	done := make(chan leitura, 1)
	go func() {
		var r leitura
		r.err = s.rdb.QueryRow(`SELECT COUNT(*) FROM contatos`).Scan(&r.n)
		done <- r
	}()
	select {
	case r := <-done:
		if r.err != nil {
			t.Fatalf("leitura durante a gravação: %v", r.err)
		}
		if r.n != 1 {
			t.Errorf("a leitura não pode ver a gravação ainda não confirmada: %d contatos", r.n)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("a leitura ficou esperando a gravação terminar")
	}

	// o pool de leitura não grava
	if _, err := s.rdb.Exec(`INSERT INTO contatos (nome, tipo_servico, contato) VALUES ('X', 'Y', 'Z')`); err == nil {
		t.Errorf("o pool de leitura não deveria aceitar gravação")
	}
	// e o que a transação gravou só aparece depois do commit
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := s.rdb.QueryRow(`SELECT COUNT(*) FROM contatos`).Scan(&n); err != nil || n != 2 {
		t.Errorf("depois do commit a leitura deveria ver 2 contatos: n=%d err=%v", n, err)
	}
}

func TestStoreCloseFechaOsDoisPools(t *testing.T) {
	s, err := openStore(filepath.Join(t.TempDir(), "fecha.db"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := s.db.Ping(); err == nil {
		t.Errorf("a conexão de gravação deveria estar fechada")
	}
	if err := s.rdb.Ping(); err == nil {
		t.Errorf("o pool de leitura deveria estar fechado")
	}
}
