// Diogows: uma área de trabalho no navegador (desktop.html), com login e vários usuários. É uma interface a mais: o painel
// atual (TV, celular, Config) continua exatamente como era. Aqui ficam a configuração, as tabelas, as sessões e a
// administração de usuários; os arquivos estão em desk_fs.go, o terminal em desk_shell.go e o resto em desk_misc.go.
//
// Perfis: o administrador faz tudo (câmeras, Config, usuários, Terminal e arquivos do computador, inclusive sudo); os demais
// usam câmeras (só ver), contatos, visualizadores e a própria pasta. Terminal e arquivos do computador só chegam a quem o
// administrador liberar, usuário por usuário, e o sudo sempre pede a senha de um administrador.
package main

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DeskConfig é o bloco "desk" do hub.config.json. Tudo é opcional; sem o bloco o desktop fica ligado e o terminal desligado.
type DeskConfig struct {
	Disabled        bool   `json:"disabled"`        // true desliga o desktop inteiro (/api/desk/* responde 404)
	Dir             string `json:"dir"`             // pasta das pastas dos usuários (padrão: "desk" ao lado do hub.config.json)
	Shell           bool   `json:"shell"`           // liga o Terminal e os arquivos do computador (padrão desligado; veja SECURITY.md)
	ShellAnyNetwork bool   `json:"shellAnyNetwork"` // permite o terminal por HTTP puro vindo de fora das redes privadas (não recomendado)
	ProtectSettings bool   `json:"protectSettings"` // alterações de Config e câmeras exigem sessão de administrador do Diogows
	NoBrowser       bool   `json:"noBrowser"`       // true tira o navegador interno e os downloads
	MaxUploadMB     int    `json:"maxUploadMB"`     // tamanho máximo de um envio (padrão 2048)
}

const (
	deskCookie     = "desk_session"
	deskSessionTTL = 12 * time.Hour
	deskMaxJSON    = 1 << 20
)

// deskPBKDF2Iter é variável só para os testes poderem usar um valor baixo.
var deskPBKDF2Iter = 600_000

var deskUsernameRe = regexp.MustCompile(`^[A-Za-z0-9._-]{3,32}$`)

type DeskUser struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	PassHash    string `json:"-"`
	IsAdmin     bool   `json:"is_admin"`
	CanTerminal bool   `json:"can_terminal"` // pode usar o Terminal (e o sudo, com a senha de um administrador)
	CanExplorer bool   `json:"can_explorer"` // pode navegar nos arquivos do computador
	MustChange  bool   `json:"must_change"`
	CreatedAt   int64  `json:"created_at"`
}

// Admin e quem recebeu a permissão.
func (u *DeskUser) terminal() bool { return u.IsAdmin || u.CanTerminal }
func (u *DeskUser) explorer() bool { return u.IsAdmin || u.CanExplorer }

type deskAPI struct {
	st     *store
	cfg    DeskConfig
	dir    string // pasta dos dados dos usuários
	sm     *settingsMgr
	sys    *sysMon
	videos VideosConfig
	verDir string
	maxUp  int64
	lim    *deskLimiter
	shell  *deskShellState

	webClient *http.Client // navegador interno (só endereços públicos)
	dlClient  *http.Client // downloads, sem limite de tempo total
	dl        dlManager
	calClient *http.Client // baixa as agendas iCal (só endereços públicos; os testes trocam por um cliente comum)
	calCache  deskCalCache
}

func newDesk(cfg Config, st *store, sm *settingsMgr, sys *sysMon, cfgDir string) *deskAPI {
	d := &deskAPI{dl: dlManager{jobs: map[int64][]*dlJob{}}, st: st, cfg: cfg.Desk, sm: sm, sys: sys, videos: cfg.Videos, verDir: cfgDir, lim: newDeskLimiter(), calClient: newCalClient(), webClient: newSafeClient(35 * time.Second), dlClient: newSafeClient(0),
		shell: &deskShellState{unlocks: map[string]deskUnlock{}, busy: map[int64]bool{}}}
	d.dir = cfg.Desk.Dir
	if d.dir == "" {
		d.dir = "desk"
	}
	if !filepath.IsAbs(d.dir) {
		d.dir = filepath.Join(cfgDir, d.dir)
	}
	mb := cfg.Desk.MaxUploadMB
	if mb <= 0 {
		mb = 2048
	}
	d.maxUp = int64(mb) << 20
	return d
}

