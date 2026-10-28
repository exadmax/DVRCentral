// Login OAuth 2.0 (Gmail e Microsoft/Outlook) do E-mail do Diogows: código de autorização com PKCE. O aplicativo OAuth (client id) é de cada
// usuário, registrado por ele mesmo na janela E-mail (tabela desk_mail_apps; nada disso é configuração do servidor). Como Google e Microsoft só aceitam retorno em localhost ou https, há dois caminhos:
//
//   - sem configuração extra: o retorno é http://localhost:8765/, que não abre nada no seu aparelho; você copia o endereço da barra e cola
//     no Diogows, que troca o código pelos tokens (o mesmo truque dos aplicativos de linha de comando);
//   - com "redirectURI" apontando para <hub em https>/api/desk/mail/oauth/callback, o retorno acontece sozinho.
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var (
	googleAuthURL  = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL = "https://oauth2.googleapis.com/token"
	msLoginBase    = "https://login.microsoftonline.com"
)

const (
	googleScope = "https://mail.google.com/"
	msScope     = "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access"
	oauthTTL    = 10 * time.Minute
)

type oauthFlow struct {
	userID   int64
	provider string
	email    string
	verifier string
	redirect string
	created  time.Time
}

func jsonDecodeBody(r *http.Request, v any) error { return json.NewDecoder(r.Body).Decode(v) }

func (d *deskAPI) oauthRedirect() string {
	if d.cfg.Mail.RedirectURI != "" {
		return d.cfg.Mail.RedirectURI
	}
	return "http://localhost:8765/"
}

// userOAuthApp lê o aplicativo OAuth do usuário para o provedor (com o segredo, se houver). ok é falso quando ele ainda não registrou um.
func (d *deskAPI) userOAuthApp(ctx context.Context, userID int64, provider string) (app OAuthApp, ok bool) {
	var sealed string
	err := d.st.db.QueryRowContext(ctx, `SELECT client_id, tenant, secret FROM desk_mail_apps WHERE user_id = ? AND provider = ?`, userID, provider).Scan(&app.ClientID, &app.Tenant, &sealed)
	if err != nil || app.ClientID == "" {
		return OAuthApp{}, false
	}
	if sealed != "" {
		if s, err := d.mailOpen(sealed); err == nil {
			app.ClientSecret = s.Password
		}
	}
	return app, true
}

func (d *deskAPI) oauthApp(ctx context.Context, userID int64, provider string) (app OAuthApp, authURL, tokenURL, scope string, ok bool) {
	if provider != "google" && provider != "microsoft" {
		return
	}
	app, ok = d.userOAuthApp(ctx, userID, provider)
	if !ok {
		return
	}
	switch provider {
	case "google":
		return app, googleAuthURL, googleTokenURL, googleScope, true
	case "microsoft":
		t := app.Tenant
		if t == "" {
			t = "common"
		}
		base := msLoginBase + "/" + url.PathEscape(t) + "/oauth2/v2.0"
		return app, base + "/authorize", base + "/token", msScope, true
	}
	return
}

var oauthTenantRe = regexp.MustCompile(`^[A-Za-z0-9.-]{1,64}$`)

type oauthAppIn struct {
	Provider     string `json:"provider"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"` // vazio mantém o segredo já guardado (se o client_id for o mesmo)
	Tenant       string `json:"tenant"`        // só Microsoft
}

