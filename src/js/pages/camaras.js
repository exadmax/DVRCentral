(function (CD) {
  // Página "Câmeras" (camaras.html): imagem ao vivo das câmeras de casa (o player fica em services/cameraPlayer.js) e a aba
  // Gravações, com os arquivos de 1 hora que o hub grava (liga/desliga e retenção: página Config). Só conecta enquanto visível.
  const U = CD.util, I = CD.icons, esc = U.esc;

  function size(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1).replace('.', ',') + ' GB' : Math.max(1, Math.round(n / 1048576)) + ' MB'; }
  const two = n => (n < 10 ? '0' : '') + n;
  const hhmm = d => two(d.getHours()) + ':' + two(d.getMinutes());

  // Player embutido de uma gravação (mesmo molde da página Vídeos).
  function player(f) {
    const ov = document.createElement('div'), d = new Date(f.start * 1000);
    ov.className = 'vp';
    ov.innerHTML = '<div class="vp-top"><div class="vp-name">' + esc(f.camera + ' · ' + d.toLocaleDateString('pt-BR') + ' ' + hhmm(d)) + '</div>' +
      '<a class="vbtn" href="' + esc(CD.hubApi.recordings.fileUrl(f.name, true)) + '">Baixar</a><button type="button" class="vbtn" data-a="x">Fechar</button></div>' +
      '<video controls autoplay playsinline></video><div class="vp-msg">Gravação de 1 hora; use a barra para pular para o minuto desejado.</div>';
    const video = ov.querySelector('video'), msg = ov.querySelector('.vp-msg');
    video.src = CD.hubApi.recordings.fileUrl(f.name);
    video.addEventListener('error', () => { msg.textContent = 'O navegador não consegue tocar esta gravação. Use Baixar e abra no VLC.'; msg.className = 'vp-msg err'; });
    function close() {
      document.removeEventListener('keydown', onKey);
      video.pause(); video.removeAttribute('src'); video.load();
      ov.remove();
    }
    function onKey(e) { if (e.key === 'Escape' || e.keyCode === 10009) close(); }
    document.addEventListener('keydown', onKey);
    ov.querySelector('[data-a="x"]').addEventListener('click', close);
    document.body.appendChild(ov);
    video.play().catch(() => { /* autoplay barrado: o usuário aperta play */ });
  }

  function mount(root) {
    root.innerHTML = '<section class="pg"><div class="cams-bar"><button type="button" class="vbtn on" data-v="live">Ao vivo</button>' +
      '<button type="button" class="vbtn" data-v="recs">Gravações</button></div>' +
      '<div class="cams" id="cams"></div><div class="recs" id="recs" hidden></div></section>';
    const box = root.querySelector('#cams'), recsBox = root.querySelector('#recs'), players = [];
    let view = 'live', recCam = '';

    function note(msg) { box.innerHTML = '<div class="empty">' + esc(msg) + '</div>'; }

    function card(c) {
      const el = document.createElement('article');
      el.className = 'cam';
      el.innerHTML = '<header class="cam-h"><h2>' + esc(c.name) + '</h2>' +
        '<button type="button" class="ib" title="Tela cheia" aria-label="Tela cheia: ' + esc(c.name) + '">' + I.svg('expand', 'currentColor', 24, 2) + '</button></header>' +
        '<div class="cam-v"><video muted autoplay playsinline></video><div class="cam-s">Conectando…</div></div>';
      const video = el.querySelector('video'), status = el.querySelector('.cam-s');
      const p = CD.cameraPlayer.create(video, CD.hubApi.cameras.streamUrl(c.id), (kind, text) => {
        status.textContent = text;
        status.className = 'cam-s' + (kind === 'play' ? ' off' : kind === 'err' ? ' err' : '');
      });
      el.querySelector('.ib').addEventListener('click', () => {
        const d = document;
        if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
        const f = el.requestFullscreen || el.webkitRequestFullscreen;
        if (f) f.call(el);
      });
      players.push(p);
      return el;
    }

    function watch() {
      const visible = () => !document.hidden && view === 'live';
      document.addEventListener('visibilitychange', () => players.forEach(p => visible() ? p.start() : p.stop()));
      window.addEventListener('pagehide', () => players.forEach(p => p.stop()));
    }

    // ---- gravações ----
    async function loadRecs() {
      if (!CD.state.hub) { recsBox.innerHTML = '<div class="empty">Sem o hub: abra o painel pelo endereço do servidor da casa.</div>'; return; }
      recsBox.innerHTML = '<div class="empty">Carregando…</div>';
      let list, st = null;
      try { list = await CD.hubApi.recordings.list(); } catch (e) { recsBox.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; return; }
      try { st = await CD.hubApi.recordings.settings(); } catch (e) { /* só o aviso de "desligada" some */ }
      if (view !== 'recs') return;
      const cams = []; list.forEach(f => { if (cams.indexOf(f.camera) < 0) cams.push(f.camera); });
      if (recCam && cams.indexOf(recCam) < 0) recCam = '';
      const shown = list.filter(f => !recCam || f.camera === recCam);
      let html = '';
      if (st && !st.enabled) html += '<div class="cfg-msg">A gravação está desligada. Ligue em <a href="config.html">Config</a>.</div>';
      else if (st) html += '<div class="cfg-md">' + st.files + ' arquivo(s), ' + size(st.usedBytes) + ' · modo, retenção e limite de cada câmera em <a href="config.html">Config</a>.</div>';
      if (cams.length > 1) {
        html += '<div class="recs-f"><button type="button" class="vbtn' + (recCam ? '' : ' on') + '" data-cam="">Todas</button>' +
          cams.map(c => '<button type="button" class="vbtn' + (recCam === c ? ' on' : '') + '" data-cam="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>';
      }
      if (!shown.length) html += '<div class="empty">Nenhuma gravação ainda.</div>';
      let day = '';
      shown.forEach((f, i) => {
        const d = new Date(f.start * 1000), key = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
        if (key !== day) { day = key; html += '<div class="rec-day">' + esc(key) + '</div>'; }
        const end = new Date((f.start + 3600) * 1000);
        html += '<article class="vid"><div class="vid-main"><div class="vid-name">' + esc(f.camera) + (f.recording ? '<span class="rec-live">gravando</span>' : '') + '</div>' +
          '<div class="vid-meta">' + d.toLocaleDateString('pt-BR') + ' · ' + hhmm(d) + ' – ' + hhmm(end) + ' · ' + size(f.size) + '</div></div><div class="vid-act">' +
          '<button type="button" class="vbtn main" data-play="' + i + '">Assistir</button>' +
          '<a class="vbtn" href="' + esc(CD.hubApi.recordings.fileUrl(f.name, true)) + '">Baixar</a></div></article>';
      });
      recsBox.innerHTML = html;
      recsBox.onclick = e => {
        const b = e.target.closest && e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-cam')) { recCam = b.getAttribute('data-cam'); loadRecs(); }
        else if (b.hasAttribute('data-play')) player(shown[+b.getAttribute('data-play')]);
      };
    }

    function show(v) {
      view = v;
      root.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', b.getAttribute('data-v') === v));
      box.hidden = v !== 'live'; recsBox.hidden = v !== 'recs';
      players.forEach(p => v === 'live' ? p.start() : p.stop());
      if (v === 'recs') loadRecs();
    }
    root.querySelector('.cams-bar').addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-v]');
      if (b) show(b.getAttribute('data-v'));
    });

    async function load() {
      if (!CD.state.hub) { note('Sem o hub: abra o painel pelo endereço do servidor da casa para ver as câmeras.'); return; }
      let list;
      try { list = await CD.hubApi.cameras.list(); } catch (e) { note(e.message); return; }
      if (!list || !list.length) { note('Nenhuma câmera configurada no hub (campo "cameras" do hub.config.json).'); return; }
      box.innerHTML = '';
      list.forEach(c => box.appendChild(card(c)));
      if (view === 'live') players.forEach(p => p.start());
      watch();
    }
    load();
  }

  CD.pages = CD.pages || {};
  CD.pages.camaras = { label: 'Câmeras', sub: 'imagem ao vivo', icon: 'camera', mount: mount };
})(window.CD = window.CD || {});
