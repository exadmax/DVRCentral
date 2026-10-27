(function (DK) {
  // Mensagens: conversa um a um entre os usuários do Desktop, com envio de arquivos e imagens (/api/desk/chat). Enquanto o Desktop
  // estiver aberto, consulta o servidor a cada poucos segundos: atualiza a conversa aberta e avisa (sino, aviso na tela e som) das
  // mensagens novas de quem não está na conversa aberta.
  const el = DK.el;
  const KEY = 'messages', POLL_MS = 3000;
  const chat = DK.chat = { peers: [], timer: 0, busy: false, open: null };

  const url = (m, mode) => '/api/desk/chat/file?id=' + m.id + (mode ? '&mode=' + mode : '');
  const hhmm = t => new Date(t * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dayLabel = t => {
    const d = new Date(t * 1000), n = new Date(), y = new Date(Date.now() - 864e5);
    return d.toDateString() === n.toDateString() ? 'Hoje' : d.toDateString() === y.toDateString() ? 'Ontem' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  // Envio com barra de progresso (o fetch não informa o andamento do upload).
  function uploadFile(to, file, text, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/api/desk/chat/upload?to=' + to + '&name=' + encodeURIComponent(file.name || 'arquivo') + (text ? '&text=' + encodeURIComponent(text) : ''));
      x.setRequestHeader('X-Desk', '1');
      x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let data = null;
        try { data = JSON.parse(x.responseText); } catch (e) { /* corpo vazio */ }
        if (x.status >= 200 && x.status < 300) resolve(data); else reject(new Error((data && data.error) || ('erro ' + x.status)));
      };
      x.onerror = () => reject(new Error('falha de rede'));
      x.send(file);
    });
  }

  // ---------- consulta periódica ----------
  const unreadTotal = () => chat.peers.reduce((n, p) => n + p.unread, 0);
  const windowVisible = () => { const w = DK.wins[KEY]; return !!w && !w.classList.contains('min') && !document.hidden; };

  async function tick() {
    if (chat.busy || !DK.me) return;
    chat.busy = true;
    try {
      // A conversa aberta lê primeiro (marca como lidas); só depois a lista, para não avisar do que já está na tela.
      if (chat.open && windowVisible()) await chat.open.refresh();
      const peers = await DK.api('GET', '/chat/peers');
      const before = {};
      chat.peers.forEach(p => { before[p.id] = p.unread; });
      peers.forEach(p => {
        const seen = chat.open && chat.open.peer === p.id && windowVisible();
        if (p.unread > (before[p.id] || 0) && !seen) {
          DK.notify({ title: '💬 ' + p.username, text: p.preview + (p.unread > 1 ? '  (+' + (p.unread - 1) + ')' : ''), color: '#25a55f', onclick: () => DK.messagesApp(p.id) });
        }
      });
      chat.peers = peers;
      if (chat.open) chat.open.drawPeers();
    } catch (e) { /* sem rede ou sessão expirada: o próximo ciclo tenta de novo */ }
    chat.busy = false;
  }
  chat.start = function () { chat.stop(); tick(); chat.timer = setInterval(tick, POLL_MS); };
  chat.stop = function () { clearInterval(chat.timer); chat.timer = 0; chat.peers = []; chat.open = null; };

  // ---------- janela ----------
  DK.messagesApp = function (openWith) {
    const existing = DK.wins[KEY];
    DK.openWindow(KEY, 'Mensagens', (body, win) => {
      body.className = 'body flush';
      let cur = null, lastId = 0, readUpto = 0, msgs = [], sending = false;   // lastId: último id trazido pelo servidor (as minhas ficam de fora)
      const side = el('div', { className: 'chat-side' });
      const head = el('div', { className: 'chat-head', textContent: 'Escolha uma conversa' });
      const list = el('div', { className: 'cmsgs' });
      const status = el('div', { className: 'status' });
      const ta = el('textarea', { placeholder: 'Escreva uma mensagem…', rows: 1, maxLength: 4000 });
      const attach = el('button', { textContent: '📎', title: 'Enviar arquivo ou imagem', type: 'button' });
      const file = el('input', { type: 'file', multiple: true }); file.style.display = 'none';
      const send = el('button', { className: 'pri', textContent: 'Enviar', type: 'button' });
      const input = el('div', { className: 'cin hidden' }, attach, ta, send, file);
      const main = el('div', { className: 'chat-main' }, head, list, status, input);
      body.append(el('div', { className: 'chat' }, side, main));

      function drawPeers() {
        side.replaceChildren(el('div', { className: 'meta', style: 'padding:8px 10px', textContent: 'Usuários' }));
        if (!chat.peers.length) side.append(el('div', { className: 'meta', style: 'padding:8px 10px', textContent: 'Não há outros usuários. O administrador cria contas em Usuários.' }));
        chat.peers.slice().sort((a, b) => (b.unread > 0) - (a.unread > 0) || b.last_at - a.last_at || a.username.localeCompare(b.username)).forEach(p => {
          const b = el('button', { className: 'peer' + (cur && cur.id === p.id ? ' on' : ''), onclick: () => select(p) }, el('span', { className: 'av', textContent: p.username.charAt(0).toUpperCase() }), el('span', { className: 'pn', textContent: p.username }));
          if (p.unread) b.append(el('b', { className: 'badge', textContent: p.unread }));
          side.append(b);
        });
      }

      function bubble(m) {
        const mine = m.from === DK.me.id;
        const b = el('div', { className: 'bub ' + (mine ? 'me' : 'them') });
        if (m.file) {
          if (m.file.image) {
            const img = el('img', { src: url(m, 'view'), alt: m.file.name, loading: 'lazy', title: 'Abrir', onclick: () => window.open(url(m, 'view'), '_blank', 'noopener') });
            b.append(img);
          }
          const row = el('div', { className: 'fil' }, el('span', { textContent: m.file.image ? '🖼️' : '📄' }),
            el('a', { href: url(m), textContent: m.file.name, download: m.file.name, title: 'Baixar' }), el('span', { className: 'meta', textContent: DK.fmtSize(m.file.size) }));
          if (!mine) row.append(el('button', { textContent: '💾', title: 'Salvar em Meus arquivos (pasta Recebidos)', onclick: async e => {
            e.target.disabled = true;
            try { const r = await DK.api('POST', '/chat/save', { id: m.id }); DK.toast('Salvo em Meus arquivos' + r.path); } catch (x) { DK.toast(x.message); }
            e.target.disabled = false;
          } }));
          b.append(row);
        }
        if (m.text) b.append(el('div', { className: 'tx', textContent: m.text }));
        const info = el('div', { className: 'meta tm', textContent: hhmm(m.at) });
        if (mine) {
          const tick = el('span', { className: 'tk', textContent: m.id <= readUpto ? ' ✓✓' : ' ✓', title: m.id <= readUpto ? 'Lida' : 'Enviada' });
          if (m.id <= readUpto) tick.classList.add('seen');
          info.append(tick, el('button', { className: 'x', textContent: '🗑', title: 'Apagar para os dois', onclick: async () => {
            if (!confirm('Apagar esta mensagem para os dois?')) return;
            try { await DK.api('DELETE', '/chat/messages/' + m.id); msgs = msgs.filter(x => x.id !== m.id); draw(); } catch (e) { DK.toast(e.message); }
          } }));
        }
        b.append(info);
        return b;
      }

      function draw(stick) {
        const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        list.replaceChildren();
        if (!msgs.length) list.append(el('div', { className: 'meta', style: 'padding:14px;text-align:center', textContent: 'Nenhuma mensagem ainda. Diga olá, ou arraste um arquivo ou imagem para cá.' }));
        let day = '';
        msgs.forEach(m => {
          const d = dayLabel(m.at);
          if (d !== day) { day = d; list.append(el('div', { className: 'dsep', textContent: d })); }
          list.append(bubble(m));
        });
        if (stick || near) list.scrollTop = list.scrollHeight;
      }

      // Traz o que há de novo na conversa aberta (a primeira chamada traz as mais recentes).
      async function refresh() {
        if (!cur) return;
        const peer = cur.id;
        try {
          const r = await DK.api('GET', '/chat/messages?with=' + peer + (lastId ? '&after=' + lastId : ''));
          if (!cur || cur.id !== peer) return;                      // trocou de conversa durante o pedido
          const got = r.messages || [], first = !lastId, seenBefore = readUpto;
          readUpto = r.read_upto || 0;
          if (got.length) lastId = got[got.length - 1].id;
          const fresh = got.filter(m => !msgs.some(x => x.id === m.id));
          if (fresh.length) msgs = msgs.concat(fresh).sort((a, b) => a.id - b.id);
          if (fresh.length || readUpto !== seenBefore) draw(first);
          const p = chat.peers.filter(x => x.id === peer)[0]; if (p) p.unread = 0;
          status.textContent = '';
        } catch (e) { status.textContent = e.message; }
      }

      async function select(p) {
        cur = p; lastId = 0; readUpto = 0; msgs = [];
        head.textContent = '💬 ' + p.username;
        input.classList.remove('hidden');
        list.replaceChildren();
        drawPeers();
        await refresh();
        ta.focus();
      }

      // Mensagem que acabei de enviar: entra na tela já; se a consulta periódica a trouxe antes, não duplica.
      function addOwn(m) {
        if (!msgs.some(x => x.id === m.id)) msgs = msgs.concat(m).sort((a, b) => a.id - b.id);
        draw(true);
      }

      async function sendText() {
        const text = ta.value.trim();
        if (!cur || !text || sending) return;
        sending = true; send.disabled = true;
        try {
          const m = await DK.api('POST', '/chat/send?to=' + cur.id, { text: text });
          ta.value = ''; autosize();
          addOwn(m);
        } catch (e) { status.textContent = e.message; }
        sending = false; send.disabled = false; ta.focus();
      }

      async function sendFiles(files) {
        if (!cur || !files.length) return;
        const peer = cur;
        for (const f of files) {
          const caption = files.length === 1 ? ta.value.trim() : '';
          try {
            status.textContent = 'Enviando ' + f.name + '…';
            const m = await uploadFile(peer.id, f, caption, pct => { status.textContent = 'Enviando ' + f.name + ' — ' + Math.round(pct * 100) + '%'; });
            if (files.length === 1) { ta.value = ''; autosize(); }
            if (cur === peer) addOwn(m);
            status.textContent = '';
          } catch (e) { status.textContent = f.name + ': ' + e.message; return; }
        }
      }

      function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(110, ta.scrollHeight + 2) + 'px'; }
      send.onclick = sendText;
      ta.oninput = autosize;
      ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendText(); } };
      attach.onclick = () => file.click();
      file.onchange = () => { sendFiles([].slice.call(file.files)); file.value = ''; };
      // Colar uma imagem da área de transferência (print de tela) envia como arquivo.
      ta.addEventListener('paste', e => {
        const fs = [].slice.call((e.clipboardData && e.clipboardData.files) || []);
        if (fs.length) { e.preventDefault(); sendFiles(fs.map((f, i) => f.name && f.name !== 'image.png' ? f : new File([f], 'imagem-' + Date.now() + (i ? '-' + i : '') + '.' + ((f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')), { type: f.type }))); }
      });
      main.ondragover = e => { if (cur && e.dataTransfer && [].indexOf.call(e.dataTransfer.types, 'Files') >= 0) { e.preventDefault(); main.classList.add('on'); } };
      main.ondragleave = e => { if (!main.contains(e.relatedTarget)) main.classList.remove('on'); };
      main.ondrop = e => { main.classList.remove('on'); if (cur && e.dataTransfer.files.length) { e.preventDefault(); sendFiles([].slice.call(e.dataTransfer.files)); } };

      chat.open = {
        get peer() { return cur ? cur.id : 0; },
        refresh: refresh, drawPeers: drawPeers,
        select: id => { const p = chat.peers.filter(x => x.id === id)[0]; if (p) select(p); },
      };
      win._onClose = () => { chat.open = null; };
      drawPeers();
      (async () => {
        await tick();
        drawPeers();
        if (openWith) chat.open.select(openWith);
      })();
    }, 700, 500, { flush: true });
    // Janela que já estava aberta: só vai para a conversa pedida (ex.: clique no aviso).
    if (existing && openWith && chat.open) chat.open.select(openWith);
  };

  DK.register({ id: 'messages', icon: '💬', label: 'Mensagens', desktop: true, open: () => DK.messagesApp() });
})(window.DK = window.DK || {});
