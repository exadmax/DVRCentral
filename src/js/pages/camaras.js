(function (CD) {
  // Página "Câmeras" (camaras.html): imagem ao vivo das câmeras de casa (o player fica em services/cameraPlayer.js).
  // Só conecta enquanto a página está visível.
  const U = CD.util, I = CD.icons, esc = U.esc;

  function mount(root) {
    root.innerHTML = '<section class="pg"><div class="cams" id="cams"></div></section>';
    const box = root.querySelector('#cams'), players = [];

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
      const visible = () => !document.hidden;
      document.addEventListener('visibilitychange', () => players.forEach(p => visible() ? p.start() : p.stop()));
      window.addEventListener('pagehide', () => players.forEach(p => p.stop()));
    }

    async function load() {
      if (!CD.state.hub) { note('Sem o hub: abra o painel pelo endereço do servidor da casa para ver as câmeras.'); return; }
      let list;
      try { list = await CD.hubApi.cameras.list(); } catch (e) { note(e.message); return; }
      if (!list || !list.length) { note('Nenhuma câmera configurada no hub (campo "cameras" do hub.config.json).'); return; }
      box.innerHTML = '';
      list.forEach(c => box.appendChild(card(c)));
      players.forEach(p => p.start());
      watch();
    }
    load();
  }

  CD.pages = CD.pages || {};
  CD.pages.camaras = { label: 'Câmeras', sub: 'imagem ao vivo', icon: 'camera', mount: mount };
})(window.CD = window.CD || {});
