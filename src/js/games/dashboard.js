(function (CD) {
  // Dashboard "Conquistas": PSN + Xbox + Steam + RetroAchievements (dados de CD.gamesApi).
  const U = CD.util, I = CD.icons, A = CD.gamesApi;
  const $ = s => document.querySelector(s);
  const esc = U.esc;
  const nf = n => (n == null || isNaN(n) ? '–' : Number(n).toLocaleString('pt-BR'));
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  const cfg = U.deepMerge(JSON.parse(JSON.stringify(window.CD_SETTINGS || {})), window.CD_SETTINGS_LOCAL);
  const st = { data: null, hub: '', loading: true, filter: 'all', q: '', sort: 'recent', only100: false, limit: 48, fetchedAt: null };

  function hubBase() {
    return ((cfg.hub && cfg.hub.url) || (/^https?:/.test(location.protocol) ? location.origin : '')).replace(/\/$/, '');
  }

  function ago(iso) {
    if (!iso) return '';
    const d = new Date(iso), days = Math.floor((Date.now() - d.getTime()) / 864e5);
    if (isNaN(days)) return '';
    if (days <= 0) return 'hoje';
    if (days === 1) return 'ontem';
    if (days < 30) return 'há ' + days + ' dias';
    if (days < 365) return 'há ' + Math.round(days / 30) + (Math.round(days / 30) === 1 ? ' mês' : ' meses');
    return d.getDate() + ' ' + MES[d.getMonth()] + ' ' + d.getFullYear();
  }
  const hours = min => (min >= 60 ? nf(Math.round(min / 60)) + ' h' : min > 0 ? min + ' min' : '');

  function visible() {
    const ps = st.data ? st.data.platforms : [];
    return st.filter === 'all' ? ps : ps.filter(p => p.id === st.filter);
  }

  // Totais, gráficos e listas: só plataformas com dados reais (exemplo entra apenas quando nada real existe)
  function counted() {
    const v = visible(), anyReal = v.some(p => !p.demo);
    return v.filter(p => !anyReal || !p.demo);
  }

  // ---------- blocos ----------
  function header() {
    const d = st.data;
    let status = 'Carregando…';
    if (d) {
      const demo = d.platforms.filter(p => p.demo).length;
      status = d.refreshing ? 'Atualizando as plataformas…' : demo === 4 ? 'Dados de exemplo — configure as chaves no hub'
        : demo ? demo + ' plataforma(s) com dados de exemplo' : 'Consultado às ' + U.hhmm(st.fetchedAt);
    }
    return '<header class="g-top"><a class="g-back" href="index.html" title="Voltar ao painel">' + I.svg('back', 'currentColor', 22, 2) + '</a>' +
      '<img class="g-logo" src="assets/img/logo-128.png" alt="">' +
      '<div class="g-title"><h1>Conquistas</h1><div class="g-sub">Omega Diogo · ' + esc(status) + '</div></div>' +
      '<button class="g-btn" data-act="refresh"' + (st.loading ? ' disabled' : '') + '>' + I.svg('refresh', 'currentColor', 20, 2) + '<span>Atualizar</span></button></header>';
  }

  function kpis() {
    const ps = counted();
    const sum = k => ps.reduce((a, p) => a + (Number(p.stats[k]) || 0), 0);
    const played = ps.reduce((a, p) => a + (Number(p.stats.played != null ? p.stats.played : p.stats.games) || 0), 0);
    const tile = (label, value, note) => '<div class="kpi"><div class="kpi-l">' + label + '</div><div class="kpi-v num">' + value + '</div>' +
      '<div class="kpi-n">' + note + '</div></div>';
    const hrsFrom = ps.filter(p => p.stats.hours != null).map(p => p.meta.short).join(' + ');
    return '<section class="kpis">' +
      tile('Jogos com progresso', nf(played), ps.length > 1 ? 'em ' + ps.length + ' plataformas' : ps[0] ? ps[0].meta.name : '') +
      tile('Conquistas e troféus', nf(sum('achievements')), 'desbloqueados no total') +
      tile('Jogos completos', nf(sum('perfect')), 'platinas, 100% e masterizados') +
      tile('Horas jogadas', hrsFrom ? nf(sum('hours')) : '–', hrsFrom ? 'registradas por ' + hrsFrom : 'sem registro nesta plataforma') + '</section>';
  }

  function grades(gr) {
    if (!gr) return '';
    const tot = gr.platinum + gr.gold + gr.silver + gr.bronze || 1;
    const seg = (k, lbl) => gr[k] ? '<span class="gr-s gr-' + k + '" style="flex:' + Math.max(gr[k] / tot, .02) + '" data-tip="' + lbl + ': ' + nf(gr[k]) + '"></span>' : '';
    return '<div class="grades">' + seg('platinum', 'Platina') + seg('gold', 'Ouro') + seg('silver', 'Prata') + seg('bronze', 'Bronze') + '</div>' +
      '<div class="gr-leg">' + [['platinum', 'Platina'], ['gold', 'Ouro'], ['silver', 'Prata'], ['bronze', 'Bronze']]
        .map(x => '<span><i class="gr-' + x[0] + '"></i>' + nf(gr[x[0]]) + ' ' + x[1] + '</span>').join('') + '</div>';
  }

  function pcard(p) {
    const s = p.stats, m = p.meta;
    let head = '', extra = '';
    if (p.id === 'psn') { head = big(s.level, 'nível de troféus'); extra = grades(s.grades); }
    if (p.id === 'xbox') head = big(s.gamerscore, 'gamerscore');
    if (p.id === 'steam') head = big(s.level, 'nível Steam');
    if (p.id === 'retro') head = big(s.points, 'pontos hardcore') + (s.rank ? '<div class="pc-rank">#' + nf(s.rank) + ' no ranking</div>' : '');
    const rows = [
      [p.id === 'steam' ? 'Jogos na biblioteca' : 'Jogos', s.games],
      p.id === 'steam' ? ['Jogados', s.played] : null,
      ['Conquistas' + (p.id === 'psn' ? ' (troféus)' : ''), s.achievements],
      [p.id === 'psn' ? 'Platinas' : p.id === 'retro' ? 'Masterizados' : 'Jogos 100%', s.perfect],
      p.id === 'retro' ? ['Zerados', s.beaten] : null,
      s.hours != null ? ['Horas jogadas', s.hours] : null
    ].filter(Boolean);
    let tag = '';
    if (p.demo) tag = '<span class="tag">exemplo</span>';
    else if (p.stale) tag = '<span class="tag warn" data-tip="' + esc(p.error) + '">desatualizado</span>';
    const note = p.needsLogin && st.hub ? xboxConnect() : p.demo ? '<div class="pc-note">' + esc(p.error ? 'Erro: ' + p.error : !st.data.hub ? 'Hub não encontrado — abra esta página pelo hub' : p.configured ? 'Aguardando a primeira consulta…' : 'Sem chave no hub — veja docs/jogos.md') + '</div>' : '';
    const avatar = p.avatar ? '<img class="pc-av" src="' + esc(p.avatar) + '" alt="" onerror="this.style.display=\'none\'">' : '<span class="pc-av pc-av0" style="background:' + m.color + '">' + esc(m.short) + '</span>';
    const acct = p.profileUrl ? '<a href="' + esc(p.profileUrl) + '" target="_blank" rel="noopener">' + esc(p.account) + '</a>' : esc(p.account);
    return '<article class="pcard" style="--pc:' + m.color + '"><div class="pc-top">' + avatar +
      '<div class="pc-id"><div class="pc-name"><span class="sw" style="background:' + m.color + '"></span>' + esc(m.name) + tag + '</div><div class="pc-acct">' + acct + '</div></div></div>' +
      '<div class="pc-head">' + head + '</div>' + extra +
      '<dl class="pc-rows">' + rows.map(r => '<div><dt>' + r[0] + '</dt><dd class="num">' + nf(r[1]) + '</dd></div>').join('') + '</dl>' + note + '</article>';
  }
  // Conectar o Xbox: login da Microsoft numa aba nova; o endereço final (página em branco) é colado aqui
  function xboxConnect() {
    return '<div class="xc"><div class="xc-t">Conecte a conta Microsoft do Xbox:</div>' +
      '<ol><li><button class="g-btn sm" data-act="xbox-open">Entrar na Microsoft</button></li>' +
      '<li>Na página em branco que abrir no fim, copie o endereço inteiro da barra e cole abaixo.</li></ol>' +
      '<div class="xc-row"><input id="xbu" type="text" placeholder="https://login.live.com/oauth20_desktop.srf?code=…" value="' + esc(st.xbu || '') + '">' +
      '<button class="g-btn sm" data-act="xbox-send"' + (st.xbBusy ? ' disabled' : '') + '>' + (st.xbBusy ? 'Conectando…' : 'Conectar') + '</button></div>' +
      (st.xbMsg ? '<div class="xc-msg">' + esc(st.xbMsg) + '</div>' : '') + '</div>';
  }

  async function xboxOpen() {
    const w = window.open('about:blank', '_blank');
    try {
      const j = await U.getJson(st.hub + '/api/games/xbox-login', 8000);
      if (w) w.location.href = j.url; else location.href = j.url;
    } catch (e) { if (w) w.close(); st.xbMsg = 'Hub não respondeu.'; render(); }
  }

  async function xboxSend() {
    st.xbBusy = true; st.xbMsg = ''; render();
    try {
      const r = await fetch(st.hub + '/api/games/xbox-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: st.xbu || '' }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'falhou');
      st.xbu = ''; st.xbMsg = '';
      st.xbBusy = false;
      return load(false);
    } catch (e) { st.xbMsg = String(e.message || e); }
    st.xbBusy = false; render();
  }

  function big(v, label) { return '<div class="pc-big num">' + nf(v) + '</div><div class="pc-bigl">' + label + '</div>'; }

  // Atividade: jogos com última sessão em cada mês (12 meses), empilhado por plataforma
  function activity() {
    const ps = counted(), now = new Date(), months = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ y: d.getFullYear(), m: d.getMonth(), by: {} }); }
    ps.forEach(p => p.games.forEach(g => {
      if (!g.lastPlayed) return;
      const d = new Date(g.lastPlayed), mm = months.find(x => x.y === d.getFullYear() && x.m === d.getMonth());
      if (mm) mm.by[p.id] = (mm.by[p.id] || 0) + 1;
    }));
    const tot = x => ps.reduce((a, p) => a + (x.by[p.id] || 0), 0);
    const max = Math.max(1, Math.max.apply(null, months.map(tot)));
    const H = 150;
    const cols = months.map(x => {
      const t = tot(x);
      const tip = MES[x.m] + '/' + String(x.y).slice(2) + ': ' + t + ' jogo(s)' + ps.filter(p => x.by[p.id]).map(p => ' · ' + p.meta.short + ' ' + x.by[p.id]).join('');
      const segs = ps.filter(p => x.by[p.id]).map(p => '<span style="height:' + Math.max(2, x.by[p.id] / max * H) + 'px;background:' + p.meta.color + '"></span>').join('');
      return '<div class="ac-col" data-tip="' + esc(tip) + '"><div class="ac-stack" style="height:' + H + 'px">' + segs + '</div><div class="ac-x">' + MES[x.m] + '</div></div>';
    }).join('');
    return '<section class="card"><div class="card-h"><h2>Atividade</h2><span class="muted">jogos por mês da última sessão · 12 meses</span></div>' +
      legend(ps) + '<div class="ac" role="img" aria-label="Jogos por mês">' + cols + '</div></section>';
  }

  function legend(ps) {
    return ps.length > 1 ? '<div class="legend">' + ps.map(p => '<span><i style="background:' + p.meta.color + '"></i>' + p.meta.short + '</span>').join('') + '</div>' : '';
  }

  // Conclusão: distribuição dos jogos por faixa de progresso
  function completion() {
    const ps = counted();
    const B = [['0–24%', 0, 25], ['25–49%', 25, 50], ['50–74%', 50, 75], ['75–99%', 75, 100], ['100%', 100, 101]];
    const rows = B.map(b => ({ label: b[0], by: ps.map(p => ({ p: p, n: p.games.filter(g => g.total > 0 && g.pct >= b[1] && g.pct < b[2]).length })) }));
    const max = Math.max(1, Math.max.apply(null, rows.map(r => r.by.reduce((a, x) => a + x.n, 0))));
    return '<section class="card"><div class="card-h"><h2>Progresso dos jogos</h2><span class="muted">% de conquistas obtidas por jogo</span></div>' + legend(ps) +
      '<div class="hb">' + rows.map(r => {
        const t = r.by.reduce((a, x) => a + x.n, 0);
        return '<div class="hb-r" data-tip="' + esc(r.label + ': ' + t + ' jogo(s)' + r.by.filter(x => x.n).map(x => ' · ' + x.p.meta.short + ' ' + x.n).join('')) + '">' +
          '<span class="hb-l">' + r.label + '</span><span class="hb-bar">' +
          r.by.filter(x => x.n).map(x => '<span style="width:' + (x.n / max * 100) + '%;background:' + x.p.meta.color + '"></span>').join('') +
          '</span><span class="hb-v num">' + t + '</span></div>';
      }).join('') + '</div></section>';
  }

  function recent() {
    const items = [];
    counted().forEach(p => p.recent.forEach(r => items.push(Object.assign({ p: p }, r))));
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const KIND = { platinum: 'Platina', gold: 'Ouro', silver: 'Prata', bronze: 'Bronze' };
    const list = items.slice(0, 20).map(r => {
      const badge = r.kind ? '<span class="rk gr-' + esc(r.kind) + '">' + (KIND[r.kind] || r.kind) + '</span>'
        : r.points ? '<span class="rk">' + r.points + (r.p.id === 'xbox' ? ' G' : ' pts') + '</span>' : '';
      const rare = r.rarity ? '<span class="rare' + (r.rarity < 10 ? ' ultra' : '') + '">' + r.rarity.toFixed(1).replace('.', ',') + '% têm</span>' : '';
      return '<li class="rc"><span class="rc-img">' + img(r.image, r.p) + '</span><div class="rc-t"><div class="rc-n">' + esc(r.name || '(sem nome)') + badge + '</div>' +
        '<div class="rc-d">' + esc(r.desc || '') + '</div><div class="rc-g"><span class="sw" style="background:' + r.p.meta.color + '"></span>' + esc(r.p.meta.short) + ' · ' + esc(r.game) +
        ' · ' + ago(r.date) + rare + '</div></div></li>';
    }).join('');
    return '<section class="card rcard"><div class="card-h"><h2>Desbloqueios recentes</h2></div>' +
      (list ? '<ul class="rlist">' + list + '</ul>' : '<div class="empty">Nada recente.</div>') + '</section>';
  }

  function img(src, p) {
    return src ? '<img src="' + esc(src) + '" alt="" loading="lazy" onerror="this.remove()">' : '<span class="ph" style="background:' + p.meta.color + '"></span>';
  }

  function library() {
    let gs = [];
    counted().forEach(p => p.games.forEach(g => gs.push(Object.assign({ p: p }, g))));
    const q = st.q.trim().toLowerCase();
    if (q) gs = gs.filter(g => (g.name + ' ' + (g.system || '')).toLowerCase().indexOf(q) >= 0);
    if (st.only100) gs = gs.filter(g => g.award === 'platina' || g.award === '100%' || g.award === 'masterizado');
    else gs = gs.filter(g => g.total > 0 || g.playMin > 0 || g.earned > 0);
    const by = {
      recent: (a, b) => (b.lastPlayed || '').localeCompare(a.lastPlayed || ''),
      progress: (a, b) => b.pct - a.pct || b.earned - a.earned,
      hours: (a, b) => (b.playMin || 0) - (a.playMin || 0),
      name: (a, b) => a.name.localeCompare(b.name, 'pt-BR')
    };
    gs.sort(by[st.sort]);
    const total = gs.length;
    const cards = gs.slice(0, st.limit).map(g => {
      const aw = g.award ? '<span class="aw aw-' + (g.award === '100%' ? 'full' : g.award === 'platina' ? 'plat' : g.award === 'masterizado' ? 'mast' : 'beat') + '">' + esc(g.award) + '</span>' : '';
      const meta = [g.system, hours(g.playMin), g.lastPlayed ? ago(g.lastPlayed) : ''].filter(Boolean).map(esc).join(' · ');
      const score = g.scoreTotal ? '<span class="gc-sc num">' + nf(g.score) + '/' + nf(g.scoreTotal) + (g.p.id === 'xbox' ? ' G' : ' pts') + '</span>' : '';
      return '<article class="gc" style="--pc:' + g.p.meta.color + '"><div class="gc-img' + (g.p.id === 'retro' ? ' px' : '') + '">' + img(g.image, g.p) + aw + '</div>' +
        '<div class="gc-b"><div class="gc-n" title="' + esc(g.name) + '">' + esc(g.name) + '</div><div class="gc-m"><span class="sw" style="background:' + g.p.meta.color + '"></span>' + esc(g.p.meta.short) + (meta ? ' · ' + meta : '') + '</div>' +
        (g.total > 0 ? '<div class="gc-p"><span class="bar"><span style="width:' + Math.min(100, g.pct) + '%"></span></span><span class="num">' + g.earned + '/' + g.total + '</span></div>' +
          '<div class="gc-f"><span class="num">' + String(g.pct).replace('.', ',') + '%</span>' + score + '</div>'
          : '<div class="gc-f muted">sem conquistas</div>') + '</div></article>';
    }).join('');
    const sortSel = [['recent', 'Jogados recentemente'], ['progress', 'Maior progresso'], ['hours', 'Mais horas'], ['name', 'Nome']]
      .map(o => '<option value="' + o[0] + '"' + (st.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('');
    return '<section class="card lib"><div class="card-h"><h2>Biblioteca</h2><span class="muted">' + nf(total) + ' jogos</span></div>' +
      '<div class="lib-tools"><label class="search">' + I.svg('search', 'currentColor', 18, 2) + '<input id="gq" type="search" placeholder="Buscar jogo ou console" value="' + esc(st.q) + '"></label>' +
      '<select id="gsort" aria-label="Ordenar">' + sortSel + '</select>' +
      '<label class="chk"><input id="g100" type="checkbox"' + (st.only100 ? ' checked' : '') + '> Só completos</label></div>' +
      (cards ? '<div class="grid">' + cards + '</div>' : '<div class="empty">Nenhum jogo encontrado.</div>') +
      (total > st.limit ? '<button class="g-btn more" data-act="more">Mostrar mais (' + nf(total - st.limit) + ')</button>' : '') + '</section>';
  }

  function chips() {
    const all = [['all', 'Todas', '']].concat(A.ORDER.map(id => [id, A.PLATFORMS[id].name, A.PLATFORMS[id].color]));
    return '<nav class="chips" aria-label="Plataforma">' + all.map(c => '<button class="chip' + (st.filter === c[0] ? ' on' : '') + '" data-filter="' + c[0] + '">' +
      (c[2] ? '<span class="sw" style="background:' + c[2] + '"></span>' : '') + c[1] + '</button>').join('') + '</nav>';
  }

  function render() {
    const focusId = document.activeElement && document.activeElement.id;
    const caret = focusId === 'gq' ? document.activeElement.selectionStart : null;
    if (!st.data) { $('#g').innerHTML = header() + '<div class="skel-wrap"><div class="skel"></div><div class="skel"></div></div>'; return; }
    $('#g').innerHTML = header() + chips() + kpis() +
      '<section class="pcards">' + visible().map(pcard).join('') + '</section>' +
      '<div class="two">' + activity() + completion() + '</div>' +
      '<div class="two wide">' + library() + recent() + '</div>' +
      '<footer class="g-foot">Dados: PlayStation Network, Xbox Live, Steam Web API e RetroAchievements — consultados pelo hub a cada ' +
      'poucas horas.</footer>';
    if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); if (caret != null) el.setSelectionRange(caret, caret); } }
  }

  // ---------- tooltip ----------
  function tooltip() {
    const tip = document.createElement('div');
    tip.className = 'tip'; document.body.appendChild(tip);
    document.addEventListener('mouseover', e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { tip.style.opacity = 0; return; }
      tip.textContent = t.getAttribute('data-tip');
      const r = t.getBoundingClientRect();
      tip.style.opacity = 1;
      const x = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2));
      tip.style.left = x + 'px';
      tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
    });
    window.addEventListener('scroll', () => { tip.style.opacity = 0; }, { passive: true });
  }

  // ---------- dados ----------
  async function load(refresh) {
    st.loading = true; render();
    st.data = await A.load(st.hub, refresh);
    st.fetchedAt = new Date(); st.loading = false;
    render();
    if (st.data.refreshing) setTimeout(() => load(false), 20000); // hub consultando as plataformas: confere de novo
  }

  async function boot() {
    try { st.filter = localStorage.getItem('cd:gfilter') || 'all'; } catch (e) { /* sem storage */ }
    tooltip();
    const base = hubBase();
    if (base) { try { await U.getJson(base + '/api/health', 3000); st.hub = base; } catch (e) { st.hub = ''; } }
    load(false);
    setInterval(() => load(false), 30 * 60000);
    document.addEventListener('click', e => {
      const f = e.target.closest && e.target.closest('[data-filter]');
      if (f) { st.filter = f.getAttribute('data-filter'); st.limit = 48; try { localStorage.setItem('cd:gfilter', st.filter); } catch (x) { /* ignore */ } render(); return; }
      const a = e.target.closest && e.target.closest('[data-act]');
      if (a && a.getAttribute('data-act') === 'refresh') load(true);
      if (a && a.getAttribute('data-act') === 'more') { st.limit += 48; render(); }
      if (a && a.getAttribute('data-act') === 'xbox-open') xboxOpen();
      if (a && a.getAttribute('data-act') === 'xbox-send') xboxSend();
    });
    document.addEventListener('input', e => {
      if (e.target.id === 'gq') { st.q = e.target.value; st.limit = 48; render(); }
      if (e.target.id === 'xbu') st.xbu = e.target.value;
    });
    document.addEventListener('change', e => {
      if (e.target.id === 'gsort') { st.sort = e.target.value; render(); }
      if (e.target.id === 'g100') { st.only100 = e.target.checked; render(); }
    });
    document.addEventListener('keydown', e => {
      if (e.keyCode === 10009) location.href = 'index.html'; // Voltar do controle Samsung
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.CD = window.CD || {});
