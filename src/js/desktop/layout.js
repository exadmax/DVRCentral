(function (DK) {
  // Layout do Desktop: detecta celular e liga a interface adaptativa (classe "mob" no <html>; o CSS faz o resto). A pessoa pode forçar
  // o "Layout PC puro": a mesma tela do computador, numa viewport de 1280 px (com zoom por pinça). A escolha vale por aparelho (localStorage).
  // Carregado no <head> para a classe já estar no <html> antes da primeira pintura.
  const KEY = 'desk.layout', PC_WIDTH = 1280;
  const root = document.documentElement;
  const coarse = matchMedia('(pointer: coarse)');
  const listeners = [];
  let pc = false, mobile = false;
  try { pc = localStorage.getItem(KEY) === 'pc'; } catch (e) { /* armazenamento bloqueado: segue o automático */ }

  // Celular = tela estreita, ou aparelho de toque com o lado curto pequeno (celular deitado). Tablet fica com o layout de PC com alvos maiores.
  const detect = () => !pc && (innerWidth <= 760 || (coarse.matches && Math.min(innerWidth, innerHeight) <= 500));

  function apply() {
    const was = mobile;
    mobile = detect();
    root.classList.toggle('mob', mobile);
    root.classList.toggle('pcforce', pc);
    const v = document.querySelector('meta[name=viewport]');
    if (v) v.content = pc ? 'width=' + PC_WIDTH : 'width=device-width, initial-scale=1, viewport-fit=cover';
    if (was !== mobile) listeners.forEach(f => f());
  }

  DK.layout = {
    isMobile: () => mobile,
    isPc: () => pc,
    // O botão de alternar só faz sentido onde há o que alternar: no celular (ou já forçado) e em aparelhos de toque.
    canToggle: () => mobile || pc || coarse.matches,
    setPc: function (on) {
      pc = !!on;
      try { if (pc) localStorage.setItem(KEY, 'pc'); else localStorage.removeItem(KEY); } catch (e) { /* idem */ }
      apply();
      listeners.forEach(f => f());
    },
    toggle: () => DK.layout.setPc(!pc),
    label: () => (pc ? '📱 Voltar ao layout adaptativo' : '🖥️ Layout PC puro'),
    onChange: f => listeners.push(f),
  };
  apply();
  addEventListener('resize', apply);
  addEventListener('orientationchange', apply);

  // ---------- peças que só existem no celular: botão de janelas abertas e a folha com a lista ----------
  function build() {
    const $ = id => document.getElementById(id);
    const bar = $('bar');
    if (!bar) return;

    const n = document.createElement('b');
    const btn = document.createElement('button');
    btn.id = 'taskbtn'; btn.title = 'Janelas abertas';
    btn.append('▣ ', n);
    $('start').after(btn);

    const sheet = document.createElement('div');
    sheet.id = 'tasksheet'; sheet.className = 'hidden';
    document.body.append(sheet);

    function render() {
      const keys = Object.keys(DK.wins || {});
      n.textContent = keys.length;
      if (sheet.classList.contains('hidden')) return;
      sheet.replaceChildren();
      const head = document.createElement('header');
      const home = document.createElement('button');
      home.textContent = '🏠 Área de trabalho';
      home.onclick = () => { DK.minimizeAll(); sheet.classList.add('hidden'); };
      head.append('Janelas abertas', home);
      sheet.append(head);
      if (!keys.length) {
        const m = document.createElement('div');
        m.className = 'meta'; m.style.padding = '14px'; m.textContent = 'Nenhuma janela aberta.';
        sheet.append(m);
      }
      keys.forEach(k => {
        const w = DK.wins[k];
        const row = document.createElement('div');
        row.className = 'trow' + (w.classList.contains('min') ? ' mini' : '') + (w._task.classList.contains('act') ? ' act' : '');
        const go = document.createElement('button');
        go.textContent = w._task.textContent;
        go.onclick = () => {
          if (w.classList.contains('min') || !w._task.classList.contains('act')) w._task.click();   // restaura ou traz para a frente
          sheet.classList.add('hidden');
        };
        const x = document.createElement('button');
        x.textContent = '✕'; x.title = 'Fechar'; x.className = 'del';
        x.onclick = () => { DK.closeWin(w); render(); };
        row.append(go, x);
        sheet.append(row);
      });
    }

    btn.onclick = e => { e.stopPropagation(); sheet.classList.toggle('hidden'); render(); };
    new MutationObserver(render).observe($('tasks'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('pointerdown', e => { if (!sheet.contains(e.target) && !btn.contains(e.target)) sheet.classList.add('hidden'); });
    render();

    // Alternador na tela de login (que aparece antes de qualquer menu).
    const lay = $('layLogin');
    if (lay) {
      const draw = () => { lay.classList.toggle('hidden', !DK.layout.canToggle()); lay.textContent = DK.layout.label(); };
      lay.onclick = () => DK.layout.toggle();
      DK.layout.onChange(draw);
      draw();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})(window.DK = window.DK || {});
