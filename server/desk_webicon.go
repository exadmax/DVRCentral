// Ícone do site para o "Programa Web": o Diogows procura o ícone próprio da página (apple-touch-icon, <link rel="icon"> ou /favicon.ico) para
// usá-lo no menu Iniciar e na área de trabalho. O servidor é quem busca (o navegador não consegue ler ícones de outros sites) e, como no
// Navegador interno, só alcança endereços da internet.
package main

import (
	"bytes"
	"context"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html"
)

const (
	webIconMaxPage = 512 << 10
	webIconMaxIcon = 300 << 10
)

var webIconSizeRe = regexp.MustCompile(`(\d+)[xX](\d+)`)

func (d *deskAPI) registerWebIcon(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/desk/webicon", d.guard(false, false, d.webIcon))
}

type iconCand struct {
	url   *url.URL
	score float64
}

// iconCandidates lê os <link rel="...icon..."> da página, do melhor para o pior: tamanho declarado perto de 64 px vale mais, e o
// apple-touch-icon (quase sempre PNG grande e nítido) leva um pequeno bônus.
func iconCandidates(page []byte, base *url.URL) []iconCand {
	var out []iconCand
	z := html.NewTokenizer(bytes.NewReader(page))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}
		name, hasAttr := z.TagName()
		if string(name) == "body" {
			break
		}
		if string(name) != "link" || !hasAttr {
			continue
		}
		attrs := map[string]string{}
		for {
			k, v, more := z.TagAttr()
			attrs[strings.ToLower(string(k))] = string(v)
			if !more {
				break
			}
		}
		rel := strings.ToLower(attrs["rel"])
		if !strings.Contains(rel, "icon") || strings.Contains(rel, "mask-icon") || attrs["href"] == "" {
			continue
		}
		u, err := base.Parse(strings.TrimSpace(attrs["href"]))
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			continue
		}
		score := 0.5
		if m := webIconSizeRe.FindStringSubmatch(attrs["sizes"]); m != nil {
			if w, _ := strconv.Atoi(m[1]); w > 0 {
				score = 1 - math.Abs(math.Log2(float64(w)/64))/4
			}
		}
		if strings.Contains(rel, "apple-touch") {
			score += 0.2
		}
		if strings.HasSuffix(strings.ToLower(u.Path), ".svg") || strings.Contains(strings.ToLower(attrs["type"]), "svg") {
			score -= 0.3 // vetor só se não houver outro: ainda precisa ser rasterizado no navegador
		}
		out = append(out, iconCand{u, score})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].score > out[j].score })
	return out
}

// sniffIcon diz o tipo da imagem pelo conteúdo (nunca pelo que o site afirma) ou "" se não for uma imagem aceita.
func sniffIcon(b []byte) string {
	t := bytes.TrimSpace(b[:min(len(b), 512)])
	if bytes.HasPrefix(t, []byte("<svg")) || (bytes.HasPrefix(t, []byte("<?xml")) && bytes.Contains(t, []byte("<svg"))) {
		return "image/svg+xml"
	}
	switch ct := http.DetectContentType(b); ct {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/vnd.microsoft.icon", "image/bmp":
		return ct
	}
	return ""
}

func (d *deskAPI) webGet(ctx context.Context, u *url.URL, max int64) ([]byte, *url.URL, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; CentralDiogo)")
	resp, err := d.webClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, io.ErrUnexpectedEOF
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
	if err != nil || int64(len(b)) > max {
		return nil, nil, io.ErrShortBuffer
	}
	return b, resp.Request.URL, nil
}

func (d *deskAPI) webIcon(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	if d.cfg.NoBrowser {
		deskErr(w, http.StatusNotFound, "a busca de ícones está desligada (desk.noBrowser)")
		return
	}
	raw := r.URL.Query().Get("url")
	pu, err := url.Parse(raw)
	if err != nil || len(raw) > 500 || (pu.Scheme != "http" && pu.Scheme != "https") || pu.Hostname() == "" {
		deskErr(w, http.StatusBadRequest, "endereço inválido")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	var cands []iconCand
	base := pu
	if page, final, err := d.webGet(ctx, pu, webIconMaxPage); err == nil {
		base = final
		cands = iconCandidates(page, final)
	}
	root := &url.URL{Scheme: base.Scheme, Host: base.Host, Path: "/favicon.ico"}
	cands = append(cands, iconCand{root, 0})
	for i, c := range cands {
		if i >= 5 {
			break
		}
		b, _, err := d.webGet(ctx, c.url, webIconMaxIcon)
		if err != nil || len(b) == 0 {
			continue
		}
		ct := sniffIcon(b)
		if ct == "" {
			continue
		}
		h := w.Header()
		h.Set("Content-Type", ct)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
		h.Set("Cache-Control", "private, max-age=3600")
		h.Set("Content-Length", strconv.Itoa(len(b)))
		_, _ = w.Write(b)
		return
	}
	deskErr(w, http.StatusNotFound, "não encontrei um ícone nesse site")
}
