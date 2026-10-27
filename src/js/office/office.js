// LiteOffice Completo: abre um arquivo do Diogows no LibreOffice compilado para WebAssembly (ZetaOffice), que roda no navegador de quem usa.
// O servidor só entrega o arquivo e guarda o resultado; nada é processado nele. Esta página precisa de "isolamento de origem cruzada"
// (o hub já manda COOP/COEP para office.html) e de contexto seguro: HTTPS ou localhost. Veja docs/desktop.md, seção "LiteOffice Completo".
// Modelo do exemplo "web-office" do zetajs (MIT, allotropia).
'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const space = q.get('space') === 'machine' ? 'machine' : 'home', fpath = q.get('path') || '', sudo = q.get('sudo') === '1';
  const name = fpath.split('/').pop() || 'documento';
  const ext = ((name.match(/\.([A-Za-z0-9]+)$/) || [])[1] || 'odt').toLowerCase();
  const FSNAME = 'documento.' + ext;       // nome fixo e simples dentro do WebAssembly (acentos e espaços do nome original não entram em URLs file://)
  let thr = null, ready = false, saving = false, modified = false, saveId = 0, loaded = false;

  document.title = name + ' — LiteOffice Completo';
  $('name').textContent = name;

  const say = (msg, hint) => { $('msg').textContent = msg; $('hint').textContent = hint || ''; };
  const fail = (msg, hint) => { $('loading').classList.add('err'); $('loading').style.display = ''; say(msg, hint); };

  // De onde vêm os arquivos do LibreOffice (soffice.js, soffice.wasm, soffice.data, ~50 MB): do CDN do ZetaOffice ou de uma cópia sua, definida
  // em config/settings.js (zetaoffice.base). Isso NUNCA vem da URL da página: um link montado por outra pessoa não pode escolher que código executar aqui.
  const cfg = Object.assign({}, (window.CD_SETTINGS || {}).zetaoffice, (window.CD_SETTINGS_LOCAL || {}).zetaoffice);
  let base = String(cfg.base || 'https://cdn.zetaoffice.net/zetaoffice_latest/');
  if (!/\/$/.test(base)) base += '/';
  base = new URL(base, location.href).href;
  const abs = p => new URL(p, location.href).href;

  const fsUrl = (path, extra) => '/api/desk/fs/' + path + '?space=' + space + (sudo ? '&sudo=1' : '') + '&path=' + encodeURIComponent(fpath) + extra;
  async function fetchDoc() {
    const r = await fetch(fsUrl('read', '&mode=download'), { credentials: 'same-origin' });
    if (!r.ok) {
      let m = 'erro ' + r.status;
      try { m = (await r.json()).error || m; } catch (e) { /* sem corpo */ }
      throw new Error(m + (space === 'machine' ? ' (arquivos do Computador precisam estar desbloqueados no Explorer)' : ''));
    }
    return new Uint8Array(await r.arrayBuffer());
  }
  async function upload(bytes) {
    const r = await fetch(fsUrl('file', '&overwrite=1'), { method: 'PUT', body: new Blob([bytes]), credentials: 'same-origin', headers: { 'X-Desk': '1' } });
    if (!r.ok) {
      let m = 'erro ' + r.status;
      try { m = (await r.json()).error || m; } catch (e) { /* sem corpo */ }
      throw new Error(m);
    }
  }

  function save() {
    if (!ready || saving) return;
    saving = true; $('save').disabled = true; $('state').textContent = 'Salvando…';
    thr.postMessage({ cmd: 'save', id: ++saveId });
  }
  $('save').onclick = save;
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopImmediatePropagation(); save(); }
  }, true);
  window.addEventListener('beforeunload', e => { if (modified) { e.preventDefault(); e.returnValue = ''; } });

  function onMessage(e) {
    const m = e.data;
    switch (m.cmd) {
    case 'thr_running':
      (async () => {
        say('Baixando o arquivo do Diogows…');
        let bytes;
        try { bytes = await fetchDoc(); } catch (x) { fail('Não foi possível abrir “' + name + '”.', x.message); return; }
        try { FS.mkdir('/tmp/office/'); } catch (x) { /* já existe */ }
        FS.writeFile('/tmp/office/' + FSNAME, bytes);
        say('Abrindo no LibreOffice…');
        thr.postMessage({ cmd: 'upload', filename: FSNAME });
      })();
      break;
    case 'ui_ready':
      window.dispatchEvent(new Event('resize'));           // o Qt só ajusta o tamanho da janela interna depois disso
      setTimeout(() => {
        $('loading').style.display = 'none'; $('qtcanvas').style.visibility = 'visible'; $('qtcanvas').focus();
        ready = true; $('save').disabled = false; $('state').textContent = 'pronto';
        setInterval(() => { if (ready && !saving) thr.postMessage({ cmd: 'status' }); }, 2500);
      }, 800);
      break;
    case 'status':
      modified = !!m.modified;
      if (!saving) $('state').textContent = modified ? '● modificado' : 'salvo';
      break;
    case 'saved':
      (async () => {
        try { await upload(FS.readFile('/tmp/office/' + FSNAME)); modified = false; $('state').textContent = 'salvo no Diogows às ' + new Date().toLocaleTimeString('pt-BR'); }
        catch (x) { $('state').textContent = 'erro ao salvar: ' + x.message; }
        saving = false; $('save').disabled = false;
      })();
      break;
    case 'save_error':
      saving = false; $('save').disabled = false; $('state').textContent = 'erro ao salvar: ' + m.error;
      break;
    }
  }

  // ---------- início ----------
  if (!fpath) { fail('Nenhum arquivo informado.', 'Abra esta página pelo Diogows (Explorer → botão direito → Abrir no Office completo).'); return; }
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    fail('Este navegador não liberou o recurso que o LibreOffice precisa (SharedArrayBuffer).',
      window.isSecureContext ? 'O endereço está seguro, mas a página não está isolada: confira se o hub (ou o nginx na frente dele) está entregando office.html com os cabeçalhos Cross-Origin-Opener-Policy: same-origin e Cross-Origin-Embedder-Policy: require-corp.'
        : 'Esta página está em HTTP puro (' + location.origin + '). O navegador só libera isso em HTTPS ou em localhost. Acesse o Diogows por HTTPS (veja docs/desktop.md) ou por http://localhost.');
    return;
  }
  say('Carregando o LibreOffice…', 'Na primeira vez são ~50 MB (do ' + new URL(base).host + '); depois o navegador guarda em cache. Precisa de ~1 GB de memória livre no seu computador.');
  const canvas = $('qtcanvas');
  window.Module = {
    canvas: canvas,
    uno_scripts: [abs('vendor/zetajs/zeta.js'), abs('js/office/office_thread.js')],
    locateFile: (path, prefix) => (prefix || base) + path,
    mainScriptUrlOrBlob: new Blob(['importScripts(' + JSON.stringify(base + 'soffice.js') + ');'], { type: 'text/javascript' })
  };
  canvas.addEventListener('wheel', e => e.preventDefault(), { passive: false });      // a rolagem é só do canvas
  let lastDpr = window.devicePixelRatio;
  window.onresize = function () {         // avisa o Qt quando o zoom do navegador muda
    setTimeout(() => {
      if (lastDpr) { if (lastDpr !== window.devicePixelRatio) { lastDpr = false; window.dispatchEvent(new Event('resize')); } }
      else { lastDpr = window.devicePixelRatio; window.dispatchEvent(new Event('resize')); }
    }, 100);
  };
  const s = document.createElement('script');
  s.src = base + 'soffice.js';
  s.onerror = () => fail('Não foi possível baixar o LibreOffice.', 'Endereço: ' + base + ' — verifique a internet ou o endereço configurado em zetaoffice.base (config/settings.js).');
  s.onload = () => {
    loaded = true;
    window.Module.uno_main.then(port => { thr = port; thr.onmessage = onMessage; });
  };
  document.body.appendChild(s);
  setTimeout(() => { if (!loaded) say('Ainda baixando o LibreOffice…', 'A conexão está lenta; aguarde.'); }, 20000);
})();
