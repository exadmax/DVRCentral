// E-mail do Diogows: a conversa com o provedor (IMAP para ler e organizar, SMTP para enviar) e a montagem e leitura das mensagens.
package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	netmail "net/mail"
	"net/smtp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	"github.com/emersion/go-message"
	"github.com/emersion/go-message/mail"
	"github.com/emersion/go-sasl"
)

// ---------- autenticação ----------

// xoauth2 é o mecanismo SASL XOAUTH2 (Gmail e Microsoft): o token de acesso no lugar da senha.
type xoauth2 struct{ user, token string }

func (x *xoauth2) Start() (string, []byte, error) {
	return "XOAUTH2", []byte("user=" + x.user + "\x01auth=Bearer " + x.token + "\x01\x01"), nil
}
func (x *xoauth2) Next([]byte) ([]byte, error) {
	return nil, errors.New("o provedor recusou o acesso OAuth")
}

var _ sasl.Client = (*xoauth2)(nil)

type smtpXOAuth2 struct{ user, token string }

func (x *smtpXOAuth2) Start(*smtp.ServerInfo) (string, []byte, error) {
	return "XOAUTH2", []byte("user=" + x.user + "\x01auth=Bearer " + x.token + "\x01\x01"), nil
}
func (x *smtpXOAuth2) Next(_ []byte, more bool) ([]byte, error) {
	if more {
		return []byte{}, nil // o servidor mandou o motivo da recusa; a resposta vazia o deixa terminar com o erro
	}
	return nil, nil
}

// smtpLogin é o AUTH LOGIN, que alguns servidores aceitam no lugar do PLAIN.
type smtpLogin struct{ user, pass string }

func (l *smtpLogin) Start(*smtp.ServerInfo) (string, []byte, error) { return "LOGIN", nil, nil }
func (l *smtpLogin) Next(from []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch strings.ToLower(strings.TrimSpace(string(from))) {
	case "username:":
		return []byte(l.user), nil
	case "password:":
		return []byte(l.pass), nil
	}
	return nil, errors.New("resposta inesperada do servidor SMTP")
}

func (d *deskAPI) mailCreds(ctx context.Context, a *mailAccount) (mailSecret, string, error) {
	sec, err := d.mailOpen(a.secret)
	if err != nil {
		return sec, "", err
	}
	if a.Provider == "imap" {
		return sec, "", nil
	}
	tok, err := d.mailAccessToken(ctx, a, sec)
	return sec, tok, err
}

// ---------- IMAP ----------

func (d *deskAPI) imapConnect(ctx context.Context, a *mailAccount) (*imapclient.Client, error) {
	sec, tok, err := d.mailCreds(ctx, a)
	if err != nil {
		return nil, err
	}
	opts := &imapclient.Options{Dialer: d.mailDialer(), TLSConfig: d.mailTLS(a.IMAPHost)}
	addr := net.JoinHostPort(a.IMAPHost, strconv.Itoa(a.IMAPPort))
	var c *imapclient.Client
	if a.IMAPSec == "tls" {
		c, err = imapclient.DialTLS(addr, opts)
	} else {
		c, err = imapclient.DialStartTLS(addr, opts)
	}
	if err != nil {
		return nil, fmt.Errorf("não consegui conectar ao IMAP %s: %v", a.IMAPHost, err)
	}
	if a.Provider == "imap" {
		err = c.Login(a.Username, sec.Password).Wait()
	} else {
		err = c.Authenticate(&xoauth2{a.Username, tok})
	}
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("o servidor IMAP recusou o login: %v (confira usuário e senha; no Gmail e no iCloud use uma senha de app)", err)
	}
	return c, nil
}

// withIMAP abre a conexão, roda fn e a encerra. O relógio fecha a conexão se o servidor travar.
func (d *deskAPI) withIMAP(ctx context.Context, a *mailAccount, fn func(c *imapclient.Client) error) error {
	c, err := d.imapConnect(ctx, a)
	if err != nil {
		return err
	}
	t := time.AfterFunc(mailOpTimeout, func() { c.Close() })
	defer func() { t.Stop(); _ = c.Logout().Wait(); c.Close() }()
	return fn(c)
}

