package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOfficeIsolationHeaders(t *testing.T) {
	h := withOfficeIsolation(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	get := func(path string) http.Header {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w.Header()
	}

	page := get("/office.html")
	if page.Get("Cross-Origin-Opener-Policy") != "same-origin" || page.Get("Cross-Origin-Embedder-Policy") != "require-corp" {
		t.Errorf("office.html sem COOP/COEP: %v", page)
	}
	for _, p := range []string{"/vendor/zetajs/zeta.js", "/vendor/zetaoffice/soffice.wasm", "/js/office/office.js"} {
		h := get(p)
		if h.Get("Cross-Origin-Embedder-Policy") != "require-corp" || h.Get("Cross-Origin-Resource-Policy") != "same-origin" {
			t.Errorf("%s sem COEP/CORP: %v", p, h)
		}
		if h.Get("Cross-Origin-Opener-Policy") != "" {
			t.Errorf("%s não devia ter COOP: %v", p, h)
		}
	}
	// o resto do painel e do Desktop não pode ganhar COEP (quebraria iframes de visualizadores e imagens externas)
	for _, p := range []string{"/", "/desktop.html", "/index.html", "/js/desktop/core.js", "/vendor/js-dos/js-dos.js", "/api/desk/fs/read", "/office.html.bak"} {
		h := get(p)
		if h.Get("Cross-Origin-Embedder-Policy") != "" || h.Get("Cross-Origin-Opener-Policy") != "" {
			t.Errorf("%s recebeu cabeçalhos de isolamento sem precisar: %v", p, h)
		}
	}
}
