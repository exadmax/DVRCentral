// Arquivos do Diogows (Explorer, visualizadores, Bloco de Notas e player de vídeo). Existem dois "espaços":
//
//	home     a pasta própria do usuário, presa à pasta dele (ninguém mais enxerga). Qualquer usuário.
//	machine  o computador do servidor, como o usuário do serviço ou, com sudo=1, como root. Passa pelos portões do terminal
//	         (desk_shell.go) e só vai para quem o administrador liberou.
//
// Os caminhos da API usam sempre "/" (no Windows de desenvolvimento, "/" lista as unidades e "/C:/Users" é uma pasta).
package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	deskFsMaxEntries = 5000
	deskTextMax      = 1 << 20
)

type fsEntry struct {
	Name  string  `json:"name"`
	Path  string  `json:"path"`
	Type  string  `json:"type"` // dir | file | other
	Size  int64   `json:"size"`
	MTime float64 `json:"mtime"` // segundos Unix
}

// fsError carrega o status HTTP da falha.
type fsError struct {
	status int
	msg    string
}

func (e *fsError) Error() string { return e.msg }

func fsErr(status int, format string, a ...any) error {
	return &fsError{status, fmt.Sprintf(format, a...)}
}

// osErr traduz erros do sistema de arquivos para algo que a tela entende.
func osErr(err error) error {
	var fe *fsError
	var me *http.MaxBytesError
	switch {
	case err == nil:
		return nil
	case errors.As(err, &fe):
		return fe
	case errors.As(err, &me):
		return fsErr(http.StatusRequestEntityTooLarge, "arquivo maior que o limite")
	case os.IsNotExist(err):
		return fsErr(http.StatusNotFound, "não encontrado")
	case os.IsPermission(err):
		return fsErr(http.StatusForbidden, "sem permissão (o usuário do serviço não pode fazer isto; tente com sudo)")
	case os.IsExist(err):
		return fsErr(http.StatusConflict, "já existe")
	}
	return fsErr(http.StatusBadRequest, "%s", deskTrunc(err.Error(), 300))
}

type fsBackend interface {
	List(ctx context.Context, dir string) ([]fsEntry, error)
	Stat(ctx context.Context, p string) (fsEntry, error)
	Open(ctx context.Context, p string, off int64) (io.ReadCloser, error)
	Write(ctx context.Context, p string, r io.Reader) error // cria ou substitui; a pasta de destino precisa existir
	Mkdir(ctx context.Context, p string) error
	Remove(ctx context.Context, p string) error // recursivo
	Rename(ctx context.Context, from, to string) error
}

// cleanAPIPath normaliza para "/a/b" (sem "..", sem barras duplas).
func cleanAPIPath(p string) string { return path.Clean("/" + strings.ReplaceAll(p, "\\", "/")) }

func apiParent(p string) string {
	if p == "/" {
		return ""
	}
	return path.Dir(p)
}

func kindOf(mode os.FileMode) string {
	switch {
	case mode.IsDir():
		return "dir"
	case mode.IsRegular():
		return "file"
	}
	return "other"
}

// ---------- local: a pasta do usuário ou o computador inteiro ----------

// localFS com root vazio é o computador (caminhos absolutos); com root, é uma pasta fechada em si mesma.
type localFS struct{ root string }

var winDriveRe = regexp.MustCompile(`^[A-Za-z]:(/|$)`)

func (l localFS) real(p string) (string, error) {
	rel := cleanAPIPath(p)
	if strings.ContainsRune(rel, 0) {
		return "", fsErr(http.StatusBadRequest, "caminho inválido")
	}
	if l.root != "" {
		abs := filepath.Join(l.root, filepath.FromSlash(rel))
		if !l.inside(abs) {
			return "", fsErr(http.StatusForbidden, "caminho fora da sua pasta")
		}
		return abs, nil
	}
	if runtime.GOOS == "windows" {
		s := strings.TrimPrefix(rel, "/")
		if !winDriveRe.MatchString(s) {
			return "", fsErr(http.StatusBadRequest, "use um caminho como /C:/pasta")
		}
		if len(s) == 2 {
			s += "/"
		}
		return filepath.FromSlash(s), nil
	}
	return filepath.FromSlash(rel), nil
}