func mailRole(l *imap.ListData) string {
	if strings.EqualFold(l.Mailbox, "INBOX") {
		return "inbox"
	}
	for _, at := range l.Attrs {
		switch at {
		case imap.MailboxAttrSent:
			return "sent"
		case imap.MailboxAttrDrafts:
			return "drafts"
		case imap.MailboxAttrTrash:
			return "trash"
		case imap.MailboxAttrJunk:
			return "junk"
		case imap.MailboxAttrArchive:
			return "archive"
		case imap.MailboxAttrAll:
			return "all"
		}
	}
	name := strings.ToLower(l.Mailbox)
	if i := strings.LastIndexAny(name, "/."); i >= 0 {
		name = name[i+1:]
	}
	switch name {
	case "sent", "sent items", "sent messages", "enviados", "itens enviados", "enviadas":
		return "sent"
	case "drafts", "rascunhos":
		return "drafts"
	case "trash", "deleted items", "deleted messages", "lixeira", "itens excluídos", "excluídos":
		return "trash"
	case "junk", "spam", "junk email", "lixo eletrônico":
		return "junk"
	case "archive", "arquivo", "arquivados":
		return "archive"
	}
	return ""
}

type mailFolder struct {
	Name   string `json:"name"`
	Label  string `json:"label"`
	Role   string `json:"role"`
	Unseen uint32 `json:"unseen"`
	Total  uint32 `json:"total"`
}

