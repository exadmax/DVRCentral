// O Diogows (a área de trabalho no navegador) já foi uma página desta Central e hoje é outro programa, em outro serviço
// (https://github.com/exadmax/diogogows). Quem ainda abre /desktop.html aqui (favorito, ou um atalho antigo salvo no menu da
// Config) é levado ao endereço novo, na mesma máquina, na porta configurada em "diogowsPort" (padrão 8090).
package main

import (
	"net"
	"net/http"
	"strconv"
)

const defaultDiogowsPort = 8090

// diogowsRedirect manda /desktop.html (e /desktop) para o Diogows, mantendo o protocolo e o nome da máquina que o navegador usou.
func diogowsRedirect(port int) http.HandlerFunc {
	if port <= 0 {
		port = defaultDiogowsPort
	}
	return func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(r.Host); err == nil {
			host = h
		}
		if host == "" {
			http.NotFound(w, r)
			return
		}
		scheme := "http"
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		if ip := net.ParseIP(host); ip != nil && ip.To4() == nil { // IPv6 literal precisa de colchetes
			host = "[" + host + "]"
		}
		http.Redirect(w, r, scheme+"://"+host+":"+strconv.Itoa(port)+"/desktop.html", http.StatusFound)
	}
}
