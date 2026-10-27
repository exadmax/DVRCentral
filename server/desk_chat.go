// Diogows: Mensagens. Conversa um a um entre os usuários do Diogows, com envio de arquivos e imagens. O texto e os dados do
// anexo ficam no SQLite; o conteúdo dos anexos fica em <desk>/_chat/ (nome sorteado, nunca o nome enviado). Só quem enviou e
// quem recebeu alcança uma mensagem ou o anexo dela.
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const deskChatMigration = `CREATE TABLE IF NOT EXISTS desk_messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	from_id INTEGER NOT NULL,
	to_id INTEGER NOT NULL,
	body TEXT NOT NULL DEFAULT '',
	file_name TEXT NOT NULL DEFAULT '',
	file_size INTEGER NOT NULL DEFAULT 0,
	file_key TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	read_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS desk_messages_pair ON desk_messages (from_id, to_id, id);
CREATE INDEX IF NOT EXISTS desk_messages_to ON desk_messages (to_id, read_at);`

const (
	deskChatMaxText = 4000
	deskChatPage    = 300
)

// Imagens que a conversa mostra na própria bolha. SVG fica de fora de propósito (carrega script): baixa como qualquer arquivo.
var deskChatImages = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
}

type chatFile struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Image bool   `json:"image"`
}

type chatMsg struct {
	ID   int64     `json:"id"`
	From int64     `json:"from"`
	To   int64     `json:"to"`
	Text string    `json:"text"`
	File *chatFile `json:"file,omitempty"`
	At   int64     `json:"at"`
	Read bool      `json:"read"`
	key  string
}

type chatPeer struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Unread   int    `json:"unread"`
	LastAt   int64  `json:"last_at"`
	Preview  string `json:"preview,omitempty"` // última mensagem não lida (para o aviso)
}

func (d *deskAPI) chatDir() string { return filepath.Join(d.dir, "_chat") }

func isChatImage(name string) bool {
	_, ok := deskChatImages[strings.ToLower(path.Ext(name))]
	return ok
}

const chatCols = "id, from_id, to_id, body, file_name, file_size, file_key, created_at, read_at"

func scanChatMsg(row interface{ Scan(...any) error }) (chatMsg, error) {
	var m chatMsg
	var fname string
	var fsize, readAt int64
	if err := row.Scan(&m.ID, &m.From, &m.To, &m.Text, &fname, &fsize, &m.key, &m.At, &readAt); err != nil {
		return m, err
	}
	m.Read = readAt > 0
	if m.key != "" {
		m.File = &chatFile{Name: fname, Size: fsize, Image: isChatImage(fname)}
	}
	return m, nil
}

