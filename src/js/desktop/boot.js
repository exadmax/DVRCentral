(function (DK) {
  // Ciclo de sessão do Desktop: login, troca obrigatória de senha, menu Iniciar, ícones, relógio e os atalhos do painel da casa.
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
  const MENU_ORDER = ['computer', 'explorer', 'docs', 'notepad', 'images', 'pdf', 'video', 'cameras', 'contacts', 'calendar', 'terminal', 'users', 'config', 'account'];
  const ICON_ORDER = ['computer', 'explorer', 'docs', 'cameras', 'contacts', 'calendar', 'video', 'terminal'];
  const visible = () => DK.apps.filter(a => !a.show || a.show(DK.me));
  const byOrder = (list, order) => list.slice().sort((a, b) => { const x = order.indexOf(a.id), y = order.indexOf(b.id); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });

  function buildStartMenu() {
    const m = $('startmenu');
    m.replaceChildren(el('header', {}, el('img', { src: 'assets/img/logo-128.png', alt: '' }), 'Iniciar'));
    const add = (emoji, label, fn) => m.append(el('button', { onclick: () => { m.classList.add('hidden'); fn(); } }, el('span', { textContent: emoji }), label));
    const apps = byOrder(visible(), MENU_ORDER);
    apps.filter(a => !a.group).forEach(a => add(a.icon, a.label, a.open));
    if (DK.links.length) {
      m.append(el('hr'), el('div', { className: 'meta', style: 'padding:6px 14px 2px', textContent: 'Painel e serviços da casa (abrem em outra aba)' }));
      DK.links.forEach(l => add(LINK_ICONS[l.icon] || '🔗', l.label + (l.sub ? ' — ' + l.sub : ''), () => openLink(l)));
    }
    m.append(el('hr'));
    apps.filter(a => a.group).forEach(a => add(a.icon, a.label, a.open));
    add('🏠', 'Painel da casa', () => { location.href = 'index.html'; });
  }
  function buildIcons() {
    const icons = $('icons');
    icons.replaceChildren();
    const add = (emoji, label, fn) => icons.append(el('button', { className: 'icon', onclick: fn }, el('span', { textContent: emoji }), label));
    byOrder(visible().filter(a => a.desktop), ICON_ORDER).forEach(a => add(a.icon, a.label.replace(/ \(.*\)$/, ''), a.open));
    DK.links.filter(isExternal).forEach(l => add(LINK_ICONS[l.icon] || '🔗', l.label, () => openLink(l)));   // Jogos (WebRCade), Música (Navidrome)...
    layoutIcons();
  }
  function layoutIcons() {
    const rows = Math.max(3, Math.floor((innerHeight - 70) / 92));
    $('icons').style.gridTemplateRows = 'repeat(' + rows + ', 88px)';
  }
  addEventListener('resize', layoutIcons);

  $('start').onclick = e => { e.stopPropagation(); $('startmenu').classList.toggle('hidden'); };
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
    $('who').textContent = DK.me.username + (DK.me.is_admin ? ' (admin)' : '');
    tickClock(); buildIcons(); buildStartMenu();
    await DK.loadPrefs();
    await loadLinks();
    buildIcons(); buildStartMenu();
    DK.cal.startWatching();                    // avisos do calendário enquanto o Desktop estiver aberto
  }
  function showLogin(msg) {
    DK.me = null; DK.prefs = {}; DK.notifs = [];
    DK.cal.stopWatching();
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
