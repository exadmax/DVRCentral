// Navegador interno e downloads do Desktop. O servidor busca a página (só endereços públicos), tira scripts e objetos, e entrega um
// HTML seguro que a janela do navegador mostra num iframe sem scripts. Arquivos (zip, exe, pdf, iso...) não passam pelo navegador:
// o Desktop manda baixá-los direto para "Meus arquivos/Downloads" do usuário, e nada é executado no servidor.
//
// Limites honestos: sem JavaScript, sites feitos como aplicativo (SPAs) aparecem vazios; vídeo e áudio embutidos são removidos
// (o link continua, e dá para baixar). Serve bem para páginas de texto, buscas, fóruns e páginas de download.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"golang.org/x/net/html"
)

const (
	browseMaxHTML  = 3 << 20
	browseMaxCSS   = 1 << 20
	browseMaxImage = 8 << 20
	dlMaxRunning   = 3
	dlKeepJobs     = 30
	browseUA       = "Mozilla/5.0 (compatible; CentralDiogo-Desktop/1.0)"
)

// newSafeClient: mesmo cliente que só conecta em endereços públicos (veja newCalClient), com o tempo total escolhido.
func newSafeClient(total time.Duration) *http.Client {
	c := newCalClient()
	c.Timeout = total
	if tr, ok := c.Transport.(*http.Transport); ok {
		tr.ResponseHeaderTimeout = 30 * time.Second
	}
	return c
}

// dlView é o que a API mostra de um download.
type dlView struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Host   string `json:"host"`
	Size   int64  `json:"size"`
	Done   int64  `json:"done"`
	Status string `json:"status"` // running | done | error | canceled
	Error  string `json:"error,omitempty"`
	Path   string `json:"path,omitempty"` // caminho em Meus arquivos
}

type dlJob struct {
	ID, Name, Host, Status, Error, Path string
	Size                                int64
	userID                              int64
	done                                atomic.Int64
	cancel                              context.CancelFunc
}

type dlManager struct {
	mu   sync.Mutex
	jobs map[int64][]*dlJob
}

func (d *deskAPI) registerBrowser(mux *http.ServeMux) {
	if d.cfg.NoBrowser {
		return
	}
	mux.HandleFunc("GET /api/desk/browse", d.guard(false, false, d.handleBrowse))
	mux.HandleFunc("POST /api/desk/downloads", d.guard(false, false, d.dlStart))
	mux.HandleFunc("GET /api/desk/downloads", d.guard(false, false, d.dlList))
	mux.HandleFunc("DELETE /api/desk/downloads/{id}", d.guard(false, false, d.dlDelete))
}

func parseWebURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || len(raw) > 2000 {
		return nil, errors.New("endereço inválido (use http:// ou https://)")
	}
	u.Fragment = ""
	return u, nil
}

// hdrEscape codifica um valor de cabeçalho para decodeURIComponent (espaço vira %20, não +).
func hdrEscape(v string) string { return strings.ReplaceAll(url.QueryEscape(v), "+", "%20") }

func proxyURL(abs string) string { return "/api/desk/browse?r=1&url=" + url.QueryEscape(abs) }

func netErrText(err error) string {
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err // o texto da URL pode ser um segredo
	}
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "o site demorou demais para responder"
	case strings.Contains(err.Error(), "não permitido"):
		return "este endereço não é permitido (só sites da internet)"
	}
	return deskTrunc(err.Error(), 200)
}

// ---------- navegar ----------

