(function (DK) {
  // Explorer: "Meus arquivos" (pasta própria de cada usuário) e "Computador" (arquivos do servidor, com sudo opcional, para quem tem permissão).
  // Também serve de seletor de arquivo para os visualizadores (opção pick).
  const el = DK.el;

  const TEXT_EXT = ['.txt', '.log', '.md', '.json', '.csv', '.tsv', '.ini', '.env', '.conf', '.cfg', '.properties', '.yaml', '.yml', '.toml',
    '.xml', '.html', '.htm', '.config', '.csproj', '.xaml', '.css', '.js', '.ts', '.cs', '.java', '.go', '.py', '.sh', '.ps1', '.bat', '.sql', '.c', '.cpp', '.php', '.service', '.list', '.rules'];
  const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
  const VIDEO_EXT = ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv', '.avi', '.wmv', '.ts', '.mp3', '.m4a', '.ogg', '.wav', '.flac'];

  DK.TEXT_EXT = TEXT_EXT;
  // it = { type: 'dir'|'file'|'other', name }
  DK.kindOf = function (it) {
    if (it.type === 'dir') return 'folder';
    const e = DK.extOf(it.name);
    if (TEXT_EXT.indexOf(e) >= 0) return 'text';
    if (IMG_EXT.indexOf(e) >= 0) return 'image';
    if (e === '.pdf') return 'pdf';
    if (e === '.docx' || e === '.odt') return 'doc';
    if (e === '.jsdos') return 'program';
    if (VIDEO_EXT.indexOf(e) >= 0) return 'video';
    return 'other';
  };
  DK.iconOf = it => ({ folder: '📁', text: '📝', image: '🖼️', pdf: '📕', doc: '📘', program: '🕹️', video: '🎬', other: '📄' })[DK.kindOf(it)];

  // Abre um arquivo no aplicativo certo. siblings = itens da mesma pasta (anterior/próxima nas imagens e no vídeo).
  DK.openFile = function (it, siblings) {
    switch (DK.kindOf(it)) {
      case 'folder': DK.explorerApp({ space: it.space, sudo: it.sudo, path: it.path }); break;
      case 'text': DK.notepadApp({ item: it }); break;
      case 'image': DK.imageApp({ item: it, siblings: siblings }); break;
      case 'pdf': DK.pdfApp({ item: it }); break;
      case 'doc': DK.docApp({ item: it }); break;
      case 'program': DK.installProgramApp(it); break;
      case 'video': DK.videoApp({ item: it, siblings: siblings }); break;
      default: location.href = DK.fileUrl(it, 'download');
    }
  };

  const canMachine = () => !!(DK.me && DK.me.shell && (DK.me.is_admin || DK.me.can_explorer));
  DK.canMachine = canMachine;

  // o: { space, sudo, path, pick: 'image'|'pdf'|'text'|'video'|'any', title, onPick(item), key }
  DK.explorerApp = function (o) {
    o = o || {};
    const key = o.key || (o.pick ? 'pick:' + DK.nextDocId() : 'explorer' + (o.path ? ':' + (o.space || 'home') + ':' + (o.sudo ? 's:' : '') + o.path : ''));
    return DK.openWindow(key, o.title || 'Explorer', (body, win) => {
      body.className = 'body flush';
      const st = { space: o.space || 'home', sudo: !!o.sudo, path: o.path || '/', parent: '', entries: [] };
      const crumbs = el('div', { className: 'crumbs' });
      const flist = el('div', { className: 'flist' });
      const status = el('div', { className: 'status' });
      const up = el('button', { textContent: '⬆ Subir' });
      const nf = el('button', { textContent: '📁 Nova pasta' });
      const nt = el('button', { textContent: '📝 Novo texto' });
      const nd = el('button', { textContent: '📘 Novo documento', title: 'Documento do LiteOffice: Word (.docx) ou LibreOffice (.odt)' });
      const upl = el('button', { textContent: '⬆ Enviar arquivos' });
      const file = el('input', { type: 'file', multiple: true }); file.style.display = 'none';
      const rf = el('button', { textContent: '⟳', title: 'Atualizar' });
      const sp = el('button', { textContent: '💻 Computador', title: 'Arquivos do servidor' });
      const sudo = el('button', { textContent: '🔓 sudo', title: 'Navegar e alterar como root (pede a senha de um administrador)' });
      if (!canMachine()) { sp.classList.add('hidden'); sudo.classList.add('hidden'); }
      const tb = el('div', { className: 'tb' }, up, nf, nt, nd, upl, el('span', { className: 'sp' }), sudo, sp, rf);
      body.append(tb, crumbs, flist, status, file);

      const machine = () => st.space === 'machine';
      const ref = it => ({ space: st.space, sudo: st.sudo, path: it.path, name: it.name, size: it.size, type: it.type });
      const q = extra => '?space=' + st.space + (st.sudo ? '&sudo=1' : '') + extra;
      const guard = fn => (machine() ? DK.withUnlock('explorer', st.sudo, fn) : fn());
      const fail = e => { status.textContent = e.message; };

      function syncUi() {
        sp.textContent = machine() ? '📂 Meus arquivos' : '💻 Computador';
        sudo.classList.toggle('hidden', !machine());
        sudo.classList.toggle('sudo-on', st.sudo);
        sudo.textContent = st.sudo ? '🔒 sair do sudo' : '🔓 sudo';
        tb.classList.toggle('sudo-on', st.sudo);
        [nf, nt, nd, upl].forEach(b => b.classList.toggle('hidden', !!o.pick));
        win.setTitle((o.title || 'Explorer') + (machine() ? ' — Computador' + (st.sudo ? ' (sudo)' : '') : ''));
      }

      function drawCrumbs() {
        crumbs.replaceChildren();
        const root = el('a', { textContent: machine() ? '💻 Computador' : '📂 Meus arquivos', onclick: () => go('/') });
        dropTarget(root, '/');
        crumbs.append(root);
        const segs = st.path.split('/').filter(Boolean);
        segs.forEach((sg, i) => {
          const p = '/' + segs.slice(0, i + 1).join('/');
          const a = el('a', { textContent: sg, onclick: () => go(p) });
          dropTarget(a, p);
          crumbs.append('›', a);
        });
      }

      function dropTarget(node, dest) {
        node.ondragover = e => { if (e.dataTransfer.types.indexOf('text/x-desk') >= 0) { e.preventDefault(); node.classList.add('dt'); } };
        node.ondragleave = () => node.classList.remove('dt');
        node.ondrop = e => {
          node.classList.remove('dt');
          const raw = e.dataTransfer.getData('text/x-desk');
          if (!raw) return;
          e.preventDefault(); e.stopPropagation();
          const src = JSON.parse(raw);
          if (src.space !== st.space || !!src.sudo !== st.sudo) { status.textContent = 'Só é possível mover dentro do mesmo espaço.'; return; }
          move(src.path, DK.joinPath(dest, DK.baseName(src.path)));
        };
      }

      async function move(from, to) {
        try { await guard(() => DK.api('POST', '/fs/move', { space: st.space, sudo: st.sudo, from: from, to: to })); load(); } catch (e) { fail(e); }
      }

      function draw() {
        flist.replaceChildren();
        const t = el('table'), tbody = el('tbody'); t.append(tbody); flist.append(t);
        const shown = st.entries.filter(it => !o.pick || it.type === 'dir' || o.pick === 'any' || DK.kindOf(it) === o.pick || (o.pick === 'program' && DK.extOf(it.name) === '.zip'));
        if (!shown.length) tbody.append(el('tr', {}, el('td', { className: 'meta', textContent: o.pick ? 'Nenhum arquivo deste tipo aqui.' : 'Pasta vazia. Arraste arquivos para cá.' })));
        shown.forEach(e => {
          const it = ref(e), k = DK.kindOf(it);
          const tr = el('tr', { className: 'f', draggable: true });
          tr.ondragstart = ev => ev.dataTransfer.setData('text/x-desk', JSON.stringify({ space: st.space, sudo: st.sudo, path: e.path }));
          if (k === 'folder') dropTarget(tr, e.path);
          const open = () => {
            if (k === 'folder') go(e.path);
            else if (o.pick) { DK.closeWin(win, true); o.onPick(it); }
            else DK.openFile(it, shown.filter(x => DK.kindOf(ref(x)) === k).map(ref));
          };
          tr.append(el('td', { className: 'n', textContent: DK.iconOf(it) + ' ' + e.name, onclick: open, title: 'Clique para abrir' }),
            el('td', { className: 'meta', textContent: k === 'folder' ? '' : DK.fmtSize(e.size) }),
            el('td', { className: 'meta', textContent: DK.fmtDate(e.mtime) }));
          const a = el('td', { className: 'a' });
          if (!o.pick) {
            a.append(el('button', { textContent: 'Renomear', onclick: async () => {
              const n = prompt('Novo nome:', e.name); if (!n || n === e.name) return;
              move(e.path, DK.joinPath(st.path, n));
            } }));
            if (e.type === 'file') a.append(' ', el('a', { href: DK.fileUrl(it, 'download'), textContent: 'Baixar', download: e.name, style: 'font-size:12px' }));
            a.append(' ', el('button', { className: 'del', textContent: 'Apagar', onclick: async () => {
              if (!confirm('Apagar “' + e.name + '”' + (k === 'folder' ? ' e tudo que há dentro' : '') + '?' + (st.sudo ? '\n\nVocê está em modo sudo (root).' : ''))) return;
              try { await guard(() => DK.api('DELETE', '/fs' + q('&path=' + encodeURIComponent(e.path)))); load(); } catch (x) { fail(x); }
            } }));
          }
          tr.append(a); tbody.append(tr);
        });
        status.textContent = st.entries.length + ' item(ns) em ' + st.path +
          (o.pick ? ' — clique em um arquivo para abrir' : ' — arraste itens para uma pasta ou para o caminho acima para mover') + (st.sudo ? ' — modo sudo (root)' : '');
      }

      async function load() {
        syncUi(); drawCrumbs();
        try {
          const r = await guard(() => DK.api('GET', '/fs/list' + q('&path=' + encodeURIComponent(st.path))));
          st.path = r.path; st.parent = r.parent; st.entries = r.entries;
          drawCrumbs(); draw();
        } catch (e) {
          fail(e);
          if (machine() && /desligado|permissão|rede local|Cancelado/.test(e.message)) { st.space = 'home'; st.sudo = false; st.path = '/'; setTimeout(load, 0); }
        }
      }
      function go(p) { st.path = p; load(); }

      async function upload(files) {
        for (const f of files) {
          const dest = DK.joinPath(st.path, f.name);
          for (let overwrite = false; ;) {
            try {
              status.textContent = 'Enviando ' + f.name + '…';
              await guard(() => DK.api('PUT', '/fs/file' + q('&path=' + encodeURIComponent(dest) + (overwrite ? '&overwrite=1' : '')), f, true));
              break;
            } catch (e) {
              if (e.status === 409 && !overwrite && confirm('“' + f.name + '” já existe aqui. Substituir?')) { overwrite = true; continue; }
              status.textContent = f.name + ': ' + e.message; return;
            }
          }
        }
        load();
      }

      sp.onclick = async () => {
        if (machine()) { st.space = 'home'; st.sudo = false; st.path = '/'; load(); return; }
        try { await DK.ensureMachine('explorer'); } catch (e) { if (e.message !== 'Cancelado.') fail(e); return; }
        st.space = 'machine'; st.path = '/'; load();
      };
      sudo.onclick = async () => {
        if (st.sudo) { st.sudo = false; load(); return; }
        try { await DK.ensureSudo('explorer'); } catch (e) { if (e.message !== 'Cancelado.') fail(e); return; }
        st.sudo = true; load();
      };
      up.onclick = () => { if (st.parent) go(st.parent); };
      rf.onclick = load;
      nf.onclick = async () => {
        const n = prompt('Nome da pasta:', 'Nova pasta'); if (!n) return;
        try { await guard(() => DK.api('POST', '/fs/mkdir', { space: st.space, sudo: st.sudo, path: DK.joinPath(st.path, n) })); load(); } catch (e) { fail(e); }
      };
      nt.onclick = () => DK.notepadApp({ dir: { space: st.space, sudo: st.sudo, path: st.path }, onSaved: load });
      nd.onclick = () => DK.docApp({ dir: { space: st.space, sudo: st.sudo, path: st.path }, onSaved: load });
      upl.onclick = () => file.click();
      file.onchange = () => { upload([].slice.call(file.files)); file.value = ''; };
      flist.ondragover = e => { if (e.dataTransfer.types.indexOf('Files') >= 0) { e.preventDefault(); flist.classList.add('on'); } };
      flist.ondragleave = () => flist.classList.remove('dragover'), flist.ondragleave = () => flist.classList.remove('on');
      flist.ondrop = e => { flist.classList.remove('on'); if (!o.pick && e.dataTransfer.files.length) { e.preventDefault(); upload([].slice.call(e.dataTransfer.files)); } };
      win._refresh = load;
      load();
    }, 680, 470, { flush: true });
  };

  // Seletor para os visualizadores: abre o Explorer em modo "escolher arquivo" (aceita os do Computador também).
  DK.pickFile = (kind, title, onPick) => DK.explorerApp({ pick: kind, title: title, onPick: onPick });

  DK.register({ id: 'explorer', icon: '🗂️', label: 'Explorer', desktop: true, open: () => DK.explorerApp({}) });
})(window.DK = window.DK || {});
