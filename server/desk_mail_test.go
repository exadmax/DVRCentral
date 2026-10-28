package main

import (
	"bufio"
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/emersion/go-imap/v2/imapserver/imapmemserver"
)

type lit struct{ *bytes.Reader }

func (l lit) Size() int64 { return l.Reader.Size() }

func mailTestCert(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"}, DNSNames: []string{"localhost"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, IsCA: true, BasicConstraintsValid: true}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &k.PublicKey, k)
	if err != nil {
		t.Fatal(err)
	}
	leaf, _ := x509.ParseCertificate(der)
	pool := x509.NewCertPool()
	pool.AddCert(leaf)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: k}, pool
}

// fakeSMTP aceita AUTH PLAIN e guarda a última mensagem recebida.
type fakeSMTP struct {
	mu   sync.Mutex
	msgs []string
	from string
	rcpt []string
}

func (f *fakeSMTP) serve(ln net.Listener) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		go func() {
			defer c.Close()
			br := bufio.NewReader(c)
			say := func(s string) { io.WriteString(c, s+"\r\n") }
			say("220 localhost ESMTP")
			for {
				line, err := br.ReadString('\n')
				if err != nil {
					return
				}
				cmd := strings.ToUpper(strings.TrimSpace(line))
				switch {
				case strings.HasPrefix(cmd, "EHLO"):
					say("250-localhost\r\n250-AUTH PLAIN\r\n250 8BITMIME")
				case strings.HasPrefix(cmd, "AUTH PLAIN"):
					raw, _ := base64.StdEncoding.DecodeString(strings.Fields(line)[2])
					if strings.Contains(string(raw), "senha-certa") {
						say("235 ok")
					} else {
						say("535 recusado")
					}
				case strings.HasPrefix(cmd, "MAIL FROM:"):
					f.mu.Lock()
					f.from, f.rcpt = strings.Trim(strings.SplitN(line[10:], ">", 2)[0], " <\r\n"), nil
					f.mu.Unlock()
					say("250 ok")
				case strings.HasPrefix(cmd, "RCPT TO:"):
					f.mu.Lock()
					f.rcpt = append(f.rcpt, strings.Trim(line[8:], " <>\r\n"))
					f.mu.Unlock()
					say("250 ok")
				case cmd == "DATA":
					say("354 go")
					var b strings.Builder
					for {
						l, err := br.ReadString('\n')
						if err != nil || l == ".\r\n" {
							break
						}
						b.WriteString(l)
					}
					f.mu.Lock()
					f.msgs = append(f.msgs, b.String())
					f.mu.Unlock()
					say("250 queued")
				case cmd == "QUIT":
					say("221 bye")
					return
				default:
					say("250 ok")
				}
			}
		}()
	}
}

const mailPlain = "From: Bia <bia@example.com>\r\nTo: ana@example.com\r\nSubject: =?UTF-8?Q?Reuni=C3=A3o_de_amanh=C3=A3?=\r\nDate: Tue, 27 Oct 2026 10:00:00 +0000\r\nMessage-ID: <m1@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOl\xc3\xa1, tudo certo?\r\n"

const mailMulti = "From: Cadu <cadu@example.com>\r\nTo: ana@example.com\r\nSubject: Relatorio\r\nDate: Tue, 27 Oct 2026 11:00:00 +0000\r\nMessage-ID: <m2@example.com>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=XX\r\n\r\n" +
	"--XX\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Veja <b>anexo</b></p>\r\n" +
	"--XX\r\nContent-Type: text/csv; name=dados.csv\r\nContent-Disposition: attachment; filename=dados.csv\r\nContent-Transfer-Encoding: base64\r\n\r\n" + "YSxiCjEsMgo=" + "\r\n--XX--\r\n"

type mailEnv struct {
	*dkEnv
	imapPort, smtpPort int
	mem                *imapmemserver.User
	smtp               *fakeSMTP
	ca                 string
}