func (d *deskAPI) mailFolders(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	a := d.mailAcc(w, r, u)
	if a == nil {
		return
	}
	out := []mailFolder{}
	err := d.withIMAP(r.Context(), a, func(c *imapclient.Client) error {
		lst, err := c.List("", "*", nil).Collect()
		if err != nil {
			return err
		}
		n := 0
		for _, l := range lst {
			if hasAttr(l.Attrs, imap.MailboxAttrNoSelect) || hasAttr(l.Attrs, imap.MailboxAttrNonExistent) {
				continue
			}
			f := mailFolder{Name: l.Mailbox, Label: l.Mailbox, Role: mailRole(l)}
			if i := strings.LastIndex(l.Mailbox, string(l.Delim)); l.Delim != 0 && i >= 0 && f.Role != "" {
				f.Label = l.Mailbox[i+1:]
			}
			if n < 40 || f.Role != "" { // o contador custa uma ida ao servidor por pasta
				if st, err := c.Status(l.Mailbox, &imap.StatusOptions{NumMessages: true, NumUnseen: true}).Wait(); err == nil {
					if st.NumUnseen != nil {
						f.Unseen = *st.NumUnseen
					}
					if st.NumMessages != nil {
						f.Total = *st.NumMessages
					}
				}
				n++
			}
			out = append(out, f)
		}
		return nil
	})
	if err != nil {
		deskErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeStatus(w, http.StatusOK, out)
}

func hasAttr(list []imap.MailboxAttr, a imap.MailboxAttr) bool {
	for _, x := range list {
		if x == a {
			return true
		}
	}
	return false
}

type mailMsg struct {
	UID      uint32 `json:"uid"`
	From     string `json:"from"`
	FromAddr string `json:"from_addr"`
	To       string `json:"to"`
	Subject  string `json:"subject"`
	Date     int64  `json:"date"`
	Seen     bool   `json:"seen"`
	Flagged  bool   `json:"flagged"`
	Answered bool   `json:"answered"`
	Size     int64  `json:"size"`
	Attach   bool   `json:"attach"`
}

func addrName(a imap.Address) string {
	if a.Name != "" {
		return a.Name
	}
	return a.Mailbox + "@" + a.Host
}

func addrList(l []imap.Address) string {
	s := make([]string, 0, len(l))
	for _, a := range l {
		s = append(s, addrName(a))
	}
	return strings.Join(s, ", ")
}

func mailFolderName(r *http.Request) (string, bool) {
	f := r.URL.Query().Get("folder")
	if f == "" {
		f = "INBOX"
	}
	if len(f) > 255 || strings.ContainsAny(f, "\r\n\x00") {
		return "", false
	}
	return f, true
}

func (d *deskAPI) mailMessages(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	a := d.mailAcc(w, r, u)
	if a == nil {
		return
	}
	folder, ok := mailFolderName(r)
	if !ok {
		deskErr(w, http.StatusBadRequest, "pasta inválida")
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	page = max(page, 0)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) > 200 {
		q = q[:200]
	}
	msgs, total := []mailMsg{}, 0
	err := d.withIMAP(r.Context(), a, func(c *imapclient.Client) error {
		sel, err := c.Select(folder, &imap.SelectOptions{ReadOnly: true}).Wait()
		if err != nil {
			return err
		}
		var set imap.NumSet
		if q != "" {
			sd, err := c.UIDSearch(&imap.SearchCriteria{Text: []string{q}}, nil).Wait()
			if err != nil {
				return err
			}
			uids := sd.AllUIDs()
			sort.Slice(uids, func(i, j int) bool { return uids[i] > uids[j] })
			total = len(uids)
			lo, hi := page*mailPageSize, min((page+1)*mailPageSize, len(uids))
			if lo >= len(uids) {
				return nil
			}
			us := imap.UIDSet{}
			us.AddNum(uids[lo:hi]...)
			set = us
		} else {
			total = int(sel.NumMessages)
			hi := total - page*mailPageSize
			if hi < 1 {
				return nil
			}
			lo := max(hi-mailPageSize+1, 1)
			ss := imap.SeqSet{}
			ss.AddRange(uint32(lo), uint32(hi))
			set = ss
		}
		bufs, err := c.Fetch(set, &imap.FetchOptions{UID: true, Flags: true, Envelope: true, InternalDate: true, RFC822Size: true, BodyStructure: &imap.FetchItemBodyStructure{Extended: true}}).Collect()
		if err != nil {
			return err
		}
		for _, b := range bufs {
			m := mailMsg{UID: uint32(b.UID), Size: b.RFC822Size}
			if e := b.Envelope; e != nil {
				m.Subject, m.Date = e.Subject, e.Date.Unix()
				if len(e.From) > 0 {
					m.From, m.FromAddr = addrName(e.From[0]), e.From[0].Mailbox+"@"+e.From[0].Host
				}
				m.To = addrList(e.To)
			}
			if m.Date <= 0 {
				m.Date = b.InternalDate.Unix()
			}
			for _, f := range b.Flags {
				switch f {
				case imap.FlagSeen:
					m.Seen = true
				case imap.FlagFlagged:
					m.Flagged = true
				case imap.FlagAnswered:
					m.Answered = true
				}
			}
			if b.BodyStructure != nil {
				b.BodyStructure.Walk(func(_ []int, p imap.BodyStructure) bool {
					if dsp := p.Disposition(); dsp != nil && strings.EqualFold(dsp.Value, "attachment") {
						m.Attach = true
					}
					return true
				})
			}
			msgs = append(msgs, m)
		}
		sort.Slice(msgs, func(i, j int) bool { return msgs[i].UID > msgs[j].UID })
		return nil
	})
	if err != nil {
		deskErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeStatus(w, http.StatusOK, map[string]any{"messages": msgs, "total": total, "page": page, "page_size": mailPageSize})
}

// ---------- leitura de uma mensagem ----------

type mailAtt struct {
	Idx    int    `json:"idx"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	Size   int    `json:"size"`
	CID    string `json:"cid,omitempty"`
	Inline bool   `json:"inline"`
}

type mailView struct {
	UID        uint32    `json:"uid"`
	Subject    string    `json:"subject"`
	From       string    `json:"from"`
	FromAddr   string    `json:"from_addr"`
	To         string    `json:"to"`
	Cc         string    `json:"cc"`
	ReplyTo    string    `json:"reply_to"`
	Date       int64     `json:"date"`
	MessageID  string    `json:"message_id"`
	References string    `json:"references"`
	Text       string    `json:"text"`
	HTML       string    `json:"html"`
	Atts       []mailAtt `json:"attachments"`
	Seen       bool      `json:"seen"`
	Flagged    bool      `json:"flagged"`
}

func fmtAddrs(l []*mail.Address) string {
	s := make([]string, 0, len(l))
	for _, a := range l {
		if a.Name != "" {
			s = append(s, a.Name+" <"+a.Address+">")
		} else {
			s = append(s, a.Address)
		}
	}
	return strings.Join(s, ", ")
}

// parseMail lê a mensagem inteira. Se want >= 0, devolve também os bytes do anexo de índice want.
func parseMail(raw []byte, want int) (*mailView, []byte, error) {
	mr, err := mail.CreateReader(bytes.NewReader(raw))
	if err != nil && !message.IsUnknownCharset(err) && !message.IsUnknownEncoding(err) {
		return nil, nil, err
	}
	v := &mailView{Atts: []mailAtt{}}
	h := mr.Header
	v.Subject, _ = h.Subject()
	if l, err := h.AddressList("From"); err == nil && len(l) > 0 {
		v.From, v.FromAddr = l[0].Name, l[0].Address
		if v.From == "" {
			v.From = l[0].Address
		}
	}
	if l, err := h.AddressList("To"); err == nil {
		v.To = fmtAddrs(l)
	}
	if l, err := h.AddressList("Cc"); err == nil {
		v.Cc = fmtAddrs(l)
	}
	if l, err := h.AddressList("Reply-To"); err == nil {
		v.ReplyTo = fmtAddrs(l)
	}
	if t, err := h.Date(); err == nil {
		v.Date = t.Unix()
	}
	v.MessageID, v.References = strings.TrimSpace(h.Get("Message-Id")), strings.TrimSpace(h.Get("References"))
	var data []byte
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			if message.IsUnknownCharset(err) || message.IsUnknownEncoding(err) {
				continue
			}
			break
		}
		body, _ := io.ReadAll(io.LimitReader(p.Body, mailMaxFetch))
		switch ph := p.Header.(type) {
		case *mail.InlineHeader:
			ct, _, _ := ph.ContentType()
			if ct == "text/plain" && v.Text == "" {
				v.Text = string(body)
			} else if ct == "text/html" && v.HTML == "" {
				v.HTML = string(body)
			} else if ct != "text/plain" && ct != "text/html" {
				a := mailAtt{Idx: len(v.Atts), Type: ct, Size: len(body), Inline: true, CID: strings.Trim(ph.Get("Content-Id"), "<> ")}
				a.Name = "imagem-" + strconv.Itoa(a.Idx+1)
				v.Atts = append(v.Atts, a)
				if a.Idx == want {
					data = body
				}
			}
		case *mail.AttachmentHeader:
			ct, _, _ := ph.ContentType()
			name, _ := ph.Filename()
			a := mailAtt{Idx: len(v.Atts), Type: ct, Size: len(body), Name: name, CID: strings.Trim(ph.Get("Content-Id"), "<> ")}
			if a.Name == "" {
				a.Name = "anexo-" + strconv.Itoa(a.Idx+1)
			}
			v.Atts = append(v.Atts, a)
			if a.Idx == want {
				data = body
			}
		}
	}
	return v, data, nil
}

// mailFetchRaw lê a mensagem inteira sem marcar como lida (BODY.PEEK).
func mailFetchRaw(c *imapclient.Client, folder string, uid uint32, markSeen bool) (raw []byte, seen, flagged bool, err error) {
	if _, err = c.Select(folder, &imap.SelectOptions{ReadOnly: !markSeen}).Wait(); err != nil {
		return
	}
	set := imap.UIDSetNum(imap.UID(uid))
	hdr, err := c.Fetch(set, &imap.FetchOptions{UID: true, Flags: true, RFC822Size: true}).Collect()
	if err != nil {
		return
	}
	if len(hdr) == 0 {
		err = errors.New("mensagem não encontrada (já foi movida ou apagada?)")
		return
	}
	if hdr[0].RFC822Size > mailMaxFetch {
		err = fmt.Errorf("mensagem grande demais para abrir aqui (%d MB)", hdr[0].RFC822Size>>20)
		return
	}
	for _, f := range hdr[0].Flags {
		seen = seen || f == imap.FlagSeen
		flagged = flagged || f == imap.FlagFlagged
	}
	sec := &imap.FetchItemBodySection{Peek: true}
	bufs, err := c.Fetch(set, &imap.FetchOptions{UID: true, BodySection: []*imap.FetchItemBodySection{sec}}).Collect()
	if err != nil {
		return
	}
	if len(bufs) == 0 {
		err = errors.New("mensagem não encontrada")
		return
	}
	raw = bufs[0].FindBodySection(sec)
	if markSeen && !seen {
		if c.Store(set, &imap.StoreFlags{Op: imap.StoreFlagsAdd, Silent: true, Flags: []imap.Flag{imap.FlagSeen}}, nil).Close() == nil {
			seen = true
		}
	}
	return
}

func mailUID(r *http.Request) (uint32, bool) {
	n, err := strconv.ParseUint(r.URL.Query().Get("uid"), 10, 32)
	return uint32(n), err == nil && n > 0
}

func (d *deskAPI) mailMessage(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	a := d.mailAcc(w, r, u)
	if a == nil {
		return
	}
	folder, ok := mailFolderName(r)
	uid, ok2 := mailUID(r)
	if !ok || !ok2 {
		deskErr(w, http.StatusBadRequest, "pasta ou mensagem inválida")
		return
	}
	var v *mailView
	err := d.withIMAP(r.Context(), a, func(c *imapclient.Client) error {
		raw, seen, flagged, err := mailFetchRaw(c, folder, uid, true)
		if err != nil {
			return err
		}
		if v, _, err = parseMail(raw, -1); err != nil {
			return fmt.Errorf("não consegui ler a mensagem: %v", err)
		}
		v.UID, v.Seen, v.Flagged = uid, seen, flagged
		return nil
	})
	if err != nil {
		deskErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeStatus(w, http.StatusOK, v)
}

// Anexos só saem como download (octet-stream), exceto imagens comuns, que o leitor usa nas imagens embutidas (cid:). SVG e HTML nunca vão
// inline: rodariam script na origem do Diogows.
var mailInlineImg = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

func (d *deskAPI) mailAttachment(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	a := d.mailAcc(w, r, u)
	if a == nil {
		return
	}
	folder, ok := mailFolderName(r)
	uid, ok2 := mailUID(r)
	idx, err := strconv.Atoi(r.URL.Query().Get("idx"))
	if !ok || !ok2 || err != nil || idx < 0 {
		deskErr(w, http.StatusBadRequest, "anexo inválido")
		return
	}
	var data []byte
	var att mailAtt
	err = d.withIMAP(r.Context(), a, func(c *imapclient.Client) error {
		raw, _, _, err := mailFetchRaw(c, folder, uid, false)
		if err != nil {
			return err
		}
		v, b, err := parseMail(raw, idx)
		if err != nil {
			return err
		}
		if idx >= len(v.Atts) {
			return errors.New("anexo não encontrado")
		}
		att, data = v.Atts[idx], b
		return nil
	})
	if err != nil {
		deskErr(w, http.StatusBadGateway, err.Error())
		return
	}
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cache-Control", "private, max-age=300")
	if mailInlineImg[att.Type] && r.URL.Query().Get("download") != "1" {
		h.Set("Content-Type", att.Type)
	} else {
		h.Set("Content-Type", "application/octet-stream")
		h.Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEscapeName(att.Name))
	}
	h.Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}

// ---------- organizar ----------

type mailActionIn struct {
	Folder string   `json:"folder"`
	UIDs   []uint32 `json:"uids"`
	Op     string   `json:"op"` // seen | unseen | flag | unflag | delete | move
	To     string   `json:"to"`
}

func (d *deskAPI) mailAction(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	a := d.mailAcc(w, r, u)
	if a == nil {
		return
	}
	var in mailActionIn
	if !deskDecode(w, r, &in) {
		return
	}
	validName := func(s string) bool { return s != "" && len(s) <= 255 && !strings.ContainsAny(s, "\r\n\x00") }
	if !validName(in.Folder) || len(in.UIDs) == 0 || len(in.UIDs) > 200 || (in.Op == "move" && !validName(in.To)) {
		deskErr(w, http.StatusBadRequest, "pedido inválido")
		return
	}
	set := imap.UIDSet{}
	for _, id := range in.UIDs {
		if id == 0 {
			deskErr(w, http.StatusBadRequest, "mensagem inválida")
			return
		}
		set.AddNum(imap.UID(id))
	}
	flag := func(c *imapclient.Client, op imap.StoreFlagsOp, f imap.Flag) error {
		return c.Store(set, &imap.StoreFlags{Op: op, Silent: true, Flags: []imap.Flag{f}}, nil).Close()
	}
	err := d.withIMAP(r.Context(), a, func(c *imapclient.Client) error {
		if _, err := c.Select(in.Folder, nil).Wait(); err != nil {
			return err
		}
		switch in.Op {
		case "seen":
			return flag(c, imap.StoreFlagsAdd, imap.FlagSeen)
		case "unseen":
			return flag(c, imap.StoreFlagsDel, imap.FlagSeen)
		case "flag":
			return flag(c, imap.StoreFlagsAdd, imap.FlagFlagged)
		case "unflag":
			return flag(c, imap.StoreFlagsDel, imap.FlagFlagged)
		case "move":
			_, err := c.Move(set, in.To).Wait()
			return err
		case "delete": // vai para a lixeira; se já está nela (ou não há), apaga de vez
			trash := ""
			if lst, err := c.List("", "*", nil).Collect(); err == nil {
				for _, l := range lst {
					if mailRole(l) == "trash" {
						trash = l.Mailbox
						break
					}
				}
			}
			if trash != "" && trash != in.Folder {
				_, err := c.Move(set, trash).Wait()
				return err
			}
			if err := flag(c, imap.StoreFlagsAdd, imap.FlagDeleted); err != nil {
				return err
			}
			return c.UIDExpunge(set).Close()
		}
		return errors.New("operação desconhecida")
	})
	if err != nil {
		deskErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeStatus(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- enviar ----------

type mailSendAtt struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Data string `json:"data"` // base64
}

type mailSendIn struct {
	To          []string      `json:"to"`
	Cc          []string      `json:"cc"`
	Bcc         []string      `json:"bcc"`
	Subject     string        `json:"subject"`
	Text        string        `json:"text"`
	InReplyTo   string        `json:"in_reply_to"`
	References  string        `json:"references"`
	Attachments []mailSendAtt `json:"attachments"`
}

func parseRcpts(list []string) ([]*netmail.Address, error) {
	var out []*netmail.Address
	for _, s := range list {
		if s = strings.TrimSpace(s); s == "" {
			continue
		}
		a, err := netmail.ParseAddress(s)
		if err != nil {
			return nil, fmt.Errorf("endereço inválido: %q", s)
		}
		out = append(out, a)
	}
	return out, nil
}

func toMailAddrs(l []*netmail.Address) []*mail.Address {
	o := make([]*mail.Address, len(l))
	for i, a := range l {
		o[i] = &mail.Address{Name: a.Name, Address: a.Address}
	}
	return o
}

// buildMail monta a mensagem MIME (texto simples + anexos). Cabeçalhos passam por codificação: nada digitado vira linha de cabeçalho solta.
func buildMail(from *mail.Address, in *mailSendIn, to, cc []*mail.Address) ([]byte, error) {
	var h mail.Header
	h.SetDate(time.Now())
	h.SetAddressList("From", []*mail.Address{from})
	h.SetAddressList("To", to)
	if len(cc) > 0 {
		h.SetAddressList("Cc", cc)
	}
	h.SetSubject(strings.NewReplacer("\r", " ", "\n", " ").Replace(in.Subject))
	if err := h.GenerateMessageID(); err != nil {
		return nil, err
	}
	clean := func(s string) string { return strings.TrimSpace(strings.NewReplacer("\r", "", "\n", " ").Replace(s)) }
	if v := clean(in.InReplyTo); v != "" && len(v) < 998 {
		h.Set("In-Reply-To", v)
	}
	if v := clean(in.References); v != "" && len(v) < 2000 {
		h.Set("References", v)
	}
	var buf bytes.Buffer
	mw, err := mail.CreateWriter(&buf, h)
	if err != nil {
		return nil, err
	}
	tw, err := mw.CreateInline()
	if err != nil {
		return nil, err
	}
	var th mail.InlineHeader
	th.SetContentType("text/plain", map[string]string{"charset": "utf-8"})
	pw, err := tw.CreatePart(th)
	if err != nil {
		return nil, err
	}
	_, _ = io.WriteString(pw, in.Text)
	pw.Close()
	tw.Close()
	for _, at := range in.Attachments {
		raw, err := base64.StdEncoding.DecodeString(at.Data)
		if err != nil {
			return nil, fmt.Errorf("anexo %q ilegível", at.Name)
		}
		var ah mail.AttachmentHeader
		ct := at.Type
		if _, _, err := mime.ParseMediaType(ct); err != nil || ct == "" {
			ct = "application/octet-stream"
		}
		ah.SetContentType(ct, nil)
		ah.SetFilename(strings.NewReplacer("/", "_", "\\", "_", "\r", "", "\n", "").Replace(at.Name))
		aw, err := mw.CreateAttachment(ah)
		if err != nil {
			return nil, err
		}
		aw.Write(raw)
		aw.Close()
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (d *deskAPI) mailSend(w http.ResponseWriter, r *http.Request, u *DeskUser) {
	a := d.mailAcc(w, r, u)
	if a == nil {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, mailMaxSend)
	var in mailSendIn
	if err := jsonDecodeBody(r, &in); err != nil {
		deskErr(w, http.StatusBadRequest, "pedido grande demais ou inválido (anexos somam até ~20 MB)")
		return
	}
	to, e1 := parseRcpts(in.To)
	cc, e2 := parseRcpts(in.Cc)
	bcc, e3 := parseRcpts(in.Bcc)
	for _, e := range []error{e1, e2, e3} {
		if e != nil {
			deskErr(w, http.StatusBadRequest, e.Error())
			return
		}
	}
	if len(to)+len(cc)+len(bcc) == 0 || len(to)+len(cc)+len(bcc) > 100 {
		deskErr(w, http.StatusBadRequest, "informe de 1 a 100 destinatários")
		return
	}
	if len(to) == 0 {
		to = append(to, append(cc, bcc...)[0])
	}
	from := &mail.Address{Address: a.Email}
	if p := d.st.deskProfile(r.Context(), u); p.SignEmail && (p.FirstName != "" || p.LastName != "") {
		from.Name = p.DisplayName // "Maria Silva <maria@…>" no remetente, se a pessoa ligou "usar meu nome nos e-mails"
	}
	msg, err := buildMail(from, &in, toMailAddrs(to), toMailAddrs(cc))
	if err != nil {
		deskErr(w, http.StatusBadRequest, err.Error())
		return
	}
	rcpt := []string{}
	for _, l := range [][]*netmail.Address{to, cc, bcc} {
		for _, x := range l {
			rcpt = append(rcpt, x.Address)
		}
	}
	if err := d.smtpSend(r.Context(), a, a.Email, rcpt, msg); err != nil {
		deskErr(w, http.StatusBadGateway, err.Error())
		return
	}
	log.Printf("desktop: e-mail: %s enviou uma mensagem por %s (%d destinatários)", u.Username, a.Email, len(rcpt))
	saved := true
	if a.Provider == "imap" { // Gmail e Microsoft guardam o enviado sozinhos; nos demais é preciso copiar para a pasta Enviados
		saved = d.mailAppendSent(r.Context(), a, msg) == nil
	}
	writeStatus(w, http.StatusOK, map[string]any{"ok": true, "saved_copy": saved})
}

func (d *deskAPI) mailAppendSent(ctx context.Context, a *mailAccount, msg []byte) error {
	return d.withIMAP(ctx, a, func(c *imapclient.Client) error {
		lst, err := c.List("", "*", nil).Collect()
		if err != nil {
			return err
		}
		for _, l := range lst {
			if mailRole(l) == "sent" {
				cmd := c.Append(l.Mailbox, int64(len(msg)), &imap.AppendOptions{Flags: []imap.Flag{imap.FlagSeen}, Time: time.Now()})
				if _, err := cmd.Write(msg); err != nil {
					return err
				}
				if err := cmd.Close(); err != nil {
					return err
				}
				_, err := cmd.Wait()
				return err
			}
		}
		return errors.New("sem pasta de enviados")
	})
}

// smtpDial conecta, ativa TLS e autentica.
func (d *deskAPI) smtpDial(ctx context.Context, a *mailAccount) (*smtp.Client, error) {
	sec, tok, err := d.mailCreds(ctx, a)
	if err != nil {
		return nil, err
	}
	conn, err := d.mailDialer().DialContext(ctx, "tcp", net.JoinHostPort(a.SMTPHost, strconv.Itoa(a.SMTPPort)))
	if err != nil {
		return nil, fmt.Errorf("não consegui conectar ao SMTP %s: %v", a.SMTPHost, err)
	}
	_ = conn.SetDeadline(time.Now().Add(mailOpTimeout))
	cfg := d.mailTLS(a.SMTPHost)
	if a.SMTPSec == "tls" {
		conn = tls.Client(conn, cfg)
	}
	c, err := smtp.NewClient(conn, a.SMTPHost)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("o servidor SMTP não respondeu: %v", err)
	}
	fail := func(err error) (*smtp.Client, error) { c.Close(); return nil, err }
	if a.SMTPSec == "starttls" {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return fail(errors.New("o servidor SMTP não oferece STARTTLS (conexão sem criptografia recusada)"))
		}
		if err := c.StartTLS(cfg); err != nil {
			return fail(fmt.Errorf("falha no STARTTLS do SMTP: %v", err))
		}
	}
	var auth smtp.Auth
	if a.Provider != "imap" {
		auth = &smtpXOAuth2{a.Username, tok}
	} else if _, mechs := c.Extension("AUTH"); strings.Contains(strings.ToUpper(mechs), "PLAIN") || mechs == "" {
		auth = smtp.PlainAuth("", a.Username, sec.Password, a.SMTPHost)
	} else {
		auth = &smtpLogin{a.Username, sec.Password}
	}
	if err := c.Auth(auth); err != nil {
		return fail(fmt.Errorf("o servidor SMTP recusou o login: %v", err))
	}
	return c, nil
}

func (d *deskAPI) smtpSend(ctx context.Context, a *mailAccount, from string, rcpt []string, msg []byte) error {
	c, err := d.smtpDial(ctx, a)
	if err != nil {
		return err
	}
	defer c.Close()
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("o servidor recusou o remetente: %v", err)
	}
	for _, x := range rcpt {
		if err := c.Rcpt(x); err != nil {
			return fmt.Errorf("o servidor recusou o destinatário %s: %v", x, err)
		}
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("o servidor não aceitou a mensagem: %v", err)
	}
	return c.Quit()
}

// mailTest confere o login no IMAP e no SMTP de uma conta nova.
func (d *deskAPI) mailTest(ctx context.Context, a *mailAccount) error {
	if err := d.withIMAP(ctx, a, func(*imapclient.Client) error { return nil }); err != nil {
		return err
	}
	c, err := d.smtpDial(ctx, a)
	if err != nil {
		return err
	}
	_ = c.Quit()
	return nil
}
