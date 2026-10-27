package main

// Office completo (LiteOffice Completo): a página office.html roda o LibreOffice compilado para WebAssembly (ZetaOffice) no navegador de quem a abre,
// então o servidor só entrega arquivos. O WebAssembly usa threads (SharedArrayBuffer), que o navegador só libera em páginas com "isolamento de origem
// cruzada" (COOP + COEP). Por isso só essa página e os scripts dela recebem os cabeçalhos abaixo: o resto do Desktop e do painel continua como era,
// porque o COEP quebraria visualizadores em iframe e imagens de outros sites.

import (
	"net/http"
	"strings"
)

// officeAssetPrefixes: scripts do Office completo (inclui a cópia local opcional do ZetaOffice em vendor/zetaoffice) que precisam do COEP para
// carregar dentro da página isolada e dentro dos workers dela.
var officeAssetPrefixes = []string{"/vendor/zetajs/", "/vendor/zetaoffice/", "/js/office/"}

func withOfficeIsolation(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		if r.URL.Path == "/office.html" {
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			h.Set("Cross-Origin-Embedder-Policy", "require-corp")
			h.Set("Cache-Control", "no-cache")
		} else {
			for _, p := range officeAssetPrefixes {
				if strings.HasPrefix(r.URL.Path, p) {
					h.Set("Cross-Origin-Embedder-Policy", "require-corp")
					h.Set("Cross-Origin-Resource-Policy", "same-origin")
					break
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}
