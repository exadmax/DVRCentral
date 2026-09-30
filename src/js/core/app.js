(function (CD) {
  const U = CD.util, I = CD.icons;
  const $ = s => document.querySelector(s);

  const cfg = U.deepMerge(JSON.parse(JSON.stringify(window.CD_SETTINGS || {})), window.CD_SETTINGS_LOCAL);
  cfg.calendar = cfg.calendar || { sources: [], proxy: '' };
  cfg.night = cfg.night || { from: 23, until: 5 };
  cfg.cameras = cfg.cameras || { rotateSeconds: 60 };

  const state = {
    cfg: cfg, now: new Date(), weather: null, wxStale: false, cal: { demo: true, sources: [] },
    holidays: [], traffic: null, stock: null, nightOffUntil: 0, nightSkipped: false, version: '', hub: '', showDiogoUntil: 0, trafficBusy: false, online: navigator.onLine, updatedAt: null, agTop: 0,
    cams: [], midIdx: 0            // câmeras do hub e o que ocupa o meio: 0 = Clima, 1..n = câmeras (rodízio)
  };
  CD.state = state;

  // ---------- layout ----------
  function header(s) {
    const w = s.weather;
    return '<header class="top"><div class="brand"><img class="logo" src="assets/img/logo-128.png" alt="Omega Diogo">' +
      '<div class="clock"><div class="time num">' + U.hhmm(s.now) + '</div><div class="date">' + U.dataExtenso(s.now) + '</div></div></div>' +
      CD.widgets.holidayPill(s) +
      '<div class="wxnow">' + (w ? I.weather(w.now.code, w.now.isDay, '#4DA3FF', 52, 1.8) : '') +
      '<div class="wxnow-c"><div class="num wxnow-t">' + (w ? w.now.temp + '°' : '--°') + '</div>' +
      '<div class="city">' + U.esc(cfg.location.city) + ', ' + U.esc(cfg.location.state) + '</div></div></div></header>';
  }

  function day(s) {
    return header(s) + '<div class="rule"></div><main class="main">' +
      CD.widgets.agenda(s) + (CD.widgets.cameraCur(s) ? CD.widgets.cameraSlot(s) : CD.widgets.weather(s)) + CD.widgets.map(s) + '</main>' + CD.widgets.links(s) + CD.widgets.footer(s);
  }

  function isNight(now) {
    const h = now.getHours();
    return cfg.night.from > cfg.night.until ? (h >= cfg.night.from || h < cfg.night.until) : (h >= cfg.night.from && h < cfg.night.until);
  }

  // Fim da noite atual: próxima vez em que o relógio marca a hora de saída do modo noturno
  function nightEnd(now) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), cfg.night.until, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  // Desligar vale só para esta sessão (nada é guardado: ao recarregar, o modo noturno volta se ainda for a hora) e,
  // numa TV que fica ligada, só até o fim da noite atual: na próxima noite ele volta sozinho.
  function setNightOff(off) {
    state.nightOffUntil = off ? nightEnd(new Date()) : 0;
    render();
  }

  function render() {
    state.now = new Date();
    const inNight = isNight(state.now);
    state.nightSkipped = inNight && state.now.getTime() < state.nightOffUntil;   // horário noturno, mas desligado à mão
    const night = inNight && !state.nightSkipped;
    document.body.classList.toggle('night', night);
    document.documentElement.classList.toggle('night', night);
    const shell = $('#shell');
    shell.innerHTML = night ? CD.widgets.night(state) : day(state);
    const list = $('#evlist');
    if (list) list.scrollTop = state.agTop;
    CD.widgets.cameraSync(state);
  }

  // TV/web: palco fixo 1920x1080 escalado para caber. Celular (ou retrato): coluna única.
  function fit() {
    const w = window.innerWidth, h = window.innerHeight;
    const mobile = w < 900 || h > w;
    document.body.classList.toggle('mobile', mobile);
    $('#stage').style.setProperty('--s', mobile ? 1 : Math.min(w / 1920, h / 1080));
  }

  // Anti burn-in: desloca o conteúdo alguns pixels de tempos em tempos
  function shift() {
    const r = () => Math.round((Math.random() * 2 - 1) * 4);
    $('#shell').style.transform = 'translate(' + r() + 'px,' + r() + 'px)';
  }

  // Agenda longa: rola devagar de tempos em tempos
  function autoScroll() {
    const el = $('#evlist');
    if (!el || el.scrollHeight <= el.clientHeight + 4) { state.agTop = 0; return; }
    const max = el.scrollHeight - el.clientHeight;
    state.agTop = state.agTop >= max - 2 ? 0 : Math.min(max, state.agTop + 70);
    el.scrollTop = state.agTop;
  }

  // ---------- dados ----------
  async function refreshWeather() {
    try {
      state.weather = await CD.weatherApi.fetch(cfg);
      state.wxStale = false; state.updatedAt = new Date();
      U.cache.set('weather', { t: Date.now(), v: state.weather });
    } catch (e) {
      state.wxStale = true;
      if (!state.weather) { const c = U.cache.get('weather'); if (c) state.weather = c.v; }
    }
    render();
  }

  // Hub (servidor): endereço em settings (TV/APK) ou o próprio servidor que entregou a página
  async function detectHub() {
    const base = (cfg.hub && cfg.hub.url) || (/^https?:/.test(location.protocol) ? location.origin : '');
    if (!base) return;
    try { const h = await U.getJson(base + '/api/health', 3000); state.hub = base.replace(/\/$/, ''); state.version = h.version || ''; } catch (e) { state.hub = ''; state.version = ''; }
  }

  // Trânsito vem só do hub (a chave do Google fica lá). Diogo só é consultado enquanto o "Ver trânsito" está ativo.
  async function refreshTraffic() {
    if (state.hub) {
      const asked = Date.now() < state.showDiogoUntil;
      try {
        const j = await U.getJson(state.hub + '/api/traffic' + (asked ? '?diogo=1' : ''), 25000);
        if (j.configured) { state.traffic = { demo: false, stale: !!j.stale, diogo: j.diogo, cassia: j.cassia }; return render(); }
      } catch (e) { if (state.traffic && !state.traffic.demo) { state.traffic.stale = true; return render(); } }
    }
    state.traffic = Object.assign({ demo: true }, CD.trafficApi.demo());
    render();
  }

  async function showDiogoTraffic() {
    state.showDiogoUntil = Date.now() + 10 * 60 * 1000;     // mostra por 10 min e volta a desligar
    state.trafficBusy = true; render();
    await refreshTraffic();
    state.trafficBusy = false; render();
  }

  async function refreshCalendar() {
    try { state.cal = await CD.calendar.load(cfg, state.hub); } catch (e) { /* mantém o anterior */ }
    render();
  }

  async function refreshHolidays() {
    try { state.holidays = await CD.holidaysApi.load(new Date()); } catch (e) { /* mantém */ }
    render();
  }

  // Validades para o item "Geladeira" do menu de atalhos (a lista completa fica em estoque.html)
  async function refreshStock() {
    if (!state.hub) return;
    try { state.stock = await CD.hubApi.estoque.list(); render(); } catch (e) { /* mantém o anterior */ }
  }

  // Câmeras ao vivo: a lista vem do hub; o meio da tela alterna Clima e cada câmera (uma por minuto)
  async function refreshCameras() {
    if (!state.hub) { state.cams = []; state.midIdx = 0; return; }
    try {
      const l = await CD.hubApi.cameras.list();
      state.cams = Array.isArray(l) ? l : [];
      if (state.midIdx > state.cams.length) state.midIdx = 0;
      render();
    } catch (e) { /* mantém a lista anterior */ }
  }

  function rotateMid() {
    const n = state.cams.length;
    if (!n || !CD.cameraPlayer.supported()) { state.midIdx = 0; return; }
    state.midIdx = (state.midIdx + 1) % (n + 1);
    render();
  }

  function refreshAll() { refreshWeather(); refreshTraffic(); refreshCalendar(); refreshHolidays(); refreshStock(); refreshCameras(); }

  // ---------- boot ----------
  async function boot() {
    fit(); render();
    await detectHub();
    refreshAll();
    const min = 60000;
    setInterval(render, 30 * 1000);
    setInterval(refreshWeather, Math.max(5, cfg.refreshMinutes || 15) * min);
    setInterval(refreshTraffic, 5 * min);
    setInterval(refreshCalendar, 5 * min);
    setInterval(refreshHolidays, 6 * 60 * min);
    setInterval(refreshStock, 5 * min);
    setInterval(shift, 3 * min);
    const q = /[?&]rotate=(\d+)/.exec(location.search);                   // ?rotate=15 acelera o rodízio (teste)
    setInterval(rotateMid, Math.max(5, q ? +q[1] : cfg.cameras.rotateSeconds || 60) * 1000);
    setInterval(autoScroll, 6000);
    window.addEventListener('resize', fit);
    window.addEventListener('online', () => { state.online = true; refreshAll(); });
    window.addEventListener('offline', () => { state.online = false; render(); });
    document.addEventListener('click', e => {
      const n = e.target.closest && e.target.closest('[data-night]');
      if (n) return setNightOff(n.getAttribute('data-night') === 'off');
      const b = e.target.closest && e.target.closest('[data-traffic]');
      if (b && b.getAttribute('data-traffic') === 'diogo') showDiogoTraffic();
    });
    document.addEventListener('keydown', e => {
      if (e.keyCode === 13 && !(e.target.closest && e.target.closest('a,button'))) refreshAll();                       // OK do controle: atualizar
      if (e.keyCode === 10009) {                                    // Voltar do controle Samsung
        if (window.tizen) { try { tizen.application.getCurrentApplication().exit(); } catch (x) { /* ignore */ } }
        else if (window.parent !== window) window.parent.postMessage('cd-exit', '*');  // painel dentro do app da TV (iframe)
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.CD = window.CD || {});
