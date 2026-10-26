// Terminal e arquivos do computador no Desktop. Como é execução de comando no servidor, cada chamada passa por portões:
//
//  1. "desk.shell": true no hub.config.json (desligado por padrão);
//  2. usuário administrador, ou que o administrador liberou para o Terminal / para os arquivos do computador;
//  3. rede: HTTPS, o próprio servidor, ou um aparelho de rede privada (192.168.x.x, 10.x, 172.16-31.x). Internet em HTTP
//     puro é recusada, a não ser que "desk.shellAnyNetwork" esteja ligado;
//  4. "desbloqueio": a pessoa redigita a PRÓPRIA senha e a liberação vale 15 minutos.
//
// O sudo é um portão a mais: pede a senha de um ADMINISTRADOR (a própria, se for administrador) e também vale 15 minutos.
// Quem tem o sudo executa como root por meio de `sudo -n`, então o usuário do serviço precisa de NOPASSWD (o install.sh
// com --desk-shell prepara isso). Cada comando, listagem, leitura e gravação vai para o journal com usuário e IP.
package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	deskUnlockTTL      = 15 * time.Minute
	deskShellTimeout   = 5 * time.Minute
	deskShellMaxOutput = 2 << 20
	deskShellMaxCmd    = 8192
)

const deskInsecureMsg = "o Terminal e os arquivos do computador só aceitam HTTPS ou aparelhos da rede local; esta conexão vem de fora da rede privada em HTTP puro"

type deskUnlock struct{ machine, sudo time.Time }

type deskShellState struct {
	mu      sync.Mutex
	unlocks map[string]deskUnlock // hash do token da sessão -> até quando vale
	busy    map[int64]bool        // usuário com comando em execução
}

func (d *deskAPI) unlockOf(r *http.Request) (machine, sudo bool) {
	st := d.shell
	st.mu.Lock()
	defer st.mu.Unlock()
	un := st.unlocks[deskTokenHash(deskToken(r))]
	now := time.Now()
	return now.Before(un.machine), now.Before(un.sudo)
}

func (d *deskAPI) setUnlock(r *http.Request, machine, sudo bool) {
	st := d.shell
	st.mu.Lock()
	defer st.mu.Unlock()
	k := deskTokenHash(deskToken(r))
	un := st.unlocks[k]
	exp := time.Now().Add(deskUnlockTTL)
	if machine {
		un.machine = exp
	}
	if sudo {
		un.sudo = exp
	}
	st.unlocks[k] = un
}

func (d *deskAPI) relock(r *http.Request) {
	st := d.shell
	st.mu.Lock()
	delete(st.unlocks, deskTokenHash(deskToken(r)))
	st.mu.Unlock()
}

// clientIP é o IP de quem fez o pedido. Se veio de um proxy no próprio servidor, vale o último X-Forwarded-For.
func clientIP(r *http.Request) net.IP {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return nil
	}
	ip := net.ParseIP(host)
	if ip != nil && ip.IsLoopback() {
		if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
			if p := net.ParseIP(strings.TrimSpace(xf[strings.LastIndex(xf, ",")+1:])); p != nil {
				return p
			}
		}
	}
	return ip
}

func (d *deskAPI) shellNetOK(r *http.Request) bool {
	if deskIsHTTPS(r) || d.cfg.ShellAnyNetwork {
		return true
	}
	ip := clientIP(r)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast())
}

// shellGate confere os portões e, se algum falhar, responde o erro e devolve false. what: "terminal" ou "explorer".
func (d *deskAPI) shellGate(w http.ResponseWriter, r *http.Request, u *DeskUser, what string, sudo bool) bool {
	if !d.cfg.Shell {
		deskErr(w, http.StatusForbidden, "recurso desligado neste servidor (hub.config.json: \"desk\": {\"shell\": true})")
		return false
	}
	if (what == "terminal" && !u.terminal()) || (what == "explorer" && !u.explorer()) {
		deskErr(w, http.StatusForbidden, "você não tem permissão para isto; peça ao administrador")
		return false
	}
	if !d.shellNetOK(r) {
		deskErr(w, http.StatusForbidden, deskInsecureMsg)
		return false
	}
	m, s := d.unlockOf(r)
	if !m {
		deskErr(w, http.StatusForbidden, "locked")
		return false
	}
	if sudo {
		if runtime.GOOS != "linux" {
			deskErr(w, http.StatusNotImplemented, "o sudo só existe no Linux do servidor")
			return false
		}
		if !s {
			deskErr(w, http.StatusForbidden, "sudo_locked")
			return false
		}
	}
	return true
}