func (s *store) chatInsert(ctx context.Context, m chatMsg, fileName string, fileSize int64) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO desk_messages (from_id, to_id, body, file_name, file_size, file_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		m.From, m.To, m.Text, fileName, fileSize, m.key, m.At)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *store) chatGet(ctx context.Context, id int64) (chatMsg, error) {
	m, err := scanChatMsg(s.db.QueryRowContext(ctx, `SELECT `+chatCols+` FROM desk_messages WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return m, errDeskNotFound
	}
	return m, err
}

// chatPeers lista os outros usuários (menos os administradores) com o que há de novo de cada um.
func (s *store) chatPeers(ctx context.Context, me int64) ([]chatPeer, error) {
	users, err := s.deskListUsers(ctx)
	if err != nil {
		return nil, err
	}
	peers := map[int64]*chatPeer{}
	out := []chatPeer{}
	for _, u := range users {
		if u.ID != me && !u.IsAdmin { // administradores não recebem mensagens
			out = append(out, chatPeer{ID: u.ID, Username: u.Username})
		}
	}
	for i := range out {
		peers[out[i].ID] = &out[i]
	}
	rows, err := s.db.QueryContext(ctx, `SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END, MAX(created_at) FROM desk_messages
		WHERE from_id = ? OR to_id = ? GROUP BY 1`, me, me, me)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, at int64
		if err := rows.Scan(&id, &at); err != nil {
			rows.Close()
			return nil, err
		}
		if p := peers[id]; p != nil {
			p.LastAt = at
		}
	}
	rows.Close()
	rows, err = s.db.QueryContext(ctx, `SELECT m.from_id, c.n, m.body, m.file_name FROM desk_messages m
		JOIN (SELECT from_id, COUNT(*) n, MAX(id) mid FROM desk_messages WHERE to_id = ? AND read_at = 0 GROUP BY from_id) c ON c.mid = m.id`, me)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var n int
		var body, fname string
		if err := rows.Scan(&id, &n, &body, &fname); err != nil {
			return nil, err
		}
		if p := peers[id]; p != nil {
			p.Unread = n
			p.Preview = body
			if p.Preview == "" {
				p.Preview = "📎 " + fname
			}
			if r := []rune(p.Preview); len(r) > 80 {
				p.Preview = string(r[:80]) + "…"
			}
		}
	}
	return out, rows.Err()
}

// chatPurgeUser apaga as mensagens (e os anexos) de um usuário removido.
func (d *deskAPI) chatPurgeUser(ctx context.Context, id int64) {
	rows, err := d.st.db.QueryContext(ctx, `SELECT file_key FROM desk_messages WHERE (from_id = ? OR to_id = ?) AND file_key <> ''`, id, id)
	if err != nil {
		return
	}
	var keys []string
	for rows.Next() {
		var k string
		if rows.Scan(&k) == nil {
			keys = append(keys, k)
		}
	}
	rows.Close()
	for _, k := range keys {
		_ = os.Remove(filepath.Join(d.chatDir(), k))
	}
	_, _ = d.st.db.ExecContext(ctx, `DELETE FROM desk_messages WHERE from_id = ? OR to_id = ?`, id, id)
}

func (d *deskAPI) registerChat(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/desk/chat/peers", d.guard(false, false, d.chatPeersH))
	mux.HandleFunc("GET /api/desk/chat/messages", d.guard(false, false, d.chatMessages))
	mux.HandleFunc("POST /api/desk/chat/send", d.guard(false, false, d.chatSend))
	mux.HandleFunc("POST /api/desk/chat/upload", d.guard(false, false, d.chatUpload))
	mux.HandleFunc("GET /api/desk/chat/file", d.guard(false, false, d.chatFile))
	mux.HandleFunc("POST /api/desk/chat/save", d.guard(false, false, d.chatSave))
	mux.HandleFunc("DELETE /api/desk/chat/messages/{id}", d.guard(false, false, d.chatDelete))
}

func (d *deskAPI) chatPeersH(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	peers, err := d.st.chatPeers(r.Context(), u.ID)
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha listando as conversas")
		return
	}
	writeStatus(w, http.StatusOK, peers)
}

// chatPeer valida o destinatário (?to= ou ?with=): precisa existir e não ser a própria pessoa.
func (d *deskAPI) chatPeer(w http.ResponseWriter, r *http.Request, u *DeskUser, param string) (*DeskUser, bool) {
	id, err := strconv.ParseInt(r.URL.Query().Get(param), 10, 64)
	if err != nil || id <= 0 {
		deskErr(w, http.StatusBadRequest, "usuário inválido")
		return nil, false
	}
	if id == u.ID {
		deskErr(w, http.StatusBadRequest, "escolha outro usuário")
		return nil, false
	}
	p, err := d.st.deskUserBy(r.Context(), "id", id)
	if err != nil {
		deskErr(w, http.StatusNotFound, "usuário não encontrado")
		return nil, false
	}
	if p.IsAdmin {
		deskErr(w, http.StatusForbidden, "não é possível trocar mensagens com o administrador")
		return nil, false
	}
	return p, true
}

// chatMessages devolve a conversa com ?with= (as mais recentes; ?after=N só traz as de id maior) e marca como lidas as recebidas.
// read_upto é o maior id das mensagens da própria pessoa que o outro já leu (para os "vistos").
func (d *deskAPI) chatMessages(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	p, ok := d.chatPeer(w, r, u, "with")
	if !ok {
		return
	}
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	ctx := r.Context()
	rows, err := d.st.db.QueryContext(ctx, `SELECT `+chatCols+` FROM (SELECT `+chatCols+` FROM desk_messages
		WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id`,
		u.ID, p.ID, p.ID, u.ID, after, deskChatPage)
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha lendo as mensagens")
		return
	}
	msgs := []chatMsg{}
	for rows.Next() {
		m, err := scanChatMsg(rows)
		if err != nil {
			rows.Close()
			deskErr(w, http.StatusInternalServerError, "falha lendo as mensagens")
			return
		}
		msgs = append(msgs, m)
	}
	rows.Close()
	_, _ = d.st.db.ExecContext(ctx, `UPDATE desk_messages SET read_at = ? WHERE to_id = ? AND from_id = ? AND read_at = 0`, time.Now().Unix(), u.ID, p.ID)
	var upto int64
	_ = d.st.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(id), 0) FROM desk_messages WHERE from_id = ? AND to_id = ? AND read_at > 0`, u.ID, p.ID).Scan(&upto)
	writeStatus(w, http.StatusOK, map[string]any{"messages": msgs, "read_upto": upto})
}

func (d *deskAPI) chatSend(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	p, ok := d.chatPeer(w, r, u, "to")
	if !ok {
		return
	}
	var in struct{ Text string }
	if !deskDecode(w, r, &in) {
		return
	}
	text := strings.TrimSpace(in.Text)
	if text == "" {
		deskErr(w, http.StatusBadRequest, "escreva uma mensagem")
		return
	}
	if utf8.RuneCountInString(text) > deskChatMaxText {
		deskErr(w, http.StatusBadRequest, "mensagem longa demais (máximo "+strconv.Itoa(deskChatMaxText)+" caracteres)")
		return
	}
	m := chatMsg{From: u.ID, To: p.ID, Text: text, At: time.Now().Unix()}
	id, err := d.st.chatInsert(r.Context(), m, "", 0)
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha enviando a mensagem")
		return
	}
	m.ID = id
	writeStatus(w, http.StatusCreated, m)
}

// chatFileName deixa só o nome do arquivo, sem pasta nem caracteres de controle.
func chatFileName(n string) string {
	n = strings.ReplaceAll(n, "\\", "/")
	n = path.Base(n)
	n = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, n)
	n = strings.TrimSpace(n)
	if r := []rune(n); len(r) > 200 {
		n = string(r[:200])
	}
	if n == "." || n == ".." || n == "/" {
		return ""
	}
	return n
}