func newMailEnv(t *testing.T) *mailEnv {
	t.Helper()
	cert, pool := mailTestCert(t)
	cfg := &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}

	mem := imapmemserver.NewUser("ana@example.com", "senha-certa")
	mem.Create("INBOX", nil)
	mem.Create("Sent", &imap.CreateOptions{SpecialUse: []imap.MailboxAttr{imap.MailboxAttrSent}})
	for _, m := range []string{mailPlain, mailMulti} {
		if _, err := mem.Append("INBOX", lit{bytes.NewReader([]byte(m))}, &imap.AppendOptions{Time: time.Now()}); err != nil {
			t.Fatal(err)
		}
	}
	ms := imapmemserver.New()
	ms.AddUser(mem)
	srv := imapserver.New(&imapserver.Options{
		NewSession: func(*imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
			return ms.NewSession(), nil, nil
		},
		Caps:      imap.CapSet{imap.CapIMAP4rev1: {}, imap.CapIMAP4rev2: {}, imap.CapMove: {}, imap.CapUIDPlus: {}, imap.CapNamespace: {}},
		TLSConfig: cfg,
	})
	iln, err := tls.Listen("tcp", "127.0.0.1:0", cfg)
	if err != nil {
		t.Fatal(err)
	}
	go srv.Serve(iln)
	t.Cleanup(func() { srv.Close() })

	sm := &fakeSMTP{}
	sln, err := tls.Listen("tcp", "127.0.0.1:0", cfg)
	if err != nil {
		t.Fatal(err)
	}
	go sm.serve(sln)
	t.Cleanup(func() { sln.Close() })

	e := newDK(t, DeskConfig{Mail: MailConfig{AllowPrivate: true}})
	e.d.mail.roots = pool
	e.addUser("ana", "senha-da-ana", false, false, false)
	e.addUser("beto", "senha-do-beto", false, false, false)
	return &mailEnv{dkEnv: e, imapPort: iln.Addr().(*net.TCPAddr).Port, smtpPort: sln.Addr().(*net.TCPAddr).Port, mem: mem, smtp: sm, ca: e.login("ana", "senha-da-ana")}
}

func (m *mailEnv) addBody(pass string) map[string]any {
	return map[string]any{"label": "Ana", "email": "ana@example.com", "password": pass,
		"imap_host": "localhost", "imap_port": m.imapPort, "imap_sec": "tls", "smtp_host": "localhost", "smtp_port": m.smtpPort, "smtp_sec": "tls"}
}