func (d *deskAPI) handleBrowse(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	q := r.URL.Query()
	target, err := parseWebURL(q.Get("url"))
	if err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	sub := q.Get("r") == "1" // subrecurso (imagem ou CSS de uma página): só esses tipos
	ctx, cancel := context.WithTimeout(r.Context(), 35*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	req.Header.Set("User-Agent", browseUA)
	req.Header.Set("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.5")
	if sub {
		req.Header.Set("Accept", "image/*,text/css,*/*;q=0.1")
	} else {
		req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
	}
	resp, err := d.webClient.Do(req)
	if err != nil {
		deskErr(w, http.StatusBadGateway, netErrText(err))
		return
	}
	defer resp.Body.Close()
	final := resp.Request.URL
	h := w.Header()
	// Mesmo aberto direto numa aba, nada daqui executa script nem lê cookies do Desktop.
	h.Set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, max-age=300")
	h.Set("X-Browse-Url", hdrEscape(final.String()))
	h.Set("X-Browse-Status", strconv.Itoa(resp.StatusCode))
	ct, params, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	ct = strings.ToLower(ct)

	switch {
	case ct == "text/html" || ct == "application/xhtml+xml" || (ct == "" && !sub):
		if sub {
			deskErr(w, http.StatusUnsupportedMediaType, "tipo não permitido")
			return
		}
		raw, err := io.ReadAll(io.LimitReader(resp.Body, browseMaxHTML+1))
		if err != nil || len(raw) > browseMaxHTML {
			deskErr(w, http.StatusRequestEntityTooLarge, "página grande demais")
			return
		}
		out, title := rewriteHTML(toUTF8(raw, params["charset"]), final)
		h.Set("Content-Type", "text/html; charset=utf-8")
		h.Set("X-Browse-Kind", "page")
		h.Set("X-Browse-Title", hdrEscape(title))
		io.WriteString(w, out)
	case ct == "text/css":
		raw, err := io.ReadAll(io.LimitReader(resp.Body, browseMaxCSS+1))
		if err != nil || len(raw) > browseMaxCSS {
			deskErr(w, http.StatusRequestEntityTooLarge, "CSS grande demais")
			return
		}
		h.Set("Content-Type", "text/css; charset=utf-8")
		h.Set("X-Browse-Kind", "asset")
		io.WriteString(w, rewriteCSS(toUTF8(raw, params["charset"]), final))
	case isSafeImage(ct) || (sub && ct == "image/svg+xml"): // SVG só como <img> da página (não executa script); aberto direto cai em "arquivo"
		if resp.ContentLength > browseMaxImage {
			deskErr(w, http.StatusRequestEntityTooLarge, "imagem grande demais")
			return
		}
		h.Set("Content-Type", ct)
		h.Set("X-Browse-Kind", "asset")
		io.Copy(w, io.LimitReader(resp.Body, browseMaxImage))
	default:
		if sub {
			deskErr(w, http.StatusUnsupportedMediaType, "tipo não permitido")
			return
		}
		// arquivo: não passa pelo navegador; o Desktop oferece baixar para Meus arquivos
		h.Set("X-Browse-Kind", "file")
		h.Set("X-Browse-Name", hdrEscape(fileNameFor(resp, final)))
		h.Set("X-Browse-Size", strconv.FormatInt(resp.ContentLength, 10))
		h.Set("X-Browse-Type", hdrEscape(ct))
		w.WriteHeader(http.StatusOK)
	}
}

func isSafeImage(ct string) bool {
	switch ct {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon", "image/avif":
		return true
	}
	return false
}

var cp1252 = map[byte]rune{0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž',
	0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ'}

var metaCharsetRe = regexp.MustCompile(`(?i)<meta[^>]+charset\s*=\s*["']?([\w-]+)`)

// toUTF8 converte páginas em Latin-1/Windows-1252 (comuns em sites brasileiros antigos); o resto é tratado como UTF-8.
func toUTF8(b []byte, headerCharset string) string {
	cs := strings.ToLower(headerCharset)
	if cs == "" {
		if m := metaCharsetRe.FindSubmatch(b[:min(len(b), 4096)]); m != nil {
			cs = strings.ToLower(string(m[1]))
		}
	}
	legacy := cs == "iso-8859-1" || cs == "latin1" || cs == "windows-1252" || cs == "cp1252" || cs == "iso-8859-15"
	if !legacy && utf8.Valid(b) {
		return string(b)
	}
	if !legacy && cs != "" && cs != "utf-8" && cs != "utf8" {
		legacy = true // charset exótico e bytes inválidos: o melhor palpite
	}
	if !legacy {
		return strings.ToValidUTF8(string(b), "�")
	}
	var sb strings.Builder
	for _, c := range b {
		if r, ok := cp1252[c]; ok {
			sb.WriteRune(r)
		} else {
			sb.WriteRune(rune(c))
		}
	}
	return sb.String()
}

// ---------- reescrita ----------

var (
	cssURLRe    = regexp.MustCompile(`(?i)url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)`)
	cssImportRe = regexp.MustCompile(`(?i)@import\s+(?:"([^"]+)"|'([^']+)')`)
	cssBadRe    = regexp.MustCompile(`(?i)[^;{}]*(?:expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript:)[^;}]*`)
)

func resolveWeb(base *url.URL, ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.HasPrefix(ref, "#") {
		return ""
	}
	u, err := base.Parse(ref)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	return u.String()
}

func rewriteCSS(css string, base *url.URL) string {
	css = cssBadRe.ReplaceAllString(css, "") // some a declaração inteira, sem deixar resto
	css = cssImportRe.ReplaceAllStringFunc(css, func(m string) string {
		s := cssImportRe.FindStringSubmatch(m)
		ref := s[1] + s[2]
		if abs := resolveWeb(base, ref); abs != "" {
			return `@import "` + proxyURL(abs) + `"`
		}
		return ""
	})
	return cssURLRe.ReplaceAllStringFunc(css, func(m string) string {
		s := cssURLRe.FindStringSubmatch(m)
		ref := s[1] + s[2] + s[3]
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(ref)), "data:") {
			return m
		}
		if abs := resolveWeb(base, ref); abs != "" {
			return `url("` + proxyURL(abs) + `")`
		}
		return "none"
	})
}

