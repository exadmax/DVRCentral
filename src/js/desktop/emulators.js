(function (DK) {
  // Emuladores: Mega Drive, Master System, Super Nintendo, Game Boy, Game Boy Color, Game Boy Advance e Atari 2600, com o EmulatorJS (núcleos do
  // RetroArch em WebAssembly, rodando no navegador; veja src/emu.html). As ROMs são suas, na pasta Jogos/Emuladores de Meus arquivos, uma pasta
  // por sistema; o Diogows não traz nenhuma. Cada jogo abre numa janela própria.
  const el = DK.el;
  const DIR = '/Jogos', ROOT = DIR + '/Emuladores';
  const SYSTEMS = [
    { id: 'md', name: 'Mega Drive', icon: '🔵', core: 'segaMD', ext: 'md|gen|smd|bin' },
    { id: 'ms', name: 'Master System', icon: '🔴', core: 'segaMS', ext: 'sms' },
    { id: 'snes', name: 'Super Nintendo', icon: '🟣', core: 'snes', ext: 'smc|sfc|swc|fig' },
    { id: 'gb', name: 'Game Boy', icon: '🟢', core: 'gb', ext: 'gb' },
    { id: 'gbc', name: 'Game Boy Color', icon: '🌈', core: 'gb', ext: 'gbc' },
    { id: 'gba', name: 'Game Boy Advance', icon: '🔷', core: 'gba', ext: 'gba' },
    { id: 'atari', name: 'Atari 2600', icon: '🕹️', core: 'atari2600', ext: 'a26|bin' }
  ];
  SYSTEMS.forEach(s => { s.dir = ROOT + '/' + s.name; s.re = new RegExp('\\.(' + s.ext + '|zip|7z)$', 'i'); });
  const home = p => ({ space: 'home', path: p });
  const mkdir = p => DK.api('POST', '/fs/mkdir', { space: 'home', path: p }).catch(() => { /* já existe */ });
  const title = n => n.replace(/\.[^.]+$/, '');
  const size = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  // Um jogo numa janela: o emu.html tem o emulador, que só inicia limpo num documento novo. "Reiniciar" recarrega o iframe; fechar a janela o destrói.
  DK.playRom = function (sys, path, name) {
    DK.openWindow('emu:' + sys.id + ':' + path, title(name) + ' · ' + sys.name, (body, win) => {
      body.className = 'body flush';
      const full = el('button', { textContent: '⛶ Tela cheia' }), again = el('button', { textContent: '↻ Reiniciar' });
      body.append(el('div', { className: 'tb' }, full, again, el('span', { className: 'sp' }), el('span', { className: 'meta', textContent: sys.name + ' · EmulatorJS' })));
      const frame = el('iframe', { className: 'fill dosframe', title: name });
      frame.setAttribute('allow', 'fullscreen; autoplay; gamepad');
      frame.setAttribute('allowfullscreen', '');
      body.append(frame);
      const start = () => { frame.src = 'emu.html?core=' + sys.core + '&g=' + encodeURIComponent(DK.fileUrl(home(path), 'download')) + '&n=' + encodeURIComponent(name) + '&t=' + Date.now(); };
      full.onclick = () => { if (frame.requestFullscreen) frame.requestFullscreen(); };
      again.onclick = start;
      win._onClose = () => { frame.src = 'about:blank'; };
      start();
    }, 760, 600, { flush: true });
  };

  DK.emulatorsApp = function () {
    DK.openWindow('emulators', 'Emuladores', (body, win) => {
      body.className = 'body flush';
      let cur = SYSTEMS[0], games = [];
      const sel = el('select', { title: 'Sistema' }, ...SYSTEMS.map(s => el('option', { value: s.id, textContent: s.icon + ' ' + s.name })));
      const bUp = el('button', { textContent: '⬆ Enviar ROMs', title: 'Envia ROMs do seu aparelho para a pasta deste sistema em Meus arquivos' });
      const bPick = el('button', { textContent: '📂 Da minha pasta', title: 'Copia uma ROM de qualquer pasta de Meus arquivos para a pasta deste sistema' });
      const bOpen = el('button', { textContent: '🗂 Abrir a pasta', title: 'Mostra a pasta deste sistema no Explorer, para organizar ou apagar ROMs' });
      const info = el('span', { className: 'meta' });
      const upIn = el('input', { type: 'file', multiple: true }); upIn.style.display = 'none';
      const list = el('div', { className: 'emulist' });
      body.append(el('div', { className: 'tb' }, sel, bUp, bPick, bOpen, el('span', { className: 'sp' }), info), list, upIn);

      async function load() {
        upIn.accept = cur.ext.split('|').map(e => '.' + e).concat(['.zip', '.7z']).join(',');
        info.textContent = 'Lendo a pasta…';
        await mkdir(DIR); await mkdir(ROOT); await mkdir(cur.dir);
        let r; try { r = await DK.api('GET', '/fs/list?space=home&path=' + encodeURIComponent(cur.dir)); } catch (e) { r = { entries: [] }; }
        games = (r.entries || []).filter(e => e.type !== 'dir' && cur.re.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true }));
        render();
      }
      function render() {
        list.replaceChildren();
        if (!games.length) {
          list.append(el('div', { className: 'empty' }, 'Nenhuma ROM de ' + cur.name + ' ainda.', el('br'),
            'Use “Enviar ROMs” (arquivos ' + cur.ext.split('|').map(e => '.' + e).join(' ') + ' ou .zip). O Diogows não traz jogos: use os que você tem direito de usar.'));
        }
        for (const g of games) {
          const b = el('button', { className: 'emugame', title: 'Jogar ' + title(g.name) }, el('span', { className: 'emuico', textContent: cur.icon }), el('span', { className: 'emunm', textContent: title(g.name) }), el('span', { className: 'meta', textContent: g.size != null ? size(g.size) : '' }));
          b.onclick = () => DK.playRom(cur, cur.dir + '/' + g.name, g.name);
          list.append(b);
        }
        info.textContent = games.length ? games.length + ' jogo' + (games.length > 1 ? 's' : '') + ' · Meus arquivos' + cur.dir : 'Pasta: Meus arquivos' + cur.dir;
      }
      sel.onchange = () => { cur = SYSTEMS.find(s => s.id === sel.value) || SYSTEMS[0]; load(); };
      bOpen.onclick = () => DK.explorerApp({ space: 'home', path: cur.dir });

      async function put(file, name) {
        const path = cur.dir + '/' + name.replace(/[\/\\]/g, '_');
        await DK.api('PUT', '/fs/file?space=home&overwrite=1&path=' + encodeURIComponent(path), file, true);
      }
      upIn.onchange = async () => {
        const files = [...upIn.files]; upIn.value = '';
        const ok = files.filter(f => cur.re.test(f.name));
        if (files.length > ok.length) DK.toast('Ignorei arquivos que não são ROM de ' + cur.name + '.');
        let n = 0;
        for (const f of ok) {
          info.textContent = 'Enviando ' + (++n) + ' de ' + ok.length + '…';
          try { await put(f, f.name); } catch (e) { DK.toast('“' + f.name + '”: ' + e.message); }
        }
        load();
      };
      bUp.onclick = () => upIn.click();
      bPick.onclick = () => DK.pickFile('any', 'Escolher uma ROM de ' + cur.name, async it => {
        if (it.space !== 'home' || !cur.re.test(it.name)) { DK.toast('Escolha uma ROM de ' + cur.name + ' (' + cur.ext.split('|').map(e => '.' + e).join(' ') + ' ou .zip) de Meus arquivos.'); return; }
        try { const blob = await (await fetch(DK.fileUrl(it, 'download'), { credentials: 'same-origin' })).blob(); await put(blob, it.name); } catch (e) { DK.toast(e.message); }
        load();
      });
      load();
    }, 560, 480, { flush: true });
  };

  // ROM clicada no Explorer (ou aberta de outro lugar): descobre o sistema pela extensão. .bin e .zip valem para mais de um sistema, então só
  // com o sistema da pasta (Jogos/Emuladores/<sistema>) ou na janela Emuladores.
  DK.romSystem = (path, name) => {
    const inDir = SYSTEMS.find(s => path.indexOf(s.dir + '/') === 0);
    if (inDir && inDir.re.test(name)) return inDir;
    return SYSTEMS.find(s => new RegExp('\\.(' + s.ext.replace('|bin', '').replace('bin|', '') + ')$', 'i').test(name)) || null;
  };

})(window.DK = window.DK || {});