// chatUpload recebe o arquivo no corpo cru: ?to=ID&name=arquivo.ext[&text=legenda].
func (d *deskAPI) chatUpload(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	p, ok := d.chatPeer(w, r, u, "to")
	if !ok {
		return
	}
	q := r.URL.Query()
	name := chatFileName(q.Get("name"))
	if name == "" {
		deskErr(w, http.StatusBadRequest, "informe o nome do arquivo")
		return
	}
	caption := strings.TrimSpace(q.Get("text"))
	if utf8.RuneCountInString(caption) > deskChatMaxText {
		deskErr(w, http.StatusBadRequest, "legenda longa demais")
		return
	}
	if err := os.MkdirAll(d.chatDir(), 0o700); err != nil {
		deskErr(w, http.StatusInternalServerError, "falha preparando a pasta das mensagens")
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	_ = http.NewResponseController(w).SetReadDeadline(time.Time{})
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		deskErr(w, http.StatusInternalServerError, "falha enviando o arquivo")
		return
	}
	key := hex.EncodeToString(raw)
	dst := filepath.Join(d.chatDir(), key)
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha gravando o arquivo")
		return
	}
	n, err := io.Copy(f, http.MaxBytesReader(w, r.Body, d.maxUp))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil || n == 0 {
		_ = os.Remove(dst)
		var me *http.MaxBytesError
		switch {
		case errors.As(err, &me):
			deskErr(w, http.StatusRequestEntityTooLarge, "arquivo maior que o limite ("+strconv.FormatInt(d.maxUp>>20, 10)+" MB)")
		case err == nil:
			deskErr(w, http.StatusBadRequest, "arquivo vazio")
		default:
			deskErr(w, http.StatusInternalServerError, "falha gravando o arquivo")
		}
		return
	}
	m := chatMsg{From: u.ID, To: p.ID, Text: caption, At: time.Now().Unix(), key: key}
	id, err := d.st.chatInsert(r.Context(), m, name, n)
	if err != nil {
		_ = os.Remove(dst)
		deskErr(w, http.StatusInternalServerError, "falha enviando o arquivo")
		return
	}
	m.ID = id
	m.File = &chatFile{Name: name, Size: n, Image: isChatImage(name)}
	writeStatus(w, http.StatusCreated, m)
}