var dropTags = map[string]bool{"script": true, "noscript": true, "iframe": true, "frame": true, "frameset": true, "object": true, "embed": true,
	"applet": true, "audio": true, "video": true, "canvas": true, "base": true, "template": true, "dialog": true, "picture": true}

func attrIdx(n *html.Node, key string) int {
	for i, a := range n.Attr {
		if a.Key == key {
			return i
		}
	}
	return -1
}

func attrGet(n *html.Node, key string) string {
	if i := attrIdx(n, key); i >= 0 {
		return n.Attr[i].Val
	}
	return ""
}

func attrSet(n *html.Node, key, val string) {
	if i := attrIdx(n, key); i >= 0 {
		n.Attr[i].Val = val
		return
	}
	n.Attr = append(n.Attr, html.Attribute{Key: key, Val: val})
}

func attrDel(n *html.Node, key string) {
	if i := attrIdx(n, key); i >= 0 {
		n.Attr = append(n.Attr[:i], n.Attr[i+1:]...)
	}
}

// rewriteHTML devolve o documento seguro e o título. Links (<a>) ficam com o endereço absoluto: quem navega é a janela do
// navegador, que intercepta o clique. Só imagens e CSS (subrecursos) são trazidos por /api/desk/browse.
func rewriteHTML(src string, final *url.URL) (string, string) {
	doc, err := html.Parse(strings.NewReader(src))
	if err != nil {
		return "<p>Não foi possível interpretar esta página.</p>", ""
	}
	base := final
	var title string
	// <base href> muda a resolução dos endereços relativos
	var findBase func(*html.Node)
	findBase = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "base" {
			if abs := resolveWeb(final, attrGet(n, "href")); abs != "" {
				if b, err := url.Parse(abs); err == nil {
					base = b
				}
			}
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			findBase(c)
		}
	}
	findBase(doc)

	var remove []*html.Node
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			tag := n.Data
			if tag == "title" && title == "" && n.FirstChild != nil {
				title = strings.TrimSpace(n.FirstChild.Data)
			}
			if dropTags[tag] {
				remove = append(remove, n)
				return
			}
			if tag == "link" {
				if !strings.Contains(strings.ToLower(attrGet(n, "rel")), "stylesheet") || resolveWeb(base, attrGet(n, "href")) == "" {
					remove = append(remove, n)
					return
				}
				attrSet(n, "href", proxyURL(resolveWeb(base, attrGet(n, "href"))))
			}
			if tag == "meta" && attrGet(n, "http-equiv") != "" {
				remove = append(remove, n)
				return
			}
			if tag == "source" {
				remove = append(remove, n)
				return
			}
			// atributos perigosos ou inúteis
			kept := n.Attr[:0]
			for _, a := range n.Attr {
				k := strings.ToLower(a.Key)
				if strings.HasPrefix(k, "on") || k == "srcdoc" || k == "nonce" || k == "integrity" || k == "crossorigin" || k == "target" || k == "ping" || k == "srcset" || k == "sizes" {
					continue
				}
				kept = append(kept, a)
			}
			n.Attr = kept
			switch tag {
			case "a", "area":
				if h := attrGet(n, "href"); h != "" {
					if abs := resolveWeb(base, h); abs != "" {
						attrSet(n, "href", abs)
					} else if !strings.HasPrefix(h, "#") {
						attrDel(n, "href")
					}
				}
			case "img", "input":
				if tag == "input" && attrGet(n, "type") != "image" {
					break
				}
				s := attrGet(n, "src")
				if s == "" || strings.HasPrefix(s, "data:image/gif") { // imagens preguiçosas guardam o endereço real em data-*
					for _, k := range []string{"data-src", "data-original", "data-lazy-src"} {
						if v := attrGet(n, k); v != "" {
							s = v
							break
						}
					}
				}
				if strings.HasPrefix(s, "data:image/") {
					attrSet(n, "src", s)
				} else if abs := resolveWeb(base, s); abs != "" {
					attrSet(n, "src", proxyURL(abs))
				} else {
					attrDel(n, "src")
				}
			case "form":
				if abs := resolveWeb(base, attrGet(n, "action")); abs != "" {
					attrSet(n, "action", abs)
				} else {
					attrSet(n, "action", base.String())
				}
			case "body", "table", "td", "th", "tr":
				if b := attrGet(n, "background"); b != "" {
					if abs := resolveWeb(base, b); abs != "" {
						attrSet(n, "background", proxyURL(abs))
					} else {
						attrDel(n, "background")
					}
				}
			case "style":
				for c := n.FirstChild; c != nil; c = c.NextSibling {
					if c.Type == html.TextNode {
						c.Data = rewriteCSS(c.Data, base)
					}
				}
			}
			if st := attrGet(n, "style"); st != "" {
				attrSet(n, "style", rewriteCSS(st, base))
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	for _, n := range remove {
		if n.Parent != nil {
			n.Parent.RemoveChild(n)
		}
	}
	// cabeçalho fixo: UTF-8 e uma política que impede qualquer script ou recurso externo, mesmo que algo escape da limpeza
	var head *html.Node
	var findHead func(*html.Node)
	findHead = func(n *html.Node) {
		if head == nil && n.Type == html.ElementNode && n.Data == "head" {
			head = n
			return
		}
		for c := n.FirstChild; c != nil && head == nil; c = c.NextSibling {
			findHead(c)
		}
	}
	findHead(doc)
	if head != nil {
		meta := func(attrs ...string) *html.Node {
			m := &html.Node{Type: html.ElementNode, Data: "meta"}
			for i := 0; i+1 < len(attrs); i += 2 {
				m.Attr = append(m.Attr, html.Attribute{Key: attrs[i], Val: attrs[i+1]})
			}
			return m
		}
		head.InsertBefore(meta("http-equiv", "Content-Security-Policy", "content", "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:"), head.FirstChild)
		head.InsertBefore(meta("charset", "utf-8"), head.FirstChild)
	}
	var sb strings.Builder
	html.Render(&sb, doc)
	return sb.String(), title
}

