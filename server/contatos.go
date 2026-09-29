// Contatos importantes da casa: eletricista, encanador etc. (CRUD em /api/contatos).
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

type Contato struct {
	ID           int64  `json:"id"`
	Nome         string `json:"nome"`
	TipoServico  string `json:"tipoServico"`
	Telefone     string `json:"telefone"`
	Endereco     string `json:"endereco"`
	Nota         string `json:"nota"`
	CriadoEm     string `json:"criadoEm"`
	AtualizadoEm string `json:"atualizadoEm"`
}

const contatoCols = "id, nome, tipo_servico, telefone, endereco, nota, criado_em, atualizado_em"

func (c *Contato) clean() error {
	c.Nome = strings.TrimSpace(c.Nome)
	c.TipoServico = strings.TrimSpace(c.TipoServico)
	c.Telefone = strings.TrimSpace(c.Telefone)
	c.Endereco = strings.TrimSpace(c.Endereco)
	c.Nota = strings.TrimSpace(c.Nota)
	for _, f := range []struct {
		v, nome string
		max     int
	}{{c.Nome, "nome", 120}, {c.TipoServico, "tipo de serviço", 60}, {c.Telefone, "telefone", 40}, {c.Endereco, "endereço", 250}, {c.Nota, "nota", 2000}} {
		if utf8.RuneCountInString(f.v) > f.max {
			return badRequest("%s muito longo (máximo %d caracteres)", f.nome, f.max)
		}
	}
	switch {
	case c.Nome == "":
		return badRequest("informe o nome")
	case c.TipoServico == "":
		return badRequest("informe o tipo de serviço")
	case c.Telefone == "":
		return badRequest("informe o telefone")
	}
	digits := 0
	for _, r := range c.Telefone {
		if r >= '0' && r <= '9' {
			digits++
		}
	}
	if digits < 8 {
		return badRequest("telefone deve ter pelo menos 8 dígitos")
	}
	return nil
}

func scanContato(r interface{ Scan(...interface{}) error }) (Contato, error) {
	var c Contato
	err := r.Scan(&c.ID, &c.Nome, &c.TipoServico, &c.Telefone, &c.Endereco, &c.Nota, &c.CriadoEm, &c.AtualizadoEm)
	return c, err
}

func (s *store) contatosAPI() crud {
	return crud{
		list: func() (interface{}, error) {
			rows, err := s.db.Query("SELECT " + contatoCols + " FROM contatos ORDER BY tipo_servico COLLATE NOCASE, nome COLLATE NOCASE")
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			out := []Contato{}
			for rows.Next() {
				c, err := scanContato(rows)
				if err != nil {
					return nil, err
				}
				out = append(out, c)
			}
			return out, rows.Err()
		},
		get: func(id int64) (interface{}, error) { return s.getContato(id) },
		create: func(body []byte) (interface{}, error) {
			var c Contato
			if err := json.Unmarshal(body, &c); err != nil {
				return nil, badRequest("JSON inválido")
			}
			if err := c.clean(); err != nil {
				return nil, err
			}
			res, err := s.db.Exec("INSERT INTO contatos (nome, tipo_servico, telefone, endereco, nota) VALUES (?, ?, ?, ?, ?)",
				c.Nome, c.TipoServico, c.Telefone, c.Endereco, c.Nota)
			if err != nil {
				return nil, err
			}
			id, _ := res.LastInsertId()
			return s.getContato(id)
		},
		update: func(id int64, body []byte) (interface{}, error) {
			var c Contato
			if err := json.Unmarshal(body, &c); err != nil {
				return nil, badRequest("JSON inválido")
			}
			if err := c.clean(); err != nil {
				return nil, err
			}
			res, err := s.db.Exec(`UPDATE contatos SET nome = ?, tipo_servico = ?, telefone = ?, endereco = ?, nota = ?,
				atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
				c.Nome, c.TipoServico, c.Telefone, c.Endereco, c.Nota, id)
			if err != nil {
				return nil, err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return nil, errNotFound
			}
			return s.getContato(id)
		},
		remove: func(id int64) error {
			res, err := s.db.Exec("DELETE FROM contatos WHERE id = ?", id)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n == 0 {
				return errNotFound
			}
			return nil
		},
	}
}

func (s *store) getContato(id int64) (interface{}, error) {
	c, err := scanContato(s.db.QueryRow("SELECT "+contatoCols+" FROM contatos WHERE id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	return c, err
}
