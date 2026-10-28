// Cliente de e-mail do Diogows: cada usuário liga as próprias contas (IMAP/SMTP com senha, ou Gmail e Microsoft/Outlook por OAuth 2.0) e lê,
// escreve e organiza as mensagens na janela E-mail. O servidor é só a ponte: guarda as credenciais cifradas, fala IMAP e SMTP com o provedor
// e entrega JSON ao navegador. Nada de e-mail é gravado no servidor além da conta (as mensagens ficam no provedor).
//
// Segurança: só TLS (implícito ou STARTTLS), nunca texto puro; segredos cifrados com AES-GCM por uma chave em desk/_mail.key; o servidor só
// conecta em endereços públicos (como as agendas), a menos que "desk.mail.allowPrivate" esteja ligado; cada usuário só alcança as próprias contas.
package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

const deskMailMigration = `CREATE TABLE IF NOT EXISTS desk_mail_accounts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	label TEXT NOT NULL,
	email TEXT NOT NULL,
	provider TEXT NOT NULL,
	imap_host TEXT NOT NULL,
	imap_port INTEGER NOT NULL,
	imap_sec TEXT NOT NULL,
	smtp_host TEXT NOT NULL,
	smtp_port INTEGER NOT NULL,
	smtp_sec TEXT NOT NULL,
	username TEXT NOT NULL,
	secret TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS desk_mail_user ON desk_mail_accounts (user_id);`

// Aplicativo OAuth de cada usuário (Google/Microsoft), com a chave cifrada. É uma migração à parte: as migrações são numeradas, então
// mexer na anterior não chegaria a bancos que já passaram dela.
const deskMailAppsMigration = `CREATE TABLE IF NOT EXISTS desk_mail_apps (
	user_id INTEGER NOT NULL,
	provider TEXT NOT NULL,
	client_id TEXT NOT NULL,
	tenant TEXT NOT NULL DEFAULT '',
	secret TEXT NOT NULL,
	PRIMARY KEY (user_id, provider)
);`

// MailConfig é a seção "mail" de "desk" no hub.config.json.
type MailConfig struct {
	Disabled     bool   `json:"disabled"`     // true tira o E-mail do Diogows
	AllowPrivate bool   `json:"allowPrivate"` // permite servidores de e-mail na rede da casa (padrão: só endereços da internet)
	RedirectURI  string `json:"redirectURI"`  // endereço de retorno do OAuth (padrão http://localhost:8765/, copiado à mão para o Diogows)
}

// OAuthApp é o aplicativo OAuth (Google Cloud ou Microsoft Entra ID) que cada usuário registra e guarda na própria conta do Diogows
// (tabela desk_mail_apps, com o segredo cifrado). Não é configuração do servidor: cada um usa o seu.
type OAuthApp struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	Tenant       string `json:"tenant"` // só Microsoft: "common" (padrão), "consumers", "organizations" ou o id do diretório
}

const (
	mailMaxAccounts = 6
	mailMaxSend     = 30 << 20 // corpo JSON de um envio, com anexos em base64
	mailMaxFetch    = 40 << 20 // maior mensagem que o servidor lê inteira
	mailPageSize    = 40
	mailOpTimeout   = 90 * time.Second
)

