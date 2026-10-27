(function (DK) {
  // Aparência: cor/degradê/imagem do fundo da Área de Trabalho e cores do menu Iniciar e da barra de tarefas. Fica nas preferências
  // do usuário (DK.prefs.look) no servidor, então acompanha a pessoa em qualquer aparelho. A imagem é uma referência a um arquivo
  // (nada de data URL: o limite das preferências é de 32 KB).
  const el = DK.el;
  const BG_PRESETS = [
    { n: 'Azul', c1: '#1f3a5f', c2: '#0d1b2e' }, { n: 'Oceano', c1: '#0e7490', c2: '#164e63' }, { n: 'Floresta', c1: '#14532d', c2: '#052e16' },
    { n: 'Pôr do sol', c1: '#f97316', c2: '#7c2d12' }, { n: 'Uva', c1: '#6d28d9', c2: '#2e1065' }, { n: 'Rosa', c1: '#be185d', c2: '#500724' },
    { n: 'Grafite', c1: '#374151', c2: '#111827' }, { n: 'Claro', c1: '#e2e8f0', c2: '#94a3b8' },
  ];
  const MENU_PRESETS = [
    { n: 'Escuro', bar: '#111a27', head: '#111a27', bg: '#ffffff', ink: '#1c2430' }, { n: 'Azul', bar: '#1e3a8a', head: '#1e3a8a', bg: '#f1f5ff', ink: '#1c2430' },
    { n: 'Verde', bar: '#14532d', head: '#14532d', bg: '#f0fdf4', ink: '#1c2430' }, { n: 'Roxo', bar: '#4c1d95', head: '#4c1d95', bg: '#faf5ff', ink: '#1c2430' },
    { n: 'Noturno', bar: '#020617', head: '#020617', bg: '#1e293b', ink: '#e2e8f0' }, { n: 'Claro', bar: '#e5e7eb', head: '#cbd5e1', bg: '#ffffff', ink: '#111827' },
  ];
  const DEF = { bg: { type: 'grad', c1: '#1f3a5f', c2: '#0d1b2e', angle: 160 }, menu: MENU_PRESETS[0] };
  const HEX = /^#[0-9a-f]{6}$/i;
  const hex = (v, d) => HEX.test(v || '') ? v : d;
  const lum = c => { const n = parseInt(c.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; };

  const look = () => {
    const l = DK.prefs.look || {};
    return { bg: Object.assign({}, DEF.bg, l.bg), menu: Object.assign({}, DEF.menu, l.menu) };
  };

  // aplica no documento (chamado ao entrar e a cada ajuste)
  DK.applyLook = function () {
    const L = look(), r = document.documentElement.style, b = L.bg, m = L.menu;
    const c1 = hex(b.c1, DEF.bg.c1), c2 = hex(b.c2, DEF.bg.c2);
    let css = c1;
    if (b.type === 'grad') css = 'linear-gradient(' + (+b.angle || 0) + 'deg,' + c1 + ',' + c2 + ')';
    if (b.type === 'img' && b.img && b.img.path) {
      const fit = b.fit === 'tile' ? 'repeat' : 'no-repeat', size = b.fit === 'tile' ? 'auto' : (b.fit === 'fit' ? 'contain' : 'cover');
      css = 'url("' + DK.fileUrl({ space: b.img.space === 'machine' ? 'machine' : 'home', path: b.img.path, sudo: false }, 'view') + '") center/' + size + ' ' + fit + ' ' + c1;
    }
    r.setProperty('--bg', css);
    const bar = hex(m.bar, DEF.menu.bar), head = hex(m.head, DEF.menu.head), mbg = hex(m.bg, DEF.menu.bg), ink = hex(m.ink, DEF.menu.ink);
    r.setProperty('--bar', bar); r.setProperty('--bar-ink', lum(bar) > .6 ? '#111827' : '#ffffff');
    r.setProperty('--menu-head', head); r.setProperty('--menu-head-ink', lum(head) > .6 ? '#111827' : '#ffffff');
    r.setProperty('--menu-bg', mbg); r.setProperty('--menu-ink', ink);
    r.setProperty('--menu-hover', lum(mbg) > .5 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.12)');
    r.setProperty('--menu-cat', lum(mbg) > .5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.07)');
    r.setProperty('--icon-ink', b.type === 'color' || b.type === 'grad' ? (lum(c1) > .65 && (b.type === 'color' || lum(c2) > .65) ? '#111827' : '#ffffff') : '#ffffff');
  };

  function save(patch) {
    const L = look();
    DK.prefs.look = { bg: Object.assign(L.bg, patch.bg), menu: Object.assign(L.menu, patch.menu) };
    DK.applyLook(); DK.savePrefs();
  }

  DK.lookApp = function (tab) {
    DK.openWindow('look', 'Personalizar', (body, win) => {
      let cur = tab || 'bg';
      const tabs = el('div', { className: 'row' }), box = el('div', { style: 'display:grid;gap:12px;margin-top:10px' });
      const color = (label, val, fn) => {
        const i = el('input', { type: 'color', value: hex(val, '#000000') }); i.oninput = () => fn(i.value);
        return el('label', { className: 'row', style: 'gap:8px' }, i, el('span', { textContent: label }));
      };
      const swatch = (title, css, on) => { const b = el('button', { title: title, onclick: on, style: 'width:76px;height:52px;border-radius:8px;border:2px solid var(--line);background:' + css + ';color:#fff;font-size:11px;text-shadow:0 1px 2px #000;display:flex;align-items:flex-end;justify-content:center;padding:3px' }, title); return b; };

      function drawBg() {
        const b = look().bg;
        const types = el('select', {}, ...[['color', 'Cor sólida'], ['grad', 'Degradê'], ['img', 'Imagem']].map(x => el('option', { value: x[0], textContent: x[1], selected: b.type === x[0] })));
        types.onchange = () => { save({ bg: { type: types.value } }); draw(); };
        box.append(el('div', { className: 'row' }, el('b', { textContent: 'Tipo de fundo' }), types));
        box.append(el('div', { className: 'sec', textContent: 'Modelos' }));
        const pre = el('div', { className: 'row' });
        BG_PRESETS.forEach(p => pre.append(swatch(p.n, 'linear-gradient(160deg,' + p.c1 + ',' + p.c2 + ')', () => { save({ bg: { type: 'grad', c1: p.c1, c2: p.c2, angle: 160 } }); draw(); })));
        box.append(pre);
        const cs = el('div', { className: 'row' }, color(b.type === 'grad' ? 'Cor inicial' : 'Cor', b.c1, v => save({ bg: { c1: v } })));
        if (b.type === 'grad') {
          cs.append(color('Cor final', b.c2, v => save({ bg: { c2: v } })));
          const ang = el('input', { type: 'range', min: 0, max: 360, value: +b.angle || 0 }); ang.oninput = () => save({ bg: { angle: +ang.value } });
          cs.append(el('label', { className: 'row' }, el('span', { textContent: 'Ângulo' }), ang));
        }
        if (b.type === 'img') cs.append(el('span', { className: 'meta', textContent: '(cor atrás da imagem)' }));
        box.append(cs);
        if (b.type === 'img') {
          const fit = el('select', {}, ...[['fill', 'Preencher'], ['fit', 'Ajustar'], ['tile', 'Lado a lado']].map(x => el('option', { value: x[0], textContent: x[1], selected: (b.fit || 'fill') === x[0] })));
          fit.onchange = () => save({ bg: { fit: fit.value } });
          const choose = el('button', { textContent: '🖼️ Escolher imagem…', onclick: () => DK.explorerApp({ pick: 'image', title: 'Escolha a imagem de fundo', onPick: it => { save({ bg: { type: 'img', img: { space: it.space === 'machine' ? 'machine' : 'home', path: it.path, name: it.name } } }); draw(); } }) });
          box.append(el('div', { className: 'row' }, choose, el('span', { textContent: b.img ? b.img.name || b.img.path : 'nenhuma escolhida' }), fit));
          box.append(el('div', { className: 'meta', textContent: 'A imagem fica onde está: se for movida ou apagada, volta a cor de fundo.' }));
        }
      }
      function drawMenu() {
        const m = look().menu;
        box.append(el('div', { className: 'sec', textContent: 'Modelos' }));
        const pre = el('div', { className: 'row' });
        MENU_PRESETS.forEach(p => pre.append(swatch(p.n, 'linear-gradient(90deg,' + p.bar + ' 50%,' + p.bg + ' 50%)', () => { save({ menu: { bar: p.bar, head: p.head, bg: p.bg, ink: p.ink } }); draw(); })));
        box.append(pre, el('div', { className: 'sec', textContent: 'Cores' }));
        box.append(color('Barra de tarefas', m.bar, v => save({ menu: { bar: v } })), color('Cabeçalho do menu Iniciar', m.head, v => save({ menu: { head: v } })),
          color('Fundo do menu Iniciar', m.bg, v => save({ menu: { bg: v } })), color('Texto do menu Iniciar', m.ink, v => save({ menu: { ink: v } })));
      }
      function draw() {
        tabs.replaceChildren(); box.replaceChildren();
        [['bg', '🖼️ Fundo da Área de Trabalho'], ['menu', '☰ Menu Iniciar e barra']].forEach(t => tabs.append(el('button', { textContent: t[1], className: cur === t[0] ? 'act' : '', onclick: () => { cur = t[0]; draw(); } })));
        (cur === 'bg' ? drawBg : drawMenu)();
        box.append(el('div', { className: 'row' }, el('button', { textContent: '↺ Restaurar o padrão', onclick: () => { delete DK.prefs.look; DK.applyLook(); DK.savePrefs(); draw(); } }),
          el('span', { className: 'meta', textContent: 'Vale só para a sua conta.' })));
      }
      body.append(tabs, box); draw();
    }, 520, 420);
  };
})(window.DK);
