(function (DK) {
  // Casca do Diogows: menu de contexto (botão direito no computador, toque longo no celular/tablet) e itens da Área de Trabalho
  // (arquivos, pastas e ícones de aplicativos escolhidos pela pessoa; ficam nas preferências do usuário no servidor).
  // Qualquer elemento pode ter uma função `_ctx(evento)`: devolve a lista de itens do menu, `false` (sem menu, e some o menu do navegador)
  // ou nada (vale o elemento de cima). Item: { icon, label, fn, danger, disabled, sub: [...] } ou '-' para separador.
  const $ = DK.$, el = DK.el;

  // ---------- menu de contexto ----------
  let menu = null, shownAt = 0, swallow = false;
  DK.closeCtx = () => { if (menu) { menu.remove(); menu = null; } };

  function clean(list) {
    const out = [];
    list.forEach(it => { if (it && !(it === '-' && (!out.length || out[out.length - 1] === '-'))) out.push(it); });
    while (out.length && out[out.length - 1] === '-') out.pop();
    return out;
  }
  function fill(box, list) {
    clean(list).forEach(it => {
      if (it === '-') { box.append(el('hr')); return; }
      const ic = el('span', { textContent: it.icon || '' });
      if (it.sub) {
        const wrap = el('div', { className: 'csub hidden' });
        const b = el('button', { onclick: e => { e.stopPropagation(); wrap.classList.toggle('hidden'); b.classList.toggle('open'); } }, ic, it.label, el('i', { textContent: '›' }));
        box.append(b, wrap);
        fill(wrap, it.sub);
        if (!wrap.children.length) b.disabled = true;
        return;
      }
      const b = el('button', { disabled: !!it.disabled, onclick: () => { DK.closeCtx(); if (it.fn) it.fn(); } }, ic, it.label);
      if (it.danger) b.classList.add('del');
      box.append(b);
    });
  }
  DK.ctxMenu = function (x, y, items) {
    DK.closeCtx();
    const m = el('div', { id: 'ctxmenu' });
    fill(m, items);
    if (!m.children.length) return;
    document.body.append(m);
    menu = m; shownAt = Date.now();
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  };

  const editable = t => !!(t && t.closest && t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]'));
  const selItem = () => { const s = String(window.getSelection ? window.getSelection() : ''); return s ? { icon: '📋', label: 'Copiar', fn: () => DK.copyText(s) } : null; };

  function itemsFor(t, e) {
    for (let n = t; n && n !== document; n = n.parentNode) {
      if (!n._ctx) continue;
      const r = n._ctx(e);
      if (r === false) return [selItem()];
      if (r) return r;
    }
    return null;
  }
  function openAt(t, e, x, y) {
    const items = itemsFor(t, e);
    if (items) DK.ctxMenu(x, y, items); else DK.closeCtx();
  }

  // botão direito: menu do Diogows no lugar do menu do navegador (campos de texto e Shift+botão direito mantêm o do navegador)
  document.addEventListener('contextmenu', e => {
    if (!DK.me || editable(e.target) || e.shiftKey) return;
    e.preventDefault();
    if (Date.now() - shownAt < 700) return;      // o toque longo já abriu
    openAt(e.target, e, e.clientX, e.clientY);
  });

  // toque longo (celular/tablet) faz o papel do botão direito; o "clique" que vem ao soltar o dedo é engolido
  let lp = 0, p0 = null;
  document.addEventListener('pointerdown', e => {
    swallow = false; clearTimeout(lp);
    if (e.pointerType !== 'touch' || !DK.me) { if (menu && !menu.contains(e.target)) DK.closeCtx(); return; }
    if (menu && !menu.contains(e.target)) DK.closeCtx();
    if (editable(e.target)) return;
    const t = e.target; p0 = { x: e.clientX, y: e.clientY };
    lp = setTimeout(() => {
      if (Date.now() - shownAt > 700) openAt(t, e, p0.x, p0.y);
      swallow = !!menu;
    }, 520);
  }, true);
  document.addEventListener('pointermove', e => { if (lp && p0 && Math.abs(e.clientX - p0.x) + Math.abs(e.clientY - p0.y) > 12) clearTimeout(lp); }, true);
  ['pointerup', 'pointercancel'].forEach(n => document.addEventListener(n, () => clearTimeout(lp), true));
  document.addEventListener('click', e => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') DK.closeCtx(); });
  addEventListener('resize', DK.closeCtx);
  addEventListener('blur', DK.closeCtx);

  // ---------- itens da Área de Trabalho ----------
  // prefs.deskFiles = [{ space, path, name, type }], prefs.deskApps = ids que ganham ícone, prefs.deskHidden = ids padrão que saem dela
  const arr = k => (DK.prefs[k] = Array.isArray(DK.prefs[k]) ? DK.prefs[k] : []);
  const changed = () => { DK.savePrefs(); if (DK.refreshShell) DK.refreshShell(); };
  const DIR = '/Desktop';

  DK.onDesk = a => (!!a.desktop && arr('deskHidden').indexOf(a.id) < 0) || arr('deskApps').indexOf(a.id) >= 0;
  DK.deskAddApp = a => {
    DK.prefs.deskHidden = arr('deskHidden').filter(x => x !== a.id);
    if (!a.desktop && arr('deskApps').indexOf(a.id) < 0) DK.prefs.deskApps.push(a.id);
    changed();
  };
  DK.deskRemoveApp = a => {
    DK.prefs.deskApps = arr('deskApps').filter(x => x !== a.id);
    if (a.desktop && arr('deskHidden').indexOf(a.id) < 0) DK.prefs.deskHidden.push(a.id);
    changed();
  };
  DK.deskAddFile = it => {
    if (!it || !it.path || it.path === '/' && it.type !== 'dir') return;
    if (arr('deskFiles').some(x => x.space === it.space && x.path === it.path)) { DK.toast('“' + (it.name || DK.baseName(it.path)) + '” já está na Área de Trabalho.'); return; }
    if (DK.prefs.deskFiles.length >= 120) { DK.toast('A Área de Trabalho está cheia (120 itens). Remova algum.'); return; }
    DK.prefs.deskFiles.push({ space: it.space === 'machine' ? 'machine' : 'home', path: it.path, name: it.name || DK.baseName(it.path), type: it.type === 'dir' ? 'dir' : 'file' });
    changed(); DK.toast('Adicionado à Área de Trabalho: ' + (it.name || DK.baseName(it.path)));
  };
  DK.deskRemoveFile = f => { DK.prefs.deskFiles = arr('deskFiles').filter(x => x !== f); changed(); };

  async function ensureDir() { try { await DK.api('POST', '/fs/mkdir', { space: 'home', sudo: false, path: DIR }); } catch (e) { /* já existe */ } }

  // Envia arquivos do aparelho da pessoa para a pasta Desktop de "Meus arquivos" e põe um ícone de cada um na Área de Trabalho.
  DK.deskUpload = async function (files) {
    files = [].slice.call(files);
    if (!files.length) return;
    await ensureDir();
    for (const f of files) {
      const dest = DIR + '/' + f.name;
      for (let overwrite = false; ;) {
        try {
          DK.toast('Enviando ' + f.name + '…');
          await DK.api('PUT', '/fs/file?space=home&path=' + encodeURIComponent(dest) + (overwrite ? '&overwrite=1' : ''), f, true);
          DK.deskAddFile({ space: 'home', path: dest, name: f.name, type: 'file' });
          break;
        } catch (e) {
          if (e.status === 409 && !overwrite && confirm('“' + f.name + '” já existe na Área de Trabalho. Substituir?')) { overwrite = true; continue; }
          DK.toast(f.name + ': ' + e.message); break;
        }
      }
    }
  };
  const pickDevice = () => {
    const inp = el('input', { type: 'file', multiple: true }); inp.style.display = 'none';
    inp.onchange = () => { DK.deskUpload(inp.files); inp.remove(); };
    document.body.append(inp); inp.click();
  };
  const newFolder = async () => {
    const n = prompt('Nome da pasta:', 'Nova pasta'); if (!n) return;
    try { await ensureDir(); await DK.api('POST', '/fs/mkdir', { space: 'home', sudo: false, path: DIR + '/' + n }); DK.deskAddFile({ space: 'home', path: DIR + '/' + n, name: n, type: 'dir' }); }
    catch (e) { DK.toast(e.message); }
  };

  // Arrastar para a Área de Trabalho: arquivos do aparelho são enviados; itens do Explorer viram atalhos.
  const desk = $('desktop');
  desk.addEventListener('dragover', e => {
    const t = e.dataTransfer.types;
    if (!e.target.closest('.win') && (t.indexOf('Files') >= 0 || t.indexOf('text/x-desk') >= 0)) e.preventDefault();
  });
  desk.addEventListener('drop', e => {
    if (e.target.closest('.win')) return;
    e.preventDefault();
    if (e.dataTransfer.files.length) { DK.deskUpload(e.dataTransfer.files); return; }
    const raw = e.dataTransfer.getData('text/x-desk');
    if (raw) { try { DK.deskAddFile(JSON.parse(raw)); } catch (x) { /* arrasto inválido */ } }
  });

  // menu da área vazia
  desk._ctx = () => {
    const absent = DK.apps.filter(a => (!a.show || a.show(DK.me)) && !DK.onDesk(a));
    return [
      { icon: '🆕', label: 'Nova pasta', fn: newFolder },
      { icon: '➕', label: 'Adicionar à Área de Trabalho', sub: [
        { icon: '⬆️', label: 'Enviar arquivos deste aparelho…', fn: pickDevice },
        { icon: '📄', label: 'Arquivo do Explorer…', fn: () => DK.explorerApp({ pick: 'any', title: 'Escolha o arquivo', onPick: DK.deskAddFile }) },
        { icon: '📁', label: 'Pasta do Explorer…', fn: () => DK.explorerApp({ pick: 'any', pickDir: true, title: 'Escolha a pasta', onPick: DK.deskAddFile }) },
        { icon: '🧩', label: 'Ícone de aplicativo', sub: absent.map(a => ({ icon: a.icon, label: a.label.replace(/ \(.*\)$/, ''), fn: () => DK.deskAddApp(a) })) },
      ] },
      '-',
      { icon: '🗂️', label: 'Abrir Explorer', fn: () => DK.openApp('explorer') },
      { icon: '🎛️', label: 'Painel de Controle', fn: () => DK.openApp('control') },
      '-',
      { icon: '🎨', label: 'Personalizar', sub: [
        { icon: '🖼️', label: 'Fundo da Área de Trabalho…', fn: () => DK.lookApp('bg') },
        { icon: '☰', label: 'Menu Iniciar e barra de tarefas…', fn: () => DK.lookApp('menu') },
      ] },
      { icon: '🔄', label: 'Atualizar', fn: () => { DK.refreshShell(); } },
    ];
  };

  // menu Iniciar (fora dos itens)
  $('startmenu')._ctx = () => [{ icon: '🎨', label: 'Personalizar menu e barra…', fn: () => { $('startmenu').classList.add('hidden'); DK.lookApp('menu'); } }];

  // barra de tarefas
  $('bar')._ctx = () => [
    { icon: '🎨', label: 'Personalizar menu e barra…', fn: () => DK.lookApp('menu') },
    { icon: '🖥️', label: 'Mostrar a Área de Trabalho', fn: DK.minimizeAll },
    { icon: '✕', label: 'Fechar todas as janelas', fn: () => { if (Object.keys(DK.wins).length && confirm('Fechar todas as janelas?')) DK.closeAll(); }, danger: true },
  ];

  // menu de um ícone de aplicativo (Iniciar ou Área de Trabalho)
  DK.appCtx = a => () => [
    { icon: '▶️', label: 'Abrir', fn: a.open },
    '-',
    DK.onDesk(a) ? { icon: '➖', label: 'Remover da Área de Trabalho', fn: () => DK.deskRemoveApp(a) } : { icon: '📌', label: 'Adicionar à Área de Trabalho', fn: () => DK.deskAddApp(a) },
  ];
  // menu de um ícone de arquivo/pasta da Área de Trabalho
  DK.fileCtx = f => () => [
    { icon: '▶️', label: 'Abrir', fn: () => DK.openFile(DK.deskRef(f)) },
    f.type === 'dir' ? null : { icon: '⬇️', label: 'Baixar', fn: () => { location.href = DK.fileUrl(DK.deskRef(f), 'download'); } },
    { icon: '🗂️', label: 'Mostrar no Explorer', fn: () => DK.explorerApp({ space: f.space, path: f.type === 'dir' ? f.path : f.path.replace(/\/[^\/]*$/, '') || '/' }) },
    '-',
    { icon: '➖', label: 'Remover da Área de Trabalho', fn: () => DK.deskRemoveFile(f) },
  ];
  DK.deskRef = f => ({ space: f.space, sudo: false, path: f.path, name: f.name, type: f.type });
})(window.DK = window.DK || {});