// inside confere, resolvendo links simbólicos do que já existe, que abs continua dentro da pasta raiz.
func (l localFS) inside(abs string) bool {
	realRoot, err := filepath.EvalSymlinks(l.root)
	if err != nil {
		return false
	}
	for cur := abs; ; cur = filepath.Dir(cur) {
		if r, err := filepath.EvalSymlinks(cur); err == nil {
			rel, err := filepath.Rel(realRoot, r)
			return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
		}
		if cur == filepath.Dir(cur) {
			return false
		}
	}
}

func (l localFS) isDrives(p string) bool {
	return l.root == "" && runtime.GOOS == "windows" && cleanAPIPath(p) == "/"
}

func (l localFS) List(ctx context.Context, dir string) ([]fsEntry, error) {
	base := cleanAPIPath(dir)
	out := []fsEntry{}
	if l.isDrives(dir) {
		for c := 'A'; c <= 'Z'; c++ {
			if st, err := os.Stat(string(c) + ":\\"); err == nil {
				out = append(out, fsEntry{Name: string(c) + ":", Path: "/" + string(c) + ":", Type: "dir", MTime: float64(st.ModTime().Unix())})
			}
		}
		return out, nil
	}
	real, err := l.real(dir)
	if err != nil {
		return nil, err
	}
	ents, err := os.ReadDir(real)
	if err != nil {
		return nil, osErr(err)
	}
	for _, e := range ents {
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			if st, err := os.Stat(filepath.Join(real, e.Name())); err == nil {
				info = st
			}
		}
		out = append(out, fsEntry{Name: e.Name(), Path: path.Join(base, e.Name()), Type: kindOf(info.Mode()), Size: info.Size(), MTime: float64(info.ModTime().UnixNano()) / 1e9})
		if len(out) >= deskFsMaxEntries {
			break
		}
	}
	return out, nil
}

func (l localFS) Stat(ctx context.Context, p string) (fsEntry, error) {
	p = cleanAPIPath(p)
	if l.isDrives(p) {
		return fsEntry{Name: "", Path: "/", Type: "dir"}, nil
	}
	real, err := l.real(p)
	if err != nil {
		return fsEntry{}, err
	}
	st, err := os.Stat(real)
	if err != nil {
		return fsEntry{}, osErr(err)
	}
	return fsEntry{Name: path.Base(p), Path: p, Type: kindOf(st.Mode()), Size: st.Size(), MTime: float64(st.ModTime().UnixNano()) / 1e9}, nil
}

func (l localFS) Open(ctx context.Context, p string, off int64) (io.ReadCloser, error) {
	real, err := l.real(p)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(real)
	if err != nil {
		return nil, osErr(err)
	}
	if off > 0 {
		if _, err := f.Seek(off, io.SeekStart); err != nil {
			f.Close()
			return nil, osErr(err)
		}
	}
	return f, nil
}

func (l localFS) Write(ctx context.Context, p string, r io.Reader) error {
	real, err := l.real(p)
	if err != nil {
		return err
	}
	perm := os.FileMode(0o644)
	if st, err := os.Stat(real); err == nil {
		if st.IsDir() {
			return fsErr(http.StatusBadRequest, "é uma pasta")
		}
		perm = st.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(real), ".desk-*.part")
	if err != nil {
		return osErr(err)
	}
	_, err = io.Copy(tmp, r)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		_ = os.Chmod(tmp.Name(), perm)
		err = os.Rename(tmp.Name(), real)
	}
	if err != nil {
		os.Remove(tmp.Name())
		return osErr(err)
	}
	return nil
}

func (l localFS) Mkdir(ctx context.Context, p string) error {
	real, err := l.real(p)
	if err != nil {
		return err
	}
	return osErr(os.Mkdir(real, 0o755))
}

func (l localFS) Remove(ctx context.Context, p string) error {
	real, err := l.real(p)
	if err != nil {
		return err
	}
	return osErr(os.RemoveAll(real))
}

func (l localFS) Rename(ctx context.Context, from, to string) error {
	a, err := l.real(from)
	if err != nil {
		return err
	}
	b, err := l.real(to)
	if err != nil {
		return err
	}
	return osErr(os.Rename(a, b))
}

// ---------- sudo: o computador como root, por comandos `sudo -n` (só Linux) ----------

type sudoFS struct{}

func (sudoFS) List(ctx context.Context, dir string) ([]fsEntry, error) {
	base := cleanAPIPath(dir)
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	raw, err := sudoRun(cctx, nil, "find", "-L", base, "-maxdepth", "1", "-mindepth", "1", "-printf", `%y\t%s\t%T@\t%f\0`)
	if err != nil && len(raw) == 0 {
		return nil, fsErr(http.StatusBadRequest, "%s", err.Error())
	}
	return parseFindList(base, raw), nil
}