// chatOwned carrega a mensagem do ?id= se a pessoa for quem enviou ou quem recebeu (senão, "não encontrada").
func (d *deskAPI) chatOwned(w http.ResponseWriter, r *http.Request, u *DeskUser, id int64) (chatMsg, bool) {
	m, err := d.st.chatGet(r.Context(), id)
	if err != nil || (m.From != u.ID && m.To != u.ID) {
		deskErr(w, http.StatusNotFound, "mensagem não encontrada")
		return m, false
	}
	return m, true
}

// chatFile entrega o anexo (mode=view só para imagens da lista; o resto baixa), com Range.
func (d *deskAPI) chatFile(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	id, _ := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	m, ok := d.chatOwned(w, r, u, id)
	if !ok {
		return
	}
	if m.File == nil || !validChatKey(m.key) {
		deskErr(w, http.StatusNotFound, "esta mensagem não tem arquivo")
		return
	}
	f, err := os.Open(filepath.Join(d.chatDir(), m.key))
	if err != nil {
		deskErr(w, http.StatusNotFound, "arquivo não encontrado")
		return
	}
	defer f.Close()
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, no-store")
	if ct, isImg := deskChatImages[strings.ToLower(path.Ext(m.File.Name))]; isImg && r.URL.Query().Get("mode") == "view" {
		h.Set("Content-Type", ct)
		h.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox")
	} else {
		h.Set("Content-Type", "application/octet-stream")
		h.Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEscapeName(m.File.Name))
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	http.ServeContent(w, r, "", time.Unix(m.At, 0), f)
}

func validChatKey(k string) bool {
	if len(k) != 32 {
		return false
	}
	_, err := hex.DecodeString(k)
	return err == nil
}

// chatSave copia um anexo recebido para "Meus arquivos/Recebidos" de quem está logado.
func (d *deskAPI) chatSave(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in struct{ ID int64 }
	if !deskDecode(w, r, &in) {
		return
	}
	m, ok := d.chatOwned(w, r, u, in.ID)
	if !ok {
		return
	}
	if m.File == nil || !validChatKey(m.key) {
		deskErr(w, http.StatusNotFound, "esta mensagem não tem arquivo")
		return
	}
	src, err := os.Open(filepath.Join(d.chatDir(), m.key))
	if err != nil {
		deskErr(w, http.StatusNotFound, "arquivo não encontrado")
		return
	}
	defer src.Close()
	dir := filepath.Join(d.userDir(u.ID), "Recebidos")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		deskErr(w, http.StatusInternalServerError, "falha criando a pasta Recebidos")
		return
	}
	base := m.File.Name
	ext := path.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	name := base
	var out *os.File
	for i := 2; ; i++ { // nunca sobrescreve: "foto (2).png", "foto (3).png"...
		out, err = os.OpenFile(filepath.Join(dir, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err == nil {
			break
		}
		if !errors.Is(err, os.ErrExist) || i > 999 {
			deskErr(w, http.StatusInternalServerError, "falha gravando o arquivo")
			return
		}
		name = stem + " (" + strconv.Itoa(i) + ")" + ext
	}
	_, err = io.Copy(out, src)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(filepath.Join(dir, name))
		deskErr(w, http.StatusInternalServerError, "falha gravando o arquivo")
		return
	}
	writeStatus(w, http.StatusOK, map[string]string{"path": "/Recebidos/" + name})
}

// chatDelete: só quem enviou apaga a própria mensagem (e o anexo, dos dois lados).
func (d *deskAPI) chatDelete(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	m, err := d.st.chatGet(r.Context(), id)
	if err != nil || m.From != u.ID {
		deskErr(w, http.StatusNotFound, "mensagem não encontrada")
		return
	}
	if _, err := d.st.db.ExecContext(r.Context(), `DELETE FROM desk_messages WHERE id = ?`, id); err != nil {
		deskErr(w, http.StatusInternalServerError, "falha apagando a mensagem")
		return
	}
	if validChatKey(m.key) {
		if err := os.Remove(filepath.Join(d.chatDir(), m.key)); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Printf("desktop: falha removendo anexo %s: %v", m.key, err)
		}
	}
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}
