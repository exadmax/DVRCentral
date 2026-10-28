// Perfil do usuário do Diogows: nome e sobrenome (opcionais), foto e a assinatura opcional dos e-mails. Aparece no aplicativo de Mensagens
// (foto e nome no lugar do usuário) e no E-mail. Sem nome, o Diogows continua usando o nome de usuário.
package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"image"
	_ "image/jpeg" // registra os decodificadores usados por image.DecodeConfig
	_ "image/png"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const deskProfileMigration = `CREATE TABLE IF NOT EXISTS desk_profiles (
	user_id INTEGER PRIMARY KEY,
	first_name TEXT NOT NULL DEFAULT '',
	last_name TEXT NOT NULL DEFAULT '',
	sign_email INTEGER NOT NULL DEFAULT 0,
	signature TEXT NOT NULL DEFAULT '',
	photo BLOB,
	photo_ver INTEGER NOT NULL DEFAULT 0
);`

const (
	profileMaxName  = 40
	profileMaxSig   = 500
	profileMaxPhoto = 400 << 10 // o navegador já reduz a foto para ~256 px (poucas dezenas de KB)
	profileMaxDim   = 2048
)

type deskProfile struct {
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	DisplayName string `json:"display_name"` // nome e sobrenome, ou o nome de usuário
	SignEmail   bool   `json:"sign_email"`   // usa o nome no remetente e a assinatura nos e-mails
	Signature   string `json:"signature"`    // texto da assinatura; vazio = o nome completo
	PhotoVer    int64  `json:"photo_ver"`    // 0 = sem foto; muda a cada troca (para o cache do navegador)
}

func profileName(first, last, username string) string {
	if n := strings.TrimSpace(first + " " + last); n != "" {
		return n
	}
	return username
}

func (s *store) deskProfile(ctx context.Context, u *DeskUser) deskProfile {
	p := deskProfile{DisplayName: u.Username}
	var sign int
	err := s.rdb.QueryRowContext(ctx, `SELECT first_name, last_name, sign_email, signature, CASE WHEN photo IS NULL OR length(photo) = 0 THEN 0 ELSE photo_ver END FROM desk_profiles WHERE user_id = ?`, u.ID).
		Scan(&p.FirstName, &p.LastName, &sign, &p.Signature, &p.PhotoVer)
	if err == nil {
		p.SignEmail = sign == 1
		p.DisplayName = profileName(p.FirstName, p.LastName, u.Username)
	}
	return p
}

// deskProfiles devolve nome de exibição e versão da foto de todos (para a lista de conversas).
func (s *store) deskProfiles(ctx context.Context) (map[int64]deskProfile, error) {
	rows, err := s.rdb.QueryContext(ctx, `SELECT user_id, first_name, last_name, CASE WHEN photo IS NULL OR length(photo) = 0 THEN 0 ELSE photo_ver END FROM desk_profiles`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]deskProfile{}
	for rows.Next() {
		var id int64
		var p deskProfile
		if err := rows.Scan(&id, &p.FirstName, &p.LastName, &p.PhotoVer); err != nil {
			return nil, err
		}
		out[id] = p
	}
	return out, rows.Err()
}

func (d *deskAPI) registerProfile(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/desk/profile", d.guard(false, true, d.profileGet))
	mux.HandleFunc("PUT /api/desk/profile", d.guard(false, true, d.profilePut))
	mux.HandleFunc("PUT /api/desk/profile/photo", d.guard(false, true, d.profilePhotoPut))
	mux.HandleFunc("DELETE /api/desk/profile/photo", d.guard(false, true, d.profilePhotoDelete))
	mux.HandleFunc("GET /api/desk/avatar/{id}", d.guard(false, true, d.avatarGet))
}

func (d *deskAPI) profileGet(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	writeStatus(w, http.StatusOK, d.st.deskProfile(r.Context(), u))
}

type profileIn struct {
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	SignEmail bool   `json:"sign_email"`
	Signature string `json:"signature"`
}

