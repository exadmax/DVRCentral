(function (DK) {
  // Zip Manager: abre, cria e altera arquivos .zip, extrai (tudo ou só o escolhido) e compacta arquivos e pastas do Explorer.
  // Tudo roda no navegador (zip.js + CompressionStream/DecompressionStream); o servidor só guarda os arquivos. Lê o diretório central
  // sem descomprimir nada e só descomprime a entrada que for extraída. Sem ZIP64 nem senha (avisa). Ao salvar, as entradas que não
  // mudaram são copiadas já compactadas, então um ZIP grande não é recomprimido.
  const el = DK.el;
  const MAX_TOTAL = 1024 * 1024 * 1024;          // teto do que se carrega na memória do navegador
  const MAX_FILES = 20000;
  const dec = new TextDecoder('utf-8'), WIN = new TextDecoder('windows-1252');

  // ---------- leitura do diretório central ----------
  function listZip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('o arquivo não é um ZIP válido');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    if (count === 0xFFFF || p === 0xFFFFFFFF) throw new Error('ZIP64 (arquivos acima de 4 GB) não é suportado');
    const out = [];
    for (let n = 0; n < count; n++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('diretório do ZIP corrompido');
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), time = dv.getUint16(p + 12, true), date = dv.getUint16(p + 14, true);
      const crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF || lho === 0xFFFFFFFF) throw new Error('ZIP64 (arquivos acima de 4 GB) não é suportado');
      const nb = u8.subarray(p + 46, p + 46 + nlen);
      let name;
      if (flags & 0x800) name = dec.decode(nb);
      else { try { name = new TextDecoder('utf-8', { fatal: true }).decode(nb); } catch (e) { name = WIN.decode(nb); } }
      p += 46 + nlen + xlen + clen;
      out.push({ name: name.replace(/\\/g, '/'), dir: name.endsWith('/'), usize: usize, csize: csize, method: method, crc: crc, enc: !!(flags & 1), lho: lho,
        mtime: new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2) });
    }
    return out;
  }
  function rawOf(u8, e) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (e.lho + 30 > u8.length || dv.getUint32(e.lho, true) !== 0x04034b50) throw new Error('entrada corrompida: ' + e.name);
    const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true);
    if (start + e.csize > u8.length) throw new Error('entrada truncada: ' + e.name);
    return u8.subarray(start, start + e.csize);
  }
  async function dataOf(u8, e) {
    if (e.added) return e.added;
    if (e.enc) throw new Error('“' + e.name + '” tem senha: não dá para extrair');
    const raw = rawOf(u8, e);
    let out;
    if (e.method === 0) out = raw;
    else if (e.method === 8) {
      if (typeof DecompressionStream !== 'function') throw new Error('este navegador não descomprime ZIP (atualize o navegador)');
      out = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    } else throw new Error('método de compressão não suportado (' + e.method + ') em “' + e.name + '”');
    if (out.length !== e.usize || DK.zip.crc32(out) !== e.crc) throw new Error('“' + e.name + '” está corrompido (verificação falhou)');
    return out;
  }

  // nome seguro dentro do destino: sem "..", sem barra inicial, sem letra de unidade, sem nomes vazios
  function safePath(name) {
    const parts = String(name).replace(/\\/g, '/').split('/').filter(x => x && x !== '.');
    if (!parts.length || parts.some(x => x === '..' || /[\0:]/.test(x))) return null;
    return parts.join('/');
  }

  // ---------- arquivos no servidor ----------
  const qs = (it, extra) => '?space=' + it.space + (it.sudo ? '&sudo=1' : '') + '&path=' + encodeURIComponent(it.path) + (extra || '');
  const guard = (it, fn) => it.space === 'machine' ? DK.withUnlock('explorer', !!it.sudo, fn) : fn();
  const ref = (d, path) => ({ space: d.space, sudo: !!d.sudo, path: path });
  const putFile = (it, blob, overwrite) => guard(it, () => DK.api('PUT', '/fs/file' + qs(it, overwrite ? '&overwrite=1' : ''), blob, true));
  const mkdir = (d, path) => guard(d, () => DK.api('POST', '/fs/mkdir', { space: d.space, sudo: !!d.sudo, path: path })).catch(() => { /* já existe */ });
  const listDir = (d, path) => guard(d, () => DK.api('GET', '/fs/list' + qs(ref(d, path)))).then(r => r.entries || []);
  const noExt = n => n.replace(/\.[^.\/]+$/, '');

  // Grava vários arquivos sob dest (pasta), criando as subpastas. files = [{ path (relativo), data: Uint8Array|Blob }]. onStep(i, n, nome) opcional.
  async function writeTree(dest, files, onStep) {
    const made = new Set(), skipped = []; let replaceAll = null;
    for (let i = 0; i < files.length; i++) {
      const f = files[i], rel = f.path.split('/');
      if (onStep) onStep(i, files.length, f.path);
      let acc = dest.path;
      for (let k = 0; k < rel.length - 1; k++) {
        acc = DK.joinPath(acc, rel[k]);
        if (!made.has(acc)) { made.add(acc); await mkdir(dest, acc); }
      }
      if (f.dir) continue;
      const target = ref(dest, DK.joinPath(dest.path, f.path));
      const blob = f.data instanceof Blob ? f.data : new Blob([f.data]);
      for (let ow = replaceAll === true; ;) {
        try { await putFile(target, blob, ow); break; }
        catch (e) {
          if (e.status === 409 && !ow) {
            if (replaceAll === false) { skipped.push(f.path); break; }
            const a = prompt('“' + f.path + '” já existe. Digite S para substituir, T para substituir todos, N para pular, X para pular todos:', 'S');
            const c = String(a || 'N').trim().toUpperCase();
            if (c === 'T') replaceAll = true; if (c === 'X') replaceAll = false;
            if (c === 'S' || c === 'T') { ow = true; continue; }
            skipped.push(f.path); break;
          }
          throw e;
        }
      }
    }
    return skipped;
  }

  // percorre uma pasta do servidor: [{ path relativo, item, dir }]
  async function walk(d, path, base, out) {
    out = out || [];
    for (const e of await listDir(d, path)) {
      if (out.length > MAX_FILES) throw new Error('pasta com arquivos demais (limite ' + MAX_FILES + ')');
      const full = DK.joinPath(path, e.name), rel = base ? base + '/' + e.name : e.name;
      if (e.type === 'dir') { out.push({ rel: rel + '/', dir: true }); await walk(d, full, rel, out); }
      else if (e.type === 'file') out.push({ rel: rel, item: Object.assign(ref(d, full), { name: e.name, size: e.size }) });
    }
    return out;
  }

  // ---------- extrair e compactar sem abrir a janela (menu do Explorer) ----------
  async function extractEntries(u8, list, dest, onStep) {
    const files = [];
    let total = 0;
    for (const e of list) {
      const rel = safePath(e.name);
      if (!rel) continue;
      if (e.dir) { files.push({ path: rel, dir: true }); continue; }
      total += e.usize;
      if (total > MAX_TOTAL) throw new Error('o conteúdo passa de ' + DK.fmtSize(MAX_TOTAL) + ': extraia por partes');
      files.push({ path: rel, data: await dataOf(u8, e) });
    }
    return writeTree(dest, files, onStep);
  }
  DK.zipExtractHere = async function (it) {
    try {
      DK.toast('Lendo ' + it.name + '…');
      const u8 = new Uint8Array(await DK.fetchFile(it, 'download'));
      const list = listZip(u8), dir = it.path.replace(/\/[^\/]*$/, '') || '/', dest = ref(it, DK.joinPath(dir, noExt(it.name)));
      await mkdir(dest, dest.path);
      const skipped = await extractEntries(u8, list, dest, (i, n) => { if (n > 20 && i % 20 === 0) DK.toast('Extraindo ' + (i + 1) + '/' + n + '…'); });
      DK.toast('Extraído em “' + noExt(it.name) + '”' + (skipped.length ? ' (' + skipped.length + ' pulado(s))' : '') + '.');
      document.dispatchEvent(new Event('dkfs'));
    } catch (e) { DK.toast('Zip: ' + e.message); }
  };
  DK.zipCompress = async function (it) {
    try {
      DK.toast('Compactando ' + it.name + '…');
      const dir = it.path.replace(/\/[^\/]*$/, '') || '/';
      const items = it.type === 'dir' ? await walk(it, it.path, it.name) : [{ rel: it.name, item: it }];
      if (it.type === 'dir' && !items.length) items.push({ rel: it.name + '/', dir: true });
      const entries = []; let total = 0;
      for (const f of items) {
        if (f.dir) { entries.push({ name: f.rel, data: new Uint8Array(0), store: true }); continue; }
        total += f.item.size || 0;
        if (total > MAX_TOTAL) throw new Error('passa de ' + DK.fmtSize(MAX_TOTAL) + ': compacte por partes');
        entries.push({ name: f.rel, data: new Uint8Array(await DK.fetchFile(f.item, 'download')) });
      }
      const blob = await DK.zip.write(entries);
      const out = ref(it, DK.joinPath(dir, noExt(it.name) + '.zip'));
      try { await putFile(out, blob, false); }
      catch (e) { if (e.status === 409 && confirm('“' + DK.baseName(out.path) + '” já existe. Substituir?')) await putFile(out, blob, true); else throw e; }
      DK.toast('Criado “' + DK.baseName(out.path) + '” (' + DK.fmtSize(blob.size) + ').');
      document.dispatchEvent(new Event('dkfs'));
    } catch (e) { DK.toast('Zip: ' + e.message); }
  };

  // ---------- a janela ----------
  const fmtD = d => d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fileIcon = e => e.dir ? '📁' : (e.enc ? '🔒' : DK.iconOf({ type: 'file', name: e.name }));

  // o: { item (um .zip do servidor) } ou { dir } (pasta onde salvar um ZIP novo)
  DK.zipApp = function (o) {
    o = o || {};
    const key = o.item ? 'zip:' + o.item.space + ':' + (o.item.sudo ? 's:' : '') + o.item.path : 'zip:new:' + DK.nextDocId();
    return DK.openWindow(key, 'Zip Manager', (body, win) => {
      body.className = 'body flush';
      let item = o.item || null, dir = o.dir || { space: 'home', path: '/' }, u8 = new Uint8Array(0), entries = [], dirty = false, busy = false;
      const sel = new Set();
      const bar = el('div', { className: 'row', style: 'padding:6px 8px;border-bottom:1px solid var(--line)' });
      const search = el('input', { type: 'search', placeholder: 'Filtrar por nome…', style: 'flex:1;min-width:120px;width:auto' });
      const list = el('div', { className: 'flist' }), status = el('div', { className: 'status' });
      body.append(bar, el('div', { className: 'row', style: 'padding:6px 8px;gap:6px' }, search), list, status);
      const say = m => { status.textContent = m; };
      const btn = (t, title, fn) => { const b = el('button', { textContent: t, title: title, onclick: async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { say(e.message); } busy = false; } }); bar.append(b); return b; };
      const title = () => win.setTitle('Zip Manager — ' + (item ? item.name : 'novo') + (dirty ? ' •' : ''));

      const total = () => entries.reduce((a, e) => a + (e.dir ? 0 : e.usize), 0);
      function draw() {
        const f = search.value.trim().toLowerCase();
        const shown = entries.filter(e => !f || e.name.toLowerCase().indexOf(f) >= 0);
        list.replaceChildren();
        if (!entries.length) { list.append(el('div', { className: 'meta', style: 'padding:24px;text-align:center', textContent: 'ZIP vazio. Use “Adicionar” ou arraste arquivos para esta janela.' })); }
        else {
          const all = el('input', { type: 'checkbox', checked: shown.length > 0 && shown.every(e => sel.has(e)) });
          all.onchange = () => { shown.forEach(e => all.checked ? sel.add(e) : sel.delete(e)); draw(); };
          const t = el('table'), tb = el('tbody'); t.append(tb);
          tb.append(el('tr', {}, el('th', {}, all), el('th', { textContent: 'Nome' }), el('th', { textContent: 'Tamanho' }), el('th', { textContent: 'Compactado' }), el('th', { textContent: 'Data' })));
          shown.slice(0, 3000).forEach(e => {
            const c = el('input', { type: 'checkbox', checked: sel.has(e) });
            c.onchange = () => { c.checked ? sel.add(e) : sel.delete(e); upd(); };
            const tr = el('tr', {}, el('td', {}, c), el('td', { className: 'n', textContent: fileIcon(e) + ' ' + e.name, title: e.name }),
              el('td', { className: 'meta', textContent: e.dir ? '' : DK.fmtSize(e.usize) }),
              el('td', { className: 'meta', textContent: e.dir ? '' : (e.added ? 'novo' : DK.fmtSize(e.csize) + (e.usize ? ' (' + Math.round(100 * e.csize / e.usize) + '%)' : '')) }),
              el('td', { className: 'meta', textContent: fmtD(e.mtime) }));
            tr._ctx = () => [
              { icon: '📤', label: 'Extrair…', fn: () => extract([e]) },
              e.dir ? null : { icon: '⬇️', label: 'Baixar este arquivo', fn: () => download(e) },
              '-', { icon: '🗑️', label: 'Remover do ZIP', fn: () => remove([e]), danger: true }];
            tb.append(tr);
          });
          list.append(t);
          if (shown.length > 3000) list.append(el('div', { className: 'meta', style: 'padding:8px', textContent: 'Mostrando 3000 de ' + shown.length + ': use o filtro.' }));
        }
        upd();
      }
      function upd() {
        title();
        const files = entries.filter(e => !e.dir).length;
        say(files + ' arquivo(s), ' + DK.fmtSize(total()) + (sel.size ? ' · ' + sel.size + ' selecionado(s)' : '') + (item ? '' : ' · ainda não salvo'));
        xBtn.textContent = sel.size ? '📤 Extrair selecionados' : '📤 Extrair tudo';
      }

      async function load(it) {
        say('Lendo…');
        const buf = new Uint8Array(await DK.fetchFile(it, 'download'));
        const es = listZip(buf);
        item = it; u8 = buf; entries = es; sel.clear(); dirty = false; draw();
        const enc = es.filter(e => e.enc).length;
        if (enc) say(status.textContent + ' · ' + enc + ' com senha (não extraem)');
      }

      function download(e) {
        dataOf(u8, e).then(d => {
          const a = el('a', { href: URL.createObjectURL(new Blob([d])), download: DK.baseName(e.name) });
          document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }).catch(x => say(x.message));
      }

      function extract(list) {
        const picked = list || (sel.size ? entries.filter(e => sel.has(e)) : entries);
        if (!picked.length) { say('Nada para extrair.'); return; }
        DK.explorerApp({ pick: 'any', pickDir: true, title: 'Extrair para qual pasta?', onPick: async d => {
          if (busy) return; busy = true;
          try {
            const sub = prompt('Extrair numa subpasta (deixe vazio para extrair direto em “' + (d.name || d.path) + '”):', item ? noExt(item.name) : 'extraido');
            if (sub === null) { busy = false; return; }
            const s = sub.trim().replace(/[\/\\]/g, '_');
            const dest = ref(d, s ? DK.joinPath(d.path, s) : d.path);
            if (s) await mkdir(dest, dest.path);
            const skipped = await extractEntries(u8, picked, dest, (i, n, nm) => say('Extraindo ' + (i + 1) + '/' + n + ': ' + nm));
            say('Extraído ' + picked.filter(e => !e.dir).length + ' arquivo(s) em ' + dest.path + (skipped.length ? ' · ' + skipped.length + ' pulado(s)' : '') + '.');
            document.dispatchEvent(new Event('dkfs'));
          } catch (e) { say(e.message); }
          busy = false;
        } });
      }

      function remove(list) {
        if (!list.length) return;
        if (!confirm('Remover ' + list.length + ' item(ns) do ZIP? (Só vale depois de salvar.)')) return;
        const names = new Set(list.map(e => e.name));
        // remover uma pasta leva o que há dentro
        entries = entries.filter(e => !names.has(e.name) && !list.some(x => x.dir && e.name.indexOf(x.name) === 0));
        sel.clear(); dirty = true; draw();
      }

      // adiciona { name, data } (substitui o de mesmo nome, com confirmação)
      async function addBlobs(items) {
        let sum = total();
        for (const f of items) {
          const name = safePath(f.name);
          if (!name) continue;
          const data = f.dir ? new Uint8Array(0) : new Uint8Array(await f.data.arrayBuffer());
          sum += data.length;
          if (sum > MAX_TOTAL) throw new Error('o ZIP passaria de ' + DK.fmtSize(MAX_TOTAL) + ' na memória do navegador');
          const full = f.dir ? name + '/' : name, old = entries.findIndex(e => e.name === full);
          if (old >= 0) { if (!confirm('“' + full + '” já está no ZIP. Substituir?')) continue; entries.splice(old, 1); }
          entries.push({ name: full, dir: !!f.dir, usize: data.length, csize: 0, method: 0, crc: 0, enc: false, lho: 0, mtime: new Date(), added: data });
        }
        entries.sort((a, b) => a.name < b.name ? -1 : 1);
        dirty = true; draw();
      }
      const addDevice = files => addBlobs([].slice.call(files).map(f => ({ name: f.name, data: f })));
      async function addFromServer(it) {
        const buf = await DK.fetchFile(it, 'download');
        await addBlobs([{ name: it.name, data: new Blob([buf]) }]);
      }
      async function addDirFromServer(d) {
        say('Lendo a pasta…');
        const items = await walk(d, d.path, d.name || DK.baseName(d.path));
        const out = [];
        for (const f of items) {
          if (f.dir) out.push({ name: f.rel.replace(/\/$/, ''), dir: true });
          else out.push({ name: f.rel, data: new Blob([await DK.fetchFile(f.item, 'download')]) });
          say('Lendo ' + out.length + '/' + items.length + '…');
        }
        await addBlobs(out);
      }

      async function save(asNew) {
        let target = item, overwrite = !!item;
        if (asNew || !item) {
          const n0 = prompt('Salvar como (nome do .zip):', item ? item.name : 'Arquivo.zip');
          if (!n0) return;
          let n = n0.trim().replace(/[\/\\]/g, '_'); if (!/\.zip$/i.test(n)) n += '.zip';
          const d = item ? { space: item.space, sudo: item.sudo, path: item.path.replace(/\/[^\/]*$/, '') || '/' } : dir;
          target = Object.assign(ref(d, DK.joinPath(d.path, n)), { name: n, type: 'file' }); overwrite = false;
        }
        say('Montando o ZIP…');
        const ents = entries.map(e => e.added || e.dir
          ? { name: e.name, data: e.added || new Uint8Array(0), store: e.dir }
          : (e.enc ? null : { name: e.name, pre: { data: rawOf(u8, e), method: e.method, crc: e.crc, size: e.usize } })).filter(Boolean);
        if (ents.length < entries.length) throw new Error('há itens com senha: não dá para regravar o ZIP sem perdê-los');
        const blob = await DK.zip.write(ents);
        say('Gravando…');
        try { await putFile(target, blob, overwrite); }
        catch (e) { if (e.status === 409 && confirm('“' + target.name + '” já existe. Substituir?')) await putFile(target, blob, true); else throw e; }
        u8 = new Uint8Array(await blob.arrayBuffer()); entries = listZip(u8); item = target; sel.clear(); dirty = false; draw();
        say('Salvo (' + DK.fmtSize(blob.size) + ').');
        document.dispatchEvent(new Event('dkfs'));
      }

      btn('📂 Abrir…', 'Abrir um .zip do servidor', async () => {
        DK.explorerApp({ pick: 'zip', title: 'Escolha o arquivo .zip', onPick: it => { if (dirty && !confirm('Há alterações não salvas. Abrir outro ZIP mesmo assim?')) return; load(it).catch(e => say(e.message)); } });
      });
      btn('🆕 Novo', 'Começar um ZIP vazio', async () => {
        if (dirty && !confirm('Há alterações não salvas. Começar um ZIP novo mesmo assim?')) return;
        item = null; u8 = new Uint8Array(0); entries = []; sel.clear(); dirty = false; draw();
      });
      const addBtn = btn('➕ Adicionar', 'Adicionar arquivos ou uma pasta', async () => {
        const r = addBtn.getBoundingClientRect();
        DK.ctxMenu(r.left, r.bottom, [
          { icon: '⬆️', label: 'Arquivos deste aparelho…', fn: () => { const i = el('input', { type: 'file', multiple: true }); i.style.display = 'none'; i.onchange = () => { addDevice(i.files).catch(e => say(e.message)); i.remove(); }; document.body.append(i); i.click(); } },
          { icon: '📄', label: 'Arquivo do Explorer…', fn: () => DK.explorerApp({ pick: 'any', title: 'Escolha o arquivo', onPick: it => addFromServer(it).catch(e => say(e.message)) }) },
          { icon: '📁', label: 'Pasta do Explorer…', fn: () => DK.explorerApp({ pick: 'any', pickDir: true, title: 'Escolha a pasta', onPick: d => addDirFromServer(d).catch(e => say(e.message)) }) },
        ]);
      });
      const xBtn = btn('📤 Extrair tudo', 'Extrair para uma pasta', async () => extract());
      btn('🗑️ Remover', 'Remover os selecionados do ZIP', async () => remove(entries.filter(e => sel.has(e))));
      btn('💾 Salvar', 'Salvar o ZIP (Ctrl+S)', () => save(false));
      btn('Salvar como…', 'Salvar com outro nome', () => save(true));
      search.oninput = draw;

      // arrastar arquivos do aparelho para a janela
      body.addEventListener('dragover', e => { if (e.dataTransfer.types.indexOf('Files') >= 0) e.preventDefault(); });
      body.addEventListener('drop', e => { if (e.dataTransfer.files.length) { e.preventDefault(); addDevice(e.dataTransfer.files).catch(x => say(x.message)); } });
      body.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!busy) { busy = true; save(false).catch(x => say(x.message)).then(() => { busy = false; }); } } });
      body.tabIndex = 0;
      win._beforeClose = () => !dirty || confirm('O ZIP tem alterações não salvas. Fechar mesmo assim?');

      draw();
      if (item) load(item).catch(e => say(e.message));
    }, 780, 500);
  };

  DK.register({ id: 'zip', icon: '🗜️', label: 'Zip Manager (.zip)', desktop: true, open: () => DK.zipApp({ dir: { space: 'home', path: '/' } }) });
})(window.DK = window.DK || {});
