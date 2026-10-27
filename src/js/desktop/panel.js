(function (DK) {
  // Painel de Controle: um lugar só para as configurações do Diogows e do painel da casa (a página Config, aba por aba), as contas,
  // as câmeras, o calendário, a rede e os programas Windows 95/98 e DOS instalados, que podem ser executados direto daqui.
  const el = DK.el;

  const CONFIG_TABS = [['servidor', '🖧', 'Servidor', 'Uso do servidor e botões de energia'], ['cameras', '📷', 'Câmeras e gravações', 'Gravação, retenção e Google Drive'],
    ['agendas', '🗓️', 'Agendas e rotas', 'iCal da casa e trânsito'], ['painel', '🖼️', 'Painel', 'Cidade, modo noturno, validade, locais'], ['livros', '📚', 'Livros', 'Página de livros e categorias'],
    ['menu', '☰', 'Menu de atalhos', 'Jogos, Música, Diogows e os demais'], ['integracoes', '🔌', 'Integrações', 'Planilha, jogos, cache e rede'],
    ['idioma', '🌐', 'Idioma', 'Português, English, Español, 中文'], ['compat', '📺', 'Compatibilidade (TV)', 'Uma câmera por vez'], ['ajuda', '❓', 'Ajuda', 'Manual com busca']];

  function sections() {
    const me = DK.me, admin = me.is_admin;
    const S = [];
    S.push({ title: 'Programas', items: [
      { icon: '🧩', label: 'Instalar Programas e Acessórios', sub: 'DOS, Windows 95/98/ME e acessórios', open: () => DK.programsApp() },
      { icon: '➕', label: 'Instalar programa', sub: 'A partir de .zip ou .jsdos', open: () => DK.programsApp({ tab: 'install' }) },
      { icon: '🧰', label: 'Acessórios do Diogows', sub: 'Mostrar ou esconder aplicativos', open: () => DK.programsApp({ tab: 'acc' }) }] });
    if (DK.programs.length) S.push({ title: 'Programas instalados (clique para executar)', items: DK.programs.map(p => (
      { icon: p.kind === 'win9x' ? '🪟' : '🕹️', label: p.name, sub: (p.kind === 'win9x' ? 'Windows 95/98/ME' : 'DOS') + ' · ' + (p.engine === 'dosbox' ? 'js-dos' : 'DOSBox-X'), open: () => DK.runProgram(p) })) });
    S.push({ title: 'Sistema e manutenção', items: [
      { icon: '🖥️', label: 'Meu Computador', sub: 'CPU, memória, discos e rede', open: DK.computerApp },
      { icon: '🗂️', label: 'Meus arquivos', sub: 'Explorer', open: () => DK.explorerApp({}) }] });
    if (DK.layout.canToggle()) S[S.length - 1].items.push({ icon: DK.layout.isPc() ? '📱' : '🖥️', label: DK.layout.isPc() ? 'Layout adaptativo' : 'Layout PC puro', sub: DK.layout.isPc() ? 'Voltar à interface para celular' : 'Mostrar a tela completa do computador', open: () => DK.layout.toggle() });
    if (me.shell && (admin || me.can_explorer)) S[S.length - 1].items.push({ icon: '💻', label: 'Arquivos do computador', sub: 'Explorer no servidor (com sudo)', open: () => DK.explorerApp({ space: 'machine', path: '/' }) });
    if (me.shell && (admin || me.can_terminal)) S[S.length - 1].items.push({ icon: '⌨️', label: 'Terminal', sub: 'Comandos no servidor (com sudo)', open: DK.terminalApp });
    S.push({ title: 'Contas e notificações', items: [
      { icon: '⚙️', label: 'Minha conta', sub: 'Trocar senha e ver permissões', open: DK.accountApp },
      { icon: '📅', label: 'Calendário', sub: 'Agendas iCal do usuário', open: () => DK.calendarApp() },
      { icon: '🔔', label: 'Agendas e avisos', sub: 'Antecedência, som e agendas da casa', open: () => DK.calendarApp({ view: 'cfg' }) }] });
    if (admin) S[S.length - 1].items.unshift({ icon: '👥', label: 'Usuários e permissões', sub: 'Criar contas e liberar Terminal/arquivos', open: DK.usersApp });
    S.push({ title: 'Dispositivos e contatos', items: [
      { icon: '📷', label: 'Câmeras', sub: admin ? 'Ver, abrir em janelas e gerenciar' : 'Ver e abrir em janelas', open: DK.camerasApp },
      { icon: '📇', label: 'Contatos', sub: 'Profissionais e serviços da casa', open: DK.contactsApp }] });
    if (me.browser) S.push({ title: 'Rede e Internet', items: [
      { icon: '🌐', label: 'Navegador', sub: 'Páginas e downloads internos', open: () => DK.browserApp() },
      { icon: '⬇', label: 'Downloads', sub: 'Meus arquivos/Downloads', open: () => DK.explorerApp({ path: '/Downloads' }) }] });
    if (admin) S.push({ title: 'Configurações do painel da casa (Config)', note: 'A mesma página Config do painel, aberta aqui aba por aba. Só o administrador as altera.',
      items: CONFIG_TABS.map(t => ({ icon: t[1], label: t[2], sub: t[3], open: () => DK.configApp({ tab: t[0] }) })) });
    return S;
  }

  DK.controlPanelApp = function () {
    DK.openWindow('control', 'Painel de Controle', (body, win) => {
      body.className = 'body flush';
      const q = el('input', { type: 'search', placeholder: 'Pesquisar no Painel de Controle…' });
      const tb = el('div', { className: 'tb' }, el('span', { textContent: '🎛️ Painel de Controle', style: 'font-weight:600' }), el('span', { className: 'sp' }), q);
      const box = el('div', { className: 'cpbox' });
      body.append(tb, box);
      function draw() {
        box.replaceChildren();
        const needle = q.value.trim().toLowerCase();
        sections().forEach(sec => {
          const items = sec.items.filter(i => !needle || (i.label + ' ' + i.sub + ' ' + sec.title).toLowerCase().indexOf(needle) >= 0);
          if (!items.length) return;
          box.append(el('div', { className: 'sec', textContent: sec.title }));
          if (sec.note && !needle) box.append(el('div', { className: 'meta', textContent: sec.note }));
          const grid = el('div', { className: 'tiles' });
          items.forEach(i => grid.append(el('button', { className: 'tile', onclick: i.open }, el('span', { className: 'ti', textContent: i.icon }), el('b', { textContent: i.label }), el('span', { className: 'meta', textContent: i.sub }))));
          box.append(grid);
        });
        if (!box.childNodes.length) box.append(el('div', { className: 'meta', textContent: 'Nada encontrado.' }));
      }
      q.oninput = draw;
      win._refresh = draw;
      draw();
    }, 780, 560, { flush: true });
  };

  DK.register({ id: 'control', icon: '🎛️', label: 'Painel de Controle', desktop: true, open: DK.controlPanelApp });
})(window.DK = window.DK || {});