// parseFindList lê a saída de `find -printf '%y\t%s\t%T@\t%f\0'`.
func parseFindList(base string, raw []byte) []fsEntry {
	out := []fsEntry{}
	for _, rec := range bytes.Split(raw, []byte{0}) {
		f := strings.SplitN(string(rec), "\t", 4)
		if len(f) != 4 || f[3] == "" {
			continue
		}
		e := fsEntry{Name: f[3], Path: path.Join(base, f[3]), Type: "other"}
		switch f[0] {
		case "d":
			e.Type = "dir"
		case "f":
			e.Type = "file"
		}
		e.Size, _ = strconv.ParseInt(f[1], 10, 64)
		e.MTime, _ = strconv.ParseFloat(f[2], 64)
		out = append(out, e)
		if len(out) >= deskFsMaxEntries {
			break
		}
	}
	return out
}

func (sudoFS) Stat(ctx context.Context, p string) (fsEntry, error) {
	p = cleanAPIPath(p)
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := sudoRun(cctx, nil, "stat", "-L", "-c", "%F|%s|%Y", "--", p)
	if err != nil {
		return fsEntry{}, fsErr(http.StatusNotFound, "%s", err.Error())
	}
	return parseStat(p, string(out))
}

func parseStat(p, out string) (fsEntry, error) {
	f := strings.SplitN(strings.TrimSpace(out), "|", 3)
	if len(f) != 3 {
		return fsEntry{}, fsErr(http.StatusBadRequest, "resposta inesperada do stat")
	}
	e := fsEntry{Name: path.Base(p), Path: p, Type: "other"}
	switch f[0] {
	case "directory":
		e.Type = "dir"
	case "regular file", "regular empty file":
		e.Type = "file"
	}
	e.Size, _ = strconv.ParseInt(f[1], 10, 64)
	m, _ := strconv.ParseInt(f[2], 10, 64)
	e.MTime = float64(m)
	return e, nil
}

// cmdReader entrega a saída de um comando como io.ReadCloser; fechar antes do fim encerra o comando.
type cmdReader struct {
	io.ReadCloser
	cancel context.CancelFunc
	cmd    *exec.Cmd
}

func (c *cmdReader) Close() error {
	c.cancel()
	c.ReadCloser.Close()
	_ = c.cmd.Wait()
	return nil
}

func (sudoFS) Open(ctx context.Context, p string, off int64) (io.ReadCloser, error) {
	p = cleanAPIPath(p)
	cctx, cancel := context.WithCancel(ctx)
	args := []string{"-n", "cat", "--", p}
	if off > 0 {
		args = []string{"-n", "tail", "-c", "+" + strconv.FormatInt(off+1, 10), "--", p}
	}
	cmd := exec.CommandContext(cctx, "sudo", args...)
	cmd.Stderr = io.Discard
	cmd.WaitDelay = 2 * time.Second
	out, err := cmd.StdoutPipe()
	if err == nil {
		err = cmd.Start()
	}
	if err != nil {
		cancel()
		return nil, fsErr(http.StatusBadRequest, "%s", sudoErrMessage(err, ""))
	}
	return &cmdReader{ReadCloser: out, cancel: cancel, cmd: cmd}, nil
}

func (sudoFS) Write(ctx context.Context, p string, r io.Reader) error {
	// tee grava no próprio arquivo (mantém dono e permissões de um arquivo existente); a saída padrão é descartada.
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "sudo", "-n", "tee", "--", cleanAPIPath(p))
	cmd.Stdin, cmd.Stdout, cmd.Stderr = r, io.Discard, &stderr
	if err := cmd.Run(); err != nil {
		var me *http.MaxBytesError
		if errors.As(err, &me) || strings.Contains(err.Error(), "too large") {
			return fsErr(http.StatusRequestEntityTooLarge, "arquivo maior que o limite")
		}
		return fsErr(http.StatusBadRequest, "%s", sudoErrMessage(err, stderr.String()))
	}
	return nil
}

func (sudoFS) Mkdir(ctx context.Context, p string) error {
	_, err := sudoRun(ctx, nil, "mkdir", "--", cleanAPIPath(p))
	return sudoWrap(err)
}

func (sudoFS) Remove(ctx context.Context, p string) error {
	_, err := sudoRun(ctx, nil, "rm", "-rf", "--", cleanAPIPath(p))
	return sudoWrap(err)
}

