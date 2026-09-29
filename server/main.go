// Hub da Central Diogo: serve o painel (pasta src/) e expõe /api/* para TV, celular e web.
// Guarda as URLs secretas do calendário e a chave da TomTom fora dos aparelhos e resolve o CORS do Google.
// Apenas biblioteca padrão: binário pequeno e pouca memória (feito para máquinas com 2 GB).
package main

import (
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

type Config struct {
	Listen    string `json:"listen"`
	StaticDir string `json:"staticDir"`
	Calendars []struct {
		Who   string `json:"who"`   // identificador
		Label string `json:"label"` // nome exibido no painel
		Color string `json:"color"` // cor (CSS) da categoria
		URL   string `json:"url"`
	} `json:"calendars"`
	Traffic struct {
		Key    string `json:"key"`  // chave do Google Routes API
		Home   string `json:"home"` // endereço de saída padrão
		Diogo  Person `json:"diogo"`
		Cassia Person `json:"cassia"`
	} `json:"traffic"`
	CalendarCacheMinutes int         `json:"calendarCacheMinutes"`
	TrafficCacheMinutes  int         `json:"trafficCacheMinutes"` // intervalo entre consultas dentro da janela
	ForceIPv4            bool        `json:"forceIPv4"`
	Games                GamesConfig `json:"games"`
}

func loadConfig(path string) Config {
	c := Config{Listen: ":8080", StaticDir: "../src", CalendarCacheMinutes: 5, TrafficCacheMinutes: 10, ForceIPv4: true}
	b, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("não foi possível ler %s: %v (copie hub.config.example.json para hub.config.json)", path, err)
	}
	if err := json.Unmarshal(b, &c); err != nil {
		log.Fatalf("hub.config.json inválido: %v", err)
	}
	return c
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

// CORS aberto: o hub só é acessível dentro da rede de casa.
func withCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/") { // painel sempre atualizado após um deploy
			w.Header().Set("Cache-Control", "no-cache")
		}
		h.ServeHTTP(w, r)
	})
}

func main() {
	cfgPath := flag.String("config", "hub.config.json", "caminho do arquivo de configuração")
	xboxLogin := flag.Bool("xbox-login", false, "autoriza a conta Xbox (uma vez) e sai")
	flag.Parse()
	cfg := loadConfig(*cfgPath)
	if *xboxLogin {
		xboxLoginCLI(cfg, *cfgPath)
		return
	}

	cal := newCalendars(cfg)
	tr := newTraffic(cfg)
	gm := newGames(cfg, *cfgPath)
	go gm.loop()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]interface{}{"ok": true, "time": time.Now().Format(time.RFC3339)})
	})
	mux.HandleFunc("/api/ics", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, cal.get()) })
	mux.HandleFunc("/api/traffic", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, tr.get(r.URL.Query().Get("diogo") == "1")) })
	mux.HandleFunc("/api/games", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, gm.get(r.URL.Query().Get("refresh") == "1"))
	})
	// Conectar o Xbox pelo dashboard: GET devolve a URL de login; POST {"url": "<endereço final colado>"}
	mux.HandleFunc("/api/games/xbox-login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, map[string]string{"url": gm.xboxLoginURL()})
			return
		}
		var body struct {
			URL string `json:"url"`
		}
		json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body)
		a, err := gm.xboxAuthorize(body.URL)
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		go gm.refresh()
		writeJSON(w, map[string]interface{}{"ok": true, "gamertag": a.gtg})
	})
	mux.Handle("/", http.FileServer(http.Dir(cfg.StaticDir)))

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           withCORS(mux),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("Central Diogo hub em %s (painel: %s)", cfg.Listen, cfg.StaticDir)
	log.Fatal(srv.ListenAndServe())
}
