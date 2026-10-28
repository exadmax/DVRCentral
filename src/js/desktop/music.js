(function (DK) {
  // Player de Música: o Webamp (um Winamp 2 em JavaScript, MIT, dentro do hub em src/vendor/webamp), solto sobre a área de trabalho. As músicas são as da
  // pasta Músicas de Meus arquivos (e subpastas); dá para enviar outras do aparelho, escolher arquivos de qualquer pasta sua e trocar o skin (.wsz).
  const el = DK.el;
  const DIR = '/Músicas';
  const AUDIO = /\.(mp3|m4a|ogg|wav|flac)$/i;            // os tipos que o servidor entrega como áudio
  const MAX_TRACKS = 3000, MAX_DEPTH = 3;
  const FEED_FIRST = 4, FEED_STEP = 2, FEED_EVERY_MS = 2500, FEED_HIDDEN_MS = 5000;   // lista entregue ao Webamp em lotes (ver feed)
  const home = p => ({ space: 'home', path: p });
  const track = (path, name) => ({ url: location.origin + DK.fileUrl(home(path), 'view'), defaultName: name.replace(/\.[^.]+$/, '') });
  const mkdir = p => DK.api('POST', '/fs/mkdir', { space: 'home', path: p }).catch(() => { /* já existe */ });

  async function scan(dir, depth, out) {
    let r;
    try { r = await DK.api('GET', '/fs/list?space=home&path=' + encodeURIComponent(dir)); } catch (e) { return; }
    const items = (r.entries || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true }));
    for (const e of items) {
      if (out.length >= MAX_TRACKS) return;
      if (e.type === 'dir') { if (depth < MAX_DEPTH) await scan(dir + '/' + e.name, depth + 1, out); }
      else if (AUDIO.test(e.name)) out.push(track(dir + '/' + e.name, e.name));
    }
  }

  // O Webamp é carregado na própria página do Diogows (sem iframe): as janelas dele (player, equalizador e lista) ficam soltas sobre a área de
  // trabalho, como no Winamp. Uma janelinha do Diogows, "Player de Música", guarda os botões (enviar, pasta, skin), dá o item na barra de tarefas e
  // controla o resto: minimizar esconde o Webamp, fechar o encerra (e fechar o player do Webamp fecha a janelinha).
  let loading = null;
  const loadWebamp = () => loading || (loading = new Promise((ok, no) => {
    if (window.Webamp) return ok();
    const s = el('script', { src: 'vendor/webamp/webamp.bundle.min.js' });
    s.onload = () => ok(); s.onerror = () => { loading = null; no(new Error('o player não carregou')); };
    document.head.append(s);
  }));

  DK.musicApp = function () {
    DK.openWindow('music', 'Player de Música', (body, win) => {
      const upIn = el('input', { type: 'file', accept: '.mp3,.m4a,.ogg,.wav,.flac,audio/*', multiple: true });
      upIn.style.display = 'none';
      const bUp = el('button', { textContent: '⬆ Enviar músicas', title: 'Envia músicas do seu aparelho para Meus arquivos/Músicas e as coloca na lista' });
      const bPick = el('button', { textContent: '📂 Da minha pasta', title: 'Adiciona à lista um arquivo de áudio de Meus arquivos' });
      const bSkin = el('button', { textContent: '🎨 Skin', title: 'Troca a aparência por um skin do Winamp (.wsz) de Meus arquivos' });
      const bReload = el('button', { textContent: '🔄 Recarregar pasta', title: 'Lê de novo Meus arquivos/Músicas e reinicia a lista' });
      const info = el('div', { className: 'meta', style: 'padding:2px 2px 0' });
      body.append(el('div', { className: 'row', style: 'flex-wrap:wrap' }, bUp, bPick, bSkin, bReload), info, upIn);

      const box = el('div');                                   // contêiner do Webamp: o React renderiza dentro dele (as janelas vão para o body)
      document.body.append(box);
      let webamp = null, known = new Set(), gone = false;
      const fresh = list => list.filter(t => !known.has(t.url) && known.add(t.url));

      // a janelinha minimizada esconde o Webamp; ao voltar, ele reaparece
      const watch = new MutationObserver(() => { document.body.classList.toggle('webampoff', win.classList.contains('min')); });
      watch.observe(win, { attributes: true, attributeFilter: ['class'] });

      // O Webamp baixa cada arquivo para descobrir a duração; com a lista inteira de uma vez eram 6 a 10 MP3 em paralelo no disco do servidor a cada
      // abertura. A primeira leva vai já, o resto entra aos poucos (e só com a aba visível).
      let feeder = null;
      function feed(rest) {
        clearTimeout(feeder);
        const step = () => {
          feeder = null;
          if (gone || !webamp || !rest.length) return;
          if (document.hidden) { feeder = setTimeout(step, FEED_HIDDEN_MS); return; }
          try { webamp.appendTracks(rest.splice(0, FEED_STEP)); } catch (e) { return; }
          if (rest.length) feeder = setTimeout(step, FEED_EVERY_MS);
        };
        if (rest.length) feeder = setTimeout(step, FEED_EVERY_MS);
      }
      function stop() { clearTimeout(feeder); feeder = null; try { if (webamp) webamp.dispose(); } catch (e) { /* já encerrado */ } webamp = null; }
      async function load() {
        info.textContent = 'Lendo a pasta Músicas…';
        await mkdir(DIR);
        const tracks = []; await scan(DIR, 0, tracks);
        known = new Set(); fresh(tracks);
        info.textContent = tracks.length ? tracks.length + ' música' + (tracks.length > 1 ? 's' : '') + ' em Meus arquivos/Músicas' + (tracks.length >= MAX_TRACKS ? ' (limite)' : '') : 'Pasta Músicas vazia: envie músicas ou escolha da sua pasta';
        try { await loadWebamp(); } catch (e) { info.textContent = 'Não foi possível carregar o player: ' + e.message; return; }
        if (gone) return;
        if (!Webamp.browserIsSupported()) { info.textContent = 'Este navegador não suporta o player de música.'; return; }
        stop();
        const skin = DK.prefs.webampSkin ? DK.fileUrl(home(DK.prefs.webampSkin), 'download') : null;
        // as janelas do Webamp começam no canto direito da área de trabalho (ou à esquerda, em tela estreita)
        const left = Math.max(0, innerWidth - 290), top = 16;
        const opt = {
          initialTracks: tracks.slice(0, FEED_FIRST), enableHotkeys: false,      // sem atalhos globais: as teclas continuam valendo para os outros aplicativos
          windowLayout: {
            main: { position: { top: top, left: left }, shadeMode: false, closed: false },
            equalizer: { position: { top: top + 116, left: left }, shadeMode: false, closed: false },
            playlist: { position: { top: top + 232, left: left }, shadeMode: false, size: { extraHeight: 2, extraWidth: 0 }, closed: false }
          }
        };
        if (skin) opt.initialSkin = { url: skin };
        const w = new Webamp(opt); webamp = w;
        w.onClose(() => DK.closeWin(win, true));
        w.onTrackDidChange(t => win.setTitle(t ? (t.metaData && t.metaData.artist ? t.metaData.artist + ' - ' : '') + (t.metaData && t.metaData.title || t.defaultName || '') + ' · Player de Música' : 'Player de Música'));
        try { await w.renderWhenReady(box); } catch (e) { info.textContent = 'Não foi possível iniciar o player: ' + (e && e.message || e); return; }
        if (webamp === w) feed(tracks.slice(FEED_FIRST));
      }

      bReload.onclick = load;
      bPick.onclick = () => DK.pickFile('video', 'Escolher uma música', it => {
        if (it.space !== 'home' || !AUDIO.test(it.name)) { DK.toast('Escolha um arquivo de áudio (mp3, m4a, ogg, wav ou flac) de Meus arquivos.'); return; }
        const t = fresh([track(it.path, it.name)]);
        if (t.length && webamp) webamp.appendTracks(t); else if (!t.length) DK.toast('Essa música já está na lista.');
      });
      bSkin.onclick = () => DK.pickFile('any', 'Escolher um skin do Winamp (.wsz)', it => {
        if (it.space !== 'home' || !/\.wsz$/i.test(it.name)) { DK.toast('Escolha um arquivo .wsz de Meus arquivos.'); return; }
        DK.prefs.webampSkin = it.path; DK.savePrefs();
        if (webamp) webamp.setSkinFromUrl(DK.fileUrl(home(it.path), 'download'));
      });
      bUp.onclick = () => upIn.click();
      upIn.onchange = async () => {
        const files = [...upIn.files].filter(f => AUDIO.test(f.name)); upIn.value = '';
        if (!files.length) { DK.toast('Escolha arquivos mp3, m4a, ogg, wav ou flac.'); return; }
        await mkdir(DIR);
        const added = []; let n = 0;
        for (const f of files) {
          info.textContent = 'Enviando ' + (++n) + ' de ' + files.length + '…';
          const name = f.name.replace(/[\/\\]/g, '_'), path = DIR + '/' + name;
          try { await DK.api('PUT', '/fs/file?space=home&overwrite=1&path=' + encodeURIComponent(path), f, true); added.push(track(path, name)); }
          catch (e) { DK.toast('“' + f.name + '”: ' + e.message); }
        }
        const t = fresh(added);
        if (t.length && webamp) webamp.appendTracks(t);
        info.textContent = added.length + ' enviada' + (added.length === 1 ? '' : 's') + ' para Meus arquivos/Músicas';
      };
      win._onClose = () => { gone = true; watch.disconnect(); stop(); box.remove(); document.body.classList.remove('webampoff'); };
      load();
    }, 340, 150);
  };

})(window.DK = window.DK || {});