func (sudoFS) Rename(ctx context.Context, from, to string) error {
	_, err := sudoRun(ctx, nil, "mv", "--", cleanAPIPath(from), cleanAPIPath(to))
	return sudoWrap(err)
}

func sudoWrap(err error) error {
	if err == nil {
		return nil
	}
	return fsErr(http.StatusBadRequest, "%s", err.Error())
}

// ---------- rotas ----------

func (d *deskAPI) registerFS(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/desk/fs/list", d.guard(false, false, d.fsList))
	mux.HandleFunc("GET /api/desk/fs/read", d.guard(false, false, d.fsRead))
	mux.HandleFunc("PUT /api/desk/fs/file", d.guard(false, false, d.fsPut))
	mux.HandleFunc("POST /api/desk/fs/mkdir", d.guard(false, false, d.fsMkdir))
	mux.HandleFunc("POST /api/desk/fs/move", d.guard(false, false, d.fsMove))
	mux.HandleFunc("DELETE /api/desk/fs", d.guard(false, false, d.fsDelete))
}

func truthy(s string) bool { return s == "1" || s == "true" }

// backend escolhe o espaço do pedido e confere os portões do computador. audit registra no journal o que se faz no computador.
func (d *deskAPI) backend(w http.ResponseWriter, r *http.Request, u *DeskUser, space string, sudo bool, op, p string) (fsBackend, bool) {
	switch space {
	case "home":
		root := filepath.Join(d.userDir(u.ID), "files")
		if err := os.MkdirAll(root, 0o755); err != nil {
			deskErr(w, http.StatusInternalServerError, "não foi possível preparar a sua pasta")
			return nil, false
		}
		return localFS{root: root}, true
	case "machine":
		if !d.shellGate(w, r, u, "explorer", sudo) {
			return nil, false
		}
		log.Printf("desktop-shell: fs %s user=%s ip=%s sudo=%v path=%q", op, u.Username, r.RemoteAddr, sudo, deskTrunc(p, 300))
		if sudo {
			return sudoFS{}, true
		}
		return localFS{}, true
	}
	deskErr(w, http.StatusBadRequest, "espaço inválido (use home ou machine)")
	return nil, false
}

func fsFail(w http.ResponseWriter, err error) {
	var fe *fsError
	if errors.As(err, &fe) {
		deskErr(w, fe.status, fe.msg)
		return
	}
	deskErr(w, http.StatusBadRequest, err.Error())
}

func (d *deskAPI) fsList(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	q := r.URL.Query()
	p := cleanAPIPath(q.Get("path"))
	be, ok := d.backend(w, r, u, q.Get("space"), truthy(q.Get("sudo")), "ls", p)
	if !ok {
		return
	}
	ents, err := be.List(r.Context(), p)
	if err != nil {
		fsFail(w, err)
		return
	}
	sort.Slice(ents, func(i, j int) bool {
		if (ents[i].Type == "dir") != (ents[j].Type == "dir") {
			return ents[i].Type == "dir"
		}
		return strings.ToLower(ents[i].Name) < strings.ToLower(ents[j].Name)
	})
	writeStatus(w, http.StatusOK, map[string]any{"space": q.Get("space"), "path": p, "parent": apiParent(p), "entries": ents})
}

// Tipos servidos "inline" pelo visualizador. SVG e HTML ficam de fora de propósito: carregam script e seriam servidos na
// origem do próprio painel (só baixam).
var deskViewTypes = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
	".pdf": "application/pdf",
	".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mov": "video/quicktime", ".ogv": "video/ogg",
	".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac",
}