// oauthAppSet guarda (ou troca) o aplicativo OAuth do usuário para um provedor. O segredo fica cifrado e nunca volta pela API.
func (d *deskAPI) oauthAppSet(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in oauthAppIn
	if !deskDecode(w, r, &in) {
		return
	}
	in.ClientID, in.ClientSecret, in.Tenant = strings.TrimSpace(in.ClientID), strings.TrimSpace(in.ClientSecret), strings.TrimSpace(in.Tenant)
	if in.Provider != "google" && in.Provider != "microsoft" {
		deskErr(w, http.StatusBadRequest, "provedor inválido")
		return
	}
	if in.ClientID == "" || len(in.ClientID) > 300 || strings.ContainsAny(in.ClientID, " \t\r\n") || len(in.ClientSecret) > 300 {
		deskErr(w, http.StatusBadRequest, "informe o ID do cliente (sem espaços); a chave secreta tem até 300 caracteres")
		return
	}
	if in.Provider == "google" {
		in.Tenant = ""
	} else if in.Tenant != "" && !oauthTenantRe.MatchString(in.Tenant) {
		deskErr(w, http.StatusBadRequest, "diretório (tenant) inválido: use common, consumers, organizations ou o id do diretório")
		return
	}
	if old, ok := d.userOAuthApp(r.Context(), u.ID, in.Provider); ok && in.ClientSecret == "" && old.ClientID == in.ClientID {
		in.ClientSecret = old.ClientSecret
	}
	sealed, err := d.mailSeal(mailSecret{Password: in.ClientSecret})
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "não foi possível proteger a chave")
		return
	}
	if _, err := d.st.db.ExecContext(r.Context(), `INSERT INTO desk_mail_apps (user_id, provider, client_id, tenant, secret) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id, provider) DO UPDATE SET client_id = excluded.client_id, tenant = excluded.tenant, secret = excluded.secret`, u.ID, in.Provider, in.ClientID, in.Tenant, sealed); err != nil {
		deskErr(w, http.StatusInternalServerError, "falha salvando o aplicativo")
		return
	}
	d.mail.mu.Lock()
	d.mail.tokens = map[int64]mailToken{} // tokens em cache eram do aplicativo antigo
	d.mail.mu.Unlock()
	d.mailConfig(w, r, u)
}

