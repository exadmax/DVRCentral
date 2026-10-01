(function (CD) {
  // Página "Config" (config.html): uso de CPU/memória do servidor e dois botões para aliviá-lo — desligar o desktop da
  // máquina e desativar a própria central (hub). Nada disso é permanente: o desktop volta no próximo reinício.
  // Também configura a gravação das câmeras, por câmera: liga/desliga, modo (contínuo ou só com movimento), sensibilidade, dias de retenção e limite de GB.
  const U = CD.util, esc = U.esc;

  const nf = (n, d) => n.toFixed(d).replace('.', ',');
  const bytes = b => b >= 1073741824 ? nf(b / 1073741824, 1) + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB';

  function meter(label, pct, detail) {
    return '<div class="cfg-m"><div class="cfg-mh"><span>' + esc(label) + '</span><b>' + nf(pct, 0) + '%</b></div>' +
      '<div class="cfg-bar"><i style="width:' + Math.max(1, Math.min(100, pct)) + '%"></i></div><div class="cfg-md">' + esc(detail) + '</div></div>';
  }

  function mount(root) {
    root.innerHTML = '<section class="pg"><div class="cfg" id="cfg"></div></section>';
    const box = root.querySelector('#cfg');
    let sys = null, rec = null, msg = '', recMsg = '', armed = '', armTimer = 0;

    function draw() {
      if (!CD.state.hub) { box.innerHTML = '<div class="empty">Sem o hub: abra o painel pelo endereço do servidor da casa.</div>'; return; }
      if (!sys) { box.innerHTML = '<div class="empty">Carregando…</div>'; return; }
      const can = sys.control;
      box.innerHTML = recCard() +
        '<div class="cfg-card"><h2>Servidor</h2><div class="cfg-ms">' +
        meter('Hub · CPU', sys.appCpuPercent, 'da CPU total (' + sys.cores + ' núcleos)') +
        meter('Hub · memória', sys.appMemPercent, bytes(sys.appMem) + ' da RAM') +
        meter('Máquina · CPU', sys.cpuPercent, sys.cores + ' núcleos') +
        meter('Máquina · memória', sys.memPercent, bytes(sys.memUsed) + ' de ' + bytes(sys.memTotal)) +
        '</div></div>' +
        '<div class="cfg-card"><h2>Liberar memória</h2>' +
        action('desktop', 'Desligar o desktop', 'Para o ambiente gráfico do servidor (tela, navegador, áudio do desktop). Volta sozinho no próximo reinício da máquina.',
          can && sys.desktop, !can ? 'Só no servidor Linux.' : !sys.desktop ? 'O desktop já está desligado.' : '') +
        action('hub', 'Desativar a central', 'Para o hub: o painel, as câmeras e a agenda saem do ar até alguém ligar de novo no servidor com “sudo systemctl start centraldiogo-hub”.',
          can, !can ? 'Só no servidor Linux.' : '', true) +
        (msg ? '<div class="cfg-msg">' + esc(msg) + '</div>' : '') + '</div>';
    }

    function sw(id, on, label) {
      return '<button type="button" class="cfg-sw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" aria-label="' + esc(label) + '" data-sw="' + esc(id) + '"></button>';
    }

    function sel(cam, field, value, opts) {
      const have = opts.some(o => o[0] === value);
      return '<select class="cfg-sel" data-cam="' + esc(cam) + '" data-f="' + field + '">' + opts.map(o =>
        '<option value="' + o[0] + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') +
        (have ? '' : '<option value="' + value + '" selected>' + esc(String(value)) + '</option>') + '</select>';
    }
    function row(title, text, control) {
      return '<div class="cfg-a"><div class="cfg-at"><b>' + esc(title) + '</b><span>' + esc(text) + '</span></div>' + control + '</div>';
    }

    const DAYS = [1, 2, 3, 5, 7, 10, 14, 30, 60].map(d => [d, d + (d === 1 ? ' dia' : ' dias')]);
    const GBS = [[0, 'Sem limite']].concat([5, 10, 20, 50, 100, 200, 500].map(g => [g, g + ' GB']));
    const SENS = [[1, '1 · baixa'], [2, '2'], [3, '3 · média'], [4, '4'], [5, '5 · alta']];

    function camBlock(c) {
      const motion = c.mode === 'motion';
      const state = !rec.enabled ? 'gravação geral desligada' : !c.enabled ? 'desligada para esta câmera' : c.error ? c.error :
        motion ? (c.motion ? 'gravando: movimento detectado' : c.recording ? 'gravando (fim do movimento)' : 'aguardando movimento') :
        c.recording ? 'gravando agora' : 'iniciando…';
      const cls = rec.enabled && c.enabled ? (c.error ? 'cfg-bad' : c.recording ? 'cfg-ok' : '') : '';
      return '<div class="cfg-cam"><div class="cfg-a"><div class="cfg-at"><b>' + esc(c.name) + '</b><span class="' + cls + '">' + esc(state) + ' · ' +
        c.files + ' arquivo(s), ' + bytes(c.usedBytes) + '</span></div>' + sw('cam:' + c.id, c.enabled, 'Gravar ' + c.name) + '</div>' +
        (c.enabled ? '<div class="cfg-opts">' +
          row('Modo', motion ? 'Só grava quando detecta movimento (com alguns segundos antes e depois).' : 'Grava o tempo todo, 1 arquivo por hora.',
            sel(c.id, 'mode', c.mode, [['continuous', 'Contínuo'], ['motion', 'Só com movimento']])) +
          (motion ? row('Sensibilidade', 'Mais alta pega movimentos pequenos, mas dispara mais com sombra e mudança de luz.', sel(c.id, 'sensitivity', c.sensitivity, SENS)) : '') +
          row('Guardar por', 'Gravações mais antigas são apagadas sozinhas.', sel(c.id, 'retentionDays', c.retentionDays, DAYS)) +
          row('Limite de espaço', 'Passou disso, apaga as mais antigas desta câmera.', sel(c.id, 'maxGB', c.maxGB, GBS)) + '</div>' : '') + '</div>';
    }

    function recCard() {
      if (!rec) return '<div class="cfg-card"><h2>Gravação das câmeras</h2><div class="cfg-msg">' + esc(recMsg || 'Carregando…') + '</div></div>';
      return '<div class="cfg-card"><h2>Gravação das câmeras</h2>' +
        row('Gravar as câmeras', (rec.enabled ? 'Ligada. ' : 'Desligada. ') + 'Arquivos NOME_AAAAMMDDHH.mp4 em ' + rec.dir + '. Total: ' + rec.files + ' arquivo(s), ' + bytes(rec.usedBytes) +
          '. Veja em Câmeras → Gravações.', sw('master', rec.enabled, 'Gravar as câmeras')) +
        (rec.cameras || []).map(camBlock).join('') +
        (recMsg ? '<div class="cfg-msg">' + esc(recMsg) + '</div>' : '') + '</div>';
    }

    async function saveRec(patch) {
      recMsg = '';
      try { rec = await CD.hubApi.recordings.save(patch); } catch (e) { recMsg = e.message; }
      draw();
    }

    function action(id, title, text, enabled, why, danger) {
      const on = armed === id;
      return '<div class="cfg-a"><div class="cfg-at"><b>' + esc(title) + '</b><span>' + esc(why || text) + '</span></div>' +
        '<button type="button" class="btn' + (danger ? ' danger' : '') + (on ? '' : ' ghost') + '" data-act="' + id + '"' + (enabled ? '' : ' disabled') + '>' +
        (on ? 'Confirmar?' : esc(title)) + '</button></div>';
    }

    async function load() {
      if (!CD.state.hub) return draw();
      try { sys = await CD.hubApi.system(); } catch (e) { /* mantém o anterior */ }
      try { rec = await CD.hubApi.recordings.settings(); } catch (e) { if (!rec) recMsg = e.message; }
      draw();
    }

    // Primeiro toque arma o botão (5 s); o segundo executa.
    box.addEventListener('change', e => {
      const t = e.target;
      if (!t.hasAttribute || !t.hasAttribute('data-f')) return;
      const o = {}, f = t.getAttribute('data-f');
      o[f] = f === 'mode' ? t.value : +t.value;
      const cams = {}; cams[t.getAttribute('data-cam')] = o;
      saveRec({ cameras: cams });
    });
    box.addEventListener('click', async e => {
      const t = e.target.closest && e.target.closest('[data-sw]');
      if (t && rec) {
        const id = t.getAttribute('data-sw');
        if (id === 'master') saveRec({ enabled: !rec.enabled });
        else { const c = (rec.cameras || []).filter(x => 'cam:' + x.id === id)[0]; if (c) { const o = {}; o[c.id] = { enabled: !c.enabled }; saveRec({ cameras: o }); } }
        return;
      }
      const b = e.target.closest && e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const id = b.getAttribute('data-act');
      if (armed !== id) {
        armed = id; msg = ''; draw();
        clearTimeout(armTimer); armTimer = setTimeout(() => { armed = ''; draw(); }, 5000);
        return;
      }
      clearTimeout(armTimer); armed = ''; b.disabled = true;
      try {
        await CD.hubApi.power(id === 'hub' ? 'hub-off' : 'desktop-off');
        msg = id === 'hub' ? 'Central desativada. Para ligar de novo: sudo systemctl start centraldiogo-hub' : 'Desktop desligando… a memória livre aparece aqui em instantes.';
        if (id === 'hub') { clearInterval(tick); sys = null; box.innerHTML = '<div class="cfg-card"><h2>Central desativada</h2><div class="cfg-msg">' + esc(msg) + '</div></div>'; return; }
        setTimeout(load, 4000);
      } catch (err) { msg = err.message; }
      draw();
    });

    load();
    const tick = setInterval(() => { if (!armed && !(document.activeElement && document.activeElement.tagName === 'SELECT')) load(); }, 5000);
  }

  CD.pages = CD.pages || {};
  CD.pages.config = { label: 'Config', sub: 'servidor', icon: 'gear', mount: mount };
})(window.CD = window.CD || {});
