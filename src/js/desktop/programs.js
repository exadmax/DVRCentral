(function (DK) {
  // Instalar Programas e Acessórios: instala programas DOS e sistemas virtuais (Windows 3.x, 95, 98, ME) na pasta do usuário e os executa
  // no navegador com o js-dos (que traz o DOSBox e o DOSBox-X em WebAssembly, dentro do hub; não precisa de internet). Nada roda no servidor.
  //
  //  - Programa DOS: um .zip com os arquivos do programa (o instalador monta o pacote) ou um pacote .jsdos pronto.
  //  - Sistema virtual: um pacote .jsdos com o Windows já instalado (o Windows é da Microsoft e não vem aqui: use o seu, com licença). O hub o
  //    prepara (inicia o Windows direto e libera o salvamento) e o disco alterado fica guardado no servidor, por usuário.
  //  - Programa dentro de um sistema virtual: um .zip que vira um disquete (A:) ligado ao sistema; a instalação é feita dentro do Windows e
  //    fica no disco salvo do sistema.
  //  - Acessórios: os aplicativos do próprio Diogows, que podem ser instalados (aparecem no menu) ou removidos (somem do menu).
  const el = DK.el, esc = DK.esc;
  const DIR = '/Programas', REG = DIR + '/programas.json', SYS = DIR + '/Sistemas', INST = DIR + '/Instaladores';
  DK.programs = [];
  DK.systems = [];

  const ENGINES = {
    dosboxX: { label: 'DOSBox-X', note: 'Mais compatível: roda programas DOS exigentes e é a engine dos sistemas virtuais (Windows). É a mais pesada (carrega ~8 MB, usa mais CPU e memória e pode ficar lenta em PCs fracos).' },
    dosbox: { label: 'js-dos (DOSBox)', note: 'Leve e rápida, ideal para jogos e programas DOS comuns. Tem menos recursos de compatibilidade (alguns modos de vídeo e dispositivos avançados do DOSBox-X ficam de fora).' }
  };
  const KINDS = { dos: 'DOS', vm: 'Dentro de um sistema virtual', web: 'Programa Web', win3x: 'Windows 3.x (pacote pronto)', win9x: 'Windows 95/98/ME (pacote pronto)' };   // win3x e win9x: instalados por versões anteriores
  const SYSKINDS = { win3x: 'Windows 3.x', win95: 'Windows 95', win98: 'Windows 98', winme: 'Windows ME' };
  const WEB_ICONS = ['🌐', '🎮', '🎵', '🎬', '📺', '📷', '📚', '🧊', '🏠', '📰', '✉️', '🗺️', '📊', '🛒', '☁️', '🧠', '💬'];
  const WEB_MODES = { window: 'Janela interna do Diogows', popup: 'Janela própria do navegador (compacta, sem abas)', tab: 'Fora do app (outra aba do navegador)' };
  // Atalhos prontos. Sites que proíbem ser exibidos dentro de outra página (WhatsApp Web, por exemplo, manda frame-ancestors só para o próprio
  // domínio) não funcionam na janela interna: para eles o modo certo é a janela própria do navegador.
  const WEB_PRESETS = [
    { name: 'WhatsApp Web', url: 'https://web.whatsapp.com/', icon: '💬', mode: 'popup' },
    { name: 'Telegram Web', url: 'https://web.telegram.org/', icon: '💬', mode: 'popup' },
    { name: 'Gmail', url: 'https://mail.google.com/', icon: '✉️', mode: 'popup' },
    { name: 'Outlook', url: 'https://outlook.live.com/mail/', icon: '✉️', mode: 'popup' }
  ];
  // O endereço guardado pode ter {host} (o endereço pelo qual o Diogows foi aberto), útil para serviços da própria máquina em outra porta:
  // {host}:8080/jogos/. Só http e https; "/caminho" vale para o próprio hub. Devolve null se não for um endereço aceitável.
  function webUrl(raw) {
    let u = String(raw || '').trim().replace(/\{host\}/g, location.protocol + '//' + location.hostname);
    if (!u) return null;
    if (u[0] !== '/' && !/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    try { const x = new URL(u, location.origin); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; }
  }
  const home = p => ({ space: 'home', path: p });
  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'programa';
  const sysDir = s => SYS + '/' + s.id, sysBundle = s => sysDir(s) + '/' + s.id + '.jsdos', sysChanges = s => sysDir(s) + '/' + s.id + '.changes';
  const sysOf = p => DK.systems.find(s => s.id === p.os);
  const unique = (id, list) => { while (list.some(x => x.id === id)) id += '-2'; return id; };
  const guessSysKind = n => /(^|[^0-9])3[._-]?(1|11|x)|win3/i.test(n) ? 'win3x' : /98/.test(n) ? 'win98' : /95/.test(n) ? 'win95' : /(^|[^a-z])me([^a-z]|$)/i.test(n) ? 'winme' : 'win95';

  // Categoria no menu Iniciar: uma das existentes ou uma nova, criada aqui mesmo. get() devolve o id (e cria a nova, se for o caso).
  function categoryPicker(current) {
    const sel = el('select', {});
    const fill = v => { sel.replaceChildren(...DK.menuCategories().map(c => el('option', { value: c.id, textContent: c.icon + ' ' + c.label })), el('option', { value: '__new', textContent: '➕ Nova categoria…' })); sel.value = v; if (sel.value !== v) sel.value = 'progs'; };
    const nm = el('input', { placeholder: 'Nome da nova categoria', maxLength: 30 }), ic = el('input', { placeholder: '📁', maxLength: 4, value: '📁', style: 'width:64px', title: 'Um emoji para a categoria' });
    const row = el('div', { className: 'row hidden' }, nm, ic);
    sel.onchange = () => { row.classList.toggle('hidden', sel.value !== '__new'); if (sel.value === '__new') nm.focus(); };
    fill(current || 'progs');
    return { node: el('div', { style: 'display:grid;gap:6px' }, el('label', {}, 'Categoria no menu Iniciar', sel), row), get: () => (sel.value === '__new' ? DK.addMenuCategory(nm.value, ic.value) : sel.value) };
  }
  // seletor simples para trocar a categoria de algo já instalado
  function categorySelect(item) {
    const cats = DK.menuCategories();
    const sel = el('select', { title: 'Categoria no menu Iniciar' }, ...cats.map(c => el('option', { value: c.id, textContent: c.icon + ' ' + c.label })));
    sel.value = cats.some(c => c.id === item.category) ? item.category : 'progs';
    sel.onchange = async () => { item.category = sel.value; await savePrograms(); };
    return sel;
  }

  // ---------- registro (um JSON na pasta do usuário) ----------
  const mkdir = p => DK.api('POST', '/fs/mkdir', { space: 'home', path: p }).catch(() => { /* já existe */ });
  DK.loadPrograms = async function () {
    try {
      const j = JSON.parse(new TextDecoder().decode(await DK.fetchFile(home(REG), 'download')));
      DK.programs = j.programs || []; DK.systems = j.systems || [];
    } catch (e) { DK.programs = []; DK.systems = []; }
  };
  async function savePrograms() {
    await mkdir(DIR);
    await DK.api('PUT', '/fs/file?space=home&path=' + encodeURIComponent(REG) + '&text=1&overwrite=1', JSON.stringify({ version: 2, programs: DK.programs, systems: DK.systems }, null, 1), true);
    if (DK.refreshShell) DK.refreshShell();
  }
  // Entradas para o menu Iniciar e a área de trabalho
  DK.programEntries = () => DK.systems.map(s => ({ id: 'prog:sys-' + s.id, icon: '🖥️', label: s.name, cat: s.category, desktop: !!s.desktop, open: () => DK.runSystem(s) }))
    .concat(DK.programs.map(p => ({ id: 'prog:' + p.id, icon: p.kind === 'web' ? (p.icon || '🌐') : p.kind === 'dos' ? '🕹️' : '🪟', label: p.name, cat: p.category, desktop: !!p.desktop, open: () => DK.runProgram(p) })));

  // ---------- executar ----------
  // Cada programa roda num iframe com emulator.html: o js-dos guarda estado global e só inicia limpo num documento novo. Fechar a janela
  // destrói o iframe (e o emulador junto); "Reiniciar" recarrega o iframe.
  // Programa Web: uma página aberta numa janela do Diogows (iframe) ou fora do app, em outra aba. Sites que proíbem ser exibidos dentro de
  // outra página ficam em branco na janela: o botão ↗ abre o mesmo endereço numa aba. Página https não pode embutir http (o navegador bloqueia),
  // então nesse caso abre sempre em outra aba.
  DK.runWeb = function (p) {
    const url = webUrl(p.url);
    if (!url) { DK.toast('O endereço de “' + p.name + '” não é válido.'); return; }
    const mixed = location.protocol === 'https:' && /^http:/i.test(url);
    if (p.mode === 'popup') {      // janela só do site, sem abas nem barra de endereço, do tamanho de um aplicativo
      const w = Math.min(1180, screen.availWidth - 40), h = Math.min(800, screen.availHeight - 60);
      const pop = window.open(url, '_blank', 'popup=yes,noopener,noreferrer,width=' + w + ',height=' + h + ',left=' + Math.round((screen.availWidth - w) / 2) + ',top=' + Math.round((screen.availHeight - h) / 2));
      if (!pop && !/Firefox/.test(navigator.userAgent)) DK.toast('O navegador bloqueou a janela; libere pop-ups para este endereço.');   // noopener devolve null mesmo quando abriu: só avisa onde isso não ocorre
      return;
    }
    if (p.mode === 'tab' || mixed) {
      window.open(url, '_blank', 'noopener');
      if (mixed && p.mode !== 'tab') DK.toast('Este endereço é http e o Diogows está em https: abri em outra aba.');
      return;
    }
    DK.openWindow('prog:' + p.id, p.name, (body, win) => {
      body.className = 'body flush';
      const reload = el('button', { textContent: '↻ Recarregar' }), full = el('button', { textContent: '⛶ Tela cheia' });
      const out = el('button', { textContent: '↗ Abrir em outra aba', title: 'Se a página ficar em branco, o site não permite ser aberto dentro de outra página' });
      const tb = el('div', { className: 'tb' }, reload, full, out, el('span', { className: 'sp' }), el('span', { className: 'meta', textContent: new URL(url).host }));
      const frame = el('iframe', { className: 'fill dosframe', title: p.name });
      frame.setAttribute('allow', 'fullscreen; autoplay; gamepad; clipboard-write');
      frame.setAttribute('allowfullscreen', '');
      body.append(tb, frame);
      reload.onclick = () => { frame.src = 'about:blank'; setTimeout(() => { frame.src = url; }, 0); };
      full.onclick = () => { if (frame.requestFullscreen) frame.requestFullscreen(); };
      out.onclick = () => window.open(url, '_blank', 'noopener');
      win._onClose = () => { frame.src = 'about:blank'; };
      frame.src = url;
    }, 900, 640, { flush: true });
  };

  DK.runProgram = function (p) {
    if (p.kind === 'web') return DK.runWeb(p);
    if (p.kind === 'vm') {
      const s = sysOf(p);
      if (!s) { DK.toast('O sistema virtual de “' + p.name + '” foi removido.'); return; }
      return DK.runSystem(s);
    }
    DK.openWindow('prog:' + p.id, p.name, (body, win) => {
      body.className = 'body flush';
      const eng = ENGINES[p.engine] || ENGINES.dosboxX;
      const full = el('button', { textContent: '⛶ Tela cheia' }), again = el('button', { textContent: '↻ Reiniciar' });
      const tb = el('div', { className: 'tb' }, full, again, el('span', { className: 'sp' }),
        el('span', { className: 'meta', textContent: (KINDS[p.kind] || 'DOS') + ' · ' + eng.label + (p.kind === 'win9x' || p.kind === 'win3x' ? ' · o Windows leva um tempo para iniciar' : '') }));
      const frame = el('iframe', { className: 'fill dosframe', title: p.name });
      frame.setAttribute('allow', 'fullscreen; autoplay; gamepad');
      frame.setAttribute('allowfullscreen', '');
      body.append(tb, frame);
      const start = () => { frame.src = 'emulator.html?e=' + (p.engine === 'dosbox' ? 'dosbox' : 'dosboxX') + '&b=' + encodeURIComponent(DK.fileUrl(home(p.bundle), 'download')) + '&t=' + Date.now(); };
      full.onclick = () => { if (frame.requestFullscreen) frame.requestFullscreen(); };
      again.onclick = start;
      win._onClose = () => { frame.src = 'about:blank'; };
      start();
    }, 820, 620, { flush: true });
  };

  // Sistema virtual: o Windows inicia sozinho e o disco alterado é guardado no servidor. Salva ao clicar em "Salvar agora" e ao fechar a janela.
  DK.runSystem = function (s) {
    DK.openWindow('prog:sys-' + s.id, s.name, (body, win) => {
      body.className = 'body flush';
      const full = el('button', { textContent: '⛶ Tela cheia' }), again = el('button', { textContent: '↻ Reiniciar' });
      const save = el('button', { textContent: '💾 Salvar agora', title: 'Guarda no servidor o que foi feito no sistema. Também salva ao fechar a janela.' });
      const state = el('span', { className: 'meta' });
      const tb = el('div', { className: 'tb' }, full, again, save, el('span', { className: 'sp' }), state,
        el('span', { className: 'meta', textContent: (SYSKINDS[s.kind] || 'Windows') + ' · DOSBox-X' + (s.disk ? ' · A: ' + s.disk : '') }));
      const frame = el('iframe', { className: 'fill dosframe', title: s.name });
      frame.setAttribute('allow', 'fullscreen; autoplay; gamepad');
      frame.setAttribute('allowfullscreen', '');
      body.append(tb, frame);
      const start = () => {
        state.textContent = '';
        frame.src = 'emulator.html?e=dosboxX&b=' + encodeURIComponent(DK.fileUrl(home(sysBundle(s)), 'download')) + '&c=' + encodeURIComponent(sysChanges(s)) + '&t=' + Date.now();
      };
      let busy = false;
      // true se salvou (ou não havia o que salvar); false se o sistema ainda não iniciou ou deu erro
      async function saveNow() {
        const d = frame.contentWindow && frame.contentWindow.__dos;
        if (!d || !d.save || busy) return false;
        busy = true; state.textContent = 'Salvando…'; save.disabled = true;
        try {
          const ok = await d.save();
          state.textContent = ok ? 'Salvo às ' + new Date().toTimeString().slice(0, 5) : 'Não foi possível salvar';
          return ok;
        } catch (e) { state.textContent = 'Erro ao salvar'; return false; } finally { busy = false; save.disabled = false; }
      }
      full.onclick = () => { if (frame.requestFullscreen) frame.requestFullscreen(); };
      save.onclick = saveNow;
      again.onclick = () => { if (confirm('Reiniciar o sistema? O que não foi salvo (use “Salvar agora”) será perdido.')) start(); };
      let closing = false;
      win._beforeClose = () => {
        if (closing || busy) return false;
        closing = true; state.textContent = 'Salvando antes de fechar…';
        saveNow().then(ok => {
          if (!ok && !confirm('Não consegui salvar as alterações de “' + s.name + '” (o sistema ainda estava iniciando ou houve um erro). Fechar mesmo assim?')) { closing = false; return; }
          DK.closeWin(win, true);
        });
        return false;
      };
      win._onClose = () => { frame.src = 'about:blank'; };
      start();
    }, 820, 620, { flush: true });
  };

  // ---------- janela de instalação ----------
  DK.programsApp = function (o) {
    o = o || {};
    const win = DK.openWindow('programs', 'Instalar Programas e Acessórios', (body, win) => {
      body.className = 'body flush';
      let tab = o.file ? 'install' : (o.tab || 'list');
      const tabs = el('div', { className: 'tb' });
      const main = el('div', { style: 'flex:1;min-height:0;overflow:auto;padding:12px;display:grid;gap:10px;align-content:start' });
      body.append(tabs, main);
      const tabBtn = (id, label) => { const b = el('button', { textContent: label, onclick: () => { tab = id; draw(); } }); b.dataset.t = id; tabs.append(b); };
      tabBtn('list', '🕹️ Programas instalados'); tabBtn('systems', '🖥️ Sistemas virtuais'); tabBtn('install', '➕ Instalar programa'); tabBtn('acc', '🧰 Acessórios do Diogows');

      function draw() {
        [].forEach.call(tabs.querySelectorAll('button'), b => b.classList.toggle('pri', b.dataset.t === tab));
        main.replaceChildren();
        ({ list: drawList, systems: drawSystems, install: drawInstall, acc: drawAcc })[tab]();
      }
      // escolher um arquivo da pasta do usuário ou enviá-lo do computador (vai para Programas/Instaladores)
      function filePicker(accept, title, onPick, err, ok) {
        const pick = el('button', { textContent: '📂 Escolher da minha pasta…' });
        const up = el('button', { textContent: '⬆ Enviar do computador…' });
        const upIn = el('input', { type: 'file', accept: accept }); upIn.style.display = 'none';
        pick.onclick = () => DK.pickFile('program', title, it => { if (it.space !== 'home') { err.textContent = 'Escolha um arquivo da sua pasta (Meus arquivos).'; return; } onPick(it); });
        up.onclick = () => upIn.click();
        upIn.onchange = async () => {
          const f = upIn.files[0]; upIn.value = '';
          if (!f) return;
          err.textContent = ''; ok.textContent = 'Enviando ' + f.name + '…';
          try {
            await mkdir(DIR); await mkdir(INST);
            const path = INST + '/' + f.name.replace(/[\/\\]/g, '_');
            await DK.api('PUT', '/fs/file?space=home&overwrite=1&path=' + encodeURIComponent(path), f, true);
            ok.textContent = '';
            onPick({ space: 'home', path: path, name: f.name, type: 'file' });
          } catch (e) { ok.textContent = ''; err.textContent = e.message; }
        };
        return [pick, up, upIn];
      }

      // ---- instalados ----
      function drawList() {
        if (!DK.programs.length) main.append(el('div', { className: 'meta', textContent: 'Nenhum programa instalado. Use “Instalar programa” para adicionar um jogo ou aplicativo DOS, ou instale um sistema virtual (Windows) na aba ao lado e depois programas dentro dele.' }));
        const tb = el('tbody');
        DK.programs.forEach(p => {
          const sc = el('input', { type: 'checkbox', checked: !!p.desktop, title: 'Atalho na área de trabalho' });
          sc.onchange = async () => { p.desktop = sc.checked; await savePrograms(); };
          const s = p.kind === 'vm' ? sysOf(p) : null;
          let third = el('td', { className: 'meta', textContent: p.kind === 'vm' ? '—' : (ENGINES[p.engine] || ENGINES.dosboxX).label });
          if (p.kind === 'web') {
            const m = el('select', {}, ...Object.keys(WEB_MODES).map(k => el('option', { value: k, textContent: WEB_MODES[k] })));
            m.value = p.mode === 'tab' ? 'tab' : 'window';
            m.onchange = async () => { p.mode = m.value; await savePrograms(); };
            third = el('td', {}, m);
          }
          tb.append(el('tr', {}, el('td', {}, DK.iconNode(p.kind === 'web' ? (p.icon || '🌐') : p.kind === 'dos' ? '🕹️' : '🪟'), ' ' + p.name),
            el('td', { className: 'meta', textContent: p.kind === 'vm' ? 'Dentro de ' + (s ? s.name : '(sistema removido)') : p.kind === 'web' ? 'Programa Web · ' + (p.url || '') : KINDS[p.kind] }),
            third, el('td', {}, categorySelect(p)), el('td', {}, sc),
            el('td', { className: 'row' }, el('button', { className: 'pri', textContent: p.kind === 'web' ? '▶ Abrir' : '▶ Executar', onclick: () => DK.runProgram(p) }),
              el('button', { className: 'del', textContent: 'Desinstalar', onclick: () => uninstall(p) }))));
        });
        if (DK.programs.length) main.append(el('table', {}, el('thead', {}, el('tr', {}, ...['Programa', 'Tipo', 'Engine / abre em', 'Categoria', 'Atalho', ''].map(t => el('th', { textContent: t })))), tb));
        main.append(el('div', { className: 'meta', textContent: 'Os programas ficam na sua pasta (Meus arquivos/Programas) e só você os vê.' }));
      }
      async function uninstall(p) {
        const own = p.bundle && p.bundle.indexOf(DIR + '/' + p.id + '/') === 0;
        if (!confirm('Desinstalar “' + p.name + '”?' + (p.kind === 'web' ? '\nSó o atalho é removido; o site não é afetado.' : p.kind === 'vm' ?'\nSó o atalho é removido; o que foi instalado dentro do sistema virtual continua lá.' : own ? '\nOs arquivos instalados serão apagados.' : '\nO arquivo original não será apagado.'))) return;
        if (DK.wins['prog:' + p.id]) DK.closeWin(DK.wins['prog:' + p.id], true);
        if (own) await DK.api('DELETE', '/fs?space=home&path=' + encodeURIComponent(DIR + '/' + p.id)).catch(() => { /* já removido */ });
        DK.programs = DK.programs.filter(x => x.id !== p.id);
        await savePrograms(); draw();
      }

      // ---- sistemas virtuais ----
      function drawSystems() {
        main.append(el('div', { className: 'meta', textContent: 'Um sistema virtual é um Windows que roda no navegador. Tudo o que você instala ou grava nele fica guardado no servidor, na sua pasta, e volta na próxima vez que abrir.' }));
        if (!DK.systems.length) main.append(el('div', { className: 'meta', textContent: 'Nenhum sistema virtual. Adicione um abaixo.' }));
        const tb = el('tbody');
        DK.systems.forEach(s => {
          const size = el('td', { className: 'meta', textContent: '…' });
          DK.api('GET', '/fs/list?space=home&path=' + encodeURIComponent(sysDir(s))).then(r => {
            const c = (r.entries || []).find(e => e.name === s.id + '.changes');
            size.textContent = c ? DK.fmtSize(c.size) + ' salvos' : 'nada salvo ainda';
          }).catch(() => { size.textContent = '?'; });
          const sc = el('input', { type: 'checkbox', checked: !!s.desktop, title: 'Atalho na área de trabalho' });
          sc.onchange = async () => { s.desktop = sc.checked; await savePrograms(); };
          const disk = el('td', { className: 'row' }, el('span', { className: 'meta', textContent: s.disk || '—' }));
          if (s.disk) disk.append(el('button', { textContent: 'Ejetar', title: 'Tira o disquete (A:) do sistema', onclick: () => eject(s) }));
          tb.append(el('tr', {}, el('td', { textContent: '🖥️ ' + s.name }), el('td', { className: 'meta', textContent: SYSKINDS[s.kind] || 'Windows' }), size, disk, el('td', {}, categorySelect(s)), el('td', {}, sc),
            el('td', { className: 'row' }, el('button', { className: 'pri', textContent: '▶ Iniciar', onclick: () => DK.runSystem(s) }),
              el('button', { textContent: 'Zerar disco', title: 'Apaga o que foi salvo e volta ao sistema como veio', onclick: () => resetDisk(s) }),
              el('button', { className: 'del', textContent: 'Remover', onclick: () => removeSystem(s) }))));
        });
        if (DK.systems.length) main.append(el('table', {}, el('thead', {}, el('tr', {}, ...['Sistema', 'Tipo', 'Disco salvo', 'Disquete (A:)', 'Categoria', 'Atalho', ''].map(t => el('th', { textContent: t })))), tb));

        // adicionar
        let src = null;
        const err = el('div', { className: 'err' }), ok = el('div', { className: 'ok' });
        const kindSel = el('select', {}, ...Object.keys(SYSKINDS).map(k => el('option', { value: k, textContent: SYSKINDS[k] })));
        const fileLbl = el('span', { className: 'meta', textContent: 'nenhum arquivo escolhido' });
        const name = el('input', { placeholder: 'Nome do sistema (ex.: Windows 3.11)', maxLength: 60 });
        const catPickS = categoryPicker('progs');
        const desk = el('input', { type: 'checkbox', checked: true });
        const delOrig = el('input', { type: 'checkbox' });
        const go = el('button', { className: 'pri', textContent: 'Adicionar sistema' });
        const [pick, up, upIn] = filePicker('.jsdos', 'Escolher o pacote .jsdos do sistema', it => {
          src = it; err.textContent = ''; fileLbl.textContent = it.name;
          if (!/\.jsdos$/i.test(it.name)) { err.textContent = 'Escolha um pacote .jsdos com o Windows instalado.'; src = null; return; }
          if (!name.value) name.value = it.name.replace(/\.jsdos$/i, '').replace(/^system[-_]/i, '').replace(/[_-]+/g, ' ').trim();
          kindSel.value = guessSysKind(it.name);
          delOrig.checked = it.path.indexOf(INST + '/') === 0;
        }, err, ok);
        go.onclick = async () => {
          err.textContent = ''; ok.textContent = '';
          const nm = name.value.trim();
          try {
            if (!src) throw new Error('Escolha o pacote .jsdos do sistema.');
            if (!nm) throw new Error('Dê um nome ao sistema.');
            go.disabled = true;
            const id = unique(slug(nm), DK.systems);
            ok.textContent = 'Preparando o sistema… (pode levar alguns segundos)';
            await mkdir(DIR); await mkdir(SYS);
            await DK.api('POST', '/vm/prepare', { src: src.path, id: id });
            DK.systems.push({ id: id, name: nm, kind: kindSel.value, category: catPickS.get(), desktop: desk.checked });
            await savePrograms();
            if (delOrig.checked) await DK.api('DELETE', '/fs?space=home&path=' + encodeURIComponent(src.path)).catch(() => { /* fica o original */ });
            ok.textContent = '';
            DK.toast('Sistema “' + nm + '” adicionado. Clique em Iniciar para abrir.');
            draw();
          } catch (e) { ok.textContent = ''; err.textContent = e.message; go.disabled = false; }
        };
        main.append(el('hr'), el('b', { textContent: 'Adicionar um sistema virtual' }),
          el('div', { className: 'dwarn', innerHTML: 'A Microsoft não distribui o Windows, então o Diogows não traz nenhum. Use um pacote <code>.jsdos</code> com o Windows (3.x, 95, 98 ou ME) já instalado e que você tenha licença para usar. O Windows leva um tempo para iniciar e exige um PC com folga de memória. Cada salvamento envia o disco inteiro (compactado) ao servidor.' }),
          el('label', {}, 'Versão do Windows', kindSel), el('div', { className: 'row' }, pick, up, fileLbl, upIn), el('label', {}, 'Nome', name),
          catPickS.node, el('label', { className: 'row' }, desk, ' Criar atalho na área de trabalho'),
          el('label', { className: 'row' }, delOrig, ' Apagar o pacote original depois (o sistema preparado fica em Programas/Sistemas e economiza espaço)'),
          el('div', { className: 'row' }, go), ok, err);
      }
      async function eject(s) {
        try { await DK.api('POST', '/vm/detach', { id: s.id }); s.disk = null; await savePrograms(); draw(); DK.toast('Disquete retirado. Vale para a próxima vez que o sistema abrir.'); } catch (e) { DK.toast(e.message); }
      }
      async function resetDisk(s) {
        if (!confirm('Zerar o disco de “' + s.name + '”?\nTudo o que foi instalado ou salvo dentro dele será apagado e o sistema volta ao estado original.')) return;
        if (DK.wins['prog:sys-' + s.id]) DK.closeWin(DK.wins['prog:sys-' + s.id], true);
        try { await DK.api('DELETE', '/fs?space=home&path=' + encodeURIComponent(sysChanges(s))); } catch (e) { if (e.status !== 404) { DK.toast(e.message); return; } }
        draw(); DK.toast('Disco de “' + s.name + '” zerado.');
      }
      async function removeSystem(s) {
        const deps = DK.programs.filter(p => p.os === s.id);
        if (!confirm('Remover “' + s.name + '”?\nO sistema e o disco salvo serão apagados' + (deps.length ? ', junto com os atalhos dos programas instalados nele (' + deps.map(p => p.name).join(', ') + ')' : '') + '.')) return;
        if (DK.wins['prog:sys-' + s.id]) DK.closeWin(DK.wins['prog:sys-' + s.id], true);
        await DK.api('DELETE', '/fs?space=home&path=' + encodeURIComponent(sysDir(s))).catch(() => { /* já removido */ });
        DK.programs = DK.programs.filter(p => p.os !== s.id);
        DK.systems = DK.systems.filter(x => x.id !== s.id);
        await savePrograms(); draw();
      }

      // ---- instalar ----
      function drawInstall() {
        let src = o.file || null, kind = 'dos', zipFiles = null;
        const err = el('div', { className: 'err' }), ok = el('div', { className: 'ok' });
        const kindSel = el('select', {}, ...['dos', 'vm', 'web'].map(k => el('option', { value: k, textContent: KINDS[k] })));
        const fileLbl = el('span', { className: 'meta', textContent: src ? src.name : 'nenhum arquivo escolhido' });
        // Programa Web: endereço, ícone e onde abre
        let webIcon = WEB_ICONS[0], siteIcon = null;
        const urlIn = el('input', { placeholder: 'Endereço (ex.: https://exemplo.com ou {host}:8080/jogos/)', maxLength: 500 });
        const iconRow = el('div', { className: 'row', style: 'flex-wrap:wrap;gap:4px' });
        const iconStatus = el('div', { className: 'meta' });
        const drawIcons = () => iconRow.replaceChildren(...(siteIcon ? [siteIcon] : []).concat(WEB_ICONS).map(ic => {
          const b = el('button', { title: ic === siteIcon ? 'Ícone do próprio site' : ic, className: ic === webIcon ? 'pri' : '', style: 'font-size:18px;padding:2px 8px;min-width:34px' }, DK.iconNode(ic, 22));
          b.onclick = () => { webIcon = ic; drawIcons(); };
          return b;
        }));
        // Procura o ícone do site (o servidor busca: o navegador não lê ícones de outros sites) e o reduz para 64 px; sem ícone, fica a escolha de emoji.
        let iconSeq = 0;
        async function detectIcon() {
          const seq = ++iconSeq, u = webUrl(urlIn.value);
          if (siteIcon && webIcon === siteIcon) webIcon = WEB_ICONS[0];
          siteIcon = null; drawIcons();
          if (!u) { iconStatus.textContent = ''; return; }
          iconStatus.textContent = 'Procurando o ícone do site…';
          try {
            const r = await fetch('/api/desk/webicon?url=' + encodeURIComponent(u), { credentials: 'same-origin' });
            if (!r.ok) throw new Error('sem ícone');
            const img = new Image(), blobUrl = URL.createObjectURL(await r.blob());
            img.src = blobUrl;
            await img.decode();
            const cv = el('canvas', { width: 64, height: 64 }), k = Math.min(64 / (img.naturalWidth || 64), 64 / (img.naturalHeight || 64));
            const w = (img.naturalWidth || 64) * k, h = (img.naturalHeight || 64) * k;
            cv.getContext('2d').drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);
            URL.revokeObjectURL(blobUrl);
            const data = cv.toDataURL('image/png');
            if (seq !== iconSeq) return;
            if (!DK.isIconImg(data)) throw new Error('ícone grande demais');
            siteIcon = webIcon = data; iconStatus.textContent = 'Usando o ícone do próprio site (clique em outro para trocar).';
          } catch (e) { if (seq === iconSeq) iconStatus.textContent = 'O site não tem um ícone próprio que eu consiga usar: escolha um abaixo.'; }
          if (seq === iconSeq) drawIcons();
        }
        urlIn.onchange = detectIcon;
        drawIcons();
        const modeSel = el('select', {}, ...Object.keys(WEB_MODES).map(k => el('option', { value: k, textContent: WEB_MODES[k] })));
        const presets = el('div', { className: 'row', style: 'flex-wrap:wrap;gap:4px' }, ...WEB_PRESETS.map(pr => el('button', { textContent: pr.icon + ' ' + pr.name, title: 'Preenche o endereço, o ícone e o modo', onclick: () => {
          urlIn.value = pr.url; name.value = pr.name; webIcon = pr.icon; modeSel.value = pr.mode; drawIcons(); detectIcon();
        } })));
        const webRows = el('div', { className: 'hidden', style: 'display:grid;gap:10px' },
          el('div', {}, el('div', { className: 'meta', textContent: 'Atalhos prontos' }), presets),
          el('label', {}, 'Endereço da página', urlIn),
          el('div', { className: 'meta', textContent: 'Aceita http e https. Use {host} para o endereço pelo qual você abriu o Diogows (bom para serviços desta máquina em outra porta, como {host}:4533). Um endereço que começa com / é do próprio servidor.' }),
          el('div', {}, el('div', { className: 'meta', textContent: 'Ícone' }), iconStatus, iconRow),
          el('label', {}, 'Abrir em', modeSel),
          el('div', { className: 'meta', textContent: 'Na janela interna, alguns sites não deixam ser exibidos dentro de outra página e aparecem em branco: use o botão “↗ Abrir em outra aba” ou escolha “Fora do app”.' }));
        const exeSel = el('select', {}); const exeRow = el('label', { className: 'hidden' }, 'Programa a executar ao abrir', exeSel);
        const name = el('input', { placeholder: 'Nome do programa', maxLength: 60 });
        const sysSel = el('select', {}, ...DK.systems.map(s => el('option', { value: s.id, textContent: s.name })));
        const sysRow = el('label', { className: 'hidden' }, 'Sistema virtual', sysSel);
        const engSel = el('select', {}, ...Object.keys(ENGINES).map(k => el('option', { value: k, textContent: ENGINES[k].label })));
        const engRow = el('label', {}, 'Engine de emulação', engSel);
        const engNote = el('div', { className: 'dwarn' });
        const vmNote = el('div', { className: 'dwarn hidden', innerHTML: '<b>Dentro de um sistema virtual:</b> o <code>.zip</code> vira um <b>disquete (A:)</b> ligado ao sistema. Abra o sistema, rode <code>A:\\SETUP.EXE</code> (no Windows 3.x: Arquivo → Executar; no 95/98: Iniciar → Executar) e instale. O que for instalado fica no disco salvo do sistema (clique em “Salvar agora” ou feche a janela). Cabe um programa de até <b>1,4 MB</b> (programas maiores ainda não são suportados). O atalho criado aqui abre o sistema.' });
        const catPick = categoryPicker('progs');
        const desk = el('input', { type: 'checkbox', checked: true });
        const go = el('button', { className: 'pri', textContent: 'Instalar' });

        function refreshKind() {
          kind = kindSel.value;
          const web = kind === 'web';
          webRows.classList.toggle('hidden', !web); fileRow.classList.toggle('hidden', web); tipRow.classList.toggle('hidden', web);
          if (web) { exeRow.classList.add('hidden'); sysRow.classList.add('hidden'); vmNote.classList.add('hidden'); engRow.classList.add('hidden'); engNote.classList.add('hidden'); if (err.textContent.indexOf('sistema virtual') >= 0) err.textContent = ''; return; }
          exeRow.classList.toggle('hidden', !(kind === 'dos' && zipFiles));
          sysRow.classList.toggle('hidden', kind !== 'vm'); vmNote.classList.toggle('hidden', kind !== 'vm');
          engRow.classList.toggle('hidden', kind !== 'dos'); engNote.classList.toggle('hidden', kind !== 'dos');
          engNote.textContent = ENGINES[engSel.value].note;
          if (kind === 'dos' && src && /\.zip$/i.test(src.name) && !zipFiles) readZip();
          if (kind === 'vm' && !DK.systems.length) err.textContent = 'Você ainda não tem um sistema virtual. Adicione um na aba “Sistemas virtuais”.';
          else if (err.textContent.indexOf('sistema virtual') >= 0) err.textContent = '';
        }
        async function readZip() {
          fileLbl.textContent = src.name + ' — lendo…';
          try {
            const buf = await DK.fetchFile(src, 'download');
            if (buf.byteLength > 400 * 1048576) throw new Error('pacote grande demais para montar no navegador (máx. 400 MB); use um .jsdos pronto');
            zipFiles = await DK.zip.read(buf);
            const exes = Object.keys(zipFiles).filter(n => /\.(exe|com|bat)$/i.test(n) && !/(^|\/)__macosx\//i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
            exeSel.replaceChildren(...exes.map(n => el('option', { value: n, textContent: n })));
            if (!exes.length) throw new Error('não encontrei .exe, .com ou .bat dentro do zip');
            fileLbl.textContent = src.name + ' (' + Object.keys(zipFiles).length + ' arquivos)'; refreshKind();
          } catch (e) { err.textContent = e.message; zipFiles = null; fileLbl.textContent = src.name; }
        }
        function chosen(it) {
          src = it; err.textContent = ''; ok.textContent = ''; zipFiles = null; exeRow.classList.add('hidden');
          fileLbl.textContent = it.name;
          if (!name.value) name.value = it.name.replace(/\.(zip|jsdos)$/i, '').replace(/[_]+/g, ' ');
          if (/\.jsdos$/i.test(it.name)) fileLbl.textContent = it.name + ' (pacote pronto)';
          refreshKind();
        }
        const [pick, up, upIn] = filePicker('.zip,.jsdos', 'Escolher .jsdos ou .zip', chosen, err, ok);
        const fileRow = el('div', { className: 'row' }, pick, up, fileLbl, upIn);
        const tipRow = el('div', { className: 'meta', textContent: 'Dica: baixe o programa pelo Navegador (vai para Meus arquivos/Downloads) e escolha aqui. Para DOS aceita um .zip com os arquivos do programa ou um pacote .jsdos pronto. Para Windows (3.x, 95, 98, ME), adicione primeiro o sistema na aba “Sistemas virtuais”.' });
        kindSel.onchange = refreshKind; engSel.onchange = refreshKind;

        go.onclick = async () => {
          err.textContent = ''; ok.textContent = '';
          const nm = name.value.trim();
          try {
            if (kind === 'web') {
              if (!nm) throw new Error('Dê um nome ao programa.');
              if (!webUrl(urlIn.value)) throw new Error('Endereço inválido. Use um endereço http ou https (ex.: https://exemplo.com).');
              DK.programs.push({ id: unique(slug(nm), DK.programs), name: nm, kind: 'web', url: urlIn.value.trim(), icon: webIcon, mode: modeSel.value, category: catPick.get(), desktop: desk.checked });
              await savePrograms();
              tab = 'list'; draw();
              DK.toast('“' + nm + '” adicionado. Está no menu Iniciar' + (desk.checked ? ' e na área de trabalho' : '') + '.');
              return;
            }
            if (!src) throw new Error('Escolha o arquivo do programa.');
            if (!nm) throw new Error('Dê um nome ao programa.');
            const isJsdos = /\.jsdos$/i.test(src.name);
            go.disabled = true;
            const id = unique(slug(nm), DK.programs);
            if (kind === 'vm') {
              const s = DK.systems.find(x => x.id === sysSel.value);
              if (!s) throw new Error('Escolha o sistema virtual.');
              if (!/\.zip$/i.test(src.name)) throw new Error('Para instalar dentro de um sistema virtual, escolha um .zip com os arquivos do programa.');
              ok.textContent = 'Montando o disquete…';
              const r = await DK.api('POST', '/vm/attach', { id: s.id, zip: src.path });
              s.disk = nm;
              DK.programs.push({ id: id, name: nm, kind: 'vm', os: s.id, category: catPick.get(), desktop: desk.checked });
              await savePrograms();
              ok.textContent = ''; o.file = null; tab = 'list'; draw();
              if (DK.wins['prog:sys-' + s.id]) DK.toast('Disquete ligado (' + r.files + ' arquivos). Reinicie o sistema aberto para ele aparecer como A:.');
              else DK.toast('Disquete ligado como A: (' + r.files + ' arquivos). Abra “' + s.name + '” e rode A:\\SETUP.EXE.');
              return;
            }
            let bundle = src.path;
            if (!isJsdos) {
              if (!zipFiles) throw new Error('Não consegui ler o zip.');
              ok.textContent = 'Montando o pacote…';
              const sel = exeSel.value, parts = sel.split('/'), file = parts.pop();
              const conf = '[sdl]\nautolock=false\n\n[autoexec]\n@echo off\nmount c .\nc:\n' + (parts.length ? 'cd ' + parts.join('\\') + '\n' : '') + file + '\n';
              const entries = [{ name: '.jsdos/dosbox.conf', data: conf }].concat(Object.keys(zipFiles).map(n => ({ name: n, data: zipFiles[n] })));
              const blob = await DK.zip.write(entries);
              await mkdir(DIR); await mkdir(DIR + '/' + id);
              bundle = DIR + '/' + id + '/' + id + '.jsdos';
              ok.textContent = 'Gravando em Meus arquivos/Programas…';
              await DK.api('PUT', '/fs/file?space=home&overwrite=1&path=' + encodeURIComponent(bundle), blob, true);
            }
            DK.programs.push({ id: id, name: nm, kind: 'dos', engine: engSel.value, bundle: bundle, category: catPick.get(), desktop: desk.checked });
            await savePrograms();
            ok.textContent = '';
            o.file = null; tab = 'list'; draw();
            DK.toast('“' + nm + '” instalado. Está no menu Iniciar' + (desk.checked ? ' e na área de trabalho' : '') + '.');
          } catch (e) { ok.textContent = ''; err.textContent = e.message; go.disabled = false; }
        };

        main.append(
          el('label', {}, 'Onde instalar', kindSel), sysRow, webRows,
          fileRow, tipRow,
          exeRow, el('label', {}, 'Nome', name), engRow, engNote, vmNote, catPick.node,
          el('label', { className: 'row' }, desk, ' Criar atalho na área de trabalho'), el('div', { className: 'row' }, go), ok, err);
        refreshKind();
        if (src) chosen(src);
      }

      // ---- acessórios (os aplicativos do Diogows) ----
      function drawAcc() {
        const fixed = ['programs', 'control', 'account', 'explorer'];
        const hidden = DK.prefs.hiddenApps || [];
        main.append(el('div', { className: 'meta', textContent: 'Marque os acessórios que você quer ver no menu Iniciar e na área de trabalho. Desmarcar apenas os esconde; nada é apagado e você pode instalar de novo a qualquer momento.' }));
        DK.apps.filter(a => fixed.indexOf(a.id) < 0 && (!a.show || a.show(DK.me))).forEach(a => {
          const c = el('input', { type: 'checkbox', checked: hidden.indexOf(a.id) < 0 });
          c.onchange = () => {
            const set = new Set(DK.prefs.hiddenApps || []);
            if (c.checked) set.delete(a.id); else set.add(a.id);
            DK.prefs.hiddenApps = [...set]; DK.savePrefs(); if (DK.refreshShell) DK.refreshShell();
          };
          main.append(el('label', { className: 'row' }, c, el('span', {}, DK.iconNode(a.icon, 16), ' ' + a.label)));
        });
      }
      draw();
      win._install = f => { o.file = f; tab = 'install'; draw(); };
    }, 860, 580, { flush: true });
    if (o.file && win._install) win._install(o.file);
    return win;
  };
  // atalho usado pelo Navegador e pelo Explorer: abre o instalador já com o arquivo
  DK.installProgramApp = function (it) { return DK.programsApp({ file: { space: 'home', path: it.path, name: it.name || it.path.split('/').pop(), type: 'file' } }); };

  // ---------- acessório: Calculadora ----------
  DK.calculatorApp = function () {
    DK.openWindow('calculator', 'Calculadora', body => {
      const out = el('input', { readOnly: true, value: '0', style: 'text-align:right;font-size:22px;padding:8px' });
      const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px' });
      let expr = '';
      const show = v => { out.value = v === '' ? '0' : v; };
      const calc = () => {
        if (!/^[0-9+\-*/().%\s]+$/.test(expr)) return 'Erro';
        try { const v = Function('"use strict";return (' + expr.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)') + ')')(); return isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : 'Erro'; } catch (e) { return 'Erro'; }
      };
      ['C', '(', ')', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '%', '='].forEach(k => {
        const b = el('button', { textContent: k, className: k === '=' ? 'pri' : '' }); b.style.padding = '12px';
        b.onclick = () => {
          if (k === 'C') expr = '';
          else if (k === '=') expr = calc() === 'Erro' ? '' : calc();
          else expr += k;
          show(expr);
          if (k === '=' && expr === '') show('Erro');
        };
        grid.append(b);
      });
      body.append(out, grid);
    }, 300, 360);
  };

  DK.register({ id: 'programs', icon: '🧩', label: 'Instalar Programas e Acessórios', desktop: true, open: () => DK.programsApp() });
  DK.register({ id: 'calculator', icon: '🧮', label: 'Calculadora', open: DK.calculatorApp });
})(window.DK = window.DK || {});
