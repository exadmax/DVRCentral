(function (DK) {
  // Navegador: abre páginas pelo servidor (só sites da internet, sem scripts) e baixa arquivos para "Meus arquivos/Downloads".
  // Não é um Chrome: sites que dependem de JavaScript aparecem vazios. Serve para páginas de texto, buscas e páginas de download.
  const el = DK.el, esc = DK.esc;
  const SEARCH = 'https://html.duckduckgo.com/html/?q=';
  const HOME = 'https://html.duckduckgo.com/html/';

  function normalize(input) {
    const t = input.trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    if (/^[^\s\/]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return 'https://' + t;
    return SEARCH + encodeURIComponent(t);
  }
  const page = (title, body) => '<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;margin:24px;color:#1c2430"><h2>' + esc(title) + '</h2>' + body;

  DK.browserApp = function (o) {
    o = o || {};
    const win = DK.openWindow('browser', 'Navegador', (body, win) => {
      body.className = 'body flush';
      let hist = [], idx = -1, current = '', jobs = [], poll = 0;
      const back = el('button', { textContent: '◀', title: 'Voltar' }), fwd = el('button', { textContent: '▶', title: 'Avançar' });
      const reload = el('button', { textContent: '⟳', title: 'Recarregar' }), home = el('button', { textContent: '🏠', title: 'Início (busca)' });
      const addr = el('input', { placeholder: 'Digite um endereço ou o que procurar', spellcheck: false });
      const go = el('button', { className: 'pri', textContent: 'Ir' });
      const dlb = el('button', { textContent: '⬇ Downloads', title: 'Downloads em andamento e concluídos' });
      const tb = el('div', { className: 'tb' }, back, fwd, reload, home, el('span', { style: 'flex:1;display:flex' }, addr), go, dlb);
      const frame = el('iframe', { className: 'fill', title: 'Página' });
      frame.setAttribute('sandbox', 'allow-same-origin');          // sem scripts: o conteúdo nunca executa nada
      const status = el('div', { className: 'status' });
      const prompt = el('div', { className: 'dwarn hidden' });
      const panel = el('div', { className: 'bpanel hidden' });
      body.append(tb, prompt, frame, panel, status);

      function setDoc(html) { frame.srcdoc = html; }
      function syncUi() { back.disabled = idx <= 0; fwd.disabled = idx >= hist.length - 1; addr.value = current; }

      // Intercepta cliques e buscas dentro da página (é o Desktop que navega, não o iframe)
      frame.addEventListener('load', () => {
        let d; try { d = frame.contentDocument; } catch (e) { return; }
        if (!d) return;
        d.addEventListener('click', e => {
          const a = e.target.closest && e.target.closest('a[href]');
          if (!a) return;
          const h = a.getAttribute('href') || '';
          if (h.charAt(0) === '#') return;                         // âncora da mesma página
          e.preventDefault(); navigate(a.href);
        });
        d.addEventListener('submit', e => {
          e.preventDefault();
          const f = e.target;
          if ((f.method || 'get').toLowerCase() !== 'get') { status.textContent = 'Formulários que enviam dados (POST) não são suportados neste navegador.'; return; }
          const u = new URL(f.getAttribute('action') || current, current);
          new FormData(f).forEach((v, k) => { if (typeof v === 'string') u.searchParams.set(k, v); });
          navigate(u.href);
        });
      });

      async function load(url, push) {
        status.textContent = 'Carregando ' + url + '…';
        prompt.classList.add('hidden');
        let r;
        try { r = await fetch('/api/desk/browse?url=' + encodeURIComponent(url), { credentials: 'same-origin' }); }
        catch (e) { status.textContent = 'Sem conexão com o servidor.'; return; }
        if (!r.ok) {
          let m = 'erro ' + r.status; try { m = (await r.json()).error || m; } catch (e) { /* sem corpo */ }
          setDoc(page('Não foi possível abrir a página', '<p>' + esc(m) + '</p><p style="color:#667085">' + esc(url) + '</p>'));
          status.textContent = m; win.setTitle('Navegador'); return;
        }
        const kind = r.headers.get('X-Browse-Kind'), final = decodeURIComponent(r.headers.get('X-Browse-Url') || url);
        if (kind === 'file') {
          const name = decodeURIComponent(r.headers.get('X-Browse-Name') || 'download'), size = +r.headers.get('X-Browse-Size');
          offerDownload(final, name, size, decodeURIComponent(r.headers.get('X-Browse-Type') || ''));
          status.textContent = 'Este endereço é um arquivo.';
          return;
        }
        if (push) { hist = hist.slice(0, idx + 1); hist.push(final); idx = hist.length - 1; }
        current = final;
        if (kind === 'page') {
          setDoc(await r.text());
          const t = decodeURIComponent(r.headers.get('X-Browse-Title') || '');
          win.setTitle(t ? t.slice(0, 40) + ' — Navegador' : 'Navegador');
          const code = r.headers.get('X-Browse-Status');
          status.textContent = final + (code && code !== '200' ? ' (o site respondeu ' + code + ')' : '');
        } else {
          setDoc(page('', '<img src="/api/desk/browse?r=1&url=' + encodeURIComponent(final) + '" style="max-width:100%">'));
          status.textContent = final;
        }
        syncUi();
      }
      function navigate(input) { const u = normalize(input); if (u) load(u, true); }

      // ---- downloads ----
      function offerDownload(url, name, size, type) {
        prompt.replaceChildren(el('b', { textContent: 'Arquivo: ' + name }), ' ' + (size > 0 ? '(' + DK.fmtSize(size) + ') ' : '') + (type ? '· ' + type + ' ' : ''),
          el('button', { className: 'pri', textContent: '⬇ Baixar para Meus arquivos/Downloads', onclick: () => { prompt.classList.add('hidden'); startDownload(url, name); } }),
          el('button', { textContent: 'Cancelar', onclick: () => prompt.classList.add('hidden') }));
        prompt.classList.remove('hidden');
      }
      async function startDownload(url, name) {
        try { await DK.api('POST', '/downloads', { url: url, name: name }); showPanel(true); refreshJobs(); }
        catch (e) { status.textContent = e.message; }
      }
      async function refreshJobs() {
        try { jobs = await DK.api('GET', '/downloads'); } catch (e) { return; }
        dlb.textContent = '⬇ Downloads' + (jobs.some(j => j.status === 'running') ? ' (' + jobs.filter(j => j.status === 'running').length + ')' : '');
        if (!panel.classList.contains('hidden')) drawPanel();
        clearTimeout(poll);
        if (jobs.some(j => j.status === 'running')) poll = setTimeout(refreshJobs, 1000);
      }
      function drawPanel() {
        panel.replaceChildren(el('div', { className: 'row' }, el('b', { textContent: 'Downloads' }), el('span', { style: 'flex:1' }),
          el('button', { textContent: '📂 Abrir pasta Downloads', onclick: () => DK.explorerApp({ path: '/Downloads' }) }), el('button', { textContent: '✕', onclick: () => showPanel(false) })));
        if (!jobs.length) panel.append(el('div', { className: 'meta', textContent: 'Nenhum download ainda.' }));
        jobs.slice().reverse().forEach(j => {
          const pct = j.size ? Math.min(100, Math.round(j.done * 100 / j.size)) : 0;
          const row = el('div', { className: 'djob' }, el('div', {}, el('b', { textContent: j.name }), ' ', el('span', { className: 'meta', textContent: j.host })));
          const bar = el('div', { className: 'bar' }), i = el('i'); i.style.width = (j.status === 'done' ? 100 : pct) + '%'; bar.append(i);
          const st = { running: DK.fmtSize(j.done) + (j.size ? ' de ' + DK.fmtSize(j.size) : '') + '…', done: 'Concluído · ' + DK.fmtSize(j.size), error: 'Erro: ' + j.error, canceled: 'Cancelado' }[j.status];
          row.append(bar, el('div', { className: 'meta', textContent: st }));
          const act = el('div', { className: 'row' });
          if (j.status === 'done') {
            act.append(el('button', { textContent: '📂 Mostrar', onclick: () => DK.explorerApp({ path: '/Downloads' }) }));
            if (/\.(zip|jsdos)$/i.test(j.name)) act.append(el('button', { textContent: '🕹️ Instalar como programa', onclick: () => DK.installProgramApp({ path: j.path, name: j.name }) }));
          }
          act.append(el('button', { className: j.status === 'running' ? 'del' : '', textContent: j.status === 'running' ? 'Cancelar' : 'Limpar', onclick: async () => { try { await DK.api('DELETE', '/downloads/' + j.id); } catch (e) { /* já saiu */ } refreshJobs(); } }));
          row.append(act); panel.append(row);
        });
      }
      function showPanel(on) { panel.classList.toggle('hidden', !on); if (on) { drawPanel(); refreshJobs(); } }
      dlb.onclick = () => showPanel(panel.classList.contains('hidden'));

      back.onclick = () => { if (idx > 0) { idx--; load(hist[idx], false); } };
      fwd.onclick = () => { if (idx < hist.length - 1) { idx++; load(hist[idx], false); } };
      reload.onclick = () => { if (current) load(current, false); };
      home.onclick = () => load(HOME, true);
      go.onclick = () => navigate(addr.value);
      addr.onkeydown = e => { if (e.key === 'Enter') navigate(addr.value); };
      win._go = u => navigate(u);
      win._onClose = () => clearTimeout(poll);
      syncUi(); refreshJobs();
      setDoc(page('Navegador', '<p>Digite um endereço ou uma busca acima.</p><p style="color:#667085;max-width:46em">Este navegador abre as páginas pelo servidor e <b>não executa JavaScript</b>: sites feitos como aplicativo podem aparecer vazios. Links para arquivos (zip, exe, pdf, iso…) são baixados para <b>Meus arquivos/Downloads</b>, de onde você pode instalá-los em <b>Instalar Programas e Acessórios</b>.</p>'));
      if (!o.url) load(HOME, true);
    }, 900, 600, { flush: true });
    if (o.url) win._go(o.url);
    return win;
  };

  DK.register({ id: 'browser', icon: '🌐', label: 'Navegador', desktop: true, show: me => me.browser, open: () => DK.browserApp() });
})(window.DK = window.DK || {});
