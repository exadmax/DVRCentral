(function (DK) {
  // Gestor de Câmeras: lista as câmeras do hub e abre cada uma em sua própria janela (ou todas num mosaico).
  // Todos veem as câmeras; só o administrador adiciona, renomeia e remove (aba "Gerenciar").
  const el = DK.el;

  // Câmera ao vivo dentro de um elemento .camview; devolve { stop }. Usa o mesmo player da página Câmeras (MP4 contínuo do hub).
  function liveView(cam) {
    const view = el('div', { className: 'camview' });
    const video = el('video', { muted: true, autoplay: true, playsInline: true });
    const st = el('div', { className: 'camst', textContent: 'Conectando…' });
    view.append(video, st);
    let p = null;
    if (!window.CD || !CD.cameraPlayer || !CD.cameraPlayer.supported()) {
      st.textContent = 'Este navegador não toca a câmera ao vivo.'; st.className = 'camst err';
      return { view: view, stop: () => {}, start: () => {} };
    }
    p = CD.cameraPlayer.create(video, '/api/cameras/' + encodeURIComponent(cam.id) + '/stream', (kind, text) => {
      st.textContent = text; st.className = 'camst' + (kind === 'play' ? ' off' : kind === 'err' ? ' err' : '');
    });
    return { view: view, start: () => p.start(), stop: () => p.stop() };
  }

  // Uma câmera numa janela própria (várias podem ficar abertas lado a lado).
  DK.cameraWindow = function (cam) {
    DK.openWindow('cam:' + cam.id, '📷 ' + cam.name, (body, win) => {
      body.className = 'body flush';
      const live = liveView(cam);
      const full = el('button', { textContent: '⛶ Tela cheia', onclick: () => { if (live.view.requestFullscreen) live.view.requestFullscreen(); } });
      body.append(el('div', { className: 'tb' }, full, el('span', { className: 'sp' }), el('span', { className: 'meta', textContent: cam.name })), live.view);
      live.start();
      win._onClose = () => live.stop();
    }, 520, 360, { flush: true });
  };

  // Todas as câmeras numa janela só, em grade.
  DK.cameraMosaic = function (cams) {
    DK.openWindow('cam:mosaic', '📷 Mosaico de câmeras', (body, win) => {
      body.className = 'body flush';
      const grid = el('div', { className: 'mosaic' });
      const cols = Math.ceil(Math.sqrt(cams.length));
      grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
      const lives = cams.map(c => {
        const l = liveView(c);
        l.view.append(el('div', { className: 'camname', textContent: c.name }));
        grid.append(l.view);
        return l;
      });
      body.append(grid);
      lives.forEach(l => l.start());
      win._onClose = () => lives.forEach(l => l.stop());
    }, 760, 520, { flush: true });
  };

  DK.camerasApp = function () {
    DK.openWindow('cameras', 'Gestor de Câmeras', (body, win) => {
      const msg = el('div', { className: 'err' });
      const list = el('div', { className: 'camlist' });
      const tabs = el('div', { className: 'row' });
      const view = el('div', { style: 'display:grid;gap:10px' });
      body.append(tabs, msg, view);
      let cams = [], tab = 'ver';

      const bVer = el('button', { className: 'pri', textContent: 'Câmeras', onclick: () => { tab = 'ver'; draw(); } });
      const bGer = el('button', { textContent: 'Gerenciar', onclick: () => { tab = 'ger'; draw(); } });
      tabs.append(bVer);
      if (DK.me.is_admin) tabs.append(bGer);
      tabs.append(el('a', { href: 'camaras.html', target: '_blank', textContent: 'Gravações e página de câmeras ↗', style: 'margin-left:auto;font-size:12px' }));

      async function load() {
        try { cams = await DK.hub('GET', '/api/cameras'); msg.textContent = ''; } catch (e) { msg.textContent = e.message; cams = []; }
        draw();
      }

      function drawView() {
        view.replaceChildren();
        if (!cams.length) { view.append(el('div', { className: 'meta', textContent: DK.me.is_admin ? 'Nenhuma câmera cadastrada. Use a aba Gerenciar.' : 'Nenhuma câmera cadastrada. Peça ao administrador.' })); return; }
        view.append(el('div', { className: 'row' },
          el('button', { className: 'pri', textContent: '🗔 Abrir todas em janelas', onclick: () => cams.forEach(DK.cameraWindow) }),
          el('button', { textContent: '▦ Mosaico (uma janela)', onclick: () => DK.cameraMosaic(cams) })));
        list.replaceChildren();
        cams.forEach(c => list.append(el('div', { className: 'camrow' }, el('span', { textContent: '📷' }), el('b', { textContent: c.name }),
          el('button', { className: 'pri', textContent: 'Abrir em janela', onclick: () => DK.cameraWindow(c) }))));
        view.append(list);
      }

      // Só o administrador: lista editável (nome e endereço RTSP). O endereço aparece mascarado; deixá-lo assim mantém o atual.
      async function drawManage() {
        view.replaceChildren(el('div', { className: 'meta', textContent: 'Carregando…' }));
        let rows;
        try { rows = await DK.api('GET', '/admin/cameras'); } catch (e) { view.replaceChildren(el('div', { className: 'err', textContent: e.message })); return; }
        const tb = el('tbody'), res = el('div', { className: 'err' });
        const addRow = r => {
          const name = el('input', { value: r.name, placeholder: 'Nome (ex.: Sala)', maxLength: 40 });
          const url = el('input', { value: r.url, placeholder: 'rtsp://usuário:senha@192.168.0.x:554/…?subtype=1' });
          const tr = el('tr', {}, el('td', {}, name), el('td', {}, url), el('td', {}, el('button', { className: 'del', textContent: 'Remover', onclick: () => tr.remove() })));
          tr._id = r.id || ''; tr._name = name; tr._url = url;
          tb.append(tr);
        };
        rows.forEach(addRow);
        const save = el('button', { className: 'pri', textContent: '💾 Salvar câmeras' });
        save.onclick = async () => {
          const payload = [].slice.call(tb.children).map(tr => ({ id: tr._id, name: tr._name.value, url: tr._url.value }));
          try {
            await DK.api('PUT', '/admin/cameras', payload);
            res.className = 'ok'; res.textContent = 'Câmeras salvas.';
            await load(); tab = 'ger'; drawManage();
          } catch (e) { res.className = 'err'; res.textContent = e.message; }
        };
        view.replaceChildren(
          el('div', { className: 'meta', textContent: 'Só o administrador altera as câmeras. Use o endereço RTSP com subtype=1 (H.264). Até 16 câmeras.' }),
          el('table', {}, el('thead', {}, el('tr', {}, el('th', { textContent: 'Nome' }), el('th', { textContent: 'Endereço RTSP' }), el('th'))), tb),
          el('div', { className: 'row' }, el('button', { textContent: '+ Adicionar câmera', onclick: () => addRow({ id: '', name: '', url: '' }) }), save), res);
      }

      function draw() {
        bVer.className = tab === 'ver' ? 'pri' : ''; bGer.className = tab === 'ger' ? 'pri' : '';
        if (tab === 'ger' && DK.me.is_admin) drawManage(); else drawView();
      }
      load();
    }, 520, 440);
  };

  DK.register({ id: 'cameras', icon: '📷', label: 'Câmeras', desktop: true, open: DK.camerasApp });
})(window.DK = window.DK || {});
