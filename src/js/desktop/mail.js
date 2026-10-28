(function (DK) {
  // E-mail: cliente de e-mail do Diogows. Fala com /api/desk/mail/* (o servidor conversa IMAP/SMTP com o provedor; veja server/desk_mail*.go).
  // Contas: Gmail e Microsoft por OAuth 2.0, ou qualquer servidor IMAP/SMTP com senha (senha de app, no Gmail e no iCloud).
  // O corpo HTML das mensagens é limpo aqui e mostrado num iframe com sandbox sem scripts, sem acesso ao Diogows e sem imagens remotas (só se você pedir).
  const el = DK.el;
  const api = (m, p, b) => DK.api(m, '/mail' + p, b);
  const ROLE = { inbox: ['📥', 'Caixa de entrada'], sent: ['📤', 'Enviados'], drafts: ['📝', 'Rascunhos'], trash: ['🗑️', 'Lixeira'], junk: ['🚫', 'Spam'], archive: ['🗄️', 'Arquivo'], all: ['📚', 'Todos os e-mails'] };
  const ROLE_ORDER = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash', 'all'];
  const PRESETS = [
    { re: /@(gmail|googlemail)\.com$/i, imap: 'imap.gmail.com', imapSec: 'tls', smtp: 'smtp.gmail.com', smtpPort: 465, smtpSec: 'tls', note: 'Gmail: ative a verificação em duas etapas e crie uma senha de app em myaccount.google.com/apppasswords.' },
    { re: /@(outlook|hotmail|live|msn)\.[a-z.]+$/i, imap: 'outlook.office365.com', imapSec: 'tls', smtp: 'smtp-mail.outlook.com', smtpPort: 587, smtpSec: 'starttls', note: 'Outlook.com: a Microsoft vem exigindo OAuth para IMAP; se a senha não funcionar, use “Entrar com a Microsoft”.' },
    { re: /@(yahoo|ymail)\.[a-z.]+$/i, imap: 'imap.mail.yahoo.com', imapSec: 'tls', smtp: 'smtp.mail.yahoo.com', smtpPort: 465, smtpSec: 'tls', note: 'Yahoo: crie uma senha de app nas configurações de segurança da conta.' },
    { re: /@(icloud|me|mac)\.com$/i, imap: 'imap.mail.me.com', imapSec: 'tls', smtp: 'smtp.mail.me.com', smtpPort: 587, smtpSec: 'starttls', note: 'iCloud: use uma senha específica de app (appleid.apple.com).' }
  ];
  const pad2 = n => String(n).padStart(2, '0');
  function fmtDate(ts, full) {
    const d = new Date(ts * 1000), now = new Date();
    const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (!full && d.toDateString() === now.toDateString()) return hm;
    const dm = pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + (d.getFullYear() !== now.getFullYear() || full ? '/' + d.getFullYear() : '');
    return full ? dm + ' ' + hm : dm;
  }
  const addrsOf = s => (String(s || '').match(/<([^>]+)>|([^\s,<>"]+@[^\s,<>"]+)/g) || []).map(x => x.replace(/[<>]/g, ''));
  const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const textOfHtml = h => { try { return new DOMParser().parseFromString(h, 'text/html').body.textContent; } catch (e) { return ''; } };

  // ---------- HTML da mensagem: limpeza + iframe com sandbox ----------
  const BLOCKED = 'script,meta,link,base,iframe,frame,frameset,object,embed,form,applet,audio,video,source,track,noscript,template,portal';
  function cleanHtml(html, allowImg, cids) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let blocked = 0;
    doc.querySelectorAll(BLOCKED).forEach(e => e.remove());
    doc.querySelectorAll('*').forEach(e => {
      [].slice.call(e.attributes).forEach(a => {
        const n = a.name.toLowerCase(), v = a.value.trim();
        if (n.indexOf('on') === 0 || n === 'srcdoc' || n === 'formaction') e.removeAttribute(a.name);
        else if (n === 'href' || n === 'xlink:href') {
          if (e.tagName === 'A' && /^(https?:|mailto:|tel:)/i.test(v)) { e.setAttribute('target', '_blank'); e.setAttribute('rel', 'noopener noreferrer'); }
          else e.removeAttribute(a.name);
        } else if (n === 'src' || n === 'background' || n === 'poster') {
          if (/^cid:/i.test(v)) { const d = cids[v.slice(4).toLowerCase()]; if (d) e.setAttribute(a.name, d); else e.removeAttribute(a.name); }
          else if (/^data:image\/(png|jpe?g|gif|webp);/i.test(v)) { /* imagem embutida: vale */ }
          else if (/^https?:/i.test(v) && allowImg) { e.setAttribute('referrerpolicy', 'no-referrer'); }
          else { if (/^https?:/i.test(v)) blocked++; e.removeAttribute(a.name); }
        }
      });
    });
    const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:" + (allowImg ? ' https: http:' : '');
    const head = '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><base target="_blank"><style>body{font:14px system-ui,sans-serif;margin:12px;color:#222;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:10px;color:#555}</style>';
    return { html: '<!doctype html><html><head>' + head + '</head><body>' + doc.body.innerHTML + '</body></html>', blocked: blocked };
  }

  // ---------- janela principal ----------
  DK.mailApp = function () {
    DK.openWindow('mail', 'E-mail', (body, win) => {
      body.className = 'body flush';
      let accounts = [], acc = null, folders = [], folder = 'INBOX', page = 0, query = '', list = { messages: [], total: 0 }, cur = null, view = null, cfg = {}, timer = null, allowImg = false;
      const root = el('div', { className: 'mailapp' });
      body.append(root);
      const panes = { folders: el('div', { className: 'mfold' }), list: el('div', { className: 'mlist' }), read: el('div', { className: 'mread' }) };
      root.append(panes.folders, panes.list, panes.read);
      root.dataset.pane = 'list';
      const show = p => { root.dataset.pane = p; };
      if (window.ResizeObserver) new ResizeObserver(() => root.classList.toggle('narrow', root.clientWidth < 760)).observe(root);
      const toast = DK.toast;
      const err = e => toast(e && e.message || String(e));

      // ----- contas -----
      async function boot() {
        try { cfg = await api('GET', '/config'); } catch (e) { panes.list.replaceChildren(el('div', { className: 'mempty', textContent: e.message })); return; }
        accounts = await api('GET', '/accounts');
        if (!accounts.length) { drawEmpty(); return; }
        const last = +(DK.prefs.mailAccount || 0);
        await pickAccount(accounts.find(a => a.id === last) || accounts[0]);
        timer = setInterval(() => { if (!document.hidden && acc) { loadFolders(true); loadList(true); } }, 120000);
      }
      function drawEmpty() {
        root.classList.add('empty'); panes.folders.replaceChildren(); panes.read.replaceChildren();
        panes.list.replaceChildren(el('div', { className: 'mempty' }, el('div', { style: 'font-size:42px', textContent: '✉️' }),
          el('p', { textContent: 'Nenhuma conta de e-mail ligada.' }),
          el('button', { className: 'pri', textContent: '➕ Ligar uma conta', onclick: () => accountDialog(boot) }),
          el('p', { className: 'meta', textContent: 'Gmail e Outlook/Microsoft por login (OAuth) ou qualquer servidor IMAP/SMTP com senha.' })));
        show('list');
      }
      async function pickAccount(a) {
        root.classList.remove('empty'); acc = a; folder = 'INBOX'; page = 0; query = ''; cur = null; view = null;
        DK.prefs.mailAccount = a.id; DK.savePrefs();
        drawFolders(); drawRead();
        await loadFolders(); await loadList();
      }
      async function loadFolders(quiet) {
        try { folders = await api('GET', '/accounts/' + acc.id + '/folders'); } catch (e) { if (!quiet) err(e); return; }
        drawFolders();
        const inbox = folders.find(f => f.role === 'inbox');
        win.setTitle('E-mail' + (inbox && inbox.unseen ? ' (' + inbox.unseen + ')' : '') + ' — ' + acc.label);
      }
      const folderLabel = f => (ROLE[f.role] ? ROLE[f.role][1] : f.label);
      function drawFolders() {
        const sel = el('select', { title: 'Conta' }, ...accounts.map(a => el('option', { value: a.id, textContent: a.label })));
        sel.value = acc ? acc.id : '';
        sel.onchange = () => pickAccount(accounts.find(a => a.id === +sel.value));
        const add = el('button', { textContent: '➕', title: 'Ligar outra conta', onclick: () => accountDialog(async () => { accounts = await api('GET', '/accounts'); pickAccount(accounts[accounts.length - 1]); }) });
        const del = el('button', { className: 'del', textContent: '✕', title: 'Remover esta conta do Diogows (os e-mails continuam no provedor)', onclick: removeAccount });
        const write = el('button', { className: 'pri', textContent: '✏️ Escrever', onclick: () => compose({}) });
        const sorted = folders.slice().sort((a, b) => { const x = ROLE_ORDER.indexOf(a.role), y = ROLE_ORDER.indexOf(b.role); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.name.localeCompare(b.name); });
        const items = sorted.map(f => el('button', { className: 'mf' + (f.name === folder ? ' on' : ''), onclick: () => { folder = f.name; page = 0; query = ''; cur = null; view = null; drawFolders(); drawRead(); loadList(); show('list'); } },
          el('span', { textContent: (ROLE[f.role] ? ROLE[f.role][0] : '📁') + ' ' + folderLabel(f) }), f.unseen ? el('b', { className: 'badge', textContent: f.unseen }) : ''));
        panes.folders.replaceChildren(write, el('div', { className: 'row' }, sel, add, del), ...items);
      }
      async function removeAccount() {
        if (!acc || !confirm('Remover a conta “' + acc.label + '” do Diogows?\nOs e-mails continuam no provedor; só a ligação é apagada.')) return;
        try { await api('DELETE', '/accounts/' + acc.id); } catch (e) { err(e); return; }
        accounts = accounts.filter(a => a.id !== acc.id); acc = null; folders = [];
        if (accounts.length) pickAccount(accounts[0]); else drawEmpty();
      }

      // ----- lista -----
      async function loadList(quiet) {
        if (!quiet) panes.list.classList.add('busy');
        try { list = await api('GET', '/accounts/' + acc.id + '/messages?folder=' + encodeURIComponent(folder) + '&page=' + page + (query ? '&q=' + encodeURIComponent(query) : '')); }
        catch (e) { if (!quiet) err(e); list = { messages: [], total: 0 }; }
        panes.list.classList.remove('busy');
        drawList();
      }
      function drawList() {
        const q = el('input', { type: 'search', placeholder: 'Pesquisar nesta pasta…', value: query });
        q.onkeydown = e => { if (e.key === 'Enter') { query = q.value.trim(); page = 0; loadList(); } };
        const toolbar = el('div', { className: 'tb' }, el('button', { className: 'mbk', textContent: '☰', title: 'Pastas', onclick: () => show('folders') }), q, el('button', { textContent: '↻', title: 'Atualizar', onclick: () => { loadFolders(); loadList(); } }));
        const rows = list.messages.map(m => {
          const star = el('span', { className: 'mstar' + (m.flagged ? ' on' : ''), textContent: m.flagged ? '★' : '☆', title: 'Estrela' });
          star.onclick = ev => { ev.stopPropagation(); m.flagged = !m.flagged; act(m.flagged ? 'flag' : 'unflag', [m.uid], true).then(drawList); };
          const sent = folders.some(f => f.name === folder && (f.role === 'sent' || f.role === 'drafts'));
          return el('div', { className: 'mrow' + (m.seen ? '' : ' unseen') + (cur === m.uid ? ' on' : ''), onclick: () => openMsg(m) },
            star, el('div', { className: 'mmain' }, el('div', { className: 'mfrom', textContent: (sent ? 'Para: ' + (m.to || '') : (m.from || m.from_addr)) }),
              el('div', { className: 'msubj', textContent: (m.attach ? '📎 ' : '') + (m.subject || '(sem assunto)') })), el('span', { className: 'mdate', textContent: fmtDate(m.date) }));
        });
        const pages = Math.max(1, Math.ceil(list.total / (list.page_size || 40)));
        const pager = el('div', { className: 'tb mpager' }, el('button', { textContent: '‹ Mais novas', disabled: page <= 0, onclick: () => { page--; loadList(); } }),
          el('span', { className: 'meta sp', textContent: list.total ? list.total + ' mensagens · página ' + (page + 1) + ' de ' + pages : '' }),
          el('button', { textContent: 'Mais antigas ›', disabled: page + 1 >= pages, onclick: () => { page++; loadList(); } }));
        const scroll = el('div', { className: 'mscroll' }, ...(rows.length ? rows : [el('div', { className: 'mempty', textContent: query ? 'Nada encontrado.' : 'Pasta vazia.' })]));
        panes.list.replaceChildren(toolbar, scroll, pager);
      }

      // ----- ler -----
      async function openMsg(m) {
        cur = m.uid; allowImg = false; show('read');
        panes.read.replaceChildren(el('div', { className: 'mempty', textContent: 'Abrindo…' }));
        drawList();
        try { view = await api('GET', '/accounts/' + acc.id + '/message?folder=' + encodeURIComponent(folder) + '&uid=' + m.uid); }
        catch (e) { err(e); view = null; drawRead(); return; }
        if (!m.seen) { m.seen = true; const f = folders.find(x => x.name === folder); if (f && f.unseen) f.unseen--; drawFolders(); drawList(); }
        await drawRead();
      }
      const attUrl = (a, dl) => '/api/desk/mail/accounts/' + acc.id + '/attachment?folder=' + encodeURIComponent(folder) + '&uid=' + view.uid + '&idx=' + a.idx + (dl ? '&download=1' : '');
      async function inlineImages() {            // imagens cid: viram data: (o iframe com sandbox não envia o cookie de sessão)
        const out = {};
        for (const a of view.attachments) {
          if (!a.cid || !/^image\/(png|jpe?g|gif|webp)$/.test(a.type) || a.size > 3 << 20) continue;
          try {
            const buf = await (await fetch(attUrl(a, false), { credentials: 'same-origin' })).arrayBuffer();
            out[a.cid.toLowerCase()] = 'data:' + a.type + ';base64,' + b64(buf);
          } catch (e) { /* fica sem a imagem */ }
        }
        return out;
      }
      async function drawRead() {
        if (!view) { panes.read.replaceChildren(el('div', { className: 'mempty', textContent: acc ? 'Escolha uma mensagem.' : '' })); return; }
        const v = view, mine = v;
        const tb = el('div', { className: 'tb mact' },
          el('button', { className: 'mbk', textContent: '‹', title: 'Voltar à lista', onclick: () => show('list') }),
          el('button', { textContent: '↩ Responder', onclick: () => reply(false) }), el('button', { textContent: '↩↩ Todos', onclick: () => reply(true) }), el('button', { textContent: '➡ Encaminhar', onclick: forward }),
          el('span', { className: 'sp' }),
          el('button', { textContent: v.flagged ? '★' : '☆', title: 'Estrela', onclick: async () => { v.flagged = !v.flagged; await act(v.flagged ? 'flag' : 'unflag', [v.uid], true); const m = list.messages.find(x => x.uid === v.uid); if (m) m.flagged = v.flagged; drawRead(); drawList(); } }),
          el('button', { textContent: '📭', title: 'Marcar como não lida', onclick: async () => { await act('unseen', [v.uid]); const m = list.messages.find(x => x.uid === v.uid); if (m) m.seen = false; loadFolders(true); drawList(); } }),
          moveSelect(v), el('button', { className: 'del', textContent: '🗑', title: 'Excluir', onclick: () => remove(v) }));
        const hd = el('div', { className: 'mhd' }, el('div', { className: 'msb', textContent: v.subject || '(sem assunto)' }),
          el('div', { className: 'meta', textContent: 'De: ' + (v.from === v.from_addr ? v.from_addr : v.from + ' <' + v.from_addr + '>') + ' · ' + fmtDate(v.date, true) }),
          el('div', { className: 'meta', textContent: 'Para: ' + (v.to || '—') + (v.cc ? ' · Cc: ' + v.cc : '') }));
        const usedInline = a => a.cid && v.html && v.html.toLowerCase().indexOf('cid:' + a.cid.toLowerCase()) >= 0;   // imagem do corpo: não é anexo
        const files = v.attachments.filter(a => !usedInline(a));
        const chips = files.length ? el('div', { className: 'matt' }, ...files.map(a => el('a', { className: 'chip', href: attUrl(a, true), textContent: '📎 ' + a.name + ' (' + DK.fmtSize(a.size) + ')', title: 'Baixar' }))) : '';
        let content;
        let banner = '';
        if (v.html) {
          const cids = await inlineImages();
          if (view !== mine) return;
          const c = cleanHtml(v.html, allowImg, cids);
          const frame = el('iframe', { className: 'mframe', title: 'Mensagem' });
          frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
          frame.srcdoc = c.html;
          content = frame;
          if (c.blocked) banner = el('div', { className: 'dwarn' }, 'Imagens remotas bloqueadas (' + c.blocked + '), para ninguém saber que você abriu a mensagem. ',
            el('button', { textContent: 'Mostrar imagens', onclick: () => { allowImg = true; drawRead(); } }));
        } else content = el('pre', { className: 'mtext', textContent: v.text || '(mensagem vazia)' });
        panes.read.replaceChildren(tb, hd, chips, banner, content);
      }
      function moveSelect(v) {
        const s = el('select', { title: 'Mover para…' }, el('option', { value: '', textContent: '📁 Mover…' }), ...folders.filter(f => f.name !== folder).map(f => el('option', { value: f.name, textContent: folderLabel(f) })));
        s.onchange = async () => { if (!s.value) return; await act('move', [v.uid], false, { to: s.value }); gone(v.uid); };
        return s;
      }
      async function remove(v) {
        const inTrash = folders.some(f => f.name === folder && f.role === 'trash');
        if (inTrash && !confirm('Apagar esta mensagem de vez?')) return;
        await act('delete', [v.uid]); gone(v.uid);
      }
      function gone(uid) { list.messages = list.messages.filter(m => m.uid !== uid); list.total = Math.max(0, list.total - 1); view = null; cur = null; drawRead(); drawList(); loadFolders(true); show('list'); }
      async function act(op, uids, quiet, extra) {
        try { await api('POST', '/accounts/' + acc.id + '/action', Object.assign({ folder: folder, uids: uids, op: op }, extra || {})); return true; }
        catch (e) { err(e); return false; }
      }

      // ----- escrever -----
      const subj = (p, s) => (new RegExp('^' + p + '\\s*:', 'i').test(s) ? s : p + ': ' + s);
      const quote = v => { const t = v.text || textOfHtml(v.html || ''); return '\n\nEm ' + fmtDate(v.date, true) + ', ' + (v.from || v.from_addr) + ' escreveu:\n' + t.split(/\r?\n/).map(l => '> ' + l).join('\n'); };
      function reply(all) {
        const v = view; if (!v) return;
        const me = acc.email.toLowerCase();
        const to = addrsOf(v.reply_to || v.from_addr);
        const cc = all ? addrsOf(v.to + ',' + v.cc).filter(a => a.toLowerCase() !== me && to.indexOf(a) < 0) : [];
        compose({ to: to.join(', '), cc: cc.join(', '), subject: subj('Re', v.subject), text: quote(v), inReplyTo: v.message_id, references: (v.references + ' ' + v.message_id).trim() });
      }
      function forward() {
        const v = view; if (!v) return;
        compose({ subject: subj('Enc', v.subject), text: '\n\n---------- Mensagem encaminhada ----------\nDe: ' + (v.from || '') + ' <' + v.from_addr + '>\nData: ' + fmtDate(v.date, true) + '\nAssunto: ' + v.subject + '\nPara: ' + v.to + '\n\n' + (v.text || textOfHtml(v.html || '')) });
      }
      function compose(o) { DK.mailCompose({ accounts: accounts, account: acc, o: o, sent: () => { if (folders.some(f => f.name === folder && f.role === 'sent')) loadList(true); loadFolders(true); } }); }

      // ----- ligar uma conta -----
      function accountDialog(done) { DK.mailAccountDialog(cfg, done); }

      win._onClose = () => clearInterval(timer);
      boot();
    }, 960, 620, { flush: true });
  };

  // ---------- janela de escrever ----------
  let composeSeq = 0;
  DK.mailCompose = function (ctx) {
    const o = ctx.o || {};
    DK.openWindow('mailc:' + (++composeSeq), 'Nova mensagem', (body, win) => {
      body.className = 'body flush';
      const from = el('select', {}, ...ctx.accounts.map(a => el('option', { value: a.id, textContent: a.label + ' <' + a.email + '>' })));
      from.value = ctx.account ? ctx.account.id : ctx.accounts[0].id;
      const to = el('input', { placeholder: 'Para (separe por vírgula)', value: o.to || '' }), cc = el('input', { placeholder: 'Cc', value: o.cc || '' }), bcc = el('input', { placeholder: 'Cco (cópia oculta)' });
      const subject = el('input', { placeholder: 'Assunto', value: o.subject || '', maxLength: 300 });
      const text = el('textarea', { className: 'mbody', placeholder: 'Escreva aqui…' });
      // assinatura opcional (Minha conta → "Usar meu nome nos e-mails"): vai antes do texto citado, e o cursor fica no topo para escrever
      const me = DK.me && DK.me.profile;
      const sigBlock = me && me.sign_email ? '\n\n-- \n' + (me.signature || me.display_name) : '';
      text.value = sigBlock ? sigBlock + (o.text || '') : (o.text || '');
      setTimeout(() => { text.setSelectionRange(0, 0); text.focus(); }, 0);
      const extra = el('div', { className: 'row hidden' }, el('label', {}, 'Cc', cc), el('label', {}, 'Cco', bcc));
      const files = [];     // { name, type, data(base64), size }
      const chips = el('div', { className: 'matt' });
      const total = () => files.reduce((n, f) => n + f.size, 0);
      function drawChips() {
        chips.replaceChildren(...files.map((f, i) => el('span', { className: 'chip' }, '📎 ' + f.name + ' (' + DK.fmtSize(f.size) + ') ', el('a', { href: '#', textContent: '✕', onclick: e => { e.preventDefault(); files.splice(i, 1); drawChips(); } }))));
      }
      function addFile(name, type, buf) {
        if (total() + buf.byteLength > 20 << 20) { DK.toast('Os anexos somam no máximo 20 MB.'); return; }
        files.push({ name: name, type: type || 'application/octet-stream', data: b64(buf), size: buf.byteLength }); drawChips();
      }
      const upIn = el('input', { type: 'file', multiple: true }); upIn.style.display = 'none';
      upIn.onchange = async () => { for (const f of upIn.files) addFile(f.name, f.type, await f.arrayBuffer()); upIn.value = ''; };
      const bUp = el('button', { textContent: '📎 Do aparelho', onclick: () => upIn.click() });
      const bPick = el('button', { textContent: '📂 Meus arquivos', onclick: () => DK.pickFile('any', 'Anexar arquivo', async it => {
        if (it.type === 'dir') return;
        try { addFile(it.name, '', await DK.fetchFile(it, 'download')); } catch (e) { DK.toast(e.message); }
      }) });
      const bCc = el('button', { textContent: 'Cc/Cco', onclick: () => extra.classList.toggle('hidden') });
      const msg = el('span', { className: 'meta' });
      const send = el('button', { className: 'pri', textContent: '➤ Enviar' });
      send.onclick = async () => {
        const split = s => s.split(/[,;]/).map(x => x.trim()).filter(Boolean);
        if (!split(to.value).length && !split(cc.value).length && !split(bcc.value).length) { msg.textContent = 'Informe ao menos um destinatário.'; return; }
        if (!subject.value.trim() && !confirm('Enviar sem assunto?')) return;
        send.disabled = true; msg.textContent = 'Enviando…';
        try {
          const r = await DK.api('POST', '/mail/accounts/' + from.value + '/send', { to: split(to.value), cc: split(cc.value), bcc: split(bcc.value), subject: subject.value, text: text.value,
            in_reply_to: o.inReplyTo || '', references: o.references || '', attachments: files.map(f => ({ name: f.name, type: f.type, data: f.data })) });
          DK.toast(r.saved_copy === false ? 'Mensagem enviada (não consegui guardar a cópia em Enviados).' : 'Mensagem enviada.');
          if (ctx.sent) ctx.sent();
          DK.closeWin(win, true);
        } catch (e) { msg.textContent = e.message; send.disabled = false; }
      };
      win._beforeClose = () => (!text.value.trim() || confirm('Descartar esta mensagem?'));
      body.append(el('div', { className: 'tb' }, send, bUp, bPick, bCc, el('span', { className: 'sp' }), msg),
        el('div', { className: 'mcomp' }, el('label', {}, 'De', from), el('label', {}, 'Para', to), extra, el('label', {}, 'Assunto', subject), chips, text), upIn);
    }, 640, 560, { flush: true });
  };

  // ---------- ligar uma conta ----------
  DK.mailAccountDialog = function (cfg, done) {
    DK.openWindow('mailacc', 'Ligar conta de e-mail', (body, win) => {
      body.className = 'body';
      let tab = 'google', tabEdit = '';
      const tabs = el('div', { className: 'tb' });
      const main = el('div', { style: 'display:grid;gap:10px;align-content:start;padding:12px;overflow:auto;flex:1;min-height:0' });
      body.style.padding = '0'; body.append(tabs, main);
      const TABS = { google: '🟥 Gmail', microsoft: '🟦 Outlook / Microsoft', imap: '⚙️ Outro (IMAP/SMTP)' };
      Object.keys(TABS).forEach(k => { const b = el('button', { textContent: TABS[k], onclick: () => { tab = k; tabEdit = ''; draw(); } }); b.dataset.t = k; tabs.append(b); });
      const draw = () => { [].forEach.call(tabs.querySelectorAll('button'), b => b.classList.toggle('pri', b.dataset.t === tab)); main.replaceChildren(); (tab === 'imap' ? drawImap : drawOAuth)(); };

      // O aplicativo OAuth (ID do cliente) é de cada usuário: registrado aqui, guardado cifrado na conta dele no servidor.
      function drawApp(prov, name, after) {
        const app = (cfg.apps && cfg.apps[prov]) || {};
        const id = el('input', { placeholder: prov === 'google' ? '…apps.googleusercontent.com' : 'ID do aplicativo (cliente)', value: app.client_id || '', autocomplete: 'off' });
        const secret = el('input', { type: 'password', autocomplete: 'off', placeholder: app.has_secret ? '(guardada; deixe vazio para manter)' : (prov === 'google' ? 'Chave secreta do cliente' : 'Só se o aplicativo for "confidencial"') });
        const tenant = el('input', { placeholder: 'common (padrão), consumers, organizations ou o id do diretório', value: app.tenant || '' });
        const err = el('div', { className: 'err' });
        const save = el('button', { className: 'pri', textContent: 'Guardar meu aplicativo' });
        const help = prov === 'google'
          ? 'No Google Cloud (console.cloud.google.com): crie um projeto, ative a Gmail API e em Credenciais crie um “ID do cliente OAuth” do tipo Aplicativo para computador. Cole aqui o ID e a chave secreta.'
          : 'No portal do Azure (Microsoft Entra ID → Registros de aplicativo): registre um aplicativo, adicione a plataforma “Cliente público (móvel e desktop)” com o endereço de redirecionamento ' + cfg.redirect + ' e as permissões IMAP.AccessAsUser.All, SMTP.Send e offline_access. Cole aqui o ID do aplicativo.';
        save.onclick = async () => {
          err.textContent = ''; save.disabled = true;
          try { const r = await DK.api('PUT', '/mail/oauth/app', { provider: prov, client_id: id.value.trim(), client_secret: secret.value.trim(), tenant: prov === 'microsoft' ? tenant.value.trim() : '' }); cfg.apps = r.apps; after(); }
          catch (e) { err.textContent = e.message; save.disabled = false; }
        };
        const rm = el('button', { textContent: 'Remover', title: 'Apaga o seu aplicativo guardado; as contas ligadas por ele precisarão ser ligadas de novo' });
        rm.onclick = async () => {
          if (!confirm('Remover o seu aplicativo ' + (prov === 'google' ? 'do Google' : 'da Microsoft') + '? As contas ligadas por ele deixam de atualizar até você registrar o aplicativo de novo.')) return;
          try { await DK.api('DELETE', '/mail/oauth/app/' + prov); cfg.apps[prov] = { configured: false }; after(); } catch (e) { err.textContent = e.message; }
        };
        return el('div', { style: 'display:grid;gap:8px' }, el('div', { className: 'meta', textContent: help + ' O endereço de retorno é ' + cfg.redirect + '. Isto fica só na sua conta do Diogows.' }),
          el('label', {}, 'ID do cliente', id), el('label', {}, 'Chave secreta', secret), prov === 'microsoft' ? el('label', {}, 'Diretório (tenant), opcional', tenant) : '',
          el('div', { className: 'row' }, save, app.configured ? rm : ''), err);
      }

      function drawOAuth() {
        const prov = tab, name = prov === 'google' ? 'o Google' : 'a Microsoft';
        const err = el('div', { className: 'err' }), ok = el('div', { className: 'ok' });
        const email = el('input', { type: 'email', placeholder: prov === 'google' ? 'seu@gmail.com' : 'seu@outlook.com' });
        main.append(el('div', { className: 'meta', textContent: 'Entre com ' + name + ' sem dar a sua senha ao Diogows: o acesso pode ser revogado a qualquer momento na sua conta.' }));
        const mine = cfg.apps && cfg.apps[prov] && cfg.apps[prov].configured;
        if (!mine || tabEdit === prov) {
          if (!mine) main.append(el('div', { className: 'dwarn', textContent: 'Para entrar com ' + name + ' você usa o seu próprio aplicativo (é por usuário, não do servidor). Registre-o uma vez abaixo; se preferir não, use a aba Outro (IMAP/SMTP) com uma senha de app.' }));
          main.append(drawApp(prov, name, () => { tabEdit = ''; draw(); }));
          return;
        }
        const edit = el('button', { textContent: '⚙ Meu aplicativo', title: 'Ver, trocar ou remover o seu aplicativo OAuth', onclick: () => { tabEdit = prov; draw(); } });
        const go = el('button', { className: 'pri', textContent: 'Continuar' });
        const step2 = el('div', { className: 'hidden', style: 'display:grid;gap:8px' });
        const paste = el('textarea', { rows: 3, placeholder: 'http://localhost:8765/?code=…&state=…' });
        const fin = el('button', { className: 'pri', textContent: 'Concluir' });
        let state = '';
        go.onclick = async () => {
          err.textContent = '';
          try {
            const r = await DK.api('POST', '/mail/oauth/start', { provider: prov, email: email.value.trim() });
            state = r.state; window.open(r.url, '_blank', 'noopener');
            const auto = cfg.callback;
            step2.classList.remove('hidden'); go.disabled = true;
            step2.replaceChildren(auto
              ? el('div', { className: 'meta', textContent: 'Aceite o acesso na janela que abriu. Esta janela avisa quando terminar…' })
              : el('div', {}, el('div', { className: 'meta', textContent: 'Aceite o acesso na janela que abriu. No fim o navegador vai para um endereço que começa com ' + r.redirect + ' e mostra uma página de erro: é normal. Copie o endereço inteiro da barra do navegador e cole aqui:' }), paste, el('div', { className: 'row' }, fin)));
            if (auto) {
              const t = setInterval(async () => { try { const l = await DK.api('GET', '/mail/accounts'); if (l.some(a => a.email.toLowerCase() === email.value.trim().toLowerCase())) { clearInterval(t); DK.closeWin(win, true); done(); } } catch (e) { /* tenta de novo */ } }, 2500);
              win._onClose = () => clearInterval(t);
            }
          } catch (e) { err.textContent = e.message; }
        };
        fin.onclick = async () => {
          err.textContent = ''; ok.textContent = 'Ligando a conta…'; fin.disabled = true;
          try { await DK.api('POST', '/mail/oauth/finish', { state: state, redirect_url: paste.value.trim() }); DK.closeWin(win, true); done(); }
          catch (e) { ok.textContent = ''; err.textContent = e.message + ' (se o código expirou, comece outra vez)'; fin.disabled = false; }
        };
        main.append(el('label', {}, 'Seu e-mail', email), el('div', { className: 'row' }, go, edit), step2, ok, err);
      }

      function drawImap() {
        const err = el('div', { className: 'err' }), ok = el('div', { className: 'ok' });
        const f = {};
        const input = (k, ph, o) => (f[k] = el('input', Object.assign({ placeholder: ph }, o || {})));
        const sec = k => (f[k] = el('select', {}, el('option', { value: 'tls', textContent: 'TLS (porta 993/465)' }), el('option', { value: 'starttls', textContent: 'STARTTLS (143/587)' })));
        const note = el('div', { className: 'meta' });
        input('email', 'seu@exemplo.com', { type: 'email' }); input('label', 'Nome da conta (opcional)', { maxLength: 40 }); input('user', 'Usuário (se for diferente do e-mail)'); input('pass', 'Senha (ou senha de app)', { type: 'password' });
        input('ih', 'imap.exemplo.com'); input('ip', '993', { type: 'number', value: 993 }); sec('is');
        input('sh', 'smtp.exemplo.com'); input('sp', '465', { type: 'number', value: 465 }); sec('ss'); f.ss.value = 'tls';
        f.email.onchange = () => {
          const p = PRESETS.find(x => x.re.test(f.email.value.trim()));
          if (!p) { note.textContent = ''; return; }
          f.ih.value = p.imap; f.ip.value = 993; f.is.value = p.imapSec; f.sh.value = p.smtp; f.sp.value = p.smtpPort; f.ss.value = p.smtpSec; note.textContent = p.note;
        };
        f.ss.onchange = () => { f.sp.value = f.ss.value === 'tls' ? 465 : 587; };
        f.is.onchange = () => { f.ip.value = f.is.value === 'tls' ? 993 : 143; };
        const go = el('button', { className: 'pri', textContent: 'Ligar conta' });
        go.onclick = async () => {
          err.textContent = ''; ok.textContent = 'Conferindo o login (IMAP e SMTP)…'; go.disabled = true;
          try {
            await DK.api('POST', '/mail/accounts', { label: f.label.value, email: f.email.value, username: f.user.value, password: f.pass.value,
              imap_host: f.ih.value, imap_port: +f.ip.value, imap_sec: f.is.value, smtp_host: f.sh.value, smtp_port: +f.sp.value, smtp_sec: f.ss.value });
            DK.closeWin(win, true); done();
          } catch (e) { ok.textContent = ''; err.textContent = e.message; go.disabled = false; }
        };
        main.append(el('div', { className: 'meta', textContent: 'Só conexões criptografadas (TLS ou STARTTLS). A senha fica cifrada no servidor.' }),
          el('label', {}, 'E-mail', f.email), note, el('label', {}, 'Nome', f.label), el('label', {}, 'Usuário', f.user), el('label', {}, 'Senha', f.pass),
          el('b', { textContent: 'Receber (IMAP)' }), el('div', { className: 'row' }, f.ih, f.ip, f.is),
          el('b', { textContent: 'Enviar (SMTP)' }), el('div', { className: 'row' }, f.sh, f.sp, f.ss),
          el('div', { className: 'row' }, go), ok, err);
      }
      draw();
    }, 560, 520);
  };

})(window.DK = window.DK || {});
