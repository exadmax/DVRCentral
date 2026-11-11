package main

import (
	"net/http/httptest"
	"testing"
)

func TestDiogowsRedirect(t *testing.T) {
	cases := []struct{ host, want string }{
		{"vovozinho:80", "http://vovozinho:8090/desktop.html"},
		{"192.168.15.33", "http://192.168.15.33:8090/desktop.html"},
		{"[::1]:8080", "http://[::1]:8090/desktop.html"},
	}
	for _, c := range cases {
		r := httptest.NewRequest("GET", "/desktop.html", nil)
		r.Host = c.host
		w := httptest.NewRecorder()
		diogowsRedirect(0)(w, r)
		if w.Code != 302 || w.Header().Get("Location") != c.want {
			t.Errorf("%s: %d %q (esperado %q)", c.host, w.Code, w.Header().Get("Location"), c.want)
		}
	}
	r := httptest.NewRequest("GET", "/desktop.html", nil)
	r.Host = "casa"
	r.Header.Set("X-Forwarded-Proto", "https")
	w := httptest.NewRecorder()
	diogowsRedirect(9000)(w, r)
	if got := w.Header().Get("Location"); got != "https://casa:9000/desktop.html" {
		t.Errorf("porta configurada e https: %q", got)
	}
}