func cleanProfileText(s string, max int, multiline bool) (string, bool) {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\r\n", "\n"))
	if utf8.RuneCountInString(s) > max || !utf8.ValidString(s) {
		return "", false
	}
	for _, r := range s {
		if unicode.IsControl(r) && !(multiline && r == '\n') {
			return "", false
		}
	}
	return s, true
}

func (d *deskAPI) profilePut(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	var in profileIn
	if !deskDecode(w, r, &in) {
		return
	}
	first, ok1 := cleanProfileText(in.FirstName, profileMaxName, false)
	last, ok2 := cleanProfileText(in.LastName, profileMaxName, false)
	sig, ok3 := cleanProfileText(in.Signature, profileMaxSig, true)
	if !ok1 || !ok2 {
		deskErr(w, http.StatusBadRequest, "nome e sobrenome: até "+strconv.Itoa(profileMaxName)+" caracteres, sem quebras de linha")
		return
	}
	if !ok3 || strings.Count(sig, "\n") > 7 {
		deskErr(w, http.StatusBadRequest, "assinatura: até "+strconv.Itoa(profileMaxSig)+" caracteres e 8 linhas")
		return
	}
	_, err := d.st.db.ExecContext(r.Context(), `INSERT INTO desk_profiles (user_id, first_name, last_name, sign_email, signature) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, sign_email = excluded.sign_email, signature = excluded.signature`,
		u.ID, first, last, b2i(in.SignEmail), sig)
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha salvando o perfil")
		return
	}
	writeStatus(w, http.StatusOK, d.st.deskProfile(r.Context(), u))
}

func (d *deskAPI) profilePhotoPut(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	r.Body = http.MaxBytesReader(w, r.Body, profileMaxPhoto)
	b, err := io.ReadAll(r.Body)
	if err != nil || len(b) == 0 {
		deskErr(w, http.StatusBadRequest, "foto ausente ou maior que "+strconv.Itoa(profileMaxPhoto>>10)+" KB")
		return
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil || (format != "jpeg" && format != "png") || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > profileMaxDim || cfg.Height > profileMaxDim {
		deskErr(w, http.StatusBadRequest, "use uma foto JPEG ou PNG de até "+strconv.Itoa(profileMaxDim)+" px")
		return
	}
	_, err = d.st.db.ExecContext(r.Context(), `INSERT INTO desk_profiles (user_id, photo, photo_ver) VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET photo = excluded.photo, photo_ver = excluded.photo_ver`, u.ID, b, time.Now().Unix())
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha salvando a foto")
		return
	}
	writeStatus(w, http.StatusOK, d.st.deskProfile(r.Context(), u))
}

func (d *deskAPI) profilePhotoDelete(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	d.st.db.ExecContext(r.Context(), `UPDATE desk_profiles SET photo = NULL, photo_ver = 0 WHERE user_id = ?`, u.ID)
	writeStatus(w, http.StatusOK, d.st.deskProfile(r.Context(), u))
}

// avatarGet entrega a foto de qualquer usuário a quem estiver logado (aparece nas conversas e nas listas). Sempre como imagem
// inerte: o tipo vem do conteúdo (só JPEG e PNG chegam a ser guardados) e a política de conteúdo proíbe qualquer execução.
func (d *deskAPI) avatarGet(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var b []byte
	err := d.st.rdb.QueryRowContext(r.Context(), `SELECT photo FROM desk_profiles WHERE user_id = ?`, id).Scan(&b)
	if errors.Is(err, sql.ErrNoRows) || len(b) == 0 {
		deskErr(w, http.StatusNotFound, "sem foto")
		return
	}
	if err != nil {
		deskErr(w, http.StatusInternalServerError, "falha lendo a foto")
		return
	}
	h := w.Header()
	h.Set("Content-Type", http.DetectContentType(b))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cache-Control", "private, max-age=86400") // o ?v= da foto muda a cada troca
	h.Set("Content-Length", strconv.Itoa(len(b)))
	_, _ = w.Write(b)
}