// fsRead: mode=text (qualquer arquivo até 1 MB, como texto puro), mode=view (imagem, PDF, vídeo e áudio, com Range para
// poder avançar e voltar) ou mode=download.
func (d *deskAPI) fsRead(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	q := r.URL.Query()
	p := cleanAPIPath(q.Get("path"))
	mode := q.Get("mode")
	be, ok := d.backend(w, r, u, q.Get("space"), truthy(q.Get("sudo")), "read:"+mode, p)
	if !ok {
		return
	}
	st, err := be.Stat(r.Context(), p)
	if err != nil {
		fsFail(w, err)
		return
	}
	if st.Type != "file" {
		deskErr(w, http.StatusBadRequest, "não é um arquivo comum")
		return
	}
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "no-store")
	name := path.Base(p)
	switch mode {
	case "text":
		if st.Size > deskTextMax {
			deskErr(w, http.StatusRequestEntityTooLarge, "arquivo maior que 1 MB; baixe-o")
			return
		}
		h.Set("Content-Type", "text/plain; charset=utf-8")
		h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	case "view":
		ct, ok := deskViewTypes[strings.ToLower(path.Ext(name))]
		if !ok {
			deskErr(w, http.StatusUnsupportedMediaType, "tipo não suportado pelo visualizador")
			return
		}
		h.Set("Content-Type", ct)
		if ct == "application/pdf" { // o leitor de PDF do navegador não roda com sandbox; só pode ficar dentro do próprio painel
			h.Set("Content-Security-Policy", "frame-ancestors 'self'")
			h.Set("X-Frame-Options", "SAMEORIGIN")
		} else {
			h.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; sandbox")
		}
	case "download":
		h.Set("Content-Type", "application/octet-stream")
		h.Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEscapeName(name))
	default:
		deskErr(w, http.StatusBadRequest, "mode inválido")
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	if err := serveBackendFile(w, r, be, p, st.Size); err != nil {
		log.Printf("desktop: leitura de %q interrompida: %v", p, err)
	}
}

// parseRange entende um único intervalo ("bytes=a-b", "a-" ou "-n"). ok=false quando é inválido ou fora do arquivo.
func parseRange(h string, size int64) (start, end int64, ok bool) {
	spec, found := strings.CutPrefix(strings.TrimSpace(h), "bytes=")
	if !found || strings.Contains(spec, ",") {
		return 0, 0, false
	}
	a, b, found := strings.Cut(spec, "-")
	if !found {
		return 0, 0, false
	}
	var err1, err2 error
	switch {
	case a == "": // últimos n bytes
		var n int64
		if n, err1 = strconv.ParseInt(b, 10, 64); err1 != nil || n <= 0 {
			return 0, 0, false
		}
		if n > size {
			n = size
		}
		return size - n, size - 1, true
	default:
		if start, err1 = strconv.ParseInt(a, 10, 64); err1 != nil || start < 0 || start >= size {
			return 0, 0, false
		}
		end = size - 1
		if b != "" {
			if end, err2 = strconv.ParseInt(b, 10, 64); err2 != nil || end < start {
				return 0, 0, false
			}
			if end >= size {
				end = size - 1
			}
		}
		return start, end, true
	}
}