func (d *deskAPI) oauthAppDelete(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	p := r.PathValue("provider")
	if p != "google" && p != "microsoft" {
		deskErr(w, http.StatusBadRequest, "provedor inválido")
		return
	}
	_, _ = d.st.db.ExecContext(r.Context(), `DELETE FROM desk_mail_apps WHERE user_id = ? AND provider = ?`, u.ID, p)
	w.WriteHeader(http.StatusNoContent)
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type oauthStartIn struct {
	Provider string `json:"provider"`
	Email    string `json:"email"`
}

func (d *deskAPI) oauthStart(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in oauthStartIn
	if !deskDecode(w, r, &in) {
		return
	}
	app, authURL, _, scope, ok := d.oauthApp(r.Context(), u.ID, in.Provider)
	if !ok {
		deskErr(w, http.StatusBadRequest, "você ainda não registrou o seu aplicativo "+map[string]string{"google": "do Google", "microsoft": "da Microsoft"}[in.Provider]+" (ID do cliente): preencha-o em “Meu aplicativo” ou use uma senha de app na aba IMAP")
		return
	}
	in.Email = strings.TrimSpace(in.Email)
	if !mailEmailRe.MatchString(in.Email) {
		deskErr(w, http.StatusBadRequest, "informe o endereço de e-mail da conta")
		return
	}
	f := &oauthFlow{userID: u.ID, provider: in.Provider, email: in.Email, verifier: randHex(32), redirect: d.oauthRedirect(), created: time.Now()}
	state := randHex(16)
	d.mail.mu.Lock()
	for k, v := range d.mail.pending {
		if time.Since(v.created) > oauthTTL {
			delete(d.mail.pending, k)
		}
	}
	if len(d.mail.pending) >= 200 {
		d.mail.mu.Unlock()
		deskErr(w, http.StatusTooManyRequests, "muitos logins em andamento; tente de novo em alguns minutos")
		return
	}
	d.mail.pending[state] = f
	d.mail.mu.Unlock()
	sum := sha256.Sum256([]byte(f.verifier))
	q := url.Values{"client_id": {app.ClientID}, "redirect_uri": {f.redirect}, "response_type": {"code"}, "scope": {scope}, "state": {state},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"}, "login_hint": {in.Email}}
	if in.Provider == "google" {
		q.Set("access_type", "offline")
		q.Set("prompt", "consent") // sem isto o Google só entrega o refresh token na primeira vez
	}
	writeStatus(w, http.StatusOK, map[string]string{"url": authURL + "?" + q.Encode(), "state": state, "redirect": f.redirect})
}

type oauthFinishIn struct {
	State       string `json:"state"`
	RedirectURL string `json:"redirect_url"` // o endereço inteiro da barra, ou só o código
	Label       string `json:"label"`
}

func (d *deskAPI) oauthFinish(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in oauthFinishIn
	if !deskDecode(w, r, &in) {
		return
	}
	d.mail.mu.Lock()
	f := d.mail.pending[in.State]
	if f != nil && f.userID == u.ID {
		delete(d.mail.pending, in.State) // cada state vale uma vez só, e só quem o pediu o gasta
	} else {
		f = nil
	}
	d.mail.mu.Unlock()
	if f == nil || time.Since(f.created) > oauthTTL {
		deskErr(w, http.StatusBadRequest, "este login expirou ou não é seu; comece de novo")
		return
	}
	code := strings.TrimSpace(in.RedirectURL)
	if i := strings.Index(code, "?"); i >= 0 || strings.Contains(code, "://") {
		pu, err := url.Parse(code)
		if err != nil {
			deskErr(w, http.StatusBadRequest, "endereço colado inválido")
			return
		}
		q := pu.Query()
		if e := q.Get("error"); e != "" {
			deskErr(w, http.StatusBadRequest, "o provedor recusou o acesso: "+e+" "+q.Get("error_description"))
			return
		}
		if s := q.Get("state"); s != "" && s != in.State {
			deskErr(w, http.StatusBadRequest, "o endereço colado é de outro login; use o que apareceu nesta tentativa")
			return
		}
		code = q.Get("code")
	}
	if code == "" || len(code) > 4096 {
		deskErr(w, http.StatusBadRequest, "não encontrei o código no endereço colado")
		return
	}
	tk, err := d.oauthExchange(r.Context(), u.ID, f.provider, url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {f.redirect}, "code_verifier": {f.verifier}})
	if err != nil {
		deskErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if tk.RefreshToken == "" {
		deskErr(w, http.StatusBadGateway, "o provedor não entregou acesso permanente (refresh token); revogue o acesso do aplicativo na conta e tente de novo")
		return
	}
	a := &mailAccount{Label: strings.TrimSpace(in.Label), Email: f.email, Provider: f.provider, Username: f.email}
	if a.Label == "" || len([]rune(a.Label)) > 40 {
		a.Label = f.email
	}
	if f.provider == "google" {
		a.IMAPHost, a.IMAPPort, a.IMAPSec, a.SMTPHost, a.SMTPPort, a.SMTPSec = "imap.gmail.com", 993, "tls", "smtp.gmail.com", 465, "tls"
	} else {
		a.IMAPHost, a.IMAPPort, a.IMAPSec, a.SMTPHost, a.SMTPPort, a.SMTPSec = "outlook.office365.com", 993, "tls", "smtp.office365.com", 587, "starttls"
	}
	d.mailSave(w, r, u, a, mailSecret{RefreshToken: tk.RefreshToken}, tk)
}

type oauthTok struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

func (d *deskAPI) oauthExchange(ctx context.Context, userID int64, provider string, form url.Values) (*oauthTok, error) {
	app, _, tokenURL, scope, ok := d.oauthApp(ctx, userID, provider)
	if !ok {
		return nil, errors.New("o seu aplicativo OAuth não está registrado (ou foi removido): registre-o de novo em E-mail → Adicionar conta")
	}
	form.Set("client_id", app.ClientID)
	if app.ClientSecret != "" {
		form.Set("client_secret", app.ClientSecret)
	}
	if provider == "microsoft" {
		form.Set("scope", scope)
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := d.mail.oauthCli.Do(req)
	if err != nil {
		return nil, fmt.Errorf("não consegui falar com o provedor de login: %v", err)
	}
	defer resp.Body.Close()
	var tk oauthTok
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&tk); err != nil {
		return nil, fmt.Errorf("resposta inválida do provedor de login (%d)", resp.StatusCode)
	}
	if tk.Error != "" || tk.AccessToken == "" {
		if tk.Error == "invalid_grant" {
			return nil, errors.New("o acesso à conta foi revogado ou expirou: remova a conta e ligue de novo")
		}
		return nil, fmt.Errorf("o provedor recusou o login: %s %s", tk.Error, tk.ErrorDesc)
	}
	return &tk, nil
}

// mailAccessToken devolve um token de acesso válido da conta, renovando-o com o refresh token quando preciso.
func (d *deskAPI) mailAccessToken(ctx context.Context, a *mailAccount, sec mailSecret) (string, error) {
	d.mail.mu.Lock()
	t, ok := d.mail.tokens[a.ID]
	d.mail.mu.Unlock()
	if ok && time.Now().Add(time.Minute).Before(t.expiry) {
		return t.access, nil
	}
	if sec.RefreshToken == "" {
		return "", errors.New("conta sem acesso OAuth; ligue-a de novo")
	}
	tk, err := d.oauthExchange(ctx, a.userID, a.Provider, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {sec.RefreshToken}})
	if err != nil {
		return "", err
	}
	d.mailCacheToken(a.ID, tk)
	if tk.RefreshToken != "" && tk.RefreshToken != sec.RefreshToken && a.ID > 0 { // a Microsoft troca o refresh token a cada uso
		if s, err := d.mailSeal(mailSecret{RefreshToken: tk.RefreshToken}); err == nil {
			if _, err := d.st.db.ExecContext(ctx, `UPDATE desk_mail_accounts SET secret = ? WHERE id = ?`, s, a.ID); err != nil {
				log.Printf("desktop: e-mail: não guardei o novo refresh token da conta %d: %v", a.ID, err)
			}
		}
	}
	return tk.AccessToken, nil
}

func (d *deskAPI) mailCacheToken(id int64, tk *oauthTok) {
	d.mail.mu.Lock()
	d.mail.tokens[id] = mailToken{access: tk.AccessToken, expiry: time.Now().Add(time.Duration(tk.ExpiresIn) * time.Second)}
	d.mail.mu.Unlock()
}

// oauthCallback é o retorno automático (redirectURI do próprio hub). O cookie de sessão é SameSite=Strict e não vem num retorno vindo do
// Google ou da Microsoft, então a página só entrega o endereço à API (aí sim com o cookie, por ser do mesmo site).
func (d *deskAPI) oauthCallback(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'")
	h.Set("Referrer-Policy", "no-referrer")
	_, _ = io.WriteString(w, `<!doctype html><meta charset="utf-8"><title>Ligar conta de e-mail</title>
<body style="font:15px system-ui;padding:24px"><p id="m">Concluindo…</p>
<script>
const q = new URLSearchParams(location.search), m = document.getElementById('m');
fetch('/api/desk/mail/oauth/finish', { method: 'POST', credentials: 'same-origin', headers: { 'X-Desk': '1', 'Content-Type': 'application/json' },
  body: JSON.stringify({ state: q.get('state') || '', redirect_url: location.href }) })
  .then(r => r.json().then(j => ({ ok: r.ok, j })))
  .then(x => { m.textContent = x.ok ? 'Conta ligada. Pode fechar esta janela e voltar ao Diogows.' : (x.j.error || 'Não foi possível ligar a conta.');
    if (x.ok && window.opener) { try { window.opener.postMessage({ mailOAuth: true }, location.origin); } catch (e) {} } })
  .catch(() => { m.textContent = 'Não foi possível ligar a conta.'; });
</script>`)
}