func (d *deskAPI) registerShell(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/desk/shell/status", d.guard(false, false, d.handleShellStatus))
	mux.HandleFunc("POST /api/desk/shell/unlock", d.guard(false, false, d.handleShellUnlock))
	mux.HandleFunc("POST /api/desk/shell/sudo", d.guard(false, false, d.handleShellSudo))
	mux.HandleFunc("POST /api/desk/shell/lock", d.guard(false, false, d.handleShellLock))
	mux.HandleFunc("POST /api/desk/shell/run", d.guard(false, false, d.handleShellRun))
}

func (d *deskAPI) handleShellStatus(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	m, s := d.unlockOf(r)
	writeStatus(w, http.StatusOK, map[string]any{
		"enabled": d.cfg.Shell, "terminal": u.terminal(), "explorer": u.explorer(), "network_ok": d.shellNetOK(r),
		"unlocked": d.cfg.Shell && m, "sudo_unlocked": d.cfg.Shell && s, "sudo_available": runtime.GOOS == "linux",
		"is_admin": u.IsAdmin, "os": runtime.GOOS, "ttl_minutes": int(deskUnlockTTL.Minutes()),
	})
}

// preUnlock são os portões 1 a 3 das rotas de desbloqueio (a senha também não pode trafegar da internet em HTTP puro).
func (d *deskAPI) preUnlock(w http.ResponseWriter, r *http.Request, u *DeskUser) bool {
	if !d.cfg.Shell {
		deskErr(w, http.StatusForbidden, "recurso desligado neste servidor (hub.config.json: \"desk\": {\"shell\": true})")
		return false
	}
	if !u.terminal() && !u.explorer() {
		deskErr(w, http.StatusForbidden, "você não tem permissão para isto; peça ao administrador")
		return false
	}
	if !d.shellNetOK(r) {
		deskErr(w, http.StatusForbidden, deskInsecureMsg)
		return false
	}
	return true
}