// ---------- tabelas ----------

const deskMigration = `CREATE TABLE IF NOT EXISTS desk_users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username TEXT NOT NULL UNIQUE COLLATE NOCASE,
	pass_hash TEXT NOT NULL,
	is_admin INTEGER NOT NULL DEFAULT 0,
	can_terminal INTEGER NOT NULL DEFAULT 0,
	can_explorer INTEGER NOT NULL DEFAULT 0,
	must_change INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS desk_sessions (
	token_hash TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS desk_sessions_user ON desk_sessions (user_id);`

var errDeskNotFound = errors.New("não encontrado")

const deskUserCols = "id, username, pass_hash, is_admin, can_terminal, can_explorer, must_change, created_at"

func scanDeskUser(row interface{ Scan(...any) error }) (*DeskUser, error) {
	var u DeskUser
	var a, t, e, m int
	if err := row.Scan(&u.ID, &u.Username, &u.PassHash, &a, &t, &e, &m, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errDeskNotFound
		}
		return nil, err
	}
	u.IsAdmin, u.CanTerminal, u.CanExplorer, u.MustChange = a == 1, t == 1, e == 1, m == 1
	return &u, nil
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (s *store) deskCount(ctx context.Context, where string) (n int, err error) {
	err = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM desk_users `+where).Scan(&n)
	return
}

func (s *store) deskCreateUser(ctx context.Context, u DeskUser) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO desk_users (username, pass_hash, is_admin, can_terminal, can_explorer, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		u.Username, u.PassHash, b2i(u.IsAdmin), b2i(u.CanTerminal), b2i(u.CanExplorer), b2i(u.MustChange), u.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *store) deskUserBy(ctx context.Context, col string, v any) (*DeskUser, error) {
	return scanDeskUser(s.db.QueryRowContext(ctx, `SELECT `+deskUserCols+` FROM desk_users WHERE `+col+` = ?`, v))
}

func (s *store) deskListUsers(ctx context.Context) ([]DeskUser, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+deskUserCols+` FROM desk_users ORDER BY username`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DeskUser{}
	for rows.Next() {
		u, err := scanDeskUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

func (s *store) deskSetPassword(ctx context.Context, id int64, hash string, mustChange bool) error {
	_, err := s.db.ExecContext(ctx, `UPDATE desk_users SET pass_hash = ?, must_change = ? WHERE id = ?`, hash, b2i(mustChange), id)
	return err
}

func (s *store) deskSetPerms(ctx context.Context, id int64, terminal, explorer bool) error {
	_, err := s.db.ExecContext(ctx, `UPDATE desk_users SET can_terminal = ?, can_explorer = ? WHERE id = ?`, b2i(terminal), b2i(explorer), id)
	return err
}

func (s *store) deskDeleteUser(ctx context.Context, id int64) error {
	for _, t := range []string{"desk_sessions", "desk_calendars", "desk_prefs"} { // tudo que é do usuário vai junto
		if _, err := s.db.ExecContext(ctx, `DELETE FROM `+t+` WHERE user_id = ?`, id); err != nil {
			return err
		}
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM desk_users WHERE id = ?`, id)
	return err
}