// ---------- downloads ----------

func fileNameFor(resp *http.Response, final *url.URL) string {
	name := ""
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		if _, p, err := mime.ParseMediaType(cd); err == nil {
			name = p["filename"]
		}
	}
	if name == "" {
		name, _ = url.PathUnescape(path.Base(final.Path))
	}
	return cleanFileName(name)
}

func cleanFileName(n string) string {
	n = strings.TrimSpace(strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_", "\x00", "").Replace(n))
	n = strings.Trim(n, ". ")
	if n == "" || n == "/" {
		n = "download"
	}
	if r := []rune(n); len(r) > 150 {
		ext := path.Ext(n)
		if len([]rune(ext)) > 10 {
			ext = ""
		}
		n = string(r[:150-len([]rune(ext))]) + ext
	}
	return n
}

// uniqueName evita sobrescrever: "arq.zip" vira "arq (2).zip".
func uniqueName(dir, name string) string {
	if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
		return name
	}
	ext := path.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 2; i < 1000; i++ {
		c := fmt.Sprintf("%s (%d)%s", stem, i, ext)
		if _, err := os.Stat(filepath.Join(dir, c)); os.IsNotExist(err) {
			return c
		}
	}
	return name
}

func (d *deskAPI) dlSnapshot(userID int64) []dlView {
	d.dl.mu.Lock()
	defer d.dl.mu.Unlock()
	out := []dlView{}
	for _, j := range d.dl.jobs[userID] {
		c := dlView{ID: j.ID, Name: j.Name, Host: j.Host, Size: j.Size, Done: j.done.Load(), Status: j.Status, Error: j.Error, Path: j.Path}
		out = append(out, c)
	}
	return out
}

func (d *deskAPI) dlList(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	writeStatus(w, http.StatusOK, d.dlSnapshot(u.ID))
}

