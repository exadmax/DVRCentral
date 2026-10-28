package main

import (
	"sync"
	"time"
)

// Cache da sessão do Diogows. Todo pedido autenticado (o chat sozinho consulta a cada poucos segundos, por usuário) conferia o cookie no banco;
// aqui o usuário da sessão fica em memória por sessCacheTTL. Quem altera sessão ou usuário (store) derruba as entradas na hora: o prazo é só
// uma segunda barreira, para o caso de alguém mexer no banco por fora.
const (
	sessCacheTTL = time.Minute
	sessCacheMax = 256 // uso doméstico: sobra; passou disso, recomeça
)

type sessEntry struct {
	u   DeskUser
	exp int64 // fim da sessão (segundos Unix), o mesmo gravado em desk_sessions
	at  time.Time
}

type sessCache struct {
	mu  sync.Mutex
	m   map[string]sessEntry
	gen uint64 // sobe a cada invalidação: uma leitura iniciada antes dela não pode gravar o resultado velho
	ttl time.Duration
}

func (c *sessCache) ttlOrDefault() time.Duration {
	if c.ttl > 0 {
		return c.ttl
	}
	return sessCacheTTL
}

// get devolve uma cópia do usuário da sessão, ou false se não há entrada válida (ausente, vencida pelo prazo ou sessão expirada).
func (c *sessCache) get(hash string, now int64) (*DeskUser, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[hash]
	if !ok {
		return nil, false
	}
	if now >= e.exp || time.Since(e.at) > c.ttlOrDefault() {
		delete(c.m, hash)
		return nil, false
	}
	u := e.u
	return &u, true
}

// generation marca o ponto em que uma leitura do banco começa (ver put).
func (c *sessCache) generation() uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.gen
}

// put guarda o usuário lido do banco, a menos que alguma invalidação tenha acontecido desde gen.
func (c *sessCache) put(hash string, u *DeskUser, exp int64, gen uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if gen != c.gen {
		return
	}
	if c.m == nil || len(c.m) >= sessCacheMax {
		c.m = map[string]sessEntry{}
	}
	c.m[hash] = sessEntry{u: *u, exp: exp, at: time.Now()}
}

// drop esquece uma sessão (logout).
func (c *sessCache) drop(hash string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gen++
	delete(c.m, hash)
}

// dropUser esquece as sessões de um usuário, menos keep (vazio = todas): senha, permissões ou remoção mudaram.
func (c *sessCache) dropUser(userID int64, keep string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gen++
	for h, e := range c.m {
		if e.u.ID == userID && h != keep {
			delete(c.m, h)
		}
	}
}