func (s *store) deskCreateSession(ctx context.Context, hash string, userID, exp int64) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO desk_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`, hash, userID, exp)
	return err
}

func (s *store) deskUserBySession(ctx context.Context, hash string, now int64) (*DeskUser, error) {
	return scanDeskUser(s.db.QueryRowContext(ctx,
		`SELECT u.id, u.username, u.pass_hash, u.is_admin, u.can_terminal, u.can_explorer, u.must_change, u.created_at
		 FROM desk_sessions s JOIN desk_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`, hash, now))
}

func (s *store) deskDeleteSession(ctx context.Context, hash string) {
	_, _ = s.db.ExecContext(ctx, `DELETE FROM desk_sessions WHERE token_hash = ?`, hash)
}

// deskDeleteUserSessions encerra as sessões de um usuário, menos keepHash (vazio = todas). Usado ao trocar a senha.
func (s *store) deskDeleteUserSessions(ctx context.Context, userID int64, keepHash string) {
	_, _ = s.db.ExecContext(ctx, `DELETE FROM desk_sessions WHERE user_id = ? AND token_hash <> ?`, userID, keepHash)
}

func (s *store) deskPurgeSessions(ctx context.Context, now int64) {
	_, _ = s.db.ExecContext(ctx, `DELETE FROM desk_sessions WHERE expires_at <= ?`, now)
}

// ---------- senhas ----------

func hashDeskPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, deskPBKDF2Iter, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", deskPBKDF2Iter,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

func verifyDeskPassword(password, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter < 1 || iter > 5_000_000 {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[2])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil || len(want) == 0 {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iter, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

func validateDeskPassword(p string) error {
	switch {
	case len(p) < 8:
		return errors.New("a senha precisa ter pelo menos 8 caracteres")
	case len(p) > 128:
		return errors.New("a senha pode ter no máximo 128 caracteres")
	}
	return nil
}

// ensureFirstInstall cria o administrador só quando não existe NENHUM usuário. A senha inicial é sorteada e só aparece no
// log do hub (journalctl -u centraldiogo-hub): uma senha fixa no código deixaria o primeiro a chegar na rede assumir a conta.
// A troca é obrigatória no primeiro login e apagar usuários depois nunca recria o administrador.
func (d *deskAPI) ensureFirstInstall(ctx context.Context) {
	if d.st == nil {
		return
	}
	n, err := d.st.deskCount(ctx, "")
	if err != nil || n > 0 {
		return
	}
	const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	raw := make([]byte, 14)
	if _, err := rand.Read(raw); err != nil {
		return
	}
	for i, b := range raw {
		raw[i] = alphabet[int(b)%len(alphabet)]
	}
	pass := string(raw)
	h, err := hashDeskPassword(pass)
	if err != nil {
		return
	}
	if _, err := d.st.deskCreateUser(ctx, DeskUser{Username: "admin", PassHash: h, IsAdmin: true, MustChange: true, CreatedAt: time.Now().Unix()}); err != nil {
		log.Printf("desktop: não foi possível criar o administrador: %v", err)
		return
	}
	log.Printf("desktop: primeira instalação. Usuário \"admin\", senha inicial %q (troca obrigatória no primeiro login; esta mensagem não se repete)", pass)
}

// ---------- sessão ----------

func deskTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func deskToken(r *http.Request) string {
	if c, err := r.Cookie(deskCookie); err == nil {
		return c.Value
	}
	return ""
}

func deskIsHTTPS(r *http.Request) bool {
	return r.TLS != nil || (r.Header.Get("X-Forwarded-Proto") == "https" && deskPeerIsLoopback(r))
}

func deskPeerIsLoopback(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (d *deskAPI) startSession(w http.ResponseWriter, r *http.Request, userID int64) error {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	token := hex.EncodeToString(raw)
	exp := time.Now().Add(deskSessionTTL)
	if err := d.st.deskCreateSession(r.Context(), deskTokenHash(token), userID, exp.Unix()); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: deskCookie, Value: token, Path: "/", Expires: exp, HttpOnly: true,
		SameSite: http.SameSiteStrictMode, Secure: deskIsHTTPS(r)})
	return nil
}

func clearDeskCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: deskCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
}

// sessionUser devolve o usuário da sessão do pedido (nil sem sessão válida).
func (d *deskAPI) sessionUser(r *http.Request) *DeskUser {
	if d.st == nil {
		return nil
	}
	t := deskToken(r)
	if t == "" {
		return nil
	}
	u, err := d.st.deskUserBySession(r.Context(), deskTokenHash(t), time.Now().Unix())
	if err != nil {
		return nil
	}
	return u
}

func deskErr(w http.ResponseWriter, status int, msg string) {
	writeStatus(w, status, map[string]string{"error": msg})
}

func deskDecode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, deskMaxJSON)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		deskErr(w, http.StatusBadRequest, "JSON inválido")
		return false
	}
	return true
}

// sameOrigin: se o navegador informa a origem de um pedido que altera algo, ela precisa ser o próprio hub.
func sameOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	u, err := url.Parse(o)
	return err == nil && strings.EqualFold(u.Host, r.Host)
}

type deskHandler func(w http.ResponseWriter, r *http.Request, u *DeskUser)

// guard exige sessão válida. Pedidos que alteram algo também exigem o cabeçalho X-Desk (um formulário de outro site não o
// envia) e origem igual à do hub, somando-se ao SameSite=Strict do cookie. allowMustChange libera só trocar a senha, sair e
// ver o próprio perfil para quem ainda está com a senha provisória.
func (d *deskAPI) guard(admin, allowMustChange bool, next deskHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if d.st == nil {
			deskErr(w, http.StatusServiceUnavailable, "banco de dados indisponível (veja o log do hub)")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && (r.Header.Get("X-Desk") != "1" || !sameOrigin(r)) {
			deskErr(w, http.StatusForbidden, "pedido recusado (cabeçalho X-Desk ou origem inválidos)")
			return
		}
		u := d.sessionUser(r)
		if u == nil {
			deskErr(w, http.StatusUnauthorized, "não autenticado")
			return
		}
		if u.MustChange && !allowMustChange {
			deskErr(w, http.StatusForbidden, "must_change")
			return
		}
		if admin && !u.IsAdmin {
			deskErr(w, http.StatusForbidden, "somente administrador")
			return
		}
		next(w, r, u)
	}
}

// ---------- limite de tentativas ----------

// deskLimiter trava 5 falhas seguidas por (IP, usuário) durante 5 minutos.
type deskLimiter struct {
	mu sync.Mutex
	m  map[string]*deskAttempt
}

type deskAttempt struct {
	fails int
	until time.Time
}

const (
	deskMaxFails = 5
	deskLockout  = 5 * time.Minute
)

func newDeskLimiter() *deskLimiter { return &deskLimiter{m: map[string]*deskAttempt{}} }

func deskLimiterKey(r *http.Request, name string) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return host + "|" + strings.ToLower(name)
}

func (l *deskLimiter) blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	at := l.m[key]
	if at == nil || at.fails < deskMaxFails {
		return false
	}
	if time.Now().After(at.until) {
		delete(l.m, key)
		return false
	}
	return true
}

func (l *deskLimiter) fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.m) > 10000 { // não cresce sem limite sob ataque com nomes aleatórios
		l.m = map[string]*deskAttempt{}
	}
	at := l.m[key]
	if at == nil {
		at = &deskAttempt{}
		l.m[key] = at
	}
	at.fails++
	if at.fails >= deskMaxFails {
		at.until = time.Now().Add(deskLockout)
	}
}

func (l *deskLimiter) reset(key string) {
	l.mu.Lock()
	delete(l.m, key)
	l.mu.Unlock()
}

// ---------- rotas ----------

func (d *deskAPI) register(mux *http.ServeMux) {
	if d.cfg.Disabled {
		return
	}
	mux.HandleFunc("POST /api/desk/login", d.handleLogin)
	mux.HandleFunc("POST /api/desk/logout", d.guard(false, true, d.handleLogout))
	mux.HandleFunc("GET /api/desk/me", d.guard(false, true, d.handleMe))
	mux.HandleFunc("POST /api/desk/password", d.guard(false, true, d.handlePassword))

	mux.HandleFunc("GET /api/desk/admin/users", d.guard(true, false, d.handleListUsers))
	mux.HandleFunc("POST /api/desk/admin/users", d.guard(true, false, d.handleCreateUser))
	mux.HandleFunc("PATCH /api/desk/admin/users/{id}", d.guard(true, false, d.handlePatchUser))
	mux.HandleFunc("POST /api/desk/admin/users/{id}/password", d.guard(true, false, d.handleResetPassword))
	mux.HandleFunc("DELETE /api/desk/admin/users/{id}", d.guard(true, false, d.handleDeleteUser))
	mux.HandleFunc("GET /api/desk/admin/cameras", d.guard(true, false, d.handleCamerasGet))
	mux.HandleFunc("PUT /api/desk/admin/cameras", d.guard(true, false, d.handleCamerasPut))

	d.registerFS(mux)
	d.registerShell(mux)
	d.registerMisc(mux)
	d.registerCalendar(mux)
	d.registerChat(mux)
	d.registerBrowser(mux)
}

type deskMe struct {
	*DeskUser
	Shell   bool `json:"shell"`   // Terminal e arquivos do computador ligados neste servidor
	Browser bool `json:"browser"` // navegador interno e downloads disponíveis
}

func (d *deskAPI) meOf(u *DeskUser) deskMe {
	return deskMe{DeskUser: u, Shell: d.cfg.Shell, Browser: !d.cfg.NoBrowser}
}

func (d *deskAPI) handleLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if d.st == nil {
		deskErr(w, http.StatusServiceUnavailable, "banco de dados indisponível (veja o log do hub)")
		return
	}
	if r.Header.Get("X-Desk") != "1" || !sameOrigin(r) {
		deskErr(w, http.StatusForbidden, "pedido recusado (cabeçalho X-Desk ou origem inválidos)")
		return
	}
	var in struct{ Username, Password string }
	if !deskDecode(w, r, &in) {
		return
	}
	key := deskLimiterKey(r, in.Username)
	if d.lim.blocked(key) {
		deskErr(w, http.StatusTooManyRequests, "muitas tentativas; aguarde alguns minutos")
		return
	}
	u, err := d.st.deskUserBy(r.Context(), "username", in.Username)
	// Usuário inexistente também paga o custo do hash, para o tempo de resposta não revelar quais nomes existem.
	hash := "pbkdf2-sha256$" + strconv.Itoa(deskPBKDF2Iter) + "$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	if err == nil {
		hash = u.PassHash
	}
	if !verifyDeskPassword(in.Password, hash) || err != nil {
		d.lim.fail(key)
		log.Printf("desktop: login NEGADO user=%q ip=%s", in.Username, r.RemoteAddr)
		deskErr(w, http.StatusUnauthorized, "usuário ou senha incorretos")
		return
	}
	d.lim.reset(key)
	if err := d.startSession(w, r, u.ID); err != nil {
		log.Printf("desktop: falha criando sessão: %v", err)
		deskErr(w, http.StatusInternalServerError, "falha criando sessão")
		return
	}
	d.st.deskPurgeSessions(r.Context(), time.Now().Unix())
	log.Printf("desktop: login user=%s ip=%s", u.Username, r.RemoteAddr)
	writeStatus(w, http.StatusOK, d.meOf(u))
}

func (d *deskAPI) handleLogout(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	d.relock(r)
	d.st.deskDeleteSession(r.Context(), deskTokenHash(deskToken(r)))
	clearDeskCookie(w)
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}

func (d *deskAPI) handleMe(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	writeStatus(w, http.StatusOK, d.meOf(u))
}

func (d *deskAPI) handlePassword(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in struct{ Current, New string }
	if !deskDecode(w, r, &in) {
		return
	}
	key := "pw|" + deskLimiterKey(r, u.Username)
	if d.lim.blocked(key) {
		deskErr(w, http.StatusTooManyRequests, "muitas tentativas; aguarde alguns minutos")
		return
	}
	if !verifyDeskPassword(in.Current, u.PassHash) {
		d.lim.fail(key)
		deskErr(w, http.StatusUnauthorized, "senha atual incorreta")
		return
	}
	if err := validateDeskPassword(in.New); err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if in.New == in.Current {
		deskErr(w, http.StatusBadRequest, "escolha uma senha diferente da atual")
		return
	}
	h, err := hashDeskPassword(in.New)
	if err == nil {
		err = d.st.deskSetPassword(r.Context(), u.ID, h, false)
	}
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha salvando a senha")
		return
	}
	d.lim.reset(key)
	d.st.deskDeleteUserSessions(r.Context(), u.ID, deskTokenHash(deskToken(r)))
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- administração de usuários ----------

func (d *deskAPI) handleListUsers(w http.ResponseWriter, r *http.Request, _ *DeskUser) {
	users, err := d.st.deskListUsers(r.Context())
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha listando usuários")
		return
	}
	writeStatus(w, http.StatusOK, users)
}

func (d *deskAPI) handleCreateUser(w http.ResponseWriter, r *http.Request, _ *DeskUser) {
	var in struct {
		Username    string
		Password    string
		IsAdmin     bool `json:"is_admin"`
		CanTerminal bool `json:"can_terminal"`
		CanExplorer bool `json:"can_explorer"`
	}
	if !deskDecode(w, r, &in) {
		return
	}
	if !deskUsernameRe.MatchString(in.Username) {
		deskErr(w, http.StatusBadRequest, "usuário deve ter 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado")
		return
	}
	if err := validateDeskPassword(in.Password); err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	h, err := hashDeskPassword(in.Password)
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha gerando o hash")
		return
	}
	// must_change: a senha definida aqui é provisória; quem escolhe a final é o usuário.
	id, err := d.st.deskCreateUser(r.Context(), DeskUser{Username: in.Username, PassHash: h, IsAdmin: in.IsAdmin,
		CanTerminal: in.CanTerminal, CanExplorer: in.CanExplorer, MustChange: true, CreatedAt: time.Now().Unix()})
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			deskErr(w, http.StatusConflict, "já existe um usuário com esse nome")
			return
		}
		deskErr(w, http.StatusInternalServerError, "falha criando o usuário")
		return
	}
	created, _ := d.st.deskUserBy(r.Context(), "id", id)
	writeStatus(w, http.StatusCreated, created)
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		deskErr(w, http.StatusBadRequest, "id inválido")
		return 0, false
	}
	return id, true
}

// handlePatchUser muda o que o usuário pode usar: Terminal e arquivos do computador.
func (d *deskAPI) handlePatchUser(w http.ResponseWriter, r *http.Request, _ *DeskUser) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		CanTerminal *bool `json:"can_terminal"`
		CanExplorer *bool `json:"can_explorer"`
	}
	if !deskDecode(w, r, &in) {
		return
	}
	t, err := d.st.deskUserBy(r.Context(), "id", id)
	if err != nil {
		deskErr(w, http.StatusNotFound, "usuário não encontrado")
		return
	}
	term, expl := t.CanTerminal, t.CanExplorer
	if in.CanTerminal != nil {
		term = *in.CanTerminal
	}
	if in.CanExplorer != nil {
		expl = *in.CanExplorer
	}
	if err := d.st.deskSetPerms(r.Context(), id, term, expl); err != nil {
		deskErr(w, http.StatusInternalServerError, "falha salvando")
		return
	}
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}

func (d *deskAPI) handleResetPassword(w http.ResponseWriter, r *http.Request, admin *DeskUser) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct{ Password string }
	if !deskDecode(w, r, &in) {
		return
	}
	if err := validateDeskPassword(in.Password); err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := d.st.deskUserBy(r.Context(), "id", id); err != nil {
		deskErr(w, http.StatusNotFound, "usuário não encontrado")
		return
	}
	h, err := hashDeskPassword(in.Password)
	if err == nil {
		err = d.st.deskSetPassword(r.Context(), id, h, true)
	}
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha salvando a senha")
		return
	}
	keep := ""
	if id == admin.ID {
		keep = deskTokenHash(deskToken(r))
	}
	d.st.deskDeleteUserSessions(r.Context(), id, keep)
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}

func (d *deskAPI) handleDeleteUser(w http.ResponseWriter, r *http.Request, admin *DeskUser) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if id == admin.ID {
		deskErr(w, http.StatusBadRequest, "você não pode remover a si mesmo")
		return
	}
	t, err := d.st.deskUserBy(r.Context(), "id", id)
	if err != nil {
		deskErr(w, http.StatusNotFound, "usuário não encontrado")
		return
	}
	if t.IsAdmin {
		if n, _ := d.st.deskCount(r.Context(), "WHERE is_admin = 1"); n <= 1 {
			deskErr(w, http.StatusBadRequest, "não é possível remover o último administrador")
			return
		}
	}
	d.chatPurgeUser(r.Context(), id)
	if err := d.st.deskDeleteUser(r.Context(), id); err != nil {
		deskErr(w, http.StatusInternalServerError, "falha removendo o usuário")
		return
	}
	if err := os.RemoveAll(d.userDir(id)); err != nil {
		log.Printf("desktop: falha removendo a pasta do usuário %d: %v", id, err)
	}
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}

// userDir é a pasta própria do usuário ("Meus arquivos"): nenhum outro usuário a alcança.
func (d *deskAPI) userDir(id int64) string { return filepath.Join(d.dir, strconv.FormatInt(id, 10)) }

// protectSettings (opção "protectSettings"): alterações de Config, câmeras e energia passam a exigir uma sessão de
// administrador do Diogows, mesmo vindo das páginas antigas (config.html). Leitura continua aberta como sempre foi.
func (d *deskAPI) protectSettings(next http.Handler) http.Handler {
	if !d.cfg.ProtectSettings || d.cfg.Disabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		write := r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions
		if write && (strings.HasPrefix(p, "/api/settings/") || strings.HasPrefix(p, "/api/admin/") || p == "/api/recordings/settings" || strings.HasPrefix(p, "/api/recordings/drive")) {
			if u := d.sessionUser(r); u == nil || !u.IsAdmin || u.MustChange {
				deskErr(w, http.StatusUnauthorized, "entre no Diogows como administrador para alterar a configuração")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