func (d *deskAPI) dlStart(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in struct{ URL, Name string }
	if !deskDecode(w, r, &in) {
		return
	}
	target, err := parseWebURL(in.URL)
	if err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	d.dl.mu.Lock()
	running := 0
	for _, j := range d.dl.jobs[u.ID] {
		if j.Status == "running" {
			running++
		}
	}
	if running >= dlMaxRunning {
		d.dl.mu.Unlock()
		deskErr(w, http.StatusTooManyRequests, "já há "+strconv.Itoa(dlMaxRunning)+" downloads em andamento; espere um terminar")
		return
	}
	var rb [6]byte
	rand.Read(rb[:])
	ctx, cancel := context.WithCancel(context.Background())
	job := &dlJob{ID: hex.EncodeToString(rb[:]), Name: cleanFileName(in.Name), Host: target.Hostname(), Status: "running", userID: u.ID, cancel: cancel}
	if strings.TrimSpace(in.Name) == "" {
		job.Name = cleanFileName(path.Base(target.Path))
	}
	list := append(d.dl.jobs[u.ID], job)
	if len(list) > dlKeepJobs { // descarta os mais antigos já terminados
		kept := list[:0]
		drop := len(list) - dlKeepJobs
		for _, j := range list {
			if drop > 0 && j.Status != "running" {
				drop--
				continue
			}
			kept = append(kept, j)
		}
		list = kept
	}
	d.dl.jobs[u.ID] = list
	d.dl.mu.Unlock()
	logd := func(format string, a ...any) {
		log.Printf("desktop: download user=%s "+format, append([]any{u.Username}, a...)...)
	}
	logd("início host=%s", target.Hostname())
	go d.runDownload(ctx, job, target, logd)
	writeStatus(w, http.StatusAccepted, map[string]string{"id": job.ID})
}

func (d *deskAPI) runDownload(ctx context.Context, job *dlJob, target *url.URL, logf func(string, ...any)) {
	finish := func(status, msg string) {
		d.dl.mu.Lock()
		job.Status, job.Error = status, msg
		d.dl.mu.Unlock()
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	req.Header.Set("User-Agent", browseUA)
	resp, err := d.dlClient.Do(req)
	if err != nil {
		finish("error", netErrText(err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		finish("error", "o servidor respondeu HTTP "+strconv.Itoa(resp.StatusCode))
		return
	}
	if resp.ContentLength > d.maxUp {
		finish("error", fmt.Sprintf("arquivo maior que o limite (%d MB)", d.maxUp>>20))
		return
	}
	if cd := resp.Header.Get("Content-Disposition"); cd != "" || job.Name == "download" {
		if n := fileNameFor(resp, resp.Request.URL); n != "download" {
			job.Name = n
		}
	}
	dir := filepath.Join(d.userDir(job.userID), "files", "Downloads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		finish("error", "não foi possível criar a pasta Downloads")
		return
	}
	name := uniqueName(dir, job.Name)
	tmp := filepath.Join(dir, "."+name+".part")
	f, err := os.Create(tmp)
	if err != nil {
		finish("error", "não foi possível gravar o arquivo")
		return
	}
	d.dl.mu.Lock()
	job.Name, job.Size = name, max(resp.ContentLength, 0)
	d.dl.mu.Unlock()
	buf := make([]byte, 64<<10)
	var total int64
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			total += int64(n)
			if total > d.maxUp {
				f.Close()
				os.Remove(tmp)
				finish("error", fmt.Sprintf("arquivo maior que o limite (%d MB)", d.maxUp>>20))
				return
			}
			if _, werr := f.Write(buf[:n]); werr != nil {
				f.Close()
				os.Remove(tmp)
				finish("error", "falha gravando o arquivo (disco cheio?)")
				return
			}
			job.done.Store(total)
		}
		if rerr != nil {
			if rerr != io.EOF {
				f.Close()
				os.Remove(tmp)
				if ctx.Err() != nil {
					finish("canceled", "")
				} else {
					finish("error", netErrText(rerr))
				}
				return
			}
			break
		}
	}
	f.Close()
	if err := os.Rename(tmp, filepath.Join(dir, name)); err != nil {
		os.Remove(tmp)
		finish("error", "falha finalizando o arquivo")
		return
	}
	d.dl.mu.Lock()
	job.Path, job.Size = "/Downloads/"+name, total
	d.dl.mu.Unlock()
	finish("done", "")
	logf("concluído %s (%d bytes)", name, total)
}

func (d *deskAPI) dlDelete(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	id := r.PathValue("id")
	d.dl.mu.Lock()
	defer d.dl.mu.Unlock()
	list := d.dl.jobs[u.ID]
	for i, j := range list {
		if j.ID != id {
			continue
		}
		if j.Status == "running" {
			j.cancel() // o laço de download percebe e marca como cancelado
		} else {
			d.dl.jobs[u.ID] = append(list[:i], list[i+1:]...)
		}
		writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	deskErr(w, http.StatusNotFound, "download não encontrado")
}