var (
	mailHostRe  = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$`)
	mailEmailRe = regexp.MustCompile(`^[^\s@<>"',;]{1,64}@[A-Za-z0-9.-]{1,253}$`)
)

type mailAccount struct {
	ID       int64  `json:"id"`
	Label    string `json:"label"`
	Email    string `json:"email"`
	Provider string `json:"provider"` // imap | google | microsoft
	IMAPHost string `json:"imap_host"`
	IMAPPort int    `json:"imap_port"`
	IMAPSec  string `json:"imap_sec"` // tls | starttls
	SMTPHost string `json:"smtp_host"`
	SMTPPort int    `json:"smtp_port"`
	SMTPSec  string `json:"smtp_sec"`
	Username string `json:"username"`
	secret   string // JSON cifrado: {"password"} ou {"refresh_token"}; nunca sai pela API
	userID   int64  // dono da conta (qual aplicativo OAuth usar ao renovar o acesso)
}

type mailSecret struct {
	Password     string `json:"password,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

type deskMailState struct {
	mu       sync.Mutex
	key      []byte
	tokens   map[int64]mailToken   // tokens de acesso OAuth em cache (por conta)
	pending  map[string]*oauthFlow // logins OAuth em andamento (por state)
	oauthCli *http.Client
	roots    *x509.CertPool // só os testes: certificado do servidor de teste
}

type mailToken struct {
	access string
	expiry time.Time
}

func (d *deskAPI) mailInit() {
	d.mail = &deskMailState{tokens: map[int64]mailToken{}, pending: map[string]*oauthFlow{}, oauthCli: newSafeClient(30 * time.Second)}
}

// ---------- cifra dos segredos ----------

func (d *deskAPI) mailKey() ([]byte, error) {
	d.mail.mu.Lock()
	defer d.mail.mu.Unlock()
	if d.mail.key != nil {
		return d.mail.key, nil
	}
	p := filepath.Join(d.dir, "_mail.key")
	if b, err := os.ReadFile(p); err == nil {
		if len(b) != 32 {
			return nil, errors.New("desk/_mail.key inválida (esperava 32 bytes)")
		}
		d.mail.key = b
		return b, nil
	}
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(d.dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(p, k, 0o600); err != nil {
		return nil, err
	}
	d.mail.key = k
	return k, nil
}

func (d *deskAPI) mailSeal(v mailSecret) (string, error) {
	k, err := d.mailKey()
	if err != nil {
		return "", err
	}
	blk, _ := aes.NewCipher(k)
	g, _ := cipher.NewGCM(blk)
	nonce := make([]byte, g.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	plain, _ := json.Marshal(v)
	return base64.StdEncoding.EncodeToString(g.Seal(nonce, nonce, plain, nil)), nil
}

func (d *deskAPI) mailOpen(s string) (mailSecret, error) {
	var v mailSecret
	k, err := d.mailKey()
	if err != nil {
		return v, err
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	blk, _ := aes.NewCipher(k)
	g, _ := cipher.NewGCM(blk)
	if err != nil || len(raw) < g.NonceSize() {
		return v, errors.New("credencial ilegível")
	}
	plain, err := g.Open(nil, raw[:g.NonceSize()], raw[g.NonceSize():], nil)
	if err != nil {
		return v, errors.New("credencial ilegível (a chave desk/_mail.key mudou?)")
	}
	return v, json.Unmarshal(plain, &v)
}

// ---------- contas ----------

const mailCols = `id, label, email, provider, imap_host, imap_port, imap_sec, smtp_host, smtp_port, smtp_sec, username, secret, user_id`

func scanMailAccount(sc interface{ Scan(...any) error }) (*mailAccount, error) {
	var a mailAccount
	err := sc.Scan(&a.ID, &a.Label, &a.Email, &a.Provider, &a.IMAPHost, &a.IMAPPort, &a.IMAPSec, &a.SMTPHost, &a.SMTPPort, &a.SMTPSec, &a.Username, &a.secret, &a.userID)
	return &a, err
}

func (s *store) mailAccounts(ctx context.Context, userID int64) ([]*mailAccount, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+mailCols+` FROM desk_mail_accounts WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*mailAccount{}
	for rows.Next() {
		a, err := scanMailAccount(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// mailAccount filtra por dono: um usuário nunca alcança a conta de outro.
func (s *store) mailAccount(ctx context.Context, userID, id int64) (*mailAccount, error) {
	a, err := scanMailAccount(s.db.QueryRowContext(ctx, `SELECT `+mailCols+` FROM desk_mail_accounts WHERE id = ? AND user_id = ?`, id, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errDeskNotFound
	}
	return a, err
}

func (s *store) mailInsert(ctx context.Context, userID int64, a *mailAccount) (int64, error) {
	res, err := s.db.ExecContext(ctx, `INSERT INTO desk_mail_accounts (user_id, label, email, provider, imap_host, imap_port, imap_sec, smtp_host, smtp_port, smtp_sec, username, secret, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, userID, a.Label, a.Email, a.Provider, a.IMAPHost, a.IMAPPort, a.IMAPSec, a.SMTPHost, a.SMTPPort, a.SMTPSec, a.Username, a.secret, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ---------- rede ----------

// mailDialer só conecta em endereços públicos (como as agendas), para o campo "servidor" não virar um jeito de sondar a rede da casa.
func (d *deskAPI) mailDialer() *net.Dialer {
	return &net.Dialer{Timeout: 15 * time.Second, Control: func(network, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil || (!d.cfg.Mail.AllowPrivate && !isPublicIP(net.ParseIP(host))) {
			return fmt.Errorf("endereço não permitido: %s (servidores na rede da casa exigem \"desk\": {\"mail\": {\"allowPrivate\": true}})", address)
		}
		return nil
	}}
}

func (d *deskAPI) mailTLS(host string) *tls.Config {
	return &tls.Config{MinVersion: tls.VersionTLS12, ServerName: host, RootCAs: d.mail.roots}
}

// ---------- rotas ----------

func (d *deskAPI) registerMail(mux *http.ServeMux) {
	d.mailInit()
	mux.HandleFunc("GET /api/desk/mail/config", d.guard(false, false, d.mailGuard(d.mailConfig)))
	mux.HandleFunc("GET /api/desk/mail/accounts", d.guard(false, false, d.mailGuard(d.mailList)))
	mux.HandleFunc("POST /api/desk/mail/accounts", d.guard(false, false, d.mailGuard(d.mailAdd)))
	mux.HandleFunc("DELETE /api/desk/mail/accounts/{id}", d.guard(false, false, d.mailGuard(d.mailRemove)))
	mux.HandleFunc("PUT /api/desk/mail/oauth/app", d.guard(false, false, d.mailGuard(d.oauthAppSet)))
	mux.HandleFunc("DELETE /api/desk/mail/oauth/app/{provider}", d.guard(false, false, d.mailGuard(d.oauthAppDelete)))
	mux.HandleFunc("POST /api/desk/mail/oauth/start", d.guard(false, false, d.mailGuard(d.oauthStart)))
	mux.HandleFunc("POST /api/desk/mail/oauth/finish", d.guard(false, false, d.mailGuard(d.oauthFinish)))
	mux.HandleFunc("GET /api/desk/mail/oauth/callback", d.oauthCallback) // sem sessão: o cookie SameSite=Strict não vem num retorno de outro site
	mux.HandleFunc("GET /api/desk/mail/accounts/{id}/folders", d.guard(false, false, d.mailGuard(d.mailFolders)))
	mux.HandleFunc("GET /api/desk/mail/accounts/{id}/messages", d.guard(false, false, d.mailGuard(d.mailMessages)))
	mux.HandleFunc("GET /api/desk/mail/accounts/{id}/message", d.guard(false, false, d.mailMessage))
	mux.HandleFunc("GET /api/desk/mail/accounts/{id}/attachment", d.guard(false, false, d.mailAttachment))
	mux.HandleFunc("POST /api/desk/mail/accounts/{id}/action", d.guard(false, false, d.mailGuard(d.mailAction)))
	mux.HandleFunc("POST /api/desk/mail/accounts/{id}/send", d.guard(false, false, d.mailSend))
}

// mailGuard recusa tudo quando o E-mail está desligado na configuração.
func (d *deskAPI) mailGuard(next deskHandler) deskHandler {
	return func(w http.ResponseWriter, r *http.Request, u *DeskUser) {
		if d.cfg.Mail.Disabled {
			deskErr(w, http.StatusNotFound, "o E-mail está desligado neste servidor")
			return
		}
		next(w, r, u)
	}
}

func (d *deskAPI) mailConfig(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	apps := map[string]any{}
	for _, p := range []string{"google", "microsoft"} {
		app, ok := d.userOAuthApp(r.Context(), u.ID, p)
		apps[p] = map[string]any{"configured": ok, "client_id": app.ClientID, "tenant": app.Tenant, "has_secret": app.ClientSecret != ""}
	}
	writeStatus(w, http.StatusOK, map[string]any{
		"apps": apps, "redirect": d.oauthRedirect(),
		"callback": strings.HasSuffix(d.cfg.Mail.RedirectURI, "/api/desk/mail/oauth/callback"),
	})
}

func (d *deskAPI) mailList(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	list, err := d.st.mailAccounts(r.Context(), u.ID)
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha lendo as contas de e-mail")
		return
	}
	writeStatus(w, http.StatusOK, list)
}

type mailAddInput struct {
	Label    string `json:"label"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
	IMAPHost string `json:"imap_host"`
	IMAPPort int    `json:"imap_port"`
	IMAPSec  string `json:"imap_sec"`
	SMTPHost string `json:"smtp_host"`
	SMTPPort int    `json:"smtp_port"`
	SMTPSec  string `json:"smtp_sec"`
}

func mailCheckHostPort(kind, host string, port int, sec string) error {
	if !mailHostRe.MatchString(host) {
		return fmt.Errorf("servidor %s inválido", kind)
	}
	if port < 1 || port > 65535 {
		return fmt.Errorf("porta %s inválida", kind)
	}
	if sec != "tls" && sec != "starttls" {
		return fmt.Errorf("segurança %s: use TLS ou STARTTLS (texto puro não é aceito)", kind)
	}
	return nil
}

func (d *deskAPI) mailAdd(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in mailAddInput
	if !deskDecode(w, r, &in) {
		return
	}
	in.Email = strings.TrimSpace(in.Email)
	in.Label = strings.TrimSpace(in.Label)
	in.IMAPHost, in.SMTPHost = strings.ToLower(strings.TrimSpace(in.IMAPHost)), strings.ToLower(strings.TrimSpace(in.SMTPHost))
	if in.Username = strings.TrimSpace(in.Username); in.Username == "" {
		in.Username = in.Email
	}
	if !mailEmailRe.MatchString(in.Email) {
		deskErr(w, http.StatusBadRequest, "informe o endereço de e-mail")
		return
	}
	if in.Label == "" {
		in.Label = in.Email
	}
	if len([]rune(in.Label)) > 40 || len(in.Password) == 0 || len(in.Password) > 512 || len(in.Username) > 254 {
		deskErr(w, http.StatusBadRequest, "nome (até 40 caracteres), usuário e senha são obrigatórios")
		return
	}
	if err := mailCheckHostPort("IMAP", in.IMAPHost, in.IMAPPort, in.IMAPSec); err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := mailCheckHostPort("SMTP", in.SMTPHost, in.SMTPPort, in.SMTPSec); err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	a := &mailAccount{Label: in.Label, Email: in.Email, Provider: "imap", IMAPHost: in.IMAPHost, IMAPPort: in.IMAPPort, IMAPSec: in.IMAPSec,
		SMTPHost: in.SMTPHost, SMTPPort: in.SMTPPort, SMTPSec: in.SMTPSec, Username: in.Username}
	sec := mailSecret{Password: in.Password}
	d.mailSave(w, r, u, a, sec, nil)
}

// mailSave confere a conta (login no IMAP e no SMTP) antes de guardá-la: um dado errado só daria uma caixa vazia sem explicação.
func (d *deskAPI) mailSave(w http.ResponseWriter, r *http.Request, u *DeskUser, a *mailAccount, sec mailSecret, tk *oauthTok) {
	if n, _ := d.st.mailAccounts(r.Context(), u.ID); len(n) >= mailMaxAccounts {
		deskErr(w, http.StatusBadRequest, fmt.Sprintf("no máximo %d contas de e-mail por usuário", mailMaxAccounts))
		return
	}
	var err error
	a.userID = u.ID
	if a.secret, err = d.mailSeal(sec); err != nil {
		log.Printf("desktop: e-mail: cifra: %v", err)
		deskErr(w, http.StatusInternalServerError, "não foi possível proteger a credencial")
		return
	}
	tmp := int64(0)
	if tk != nil { // o token que acabou de chegar vale para o teste (id provisório, só desta chamada) e depois fica com o id da conta
		tmp = -time.Now().UnixNano()
		a.ID = tmp
		d.mailCacheToken(tmp, tk)
	}
	err = d.mailTest(r.Context(), a)
	d.mail.mu.Lock()
	delete(d.mail.tokens, tmp)
	d.mail.mu.Unlock()
	if err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	id, err := d.st.mailInsert(r.Context(), u.ID, a)
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha salvando a conta")
		return
	}
	if tk != nil {
		d.mailCacheToken(id, tk)
	}
	log.Printf("desktop: e-mail: %s ligou a conta %s (%s)", u.Username, a.Email, a.IMAPHost)
	a.ID = id
	writeStatus(w, http.StatusCreated, a)
}

func (d *deskAPI) mailRemove(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if _, err := d.st.mailAccount(r.Context(), u.ID, id); err != nil {
		deskErr(w, http.StatusNotFound, "conta não encontrada")
		return
	}
	d.st.db.ExecContext(r.Context(), `DELETE FROM desk_mail_accounts WHERE id = ? AND user_id = ?`, id, u.ID)
	d.mail.mu.Lock()
	delete(d.mail.tokens, id)
	d.mail.mu.Unlock()
	log.Printf("desktop: e-mail: %s removeu a conta %d", u.Username, id)
	w.WriteHeader(http.StatusNoContent)
}

// mailAcc devolve a conta do usuário pelo {id} da rota, ou responde o erro.
func (d *deskAPI) mailAcc(w http.ResponseWriter, r *http.Request, u *DeskUser) *mailAccount {
	if d.cfg.Mail.Disabled {
		deskErr(w, http.StatusNotFound, "o E-mail está desligado neste servidor")
		return nil
	}
	id, ok := pathID(w, r)
	if !ok {
		return nil
	}
	a, err := d.st.mailAccount(r.Context(), u.ID, id)
	if err != nil {
		deskErr(w, http.StatusNotFound, "conta não encontrada")
		return nil
	}
	return a
}
