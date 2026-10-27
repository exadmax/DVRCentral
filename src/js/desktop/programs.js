(function (DK) {
  // Instalar Programas e Acessórios: instala programas DOS e Windows 95/98/ME na pasta do usuário e os executa no navegador com o js-dos
  // (que traz o DOSBox e o DOSBox-X em WebAssembly, dentro do hub; não precisa de internet). Nada roda no servidor.
  //
  //  - Programa DOS: um .zip com os arquivos do programa (o instalador monta o pacote) ou um pacote .jsdos pronto.
  //  - Windows 95/98/ME: um pacote .jsdos que já tenha o Windows instalado (o Windows é da Microsoft e não vem aqui: use o seu, com licença).
  //  - Acessórios: os aplicativos do próprio Desktop, que podem ser instalados (aparecem no menu) ou removidos (somem do menu).
  const el = DK.el, esc = DK.esc;
  const DIR = '/Programas', REG = DIR + '/programas.json';
  DK.programs = [];

  const ENGINES = {
    dosboxX: { label: 'DOSBox-X', win9x: true, note: 'Mais compatível: roda programas DOS e também Windows 95/98/ME. É a mais pesada (carrega ~8 MB, usa mais CPU e memória e pode ficar lenta em PCs fracos). Windows 9x exige um pacote com o Windows já instalado.' },
    dosbox: { label: 'js-dos (DOSBox)', win9x: false, note: 'Leve e rápida, ideal para jogos e programas DOS comuns. Não roda Windows 9x e tem menos recursos de compatibilidade (alguns modos de vídeo e dispositivos avançados do DOSBox-X ficam de fora).' }
  };
  const KINDS = { dos: 'DOS', win9x: 'Windows 95/98/ME' };
  const home = p => ({ space: 'home', path: p });
  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'programa';

  // ---------- registro (um JSON na pasta do usuário) ----------
  const mkdir = p => DK.api('POST', '/fs/mkdir', { space: 'home', path: p }).catch(() => { /* já existe */ });
  DK.loadPrograms = async function () {
    try { DK.programs = JSON.parse(new TextDecoder().decode(await DK.fetchFile(home(REG), 'download'))).programs || []; } catch (e) { DK.programs = []; }
  };
  async function savePrograms() {
    await mkdir(DIR);
    await DK.api('PUT', '/fs/file?space=home&path=' + encodeURIComponent(REG) + '&text=1&overwrite=1', JSON.stringify({ version: 1, programs: DK.programs }, null, 1), true);
    if (DK.refreshShell) DK.refreshShell();
  }
  // Entradas para o menu Iniciar e a área de trabalho
  DK.programEntries = () => DK.programs.map(p => ({ id: 'prog:' + p.id, icon: p.kind === 'win9x' ? '🪟' : '🕹️', label: p.name, desktop: !!p.desktop, open: () => DK.runProgram(p) }));

  // ---------- executar ----------
  // Cada programa roda num iframe com emulator.html: o js-dos guarda estado global e só inicia limpo num documento novo. Fechar a janela
  // destrói o iframe (e o emulador junto); "Reiniciar" recarrega o iframe.
  DK.runProgram = function (p) {
    DK.openWindow('prog:' + p.id, p.name, (body, win) => {
      body.className = 'body flush';
      const eng = ENGINES[p.engine] || ENGINES.dosboxX;
      const full = el('button', { textContent: '⛶ Tela cheia' }), again = el('button', { textContent: '↻ Reiniciar' });
      const tb = el('div', { className: 'tb' }, full, again, el('span', { className: 'sp' }),
        el('span', { className: 'meta', textContent: KINDS[p.kind] + ' · ' + eng.label + (p.kind === 'win9x' ? ' · o Windows leva um tempo para iniciar' : '') }));
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
      tabBtn('list', '🕹️ Programas instalados'); tabBtn('install', '➕ Instalar programa'); tabBtn('acc', '🧰 Acessórios do Desktop');

      function draw() {
        [].forEach.call(tabs.querySelectorAll('button'), b => b.classList.toggle('pri', b.dataset.t === tab));
        main.replaceChildren();
        ({ list: drawList, install: drawInstall, acc: drawAcc })[tab]();
      }

      // ---- instalados ----
      function drawList() {
        if (!DK.programs.length) main.append(el('div', { className: 'meta', textContent: 'Nenhum programa instalado. Use “Instalar programa” para adicionar um jogo ou aplicativo DOS ou Windows 95/98/ME.' }));
        const tb = el('tbody');
        DK.programs.forEach(p => {
          const sc = el('input', { type: 'checkbox', checked: !!p.desktop, title: 'Atalho na área de trabalho' });
          sc.onchange = async () => { p.desktop = sc.checked; await savePrograms(); };
          tb.append(el('tr', {}, el('td', { textContent: (p.kind === 'win9x' ? '🪟 ' : '🕹️ ') + p.name }), el('td', { className: 'meta', textContent: KINDS[p.kind] }),
            el('td', { className: 'meta', textContent: (ENGINES[p.engine] || ENGINES.dosboxX).label }), el('td', {}, sc),
            el('td', { className: 'row' }, el('button', { className: 'pri', textContent: '▶ Executar', onclick: () => DK.runProgram(p) }),
              el('button', { className: 'del', textContent: 'Desinstalar', onclick: () => uninstall(p) }))));
        });
        if (DK.programs.length) main.append(el('table', {}, el('thead', {}, el('tr', {}, ...['Programa', 'Tipo', 'Engine', 'Atalho', ''].map(t => el('th', { textContent: t })))), tb));
        main.append(el('div', { className: 'meta', textContent: 'Os programas ficam na sua pasta (Meus arquivos/Programas) e só você os vê.' }));
      }
      async function uninstall(p) {
        if (!confirm('Desinstalar “' + p.name + '”?' + (p.bundle.indexOf(DIR + '/' + p.id + '/') === 0 ? '\nOs arquivos instalados serão apagados.' : '\nO arquivo original não será apagado.'))) return;
        if (DK.wins['prog:' + p.id]) DK.closeWin(DK.wins['prog:' + p.id], true);
        if (p.bundle.indexOf(DIR + '/' + p.id + '/') === 0) await DK.api('DELETE', '/fs?space=home&path=' + encodeURIComponent(DIR + '/' + p.id)).catch(() => { /* já removido */ });
        DK.programs = DK.programs.filter(x => x.id !== p.id);
        await savePrograms(); draw();
      }

      // ---- instalar ----
      function drawInstall() {
        let src = o.file || null, kind = 'dos', zipFiles = null;
        const err = el('div', { className: 'err' }), ok = el('div', { className: 'ok' });
        const kindSel = el('select', {}, ...Object.keys(KINDS).map(k => el('option', { value: k, textContent: KINDS[k] })));
        const fileLbl = el('span', { className: 'meta', textContent: src ? src.name : 'nenhum arquivo escolhido' });
        const pick = el('button', { textContent: '📂 Escolher da minha pasta…' });
        const up = el('button', { textContent: '⬆ Enviar do computador…' });
        const upIn = el('input', { type: 'file', accept: '.zip,.jsdos' }); upIn.style.display = 'none';
        const exeSel = el('select', {}); const exeRow = el('label', { className: 'hidden' }, 'Programa a executar ao abrir', exeSel);
        const name = el('input', { placeholder: 'Nome do programa', maxLength: 60 });
        const engSel = el('select', {}, ...Object.keys(ENGINES).map(k => el('option', { value: k, textContent: ENGINES[k].label })));
        const engNote = el('div', { className: 'dwarn' });
        const desk = el('input', { type: 'checkbox', checked: true });
        const go = el('button', { className: 'pri', textContent: 'Instalar' });
        const win9note = el('div', { className: 'dwarn hidden', innerHTML: '<b>Windows 95/98/ME:</b> a Microsoft não distribui esses sistemas, então o Desktop não os traz. Use um pacote <code>.jsdos</code> com o Windows já instalado e que você tenha licença para usar (por exemplo, um que você mesmo montou). O Windows leva um tempo para iniciar e exige um PC com folga de memória.' });

        function refreshEngine() {
          kind = kindSel.value;
          [].forEach.call(engSel.options, op => { op.disabled = kind === 'win9x' && !ENGINES[op.value].win9x; });
          if (engSel.options[engSel.selectedIndex].disabled) engSel.value = 'dosboxX';
          engNote.textContent = ENGINES[engSel.value].note;
          win9note.classList.toggle('hidden', kind !== 'win9x');
        }
        async function chosen(it) {
          src = it; err.textContent = ''; ok.textContent = ''; zipFiles = null; exeRow.classList.add('hidden');
          fileLbl.textContent = it.name;
          if (!name.value) name.value = it.name.replace(/\.(zip|jsdos)$/i, '').replace(/[_]+/g, ' ');
          if (/\.zip$/i.test(it.name)) {
            fileLbl.textContent = it.name + ' — lendo…';
            try {
              const buf = await DK.fetchFile(it, 'download');
              if (buf.byteLength > 400 * 1048576) throw new Error('pacote grande demais para montar no navegador (máx. 400 MB); use um .jsdos pronto');
              zipFiles = await DK.zip.read(buf);
              const exes = Object.keys(zipFiles).filter(n => /\.(exe|com|bat)$/i.test(n) && !/(^|\/)__macosx\//i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
              exeSel.replaceChildren(...exes.map(n => el('option', { value: n, textContent: n })));
              if (!exes.length) throw new Error('não encontrei .exe, .com ou .bat dentro do zip');
              exeRow.classList.remove('hidden'); fileLbl.textContent = it.name + ' (' + Object.keys(zipFiles).length + ' arquivos)';
            } catch (e) { err.textContent = e.message; zipFiles = null; }
          }
          if (/\.jsdos$/i.test(it.name)) fileLbl.textContent = it.name + ' (pacote pronto)';
        }
        pick.onclick = () => DK.pickFile('program', 'Escolher .jsdos ou .zip', it => { if (it.space !== 'home') { err.textContent = 'Escolha um arquivo da sua pasta (Meus arquivos).'; return; } chosen(it); });
        up.onclick = () => upIn.click();
        upIn.onchange = async () => {
          const f = upIn.files[0]; upIn.value = '';
          if (!f) return;
          err.textContent = ''; ok.textContent = 'Enviando ' + f.name + '…';
          try {
            await mkdir(DIR); await mkdir(DIR + '/Instaladores');
            const path = DIR + '/Instaladores/' + f.name.replace(/[\/\\]/g, '_');
            await DK.api('PUT', '/fs/file?space=home&overwrite=1&path=' + encodeURIComponent(path), f, true);
            ok.textContent = '';
            chosen({ space: 'home', path: path, name: f.name, type: 'file' });
          } catch (e) { ok.textContent = ''; err.textContent = e.message; }
        };
        kindSel.onchange = refreshEngine; engSel.onchange = refreshEngine;

        go.onclick = async () => {
          err.textContent = ''; ok.textContent = '';
          const nm = name.value.trim();
          try {
            if (!src) throw new Error('Escolha o arquivo do programa.');
            if (!nm) throw new Error('Dê um nome ao programa.');
            const isJsdos = /\.jsdos$/i.test(src.name);
            if (kind === 'win9x' && !isJsdos) throw new Error('Windows 95/98/ME precisa de um pacote .jsdos com o Windows instalado.');
            if (kind === 'win9x' && !ENGINES[engSel.value].win9x) throw new Error('Esta engine não roda Windows 9x: use o DOSBox-X.');
            go.disabled = true;
            let id = slug(nm);
            while (DK.programs.some(p => p.id === id)) id += '-2';
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
            DK.programs.push({ id: id, name: nm, kind: kind, engine: engSel.value, bundle: bundle, desktop: desk.checked });
            await savePrograms();
            ok.textContent = '';
            o.file = null; tab = 'list'; draw();
            DK.toast('“' + nm + '” instalado. Está no menu Iniciar' + (desk.checked ? ' e na área de trabalho' : '') + '.');
          } catch (e) { ok.textContent = ''; err.textContent = e.message; go.disabled = false; }
        };

        main.append(
          el('label', {}, 'Tipo de programa', kindSel),
          el('div', { className: 'row' }, pick, up, fileLbl, upIn),
          el('div', { className: 'meta', textContent: 'Dica: baixe o programa pelo Navegador (vai para Meus arquivos/Downloads) e escolha aqui. Aceita um .zip com os arquivos do programa ou um pacote .jsdos pronto.' }),
          exeRow, el('label', {}, 'Nome', name), el('label', {}, 'Engine de emulação', engSel), engNote, win9note,
          el('label', { className: 'row' }, desk, ' Criar atalho na área de trabalho'), el('div', { className: 'row' }, go), ok, err);
        refreshEngine();
        if (src) chosen(src);
      }

      // ---- acessórios (os aplicativos do Desktop) ----
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
          main.append(el('label', { className: 'row' }, c, el('span', { textContent: a.icon + ' ' + a.label })));
        });
      }
      draw();
      win._install = f => { o.file = f; tab = 'install'; draw(); };
    }, 760, 560, { flush: true });
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