func (d *deskAPI) handleShellUnlock(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	if !d.preUnlock(w, r, u) {
		return
	}
	var in struct{ Password string }
	if !deskDecode(w, r, &in) {
		return
	}
	key := "unlock|" + deskLimiterKey(r, u.Username)
	if d.lim.blocked(key) {
		deskErr(w, http.StatusTooManyRequests, "muitas tentativas; aguarde alguns minutos")
		return
	}
	if !verifyDeskPassword(in.Password, u.PassHash) {
		d.lim.fail(key)
		log.Printf("desktop-shell: desbloqueio NEGADO user=%s ip=%s", u.Username, r.RemoteAddr)
		deskErr(w, http.StatusUnauthorized, "senha incorreta")
		return
	}
	d.lim.reset(key)
	// O administrador digitou a senha de um administrador: o sudo já fica liberado junto.
	d.setUnlock(r, true, u.IsAdmin && runtime.GOOS == "linux")
	log.Printf("desktop-shell: desbloqueado user=%s ip=%s", u.Username, r.RemoteAddr)
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleShellSudo libera o sudo com a senha de um administrador. Quem não é administrador informa qual.
func (d *deskAPI) handleShellSudo(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	if !d.preUnlock(w, r, u) {
		return
	}
	if runtime.GOOS != "linux" {
		deskErr(w, http.StatusNotImplemented, "o sudo só existe no Linux do servidor")
		return
	}
	if m, _ := d.unlockOf(r); !m {
		deskErr(w, http.StatusForbidden, "locked")
		return
	}
	var in struct{ Admin, Password string }
	if !deskDecode(w, r, &in) {
		return
	}
	name := strings.TrimSpace(in.Admin)
	if name == "" && u.IsAdmin {
		name = u.Username
	}
	key := "sudo|" + deskLimiterKey(r, name)
	if d.lim.blocked(key) {
		deskErr(w, http.StatusTooManyRequests, "muitas tentativas; aguarde alguns minutos")
		return
	}
	adm, err := d.st.deskUserBy(r.Context(), "username", name)
	hash := "pbkdf2-sha256$1$AAAA$AAAA"
	if err == nil {
		hash = adm.PassHash
	}
	if err != nil || !adm.IsAdmin || !verifyDeskPassword(in.Password, hash) {
		d.lim.fail(key)
		log.Printf("desktop-shell: sudo NEGADO user=%s admin=%q ip=%s", u.Username, name, r.RemoteAddr)
		deskErr(w, http.StatusUnauthorized, "administrador ou senha incorretos")
		return
	}
	d.lim.reset(key)
	d.setUnlock(r, false, true)
	log.Printf("desktop-shell: sudo liberado user=%s com a senha do administrador %s ip=%s", u.Username, adm.Username, r.RemoteAddr)
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}

func (d *deskAPI) handleShellLock(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	d.relock(r)
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- terminal ----------

// limitedFlushWriter escreve no response e dá flush a cada pedaço; passado do limite, descarta o resto e cancela o comando.
type limitedFlushWriter struct {
	mu     sync.Mutex
	w      http.ResponseWriter
	f      http.Flusher
	n      int64
	cancel context.CancelFunc
	cut    bool
}

func (l *limitedFlushWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cut {
		return len(p), nil
	}
	if l.n+int64(len(p)) > deskShellMaxOutput {
		if room := deskShellMaxOutput - l.n; room > 0 {
			l.w.Write(p[:room])
		}
		l.w.Write([]byte("\n[saída truncada em 2 MB; comando interrompido]\n"))
		l.cut = true
		l.cancel()
	} else {
		l.w.Write(p)
		l.n += int64(len(p))
	}
	if l.f != nil {
		l.f.Flush()
	}
	return len(p), nil
}

func (d *deskAPI) handleShellRun(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in struct {
		Command, Cwd string
		Sudo         bool
	}
	if !deskDecode(w, r, &in) {
		return
	}
	if !d.shellGate(w, r, u, "terminal", in.Sudo) {
		return
	}
	if strings.TrimSpace(in.Command) == "" || len(in.Command) > deskShellMaxCmd || strings.ContainsRune(in.Command+in.Cwd, 0) {
		deskErr(w, http.StatusBadRequest, "comando inválido")
		return
	}
	st := d.shell
	st.mu.Lock()
	if st.busy[u.ID] {
		st.mu.Unlock()
		deskErr(w, http.StatusConflict, "já existe um comando em execução; interrompa-o primeiro")
		return
	}
	st.busy[u.ID] = true
	st.mu.Unlock()
	defer func() { st.mu.Lock(); delete(st.busy, u.ID); st.mu.Unlock() }()

	log.Printf("desktop-shell: user=%s ip=%s sudo=%v cwd=%q cmd=%q", u.Username, r.RemoteAddr, in.Sudo, in.Cwd, deskTrunc(in.Command, 300))

	ctx, cancel := context.WithTimeout(r.Context(), deskShellTimeout)
	defer cancel()
	cmd := buildShellCommand(ctx, in.Command, in.Cwd, in.Sudo)
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{}) // o WriteTimeout do hub (60 s) não vale para um comando longo
	flusher, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	out := &limitedFlushWriter{w: w, f: flusher, cancel: cancel}
	cmd.Stdout, cmd.Stderr = out, out
	cmd.WaitDelay = 3 * time.Second
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		switch {
		case ctx.Err() == context.DeadlineExceeded:
			out.Write([]byte("\n[tempo limite de 5 min excedido; comando interrompido]\n"))
		case !errors.As(err, &exitErr) && ctx.Err() == nil:
			// falha ao iniciar (ex.: pasta inexistente): sem isso a tela ficaria muda
			out.Write([]byte("\n[não foi possível executar: " + err.Error() + "]\n"))
		}
	}
}

func deskTrunc(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

// sudoRun executa `sudo -n <args>` (usado pelos arquivos do computador em modo sudo) e devolve a saída.
func sudoRun(ctx context.Context, stdin io.Reader, args ...string) ([]byte, error) {
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "sudo", append([]string{"-n"}, args...)...)
	cmd.Stderr = &stderr
	cmd.Stdin = stdin
	out, err := cmd.Output()
	if err != nil {
		return out, errors.New(sudoErrMessage(err, stderr.String()))
	}
	return out, nil
}

func sudoErrMessage(err error, stderr string) string {
	msg := strings.TrimSpace(stderr)
	if msg == "" {
		msg = err.Error()
	}
	if strings.Contains(msg, "a password is required") || strings.Contains(msg, "no tty present") || strings.Contains(msg, "a terminal is required") {
		return "o sudo do usuário do serviço exige senha (falta NOPASSWD; rode o install.sh com --desk-shell)"
	}
	if strings.Contains(msg, "no new privileges") {
		return "o serviço está com NoNewPrivileges=true, que bloqueia o sudo (rode o install.sh com --desk-shell)"
	}
	return deskTrunc(msg, 300)
}
