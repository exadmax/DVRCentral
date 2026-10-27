(function (DK) {
  // Núcleo do Diogows: pedidos à API (/api/desk), janelas, diálogos de senha e o desbloqueio do computador (Terminal, arquivos, sudo).
  // Texto da interface só em português (o resto do painel é traduzido; o Diogows é uma interface de uso do administrador da casa).
  const $ = id => document.getElementById(id);
  DK.$ = $;
  DK.me = null;       // usuário logado
  DK.apps = [];       // aplicativos registrados (menu Iniciar e ícones)

  // ---------- utilidades ----------
  DK.el = function (tag, props) {
    const e = document.createElement(tag);
    if (props) Object.assign(e, props);
    for (let i = 2; i < arguments.length; i++) e.append(arguments[i]);
    return e;
  };
  DK.esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  DK.fmtSize = n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(1) + ' GB');
  DK.fmtDate = t => (t ? new Date(t * 1000).toLocaleString('pt-BR') : '');
  DK.extOf = name => (String(name).match(/\.[^.\/]+$/) || [''])[0].toLowerCase();
  DK.baseName = p => String(p).replace(/\/+$/, '').split('/').pop() || '/';
  DK.joinPath = (dir, name) => (dir === '/' ? '' : dir) + '/' + name;

  DK.toast = function (msg) {
    const t = DK.el('div', { className: 'toast', textContent: msg });
    document.body.append(t);
    setTimeout(() => t.remove(), 4000);
  };

  DK.copyText = async function (text) {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return; }
    const ta = DK.el('textarea', { value: text });          // em HTTP (rede local) a API de área de transferência não existe
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  };

  // ---------- API ----------
  // Erros viram Error com a mensagem do servidor e .status. Corpo cru (envio de arquivo) vai com raw=true.
  DK.api = async function (method, path, body, raw) {
    const opt = { method: method, headers: { 'X-Desk': '1' }, credentials: 'same-origin' };
    if (raw) opt.body = body;
    else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch('/api/desk' + path, opt);
    let data = null;
    try { data = await r.json(); } catch (e) { /* corpo vazio */ }
    if (!r.ok) {
      const e = new Error((data && data.error) || ('erro ' + r.status));
      e.status = r.status;
      throw e;
    }
    return data;
  };
  // Pedido a um endereço do hub fora de /api/desk (contatos, câmeras...). Escritas levam JSON, como a API exige.
  DK.hub = async function (method, path, body) {
    const opt = { method: method, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    const r = await fetch(path, opt);
    if (r.status === 204) return null;
    let data = null;
    try { data = await r.json(); } catch (e) { /* corpo vazio */ }
    if (!r.ok) throw new Error((data && data.error) || ('erro ' + r.status));
    return data;
  };
  // URL de um arquivo para <img>, <iframe>, <video> ou download. it = { space, path, sudo }.
  DK.fileUrl = (it, mode) => '/api/desk/fs/read?space=' + it.space + '&path=' + encodeURIComponent(it.path) + '&mode=' + mode + (it.sudo ? '&sudo=1' : '');

  // ---------- janelas ----------
  let z = 10, newDocSeq = 0;
  const wins = {};
  DK.wins = wins;
  DK.nextDocId = () => ++newDocSeq;

  function resizeHandle(win, dir) {
    const h = DK.el('div', { className: 'rz ' + dir });
    h.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); focusWin(win);
      const r0 = { l: win.offsetLeft, t: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight, x: e.clientX, y: e.clientY };
      h.setPointerCapture(e.pointerId); win.classList.add('dragging');
      const mv = ev => {
        const dx = ev.clientX - r0.x, dy = ev.clientY - r0.y;
        let l = r0.l, t = r0.t, w = r0.w, hh = r0.h;
        if (dir.indexOf('e') >= 0) w = Math.max(300, r0.w + dx);
        if (dir.indexOf('s') >= 0) hh = Math.max(170, r0.h + dy);
        if (dir.indexOf('w') >= 0) { w = Math.max(300, r0.w - dx); l = r0.l + (r0.w - w); }
        if (dir.indexOf('n') >= 0) { hh = Math.max(170, r0.h - dy); t = Math.max(0, r0.t + (r0.h - hh)); }
        win.style.left = l + 'px'; win.style.top = t + 'px'; win.style.width = w + 'px'; win.style.height = hh + 'px';
      };
      const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); win.classList.remove('dragging'); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
    });
    return h;
  }

  // Abre uma janela (ou traz a que já existe com a mesma chave). build(body, win) monta o conteúdo.
  DK.openWindow = function (key, title, build, w, h, opts) {
    opts = opts || {};
    if (wins[key]) { restoreWin(wins[key]); return wins[key]; }
    const win = DK.el('div', { className: 'win' });
    const body = DK.el('div', { className: 'body' + (opts.flush ? ' flush' : '') });
    const bMin = DK.el('button', { textContent: '—', title: 'Minimizar' });
    const bMax = DK.el('button', { className: 'bmax', textContent: '☐', title: 'Maximizar / restaurar' });
    const close = DK.el('button', { textContent: '✕', title: 'Fechar' });
    const titleEl = DK.el('b', { textContent: title });
    const head = DK.el('header', {}, titleEl, bMin, bMax, close);
    win.append(head, body);
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(d => win.append(resizeHandle(win, d)));
    const n = Object.keys(wins).length;
    const W = Math.min(w || 480, innerWidth - 20), H = Math.min(h || 420, innerHeight - 70);
    win.style.cssText = 'left:' + Math.min(130 + (n % 8) * 26, Math.max(0, innerWidth - W)) + 'px;top:' + (20 + (n % 8) * 26) + 'px;width:' + W + 'px;height:' + H + 'px';
    if (DK.layout.isMobile()) win.classList.add('max');      // celular: janela em tela cheia (o CSS do modo celular também garante)
    $('desktop').append(win);
    const task = DK.el('button', { textContent: title, onclick: () => taskClick(win) });
    $('tasks').append(task);
    win._task = task; win._key = key;
    win.setTitle = t => { titleEl.textContent = t; task.textContent = t; };
    wins[key] = win;
    close.onclick = () => closeWin(win);
    bMin.onclick = e => { e.stopPropagation(); minimizeWin(win); };
    const toggleMax = () => { const m = win.classList.toggle('max'); bMax.textContent = m ? '❐' : '☐'; };
    bMax.onclick = e => { e.stopPropagation(); toggleMax(); };
    head.addEventListener('dblclick', e => { if (e.target.tagName !== 'BUTTON') toggleMax(); });
    if (win.classList.contains('max')) bMax.textContent = '❐';
    // botão direito / toque longo: menus da janela (o resto do corpo da janela fica sem menu do Diogows, só o do navegador some)
    head._ctx = () => [
      { icon: win.classList.contains('max') ? '🗗' : '🗖', label: win.classList.contains('max') ? 'Restaurar' : 'Maximizar', fn: toggleMax },
      { icon: '🗕', label: 'Minimizar', fn: () => minimizeWin(win) },
      '-', { icon: '✕', label: 'Fechar', fn: () => closeWin(win), danger: true },
    ];
    task._ctx = () => [
      { icon: '🗗', label: win.classList.contains('min') ? 'Restaurar' : 'Minimizar', fn: () => taskClick(win) },
      '-', { icon: '✕', label: 'Fechar', fn: () => closeWin(win), danger: true },
    ];
    win._ctx = () => false;
    win.addEventListener('mousedown', () => focusWin(win));
    let dx, dy, drag = false;
    head.addEventListener('pointerdown', e => {
      if (e.target.tagName === 'BUTTON' || win.classList.contains('max') || DK.layout.isMobile()) return;
      drag = true; dx = e.clientX - win.offsetLeft; dy = e.clientY - win.offsetTop; head.setPointerCapture(e.pointerId); win.classList.add('dragging');
    });
    head.addEventListener('pointermove', e => { if (drag) { win.style.left = Math.max(0, e.clientX - dx) + 'px'; win.style.top = Math.max(0, e.clientY - dy) + 'px'; } });
    head.addEventListener('pointerup', () => { drag = false; win.classList.remove('dragging'); });
    focusWin(win);
    build(body, win);
    return win;
  };
  function focusWin(w) {
    w.style.zIndex = ++z;
    Object.keys(wins).forEach(k => wins[k]._task.classList.toggle('act', wins[k] === w));
  }
  function minimizeWin(w) { w.classList.add('min'); w._task.classList.add('mini'); w._task.classList.remove('act'); }
  function restoreWin(w) { w.classList.remove('min'); w._task.classList.remove('mini'); focusWin(w); }
  function taskClick(w) {
    if (w.classList.contains('min')) restoreWin(w);
    else if (w._task.classList.contains('act')) minimizeWin(w);
    else focusWin(w);
  }
  function closeWin(w, force) {
    if (!force && w._beforeClose && w._beforeClose() === false) return;
    if (w._onClose) w._onClose();
    w._task.remove(); w.remove(); delete wins[w._key];
  }
  DK.closeWin = closeWin;
  DK.closeAll = () => Object.keys(wins).forEach(k => closeWin(wins[k], true));
  DK.minimizeAll = () => Object.keys(wins).forEach(k => minimizeWin(wins[k]));

  // ---------- diálogo de senha ----------
  // Pede senha (e, se askUser, o nome do usuário). Resolve { user, password }; rejeita com "Cancelado." se a pessoa desistir.
  DK.askCredentials = function (o) {
    return new Promise((resolve, reject) => {
      const ov = DK.el('div', { className: 'overlay' });
      const user = DK.el('input', { placeholder: o.userLabel || 'Administrador', autocomplete: 'username' });
      const pw = DK.el('input', { type: 'password', placeholder: o.passLabel || 'Senha', autocomplete: 'current-password' });
      const ok = DK.el('button', { className: 'pri', textContent: o.okLabel || 'Liberar' }), no = DK.el('button', { type: 'button', textContent: 'Cancelar' });
      const kids = [DK.el('h1', { textContent: o.title || '🔐 Confirmar senha' }), DK.el('div', { textContent: o.message })];
      if (o.askUser) kids.push(user);
      kids.push(pw, DK.el('div', { className: 'err', textContent: o.error || '' }), DK.el('div', { className: 'row' }, ok, no));
      const form = DK.el('form', { className: 'card' });
      form.append.apply(form, kids);
      ov.append(form); document.body.append(ov);
      (o.askUser ? user : pw).focus();
      no.onclick = () => { ov.remove(); reject(new Error('Cancelado.')); };
      form.onsubmit = e => { e.preventDefault(); ov.remove(); resolve({ user: user.value.trim(), password: pw.value }); };
    });
  };

  // ---------- acesso ao computador (Terminal, arquivos do computador, sudo) ----------
  DK.shellStatus = () => DK.api('GET', '/shell/status');

  // Garante o acesso ao computador: confere o que o servidor permite e, se preciso, pede a SENHA DA PESSOA (vale alguns minutos).
  DK.ensureMachine = async function (what) {
    const st = await DK.shellStatus();
    if (!st.enabled) throw new Error('Terminal e arquivos do computador estão desligados neste servidor (hub.config.json: "desk": {"shell": true}).');
    if (!(what === 'terminal' ? st.terminal : st.explorer)) throw new Error('Você não tem permissão para isto. Peça ao administrador.');
    if (!st.network_ok) throw new Error('Por segurança, isto só funciona pela rede local ou por HTTPS; esta conexão vem de fora da rede privada em HTTP puro.');
    if (st.unlocked) return st;
    let error = '';
    for (;;) {
      const c = await DK.askCredentials({ message: 'Digite a SUA senha para liberar o acesso ao computador. A liberação vale ' + st.ttl_minutes + ' minutos.', error: error });
      try { await DK.api('POST', '/shell/unlock', { password: c.password }); return DK.shellStatus(); }
      catch (e) { if (e.status !== 401) throw e; error = 'Senha incorreta.'; }
    }
  };

  // Garante o sudo: pede a senha de um administrador (a própria, se a pessoa for administradora).
  DK.ensureSudo = async function (what) {
    let st = await DK.ensureMachine(what);
    if (st.sudo_unlocked) return st;
    if (!st.sudo_available) throw new Error('O sudo só existe no Linux do servidor.');
    let error = '';
    for (;;) {
      const c = await DK.askCredentials({
        title: '🔐 sudo (root)', askUser: !st.is_admin, error: error,
        message: st.is_admin ? 'Digite a sua senha de administrador para usar o sudo (root). Vale ' + st.ttl_minutes + ' minutos.'
          : 'O sudo executa como root e pede a senha de um ADMINISTRADOR. Informe o usuário e a senha dele. Vale ' + st.ttl_minutes + ' minutos.'
      });
      try { await DK.api('POST', '/shell/sudo', { admin: c.user, password: c.password }); return DK.shellStatus(); }
      catch (e) { if (e.status !== 401) throw e; error = 'Administrador ou senha incorretos.'; }
    }
  };

  // Roda fn(); se o servidor disser que o acesso expirou (locked / sudo_locked), pede de novo e repete uma vez.
  DK.withUnlock = async function (what, sudo, fn) {
    try { return await fn(); }
    catch (e) {
      if (e.message === 'sudo_locked') { await DK.ensureSudo(what); return fn(); }
      if (e.message === 'locked') { await (sudo ? DK.ensureSudo(what) : DK.ensureMachine(what)); return fn(); }
      throw e;
    }
  };

  // ---------- preferências do usuário (no servidor: acompanham a pessoa em qualquer aparelho) ----------
  DK.prefs = {};
  let prefsTimer = 0;
  DK.loadPrefs = async () => { try { DK.prefs = await DK.api('GET', '/prefs'); } catch (e) { DK.prefs = {}; } };
  DK.savePrefs = () => { clearTimeout(prefsTimer); prefsTimer = setTimeout(() => DK.api('PUT', '/prefs', DK.prefs).catch(() => {}), 400); };

  // ---------- notificações (sino da barra, avisos na tela, som e, se permitido, avisos do navegador) ----------
  DK.notifs = [];
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.12;
      o.connect(g); g.connect(ctx.destination); o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 260);
    } catch (e) { /* sem áudio: só o aviso visual */ }
  }
  function drawBell() {
    const n = DK.notifs.filter(x => !x.read).length, b = $('bellN');
    b.textContent = n; b.classList.toggle('hidden', !n);
  }
  // n: { title, text, color, onclick }
  DK.notify = function (n) {
    n.time = new Date(); n.read = false;
    DK.notifs.unshift(n);
    if (DK.notifs.length > 50) DK.notifs.pop();
    drawBell();
    let box = $('toasts');
    if (!box) { box = DK.el('div', { id: 'toasts' }); document.body.append(box); }
    const t = DK.el('div', { className: 'toast' }, DK.el('b', { textContent: n.title }), DK.el('div', { textContent: n.text || '' }));
    t.style.borderLeftColor = n.color && n.color.charAt(0) === '#' ? n.color : '#4DA3FF';
    t.onclick = () => { t.remove(); n.read = true; drawBell(); if (n.onclick) n.onclick(); };
    box.append(t);
    setTimeout(() => t.remove(), 15000);
    if (DK.prefs.sound !== false) beep();
    if (DK.prefs.browser && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(n.title, { body: n.text || '' }); } catch (e) { /* alguns navegadores exigem ServiceWorker */ }
    }
  };
  DK.toggleNotifs = function () {
    let p = $('notifs');
    if (p) { p.remove(); return; }
    p = DK.el('div', { id: 'notifs' });
    const clear = DK.el('button', { textContent: 'Limpar', onclick: () => { DK.notifs = []; drawBell(); p.remove(); } });
    p.append(DK.el('header', {}, 'Notificações', clear));
    if (!DK.notifs.length) p.append(DK.el('div', { className: 'meta', style: 'padding:14px', textContent: 'Nenhuma notificação.' }));
    DK.notifs.forEach(n => {
      const i = DK.el('i'); i.style.background = n.color || '#4DA3FF';
      p.append(DK.el('div', { className: 'n', onclick: () => { p.remove(); if (n.onclick) n.onclick(); } }, i,
        DK.el('b', { textContent: n.title }), DK.el('span', { className: 'meta', textContent: (n.text ? n.text + ' · ' : '') + n.time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) })));
      n.read = true;
    });
    document.body.append(p);
    drawBell();
  };
  document.addEventListener('mousedown', e => { const p = $('notifs'); if (p && !p.contains(e.target) && !$('bell').contains(e.target)) p.remove(); });

  // ---------- registro de aplicativos ----------
  // { id, icon, label, open(), desktop: mostra ícone na área de trabalho, show(me): quem enxerga, group: 0 ou 1 (separador no menu) }
  DK.register = app => DK.apps.push(app);
  DK.openApp = id => { const a = DK.apps.filter(x => x.id === id)[0]; if (a) a.open(); };
})(window.DK = window.DK || {});
