(function (DK) {
  // Ciclo de sessão do Diogows: login, troca obrigatória de senha, menu Iniciar, ícones, relógio e os atalhos do painel da casa.
  const $ = DK.$, el = DK.el;
  DK.links = [];

  // ---------- atalhos do painel (Jogos/WebRCade, Música/Navidrome e os demais) ----------
  // Mesma lista e mesma regra de endereço do rodapé do painel (widgets/links.js): settings.js + o menu salvo na Config. Nada é removido
  // nem duplicado: aqui eles só ganham um lugar no Iniciar e na área de trabalho.
  const LINK_ICONS = { gamepad: '🎮', music: '🎵', fridge: '🧊', phone: '📞', camera: '📷', film: '🎬', book: '📚', gear: '⚙️', link: '🔗' };
  function linkHref(l) {
    const host = location.protocol + '//' + location.hostname;
    const origin = l.port ? host + ':' + l.port : location.origin;
    return origin + String(l.path || '/').replace('{host}', host);
  }
  const isExternal = l => !!l.port || !/\.html(\?|$)/.test(l.path || '');
  const isDesktopLink = l => !l.port && /^\/desktop\.html/.test(l.path || '');

  async function loadLinks() {
    let cfg = {};
    try { cfg = CD.util.deepMerge(JSON.parse(JSON.stringify(window.CD_SETTINGS || {})), window.CD_SETTINGS_LOCAL); } catch (e) { cfg = window.CD_SETTINGS || {}; }
    let links = cfg.links || [], booksOff = cfg.books && cfg.books.enabled === false;
    try { const m = await DK.hub('GET', '/api/settings/menu'); if (m && m.links) links = m.links; } catch (e) { /* hub sem a rota: vale o padrão */ }
    try { const p = await DK.hub('GET', '/api/settings/panel'); if (p && p.books && p.books.enabled === false) booksOff = true; } catch (e) { /* idem */ }
    DK.links = links.filter(l => !isDesktopLink(l) && !(booksOff && /\/livros\.html$/.test(l.path || '')));
  }
  const openLink = l => window.open(linkHref(l), '_blank', 'noopener');

  // ---------- menu Iniciar e ícones ----------
  // Ordem dos itens dentro de cada categoria (o que não está na lista vai para o fim, em ordem alfabética). A ordem das categorias é a de CATS.
  const MENU_ORDER = ['explorer', 'computer', 'control', 'programs', 'zip', 'terminal',
    'mail', 'messages', 'calendar', 'contacts',
    'docs', 'sheets', 'slides', 'officefull', 'pdf', 'notepad', 'calculator',
    'browser',
    'images', 'paint', 'video', 'music', 'cameras',
    'solitaire', 'freecell', 'minesweeper', 'emulators',
    'users', 'config', 'updates', 'account'];
  const ICON_ORDER = ['computer', 'control', 'explorer', 'mail', 'paint', 'browser', 'programs', 'docs', 'sheets', 'slides', 'cameras', 'contacts', 'messages', 'calendar', 'video', 'terminal'];
  // Categorias do menu Iniciar, da mais usada à menos. Um aplicativo cai na primeira categoria que o reconhece (por id); o que sobrar vai para "Outros".
  const inIds = ids => a => ids.indexOf(a.id) >= 0;
  const CATS = [
    { id: 'files', icon: '🗂️', label: 'Arquivos e sistema', match: inIds(['explorer', 'computer', 'control', 'programs', 'zip', 'terminal']) },
    { id: 'comm', icon: '✉️', label: 'Comunicação', match: inIds(['mail', 'messages', 'calendar', 'contacts']) },
    { id: 'office', icon: '📝', label: 'Escritório', match: inIds(['docs', 'sheets', 'slides', 'officefull', 'pdf', 'notepad', 'calculator']) },
    { id: 'net', icon: '🌐', label: 'Internet', match: inIds(['browser']) },
    { id: 'media', icon: '🎞️', label: 'Imagem, vídeo e música', match: inIds(['images', 'paint', 'video', 'music', 'cameras']) },
    { id: 'games', icon: '🎮', label: 'Jogos', match: inIds(['solitaire', 'freecell', 'minesweeper', 'emulators']) },
    { id: 'progs', icon: '🕹️', label: 'Meus programas (DOS, Windows e web)', match: a => String(a.id).indexOf('prog:') === 0 },
    { id: 'house', icon: '🏠', label: 'Painel e serviços da casa', match: a => String(a.id).indexOf('link:') === 0 },
    { id: 'admin', icon: '🛠️', label: 'Administração e conta', match: inIds(['users', 'config', 'updates', 'account']) },
  ];
  const DEFAULT_OPEN = ['files', 'comm', 'office'];
  // Lista de categorias do menu. all=false devolve só as que servem para guardar programas instalados (sem "Painel da casa" nem "Administração").
  function menuCategories(all) {
    const custom = (Array.isArray(DK.prefs.startCats) ? DK.prefs.startCats : []).filter(c => c && c.id && c.label).map(c => ({ id: c.id, icon: c.icon || '📁', label: c.label, custom: true, match: () => false }));
    const list = [];
    CATS.forEach(c => { list.push(c); if (c.id === 'games') list.push(...custom); });
    return all ? list : list.filter(c => c.id !== 'house' && c.id !== 'admin');
  }
  DK.menuCategories = () => menuCategories(false);
  // Cria uma categoria nova do menu Iniciar (fica nas preferências da conta). Devolve o id.
  DK.addMenuCategory = function (label, icon) {
    label = String(label || '').trim().slice(0, 30);
    if (!label) throw new Error('Dê um nome à categoria.');
    const list = Array.isArray(DK.prefs.startCats) ? DK.prefs.startCats : (DK.prefs.startCats = []);
    const dup = menuCategories(true).find(c => c.label.toLowerCase() === label.toLowerCase());
    if (dup) return dup.id;                       // mesmo nome: reaproveita
    if (list.length >= 12) throw new Error('No máximo 12 categorias criadas por você.');
    const id = 'c-' + Math.random().toString(36).slice(2, 8);
    list.push({ id: id, label: label, icon: String(icon || '').trim().slice(0, 4) || '📁' });
    const open = Array.isArray(DK.prefs.startOpen) ? DK.prefs.startOpen : DEFAULT_OPEN.slice();
    DK.prefs.startOpen = open.concat(id);        // a categoria nova já aparece aberta
    DK.savePrefs();
    return id;
  };
  const linkApps = () => DK.links.map(l => ({ id: 'link:' + l.label, icon: LINK_ICONS[l.icon] || '🔗', label: l.label + (l.sub ? ' — ' + l.sub : ''), short: l.label, desktop: isExternal(l), open: () => openLink(l) }));
  const visible = () => DK.apps.filter(a => (!a.show || a.show(DK.me)) && (DK.prefs.hiddenApps || []).indexOf(a.id) < 0).concat(DK.programEntries ? DK.programEntries() : []).concat(linkApps());
  const byOrder = (list, order) => list.slice().sort((a, b) => { const x = order.indexOf(a.id), y = order.indexOf(b.id); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || String(a.label).localeCompare(String(b.label), 'pt'); });
  // Quantas vezes cada item foi aberto pelo menu (nas preferências da conta): os mais abertos sobem para "Mais usados".
  const FAV_MIN = 3, FAV_MAX = 5;
  function countUse(a) {
    const u = DK.prefs.appUse = DK.prefs.appUse || {};
    u[a.id] = (u[a.id] || 0) + 1;
    const ids = Object.keys(u);
    if (ids.length > 60) ids.sort((x, y) => u[x] - u[y]).slice(0, ids.length - 60).forEach(k => { delete u[k]; });   // as preferências têm limite de tamanho
    DK.savePrefs();
  }
  const coarse = matchMedia('(pointer: coarse)').matches;
  const hideMenu = () => $('startmenu').classList.add('hidden');

  function buildStartMenu() {
    const m = $('startmenu');
    const search = el('input', { className: 'ssearch', type: 'search', placeholder: 'Pesquisar programas…', autocomplete: 'off' });
    const list = el('div', { className: 'slist' });
    const home = el('button', { className: 'shome', onclick: () => { hideMenu(); location.href = 'index.html'; } }, el('span', { textContent: '🏠' }), 'Voltar ao painel da casa');
    const foot = [home];
    if (DK.layout.canToggle()) foot.push(el('button', { className: 'shome', onclick: () => { hideMenu(); DK.layout.toggle(); } }, DK.layout.label()));
    foot.push(el('button', { className: 'shome slogout', onclick: () => { hideMenu(); logout(); } }, el('span', { textContent: '🚪' }), 'Sair'));   // no celular a barra não tem o botão Sair
    m.replaceChildren(el('header', {}, el('img', { src: 'assets/img/logo-128.png', alt: '' }), 'Iniciar', el('span', { className: 'swho', textContent: DK.me ? DK.displayName() : '' })), search, list);
    m.append.apply(m, foot);

    const apps = byOrder(visible(), MENU_ORDER);
    // categorias: as fixas e as que o usuário criou (entram depois de Jogos); um item vai para a categoria que o usuário escolheu ao instalá-lo
    const cats = menuCategories(true);
    const catOf = a => (a.cat && cats.some(c => c.id === a.cat) ? a.cat : ((CATS.find(c => c.match(a)) || {}).id || 'other'));
    const groups = cats.map(c => ({ c: c, items: apps.filter(a => catOf(a) === c.id) }));
    const rest = apps.filter(a => catOf(a) === 'other');
    if (rest.length) groups.push({ c: { id: 'other', icon: '📦', label: 'Outros' }, items: rest });
    const open = new Set(Array.isArray(DK.prefs.startOpen) ? DK.prefs.startOpen : DEFAULT_OPEN);

    const row = (a, cat) => {
      const b = el('button', { className: 'sitem', onclick: () => { hideMenu(); countUse(a); a.open(); } }, DK.iconNode(a.icon), a.label, cat ? el('small', { textContent: cat }) : '');
      b._ctx = DK.appCtx(a);
      return b;
    };
    const favorites = () => { const u = DK.prefs.appUse || {}; return apps.filter(a => (u[a.id] || 0) >= FAV_MIN).sort((x, y) => u[y.id] - u[x.id]).slice(0, FAV_MAX); };
    function draw() {
      list.replaceChildren();
      const q = search.value.trim().toLowerCase();
      if (q) {   // pesquisa: lista plana, sem categorias; acha também pelo nome da categoria e mostra a que cada resultado pertence
        const hits = [];
        groups.forEach(g => g.items.forEach(a => { if (a.label.toLowerCase().indexOf(q) >= 0 || g.c.label.toLowerCase().indexOf(q) >= 0) hits.push([a, g.c.label]); }));
        if (!hits.length) list.append(el('div', { className: 'meta', style: 'padding:14px', textContent: 'Nada encontrado.' }));
        hits.forEach(h => list.append(row(h[0], h[1])));
        return;
      }
      const favs = favorites();
      if (favs.length) {
        list.append(el('div', { className: 'scat fav' }, el('span', { textContent: '⭐' }), 'Mais usados'));
        favs.forEach(a => list.append(row(a)));
      }
      const all = groups.filter(g => g.items.length);
      if (all.length > 3) {   // abrir ou fechar todas as categorias de uma vez
        const everyOpen = all.every(g => open.has(g.c.id));
        list.append(el('button', { className: 'sall', textContent: everyOpen ? '▾ Recolher tudo' : '▸ Expandir tudo', onclick: () => {
          if (everyOpen) open.clear(); else all.forEach(g => open.add(g.c.id));
          DK.prefs.startOpen = [...open]; DK.savePrefs(); draw();
        } }));
      }
      all.forEach(g => {
        const isOpen = open.has(g.c.id);
        const head = el('button', { className: 'scat' + (isOpen ? ' open' : ''), onclick: () => {
          if (open.has(g.c.id)) open.delete(g.c.id); else open.add(g.c.id);
          DK.prefs.startOpen = [...open]; DK.savePrefs(); draw();
        } }, el('span', { textContent: g.c.icon }), g.c.label, el('i', { textContent: g.items.length }), el('em', { textContent: isOpen ? '▾' : '▸' }));
        list.append(head);
        if (isOpen) g.items.forEach(a => list.append(row(a)));
      });
    }
    search.oninput = draw;
    search.onkeydown = e => {
      if (e.key === 'Escape') { if (search.value) { search.value = ''; draw(); } else hideMenu(); }
      if (e.key === 'Enter') { const f = list.querySelector('.sitem'); if (f) f.click(); }
    };
    m._focusSearch = () => { search.value = ''; draw(); if (!coarse) search.focus(); };
    draw();
  }

  function buildIcons() {
    const icons = $('icons');
    icons.replaceChildren();
    const add = (emoji, label, fn, ctx, title) => { const b = el('button', { className: 'icon', onclick: fn, title: title || label }, DK.iconNode(emoji), label); b._ctx = ctx; icons.append(b); };
    byOrder(visible().filter(DK.onDesk), ICON_ORDER).forEach(a => add(a.icon, a.short || a.label.replace(/ \(.*\)$/, ''), a.open, DK.appCtx(a), a.label));
    (DK.prefs.deskFiles || []).forEach(f => add(f.type === 'dir' ? '📁' : DK.iconOf({ type: 'file', name: f.name }), f.name, () => DK.openFile(DK.deskRef(f)), DK.fileCtx(f), f.path));
    layoutIcons();
  }
  function layoutIcons() {
    const rows = Math.max(3, Math.floor((innerHeight - 70) / 92));
    $('icons').style.gridTemplateRows = 'repeat(' + rows + ', 88px)';
  }
  addEventListener('resize', layoutIcons);
  DK.layout.onChange(() => { layoutIcons(); if (DK.me && !DK.me.must_change) buildStartMenu(); });   // o texto do botão de layout muda com o modo
  DK.refreshShell = () => { if (DK.me && !DK.me.must_change) { buildIcons(); buildStartMenu(); } };

  $('start').onclick = e => { e.stopPropagation(); const m = $('startmenu'); m.classList.toggle('hidden'); if (!m.classList.contains('hidden') && m._focusSearch) m._focusSearch(); };
  $('bell').onclick = e => { e.stopPropagation(); DK.toggleNotifs(); };
  document.addEventListener('mousedown', e => { if (!$('startmenu').contains(e.target) && !$('start').contains(e.target)) $('startmenu').classList.add('hidden'); });

  // ---------- relógio ----------
  function tickClock() {
    const now = new Date();
    $('clock').replaceChildren(el('b', { textContent: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }),
      now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }));
    $('clock').title = now.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'medium' });
  }
  setInterval(tickClock, 1000);

  // ---------- sessão ----------
  async function showDesktop() {
    $('login').classList.add('hidden'); $('force').classList.add('hidden');
    $('desktop').classList.remove('hidden'); $('bar').classList.remove('hidden');
    $('who').textContent = DK.displayName() + (DK.me.is_admin ? ' (admin)' : '');
    if (DK.me.is_admin && DK.updatesNotice) DK.updatesNotice();
    tickClock(); buildIcons(); buildStartMenu();
    await DK.loadPrefs();
    DK.applyLook();
    await loadLinks();
    if (DK.loadPrograms) await DK.loadPrograms();
    buildIcons(); buildStartMenu();
    DK.chat.start();                           // mensagens novas dos outros usuários
    DK.cal.startWatching();                    // avisos do calendário enquanto o Diogows estiver aberto
  }
  function showLogin(msg) {
    DK.me = null; DK.prefs = {}; if (DK.applyLook) DK.applyLook(); DK.notifs = []; DK.programs = []; DK.systems = [];
    DK.cal.stopWatching(); DK.chat.stop();
    DK.closeAll();
    const n = $('notifs'); if (n) n.remove();
    $('bellN').classList.add('hidden');
    $('startmenu').classList.add('hidden');
    $('desktop').classList.add('hidden'); $('bar').classList.add('hidden'); $('force').classList.add('hidden');
    $('login').classList.remove('hidden'); $('le').textContent = msg || ''; $('lp').value = '';
    $('lu').focus();
  }
  function route() {
    if (!DK.me) return showLogin();
    if (DK.me.must_change) { $('login').classList.add('hidden'); $('force').classList.remove('hidden'); $('fc').focus(); return; }
    showDesktop();
  }

  // Sessão que expirou no meio do uso volta para o login (senha errada em desbloqueio/sudo/troca de senha também dá 401, e não conta).
  const rawApi = DK.api;
  DK.api = async function (method, path) {
    try { return await rawApi.apply(null, arguments); }
    catch (e) {
      if (e.status === 401 && DK.me && ['/login', '/shell/unlock', '/shell/sudo', '/password'].indexOf(path) < 0) showLogin('Sua sessão expirou. Entre de novo.');
      throw e;
    }
  };

  $('loginForm').onsubmit = async e => {
    e.preventDefault(); $('le').textContent = '';
    try { DK.me = await DK.api('POST', '/login', { username: $('lu').value.trim(), password: $('lp').value }); route(); }
    catch (err) { $('le').textContent = err.message; }
  };
  $('forceForm').onsubmit = async e => {
    e.preventDefault(); $('fe').textContent = '';
    if ($('fn').value !== $('fn2').value) { $('fe').textContent = 'As senhas novas não conferem.'; return; }
    try { await DK.api('POST', '/password', { current: $('fc').value, new: $('fn').value }); DK.me.must_change = false; $('fc').value = $('fn').value = $('fn2').value = ''; route(); }
    catch (err) { $('fe').textContent = err.message; }
  };
  const logout = async () => { try { await DK.api('POST', '/logout', {}); } catch (e) { /* já saiu */ } showLogin(); };
  $('logout').onclick = logout; $('forceOut').onclick = logout;

  DK.api('GET', '/me').then(u => { DK.me = u; route(); }).catch(() => showLogin());
})(window.DK = window.DK || {});