func serveBackendFile(w http.ResponseWriter, r *http.Request, be fsBackend, p string, size int64) error {
	start, end, status := int64(0), size-1, http.StatusOK
	w.Header().Set("Accept-Ranges", "bytes")
	if rh := r.Header.Get("Range"); rh != "" && size > 0 && !strings.Contains(rh, ",") {
		s, e, ok := parseRange(rh, size)
		if !ok {
			w.Header().Set("Content-Range", "bytes */"+strconv.FormatInt(size, 10))
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return nil
		}
		start, end, status = s, e, http.StatusPartialContent
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
	}
	n := end - start + 1
	if size == 0 {
		n = 0
	}
	rc, err := be.Open(r.Context(), p, start)
	if err != nil {
		fsFail(w, err)
		return nil
	}
	defer rc.Close()
	w.Header().Set("Content-Length", strconv.FormatInt(n, 10))
	w.WriteHeader(status)
	if r.Method == http.MethodHead || n == 0 {
		return nil
	}
	// limita ao tamanho anunciado: se o arquivo crescer durante a leitura, o excedente é cortado
	if _, err := io.CopyN(w, rc, n); err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

func urlEscapeName(name string) string {
	var b strings.Builder
	for _, c := range []byte(name) {
		if c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || strings.IndexByte("-_.~", c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// fsPut grava o corpo cru em ?path= (envio de arquivo ou salvar do Bloco de Notas). text=1 limita a 1 MB e exige UTF-8;
// overwrite=1 permite substituir um arquivo que já existe (sem isso, 409).
func (d *deskAPI) fsPut(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	q := r.URL.Query()
	p := cleanAPIPath(q.Get("path"))
	if p == "/" {
		deskErr(w, http.StatusBadRequest, "informe o nome do arquivo")
		return
	}
	sudo := truthy(q.Get("sudo"))
	be, ok := d.backend(w, r, u, q.Get("space"), sudo, "write", p)
	if !ok {
		return
	}
	ctx := r.Context()
	existed := false
	if st, err := be.Stat(ctx, p); err == nil {
		if st.Type == "dir" {
			deskErr(w, http.StatusBadRequest, "já existe uma pasta com esse nome")
			return
		}
		if !truthy(q.Get("overwrite")) {
			deskErr(w, http.StatusConflict, "já existe um arquivo com esse nome")
			return
		}
		existed = true
	}
	if par, err := be.Stat(ctx, path.Dir(p)); err != nil || par.Type != "dir" {
		deskErr(w, http.StatusBadRequest, "a pasta de destino não existe")
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	_ = http.NewResponseController(w).SetReadDeadline(time.Time{})
	var src io.Reader
	if truthy(q.Get("text")) {
		b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, deskTextMax))
		if err != nil {
			deskErr(w, http.StatusRequestEntityTooLarge, "texto maior que 1 MB")
			return
		}
		if !utf8.Valid(b) {
			deskErr(w, http.StatusBadRequest, "o conteúdo precisa ser UTF-8")
			return
		}
		src = bytes.NewReader(b)
	} else {
		src = http.MaxBytesReader(w, r.Body, d.maxUp)
	}
	if err := be.Write(ctx, p, src); err != nil {
		if sudo && !existed { // o tee grava direto no destino: não deixa um arquivo pela metade
			_ = be.Remove(context.WithoutCancel(ctx), p)
		}
		var me *http.MaxBytesError
		if errors.As(err, &me) {
			err = fsErr(http.StatusRequestEntityTooLarge, "arquivo maior que o limite (%d MB)", d.maxUp>>20)
		}
		fsFail(w, osErr(err))
		return
	}
	st, _ := be.Stat(ctx, p)
	writeStatus(w, http.StatusOK, st)
}

// validName recusa nomes que não são um nome de arquivo ou pasta.
func validName(n string) bool {
	return n != "" && n != "." && n != ".." && !strings.ContainsAny(n, "/\\\x00") && len(n) <= 255
}

// protegido: a raiz e as pastas do primeiro nível do computador (/etc, /home, C:...) nunca são apagadas nem renomeadas.
func protegido(space, p string) bool {
	p = cleanAPIPath(p)
	if p == "/" {
		return true
	}
	return space == "machine" && strings.Count(p, "/") < 2
}

func (d *deskAPI) fsMkdir(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in struct {
		Space string
		Sudo  bool
		Path  string
	}
	if !deskDecode(w, r, &in) {
		return
	}
	p := cleanAPIPath(in.Path)
	if !validName(path.Base(p)) || p == "/" {
		deskErr(w, http.StatusBadRequest, "nome inválido")
		return
	}
	be, ok := d.backend(w, r, u, in.Space, in.Sudo, "mkdir", p)
	if !ok {
		return
	}
	if err := be.Mkdir(r.Context(), p); err != nil {
		fsFail(w, err)
		return
	}
	writeStatus(w, http.StatusCreated, map[string]bool{"ok": true})
}

// fsMove renomeia ou move (from -> to, caminhos completos). Não substitui o que já existe no destino.
func (d *deskAPI) fsMove(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in struct {
		Space    string
		Sudo     bool
		From, To string
	}
	if !deskDecode(w, r, &in) {
		return
	}
	from, to := cleanAPIPath(in.From), cleanAPIPath(in.To)
	if protegido(in.Space, from) || !validName(path.Base(to)) || to == "/" {
		deskErr(w, http.StatusBadRequest, "este item não pode ser movido ou renomeado")
		return
	}
	if from == to {
		writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if strings.HasPrefix(to+"/", from+"/") {
		deskErr(w, http.StatusBadRequest, "não é possível mover uma pasta para dentro dela mesma")
		return
	}
	be, ok := d.backend(w, r, u, in.Space, in.Sudo, "mv", from+" -> "+to)
	if !ok {
		return
	}
	if _, err := be.Stat(r.Context(), to); err == nil {
		deskErr(w, http.StatusConflict, "já existe um item com esse nome no destino")
		return
	}
	if err := be.Rename(r.Context(), from, to); err != nil {
		fsFail(w, err)
		return
	}
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}

func (d *deskAPI) fsDelete(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	q := r.URL.Query()
	p := cleanAPIPath(q.Get("path"))
	if protegido(q.Get("space"), p) {
		deskErr(w, http.StatusBadRequest, "este item não pode ser apagado")
		return
	}
	be, ok := d.backend(w, r, u, q.Get("space"), truthy(q.Get("sudo")), "rm", p)
	if !ok {
		return
	}
	if err := be.Remove(r.Context(), p); err != nil {
		fsFail(w, err)
		return
	}
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}