func TestDeskMailContasESegredos(t *testing.T) {
	m := newMailEnv(t)
	if w := m.req("POST", "/api/desk/mail/accounts", m.addBody("senha-errada"), m.ca); w.Code != 400 || !strings.Contains(w.Body.String(), "recusou") {
		t.Fatalf("senha errada deveria dar 400 (recusou): %d %s", w.Code, w.Body.String())
	}
	bad := m.addBody("senha-certa")
	bad["imap_sec"] = "none"
	if w := m.req("POST", "/api/desk/mail/accounts", bad, m.ca); w.Code != 400 {
		t.Errorf("texto puro deveria ser recusado: %d", w.Code)
	}
	bad = m.addBody("senha-certa")
	bad["imap_host"] = "exemplo.com/../x"
	if w := m.req("POST", "/api/desk/mail/accounts", bad, m.ca); w.Code != 400 {
		t.Errorf("servidor inválido: %d", w.Code)
	}
	w := m.req("POST", "/api/desk/mail/accounts", m.addBody("senha-certa"), m.ca)
	if w.Code != 201 {
		t.Fatalf("criar conta: %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "senha-certa") || strings.Contains(w.Body.String(), "secret") {
		t.Errorf("a resposta não pode trazer a credencial: %s", w.Body.String())
	}
	id := strconv.Itoa(int(dkJSON(t, w)["id"].(float64)))
	var sec string
	m.d.st.db.QueryRow(`SELECT secret FROM desk_mail_accounts WHERE id = ?`, id).Scan(&sec)
	if sec == "" || strings.Contains(sec, "senha-certa") {
		t.Errorf("a credencial deve ficar cifrada no banco: %q", sec)
	}
	if fi, err := os.Stat(filepath.Join(m.d.dir, "_mail.key")); err != nil || fi.Size() != 32 {
		t.Errorf("chave de cifra ausente: %v", err)
	}

	cb := m.login("beto", "senha-do-beto")
	if w := m.req("GET", "/api/desk/mail/accounts", nil, cb); strings.TrimSpace(w.Body.String()) != "[]" {
		t.Errorf("o Beto não pode ver as contas da Ana: %s", w.Body.String())
	}
	for _, p := range []string{"folders", "messages", "message?uid=1", "attachment?uid=1&idx=0"} {
		if w := m.req("GET", "/api/desk/mail/accounts/"+id+"/"+p, nil, cb); w.Code != 404 {
			t.Errorf("%s de conta alheia deveria dar 404, deu %d", p, w.Code)
		}
	}
	if w := m.req("DELETE", "/api/desk/mail/accounts/"+id, nil, cb); w.Code != 404 {
		t.Errorf("remover conta alheia: %d", w.Code)
	}
	if w := m.req("GET", "/api/desk/mail/accounts", nil, ""); w.Code != 401 {
		t.Errorf("sem sessão: %d", w.Code)
	}
}

func TestDeskMailLerEOrganizar(t *testing.T) {
	m := newMailEnv(t)
	id := strconv.Itoa(int(dkJSON(t, m.req("POST", "/api/desk/mail/accounts", m.addBody("senha-certa"), m.ca))["id"].(float64)))
	base := "/api/desk/mail/accounts/" + id

	var folders []map[string]any
	w := m.req("GET", base+"/folders", nil, m.ca)
	if err := json.Unmarshal(w.Body.Bytes(), &folders); err != nil || len(folders) < 2 {
		t.Fatalf("pastas: %d %s", w.Code, w.Body.String())
	}
	roles := map[string]bool{}
	for _, f := range folders {
		roles[f["role"].(string)] = true
	}
	if !roles["inbox"] || !roles["sent"] {
		t.Errorf("faltam INBOX e Enviados: %s", w.Body.String())
	}

	list := dkJSON(t, m.req("GET", base+"/messages?folder=INBOX", nil, m.ca))
	msgs := list["messages"].([]any)
	if len(msgs) != 2 || list["total"].(float64) != 2 {
		t.Fatalf("lista: %v", list)
	}
	first := msgs[0].(map[string]any) // o mais novo (UID maior) primeiro
	if first["subject"] != "Relatorio" || first["from"] != "Cadu" || first["attach"] != true || first["seen"] != false {
		t.Errorf("primeira mensagem: %v", first)
	}
	if s := msgs[1].(map[string]any)["subject"]; s != "Reunião de amanhã" {
		t.Errorf("o assunto codificado deveria vir decodificado: %v", s)
	}
	if q := dkJSON(t, m.req("GET", base+"/messages?folder=INBOX&q=Relatorio", nil, m.ca)); len(q["messages"].([]any)) != 1 {
		t.Errorf("busca: %v", q)
	}

	uid := strconv.Itoa(int(first["uid"].(float64)))
	v := dkJSON(t, m.req("GET", base+"/message?folder=INBOX&uid="+uid, nil, m.ca))
	if !strings.Contains(v["html"].(string), "<b>anexo</b>") || v["from_addr"] != "cadu@example.com" {
		t.Errorf("mensagem: %v", v)
	}
	atts := v["attachments"].([]any)
	if len(atts) != 1 || atts[0].(map[string]any)["name"] != "dados.csv" {
		t.Fatalf("anexos: %v", atts)
	}
	if after := dkJSON(t, m.req("GET", base+"/messages?folder=INBOX", nil, m.ca))["messages"].([]any)[0].(map[string]any); after["seen"] != true {
		t.Error("abrir a mensagem deveria marcá-la como lida")
	}
	aw := m.req("GET", base+"/attachment?folder=INBOX&uid="+uid+"&idx=0", nil, m.ca)
	if aw.Body.String() != "a,b\n1,2\n" || aw.Header().Get("Content-Type") != "application/octet-stream" || !strings.Contains(aw.Header().Get("Content-Disposition"), "attachment") {
		t.Errorf("anexo: %q %v", aw.Body.String(), aw.Header())
	}
	if w := m.req("GET", base+"/attachment?folder=INBOX&uid="+uid+"&idx=7", nil, m.ca); w.Code == 200 {
		t.Error("índice de anexo inexistente deveria falhar")
	}
	if w := m.req("GET", base+"/message?folder=INBOX&uid=999", nil, m.ca); w.Code != 502 {
		t.Errorf("mensagem inexistente: %d", w.Code)
	}

	act := func(op string, extra map[string]any) int {
		b := map[string]any{"folder": "INBOX", "uids": []int{int(first["uid"].(float64))}, "op": op}
		for k, x := range extra {
			b[k] = x
		}
		return m.req("POST", base+"/action", b, m.ca).Code
	}
	if c := act("flag", nil); c != 200 {
		t.Fatalf("flag: %d", c)
	}
	if got := dkJSON(t, m.req("GET", base+"/messages?folder=INBOX", nil, m.ca))["messages"].([]any)[0].(map[string]any); got["flagged"] != true {
		t.Error("a estrela deveria ter sido marcada")
	}
	if c := act("unseen", nil); c != 200 {
		t.Errorf("unseen: %d", c)
	}
	if c := act("move", map[string]any{"to": "Sent"}); c != 200 {
		t.Errorf("mover: %d", c)
	}
	if l := dkJSON(t, m.req("GET", base+"/messages?folder=INBOX", nil, m.ca)); l["total"].(float64) != 1 {
		t.Errorf("depois de mover sobra 1 na caixa de entrada: %v", l)
	}
	for _, bad := range []map[string]any{{"folder": "INBOX", "uids": []int{}, "op": "seen"}, {"folder": "", "uids": []int{1}, "op": "seen"}, {"folder": "INBOX\r\nX", "uids": []int{1}, "op": "seen"}, {"folder": "INBOX", "uids": []int{0}, "op": "seen"}} {
		if w := m.req("POST", base+"/action", bad, m.ca); w.Code != 400 {
			t.Errorf("ação inválida %v: %d", bad, w.Code)
		}
	}
	if c := act("delete", nil); c == 0 { // a mensagem já saiu da caixa de entrada: só confere que não derruba o servidor
		t.Log("delete")
	}
}

func TestDeskMailEnviar(t *testing.T) {
	m := newMailEnv(t)
	id := strconv.Itoa(int(dkJSON(t, m.req("POST", "/api/desk/mail/accounts", m.addBody("senha-certa"), m.ca))["id"].(float64)))
	base := "/api/desk/mail/accounts/" + id

	if w := m.req("POST", base+"/send", map[string]any{"to": []string{"isto não é e-mail"}, "subject": "x", "text": "y"}, m.ca); w.Code != 400 {
		t.Errorf("destinatário inválido: %d", w.Code)
	}
	if w := m.req("POST", base+"/send", map[string]any{"subject": "x", "text": "y"}, m.ca); w.Code != 400 {
		t.Errorf("sem destinatários: %d", w.Code)
	}
	body := map[string]any{"to": []string{"Dani <dani@example.com>"}, "cc": []string{"eli@example.com"}, "bcc": []string{"fabio@example.com"},
		"subject": "Olá\r\nBcc: injetado@example.com", "text": "Corpo da mensagem\nsegunda linha", "in_reply_to": "<m1@example.com>",
		"attachments": []map[string]string{{"name": "../nota.txt", "type": "text/plain", "data": base64.StdEncoding.EncodeToString([]byte("conteúdo"))}}}
	w := m.req("POST", base+"/send", body, m.ca)
	if w.Code != 200 {
		t.Fatalf("enviar: %d %s", w.Code, w.Body.String())
	}
	if r := dkJSON(t, w); r["saved_copy"] != true {
		t.Errorf("deveria ter copiado para Enviados: %v", r)
	}
	m.smtp.mu.Lock()
	defer m.smtp.mu.Unlock()
	if len(m.smtp.msgs) != 1 {
		t.Fatalf("o servidor SMTP deveria ter recebido 1 mensagem, recebeu %d", len(m.smtp.msgs))
	}
	if m.smtp.from != "ana@example.com" || len(m.smtp.rcpt) != 3 {
		t.Errorf("envelope: %q %v", m.smtp.from, m.smtp.rcpt)
	}
	raw := m.smtp.msgs[0]
	if strings.Contains(strings.ToLower(raw), "\r\nbcc:") {
		t.Errorf("Bcc não pode aparecer nos cabeçalhos (nem por injeção):\n%s", raw)
	}
	for _, want := range []string{"To: \"Dani\" <dani@example.com>", "Cc: <eli@example.com>", "In-Reply-To: <m1@example.com>", "nota.txt", "Message-Id:"} {
		if !strings.Contains(raw, want) && !strings.Contains(raw, strings.ReplaceAll(want, "\"Dani\"", "Dani")) && !strings.Contains(raw, strings.ReplaceAll(want, "Cc: <", "Cc: ")) {
			t.Errorf("faltou %q na mensagem:\n%s", want, raw)
		}
	}
	if strings.Contains(raw, "../nota.txt") {
		t.Error("o nome do anexo não pode levar ../")
	}
	// a cópia está em Enviados
	l := dkJSON(t, m.req("GET", base+"/messages?folder=Sent", nil, m.ca))
	if l["total"].(float64) != 1 {
		t.Errorf("Enviados: %v", l)
	}
}

func TestDeskMailRedeEDesligar(t *testing.T) {
	e := newDK(t, DeskConfig{}) // allowPrivate desligado
	e.addUser("ana", "senha-da-ana", false, false, false)
	c := e.login("ana", "senha-da-ana")
	body := map[string]any{"label": "x", "email": "ana@example.com", "password": "p", "imap_host": "localhost", "imap_port": 993, "imap_sec": "tls", "smtp_host": "localhost", "smtp_port": 465, "smtp_sec": "tls"}
	if w := e.req("POST", "/api/desk/mail/accounts", body, c); w.Code != 400 || !strings.Contains(w.Body.String(), "não permitido") {
		t.Errorf("servidor na rede interna deveria ser recusado: %d %s", w.Code, w.Body.String())
	}
	e2 := newDK(t, DeskConfig{Mail: MailConfig{Disabled: true}})
	e2.addUser("ana", "senha-da-ana", false, false, false)
	if w := e2.req("GET", "/api/desk/mail/config", nil, e2.login("ana", "senha-da-ana")); w.Code != 404 {
		t.Errorf("E-mail desligado: %d", w.Code)
	}
}

func TestDeskMailOAuth(t *testing.T) {
	var mu sync.Mutex
	var forms []url.Values
	tok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		mu.Lock()
		forms = append(forms, r.PostForm)
		mu.Unlock()
		if r.PostForm.Get("grant_type") == "refresh_token" && r.PostForm.Get("refresh_token") == "revogado" {
			w.WriteHeader(400)
			io.WriteString(w, `{"error":"invalid_grant"}`)
			return
		}
		io.WriteString(w, `{"access_token":"acesso-1","refresh_token":"refresh-1","expires_in":3600}`)
	}))
	defer tok.Close()
	oldT, oldA := googleTokenURL, googleAuthURL
	googleTokenURL, googleAuthURL = tok.URL, "https://contas.exemplo/auth"
	defer func() { googleTokenURL, googleAuthURL = oldT, oldA }()

	e := newDK(t, DeskConfig{Mail: MailConfig{AllowPrivate: true}})
	e.d.mail.oauthCli = http.DefaultClient
	anaID := e.addUser("ana", "senha-da-ana", false, false, false)
	e.addUser("beto", "senha-do-beto", false, false, false)
	ca, cb := e.login("ana", "senha-da-ana"), e.login("beto", "senha-do-beto")

	// o aplicativo OAuth é de cada usuário: Ana registra o dela; Beto não vê nem usa o de Ana, e o segredo nunca volta pela API
	if w := e.req("PUT", "/api/desk/mail/oauth/app", map[string]string{"provider": "google", "client_id": "cid.apps", "client_secret": "csec"}, ca); w.Code != 200 || strings.Contains(w.Body.String(), "csec") {
		t.Fatalf("registrar o aplicativo: %d %s", w.Code, w.Body.String())
	}
	if w := e.req("PUT", "/api/desk/mail/oauth/app", map[string]string{"provider": "google", "client_id": "com espaço"}, ca); w.Code != 400 {
		t.Errorf("client_id com espaço: %d", w.Code)
	}
	if w := e.req("PUT", "/api/desk/mail/oauth/app", map[string]string{"provider": "outro", "client_id": "x"}, ca); w.Code != 400 {
		t.Errorf("provedor inválido: %d", w.Code)
	}
	cfg := func(cookie, prov string) map[string]any {
		return dkJSON(t, e.req("GET", "/api/desk/mail/config", nil, cookie))["apps"].(map[string]any)[prov].(map[string]any)
	}
	if g := cfg(ca, "google"); g["configured"] != true || g["client_id"] != "cid.apps" || g["has_secret"] != true {
		t.Errorf("config de Ana: %v", g)
	}
	if g := cfg(ca, "microsoft"); g["configured"] != false {
		t.Errorf("Microsoft de Ana: %v", g)
	}
	if g := cfg(cb, "google"); g["configured"] != false || g["client_id"] != "" {
		t.Errorf("Beto não deveria ver o aplicativo de Ana: %v", g)
	}
	if w := e.req("POST", "/api/desk/mail/oauth/start", map[string]string{"provider": "google", "email": "beto@gmail.com"}, cb); w.Code != 400 {
		t.Errorf("Beto sem aplicativo próprio: %d", w.Code)
	}
	// editar sem repetir a chave mantém a chave (mesmo ID do cliente); trocar o ID sem chave a zera
	if w := e.req("PUT", "/api/desk/mail/oauth/app", map[string]string{"provider": "google", "client_id": "cid.apps"}, ca); w.Code != 200 || cfg(ca, "google")["has_secret"] != true {
		t.Errorf("manter a chave: %d", w.Code)
	}
	if w := e.req("POST", "/api/desk/mail/oauth/start", map[string]string{"provider": "microsoft", "email": "ana@outlook.com"}, ca); w.Code != 400 {
		t.Errorf("Microsoft sem configuração: %d", w.Code)
	}
	w := e.req("POST", "/api/desk/mail/oauth/start", map[string]string{"provider": "google", "email": "ana@gmail.com"}, ca)
	if w.Code != 200 {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	st := dkJSON(t, w)
	u, _ := url.Parse(st["url"].(string))
	q := u.Query()
	if u.Host != "contas.exemplo" || q.Get("client_id") != "cid.apps" || q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" || q.Get("access_type") != "offline" || q.Get("login_hint") != "ana@gmail.com" {
		t.Errorf("URL de autorização: %v", u)
	}
	state := st["state"].(string)
	// outro usuário não conclui o login de Ana
	if w := e.req("POST", "/api/desk/mail/oauth/finish", map[string]string{"state": state, "redirect_url": "http://localhost:8765/?code=abc&state=" + state}, cb); w.Code != 400 {
		t.Errorf("state de outro usuário: %d", w.Code)
	}
	// o state de Ana foi gasto na tentativa acima? Não: só some quando é dela. Conclui de verdade (a conta falha no IMAP, que o teste não tem):
	w = e.req("POST", "/api/desk/mail/oauth/finish", map[string]string{"state": state, "redirect_url": "http://localhost:8765/?code=codigo-123&state=" + state}, ca)
	if w.Code != 400 && w.Code != 201 {
		t.Fatalf("finish: %d %s", w.Code, w.Body.String())
	}
	mu.Lock()
	var ex url.Values
	for _, f := range forms {
		if f.Get("grant_type") == "authorization_code" {
			ex = f
		}
	}
	mu.Unlock()
	if ex == nil || ex.Get("code") != "codigo-123" || ex.Get("client_secret") != "csec" || ex.Get("code_verifier") == "" || ex.Get("redirect_uri") != "http://localhost:8765/" {
		t.Fatalf("a troca do código deveria levar code, verifier, secret e redirect: %v", ex)
	}
	if w := e.req("POST", "/api/desk/mail/oauth/finish", map[string]string{"state": state, "redirect_url": "x?code=y"}, ca); w.Code != 400 {
		t.Errorf("state só vale uma vez: %d", w.Code)
	}
	// renovação do token de acesso
	a := &mailAccount{ID: 7, Provider: "google", userID: anaID}
	got, err := e.d.mailAccessToken(t.Context(), a, mailSecret{RefreshToken: "refresh-0"})
	if err != nil || got != "acesso-1" {
		t.Fatalf("renovar: %q %v", got, err)
	}
	if got2, _ := e.d.mailAccessToken(t.Context(), a, mailSecret{RefreshToken: "refresh-0"}); got2 != "acesso-1" {
		t.Error("o token em cache deveria ser reaproveitado")
	}
	if _, err := e.d.mailAccessToken(t.Context(), &mailAccount{ID: 8, Provider: "google", userID: anaID}, mailSecret{RefreshToken: "revogado"}); err == nil || !strings.Contains(err.Error(), "revogado") {
		t.Errorf("refresh revogado deveria explicar: %v", err)
	}
	// remover o aplicativo: a renovação passa a explicar o que fazer
	if w := e.req("DELETE", "/api/desk/mail/oauth/app/google", nil, ca); w.Code != 204 {
		t.Errorf("remover aplicativo: %d", w.Code)
	}
	e.d.mail.mu.Lock()
	e.d.mail.tokens = map[int64]mailToken{}
	e.d.mail.mu.Unlock()
	if _, err := e.d.mailAccessToken(t.Context(), a, mailSecret{RefreshToken: "refresh-0"}); err == nil || !strings.Contains(err.Error(), "registre") {
		t.Errorf("sem aplicativo: %v", err)
	}
	// retorno automático: página sem sessão
	cw := e.req("GET", "/api/desk/mail/oauth/callback?code=x&state=y", nil, "")
	if cw.Code != 200 || !strings.Contains(cw.Body.String(), "/api/desk/mail/oauth/finish") || !strings.Contains(cw.Header().Get("Content-Security-Policy"), "default-src 'none'") {
		t.Errorf("callback: %d %v", cw.Code, cw.Header())
	}
}

func TestXOAuth2(t *testing.T) {
	_, ir, _ := (&xoauth2{"a@b.c", "tok"}).Start()
	if string(ir) != "user=a@b.c\x01auth=Bearer tok\x01\x01" {
		t.Errorf("XOAUTH2: %q", ir)
	}
}
