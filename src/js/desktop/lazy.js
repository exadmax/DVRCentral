(function (DK) {
  // Aplicativos pesados (editores, e-mail, jogos, Paint, navegador, player, zip) só são baixados e lidos pelo navegador na primeira vez que alguém os abre:
  // o Diogows abre bem mais rápido em Wi-Fi fraco, TV e computador antigo. Este arquivo registra os aplicativos no menu e deixa, no lugar das funções de
  // abrir, uma ponte que carrega o grupo de scripts e repete a chamada na função de verdade. Os scripts de cada grupo não se registram mais sozinhos.
  // Para tornar outro aplicativo sob demanda: tire o script do desktop.html, acrescente o grupo abaixo e leve o DK.register dele para cá.
  const Q = (document.currentScript && document.currentScript.src.split('?')[1]) || '';   // ?v=VERSÃO da página, repassado aos scripts
  const GROUPS = {
    docs: ['docfmt.js', 'docs.js'],
    sheets: ['formula.js', 'sheetfmt.js', 'sheets.js'],
    slides: ['slidefmt.js', 'slides.js'],
    zip: ['zipman.js'],
    mail: ['mail.js'],
    games: ['games.js'],
    browser: ['browser.js'],
    paint: ['paint.js'],
    emulators: ['emulators.js'],
    music: ['music.js']
  };
  const scripts = {}, groups = {};

  function loadScript(f) {
    return scripts[f] || (scripts[f] = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.async = false;                                         // vários scripts inseridos juntos baixam juntos e rodam na ordem
      s.src = 'js/desktop/' + f + (Q ? '?' + Q : '');
      s.onload = () => ok();
      s.onerror = () => { delete scripts[f]; s.remove(); no(new Error('não carregou ' + f)); };
      document.head.append(s);
    }));
  }

  function ensure(g) {
    return groups[g] || (groups[g] = Promise.all(GROUPS[g].map(loadScript)).then(() => {}, e => { delete groups[g]; throw e; }));
  }

  // Ponte: carrega o grupo e chama DK[name], que o script acabou de redefinir. Vale como a função de abrir (devolve uma Promise).
  function bridge(g, name) {
    const stub = function () {
      const args = arguments, b = document.body;
      b.style.cursor = 'progress';
      return ensure(g).then(() => {
        if (DK[name] === stub) throw new Error(name + ' não foi definido por ' + GROUPS[g].join(', '));
        return DK[name].apply(DK, args);
      }).catch(e => {
        console.error(e);
        DK.toast('Não foi possível abrir: ' + (e && e.message || e));
      }).then(() => { b.style.cursor = ''; });
    };
    DK[name] = stub;
  }

  [
    ['docs', ['docApp']],
    ['sheets', ['sheetApp']],
    ['slides', ['slideApp']],
    ['zip', ['zipApp', 'zipCompress', 'zipExtractHere']],
    ['mail', ['mailApp', 'mailCompose', 'mailAccountDialog']],
    ['games', ['minesweeperApp', 'solitaireApp', 'freecellApp']],
    ['browser', ['browserApp']],
    ['paint', ['paintApp']],
    ['emulators', ['emulatorsApp', 'playRom']],
    ['music', ['musicApp']]
  ].forEach(it => it[1].forEach(name => bridge(it[0], name)));

  DK.register({ id: 'zip', icon: '🗜️', label: 'Zip Manager (.zip)', desktop: true, open: () => DK.zipApp({ dir: { space: 'home', path: '/' } }) });
  DK.register({ id: 'docs', icon: '📘', label: 'LiteOffice Documentos (.docx / .odt)', desktop: true, open: () => DK.docApp({ dir: { space: 'home', path: '/' } }) });
  DK.register({ id: 'sheets', icon: '📗', label: 'LiteOffice Planilhas (.xlsx / .ods)', desktop: true, open: () => DK.sheetApp({ dir: { space: 'home', path: '/' } }) });
  DK.register({ id: 'slides', icon: '📙', label: 'LiteOffice Apresentações (.pptx / .odp)', desktop: true, open: () => DK.slideApp({ dir: { space: 'home', path: '/' } }) });
  DK.register({ id: 'browser', icon: '🌐', label: 'Navegador', desktop: true, show: me => me.browser, open: () => DK.browserApp() });
  DK.register({ id: 'minesweeper', icon: '💣', label: 'Campo Minado', open: () => DK.minesweeperApp() });
  DK.register({ id: 'solitaire', icon: '🃏', label: 'Paciência', open: () => DK.solitaireApp() });
  DK.register({ id: 'freecell', icon: '♣️', label: 'FreeCell', open: () => DK.freecellApp() });
  DK.register({ id: 'emulators', icon: '🎮', label: 'Emuladores (consoles)', desktop: false, open: () => DK.emulatorsApp() });
  DK.register({ id: 'music', icon: '🎵', label: 'Player de Música', open: () => DK.musicApp() });
  DK.register({ id: 'mail', icon: '✉️', label: 'E-mail', desktop: true, open: () => DK.mailApp() });
  DK.register({ id: 'paint', icon: '🎨', label: 'Paint', desktop: true, open: () => DK.paintApp() });
})(window.DK = window.DK || {});
