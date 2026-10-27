(function (DK) {
  // LiteOffice Apresentações: editor de slides (.pptx e .odp) que roda todo no navegador.
  // Cada slide é um conjunto de formas (texto, retângulo, elipse, linha, seta, imagem) numa área em px; a conversão de/para os arquivos fica em slidefmt.js.
  const el = DK.el, S = DK.slidefmt;

  const FONT = 'Calibri, "Segoe UI", Arial, sans-serif';
  const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 54, 66, 80];
  const TEXTY = { text: 1, rect: 1, ellipse: 1 };
  const LAYOUTS = [['title', 'Título e conteúdo'], ['cover', 'Capa (título e subtítulo)'], ['only', 'Só o título'], ['blank', 'Em branco']];
  const HANDLES = [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]];

  function imageData(file) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onerror = () => reject(new Error('não foi possível ler a imagem'));
      rd.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('imagem inválida'));
        img.onload = () => {
          let src = rd.result, w = img.naturalWidth, h = img.naturalHeight;
          const big = Math.max(w, h) > 1920, other = !/^data:image\/(png|jpeg|gif);/.test(src);
          if (big || other) {
            const k = big ? 1920 / Math.max(w, h) : 1, cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); src = cv.toDataURL(/^data:image\/jpeg/.test(rd.result) ? 'image/jpeg' : 'image/png', 0.9); w = cv.width; h = cv.height;
          }
          resolve({ src: src, w: w, h: h });
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }

  // ---------- texto: modelo <-> DOM ----------
  const pxPt = px => Math.round(px * 0.75 * 2) / 2;
  function runSpan(r) {
    const s = el('span', { textContent: r.t });
    s.style.fontSize = (r.sz || 18) * 4 / 3 + 'px';
    if (r.b) s.style.fontWeight = '700'; if (r.i) s.style.fontStyle = 'italic';
    const td = (r.u ? 'underline ' : '') + (r.s ? 'line-through' : ''); if (td) s.style.textDecoration = td.trim();
    if (r.c) s.style.color = r.c; if (r.f) s.style.fontFamily = '"' + r.f.replace(/"/g, '') + '", ' + FONT;
    return s;
  }
  function textDom(paras) {
    const root = el('div', { className: 'stx' });
    (paras || []).forEach(p => {
      const e = el('p'); e.style.textAlign = p.al || 'left'; if (p.bul) e.className = 'bul';
      const last = p.runs[p.runs.length - 1];
      p.runs.forEach(r => String(r.t).split('\n').forEach((t, i) => { if (i) e.append(el('br')); if (t) e.append(runSpan(Object.assign({}, r, { t: t }))); }));
      if (!p.runs.length || !p.runs.some(r => r.t !== '')) {
        e.style.minHeight = (last && last.sz ? last.sz * 4 / 3 : 24) * 1.2 + 'px'; e.append(el('br'));
        if (last) { if (last.sz) e.style.fontSize = last.sz * 4 / 3 + 'px'; if (last.c) e.style.color = last.c; if (last.b) e.style.fontWeight = '700'; if (last.i) e.style.fontStyle = 'italic'; if (last.f) e.style.fontFamily = '"' + last.f.replace(/"/g, '') + '", ' + FONT; }
      }
      root.append(e);
    });
    return root;
  }
  function readText(root) {
    const paras = [];
    const style = (n, st) => {
      const o = Object.assign({}, st), s = n.style || {}, tag = n.tagName;
      if (tag === 'B' || tag === 'STRONG' || s.fontWeight === 'bold' || +s.fontWeight >= 600) o.b = true;
      if (tag === 'I' || tag === 'EM' || s.fontStyle === 'italic') o.i = true;
      const td = s.textDecorationLine || s.textDecoration || '';
      if (tag === 'U' || td.indexOf('underline') >= 0) o.u = true;
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || td.indexOf('line-through') >= 0) o.s = true;
      if (s.color) o.c = rgbHex(s.color); if (tag === 'FONT' && n.getAttribute('color')) o.c = rgbHex(n.getAttribute('color'));
      if (s.fontFamily) o.f = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      const px = /^([\d.]+)px$/.exec(s.fontSize || ''); if (px) o.sz = pxPt(+px[1]);
      return o;
    };
    const collect = (n, st, runs) => {
      [].forEach.call(n.childNodes, c => {
        if (c.nodeType === 3) { if (c.nodeValue) runs.push(Object.assign({ t: c.nodeValue }, st)); }
        else if (c.nodeType === 1) { if (c.tagName === 'BR') { if (runs.length || c.nextSibling) runs.push(Object.assign({ t: '\n' }, st)); } else collect(c, style(c, st), runs); }
      });
    };
    const blocks = [].filter.call(root.childNodes, c => c.nodeType === 1 && /^(P|DIV)$/.test(c.tagName));
    const loose = [].filter.call(root.childNodes, c => !(c.nodeType === 1 && /^(P|DIV)$/.test(c.tagName)));
    const addBlock = e => {
      const runs = [], st0 = style(e, {}); collect(e, st0, runs);
      if (!runs.length && (st0.sz || st0.c)) runs.push(Object.assign({ t: '' }, st0));
      while (runs.length && runs[runs.length - 1].t === '\n') runs.pop();
      const al = e.style && e.style.textAlign; paras.push({ al: al === 'center' || al === 'right' || al === 'justify' ? al : 'left', bul: e.classList.contains('bul'), runs: runs });
    };
    if (!blocks.length || loose.some(c => c.nodeType === 3 && c.nodeValue.trim())) { const wrap = el('div'); [].slice.call(root.childNodes).forEach(c => wrap.append(c.cloneNode(true))); addBlock(wrap); }
    else blocks.forEach(addBlock);
    return paras;
  }
  function rgbHex(v) {
    v = String(v || '').trim();
    let m = /^#([0-9a-f]{6})$/i.exec(v); if (m) return '#' + m[1].toLowerCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v); if (m) return ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase();
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    return m ? '#' + [m[1], m[2], m[3]].map(x => ('0' + (+x).toString(16)).slice(-2)).join('') : '';
  }

  // ---------- desenho de uma forma e de um slide ----------
  function shapeEl(deck, sh, i) {
    const d = el('div', { className: 'sh sh-' + sh.t });
    d.dataset.i = i;
    d.style.cssText = 'left:' + sh.x + 'px;top:' + sh.y + 'px;width:' + Math.max(1, sh.w) + 'px;height:' + Math.max(1, sh.h) + 'px;' + (sh.rot ? 'transform:rotate(' + sh.rot + 'deg);' : '');
    if (sh.t === 'image') { const im = el('img', { src: deck.media[sh.img] || '', draggable: false }); d.append(im); return d; }
    if (sh.t === 'line' || sh.t === 'arrow') {
      const w = Math.max(1, sh.w), h = Math.max(1, sh.h), x1 = 0, y1 = sh.flipV ? h : 0, x2 = w, y2 = sh.flipV ? 0 : h, lw = sh.lw || 2;
      let head = '';
      if (sh.t === 'arrow') {
        const a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(10, lw * 4), sp = Math.PI / 7;
        head = '<polygon fill="' + sh.line + '" points="' + [x2, y2, x2 - L * Math.cos(a - sp), y2 - L * Math.sin(a - sp), x2 - L * Math.cos(a + sp), y2 - L * Math.sin(a + sp)].join(',') + '"/>';
      }
      d.innerHTML = '<svg width="' + w + '" height="' + h + '" style="overflow:visible"><line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + (sh.line || '#333') + '" stroke-width="' + lw + '" stroke-linecap="round"/>' + head + '</svg>';
      return d;
    }
    if (sh.fill) d.style.background = sh.fill;
    if (sh.line) d.style.border = (sh.lw || 1) + 'px solid ' + sh.line;
    if (sh.t === 'ellipse') d.style.borderRadius = '50%';
    d.style.justifyContent = sh.anchor === 'm' ? 'center' : sh.anchor === 'b' ? 'flex-end' : 'flex-start';
    d.append(textDom(sh.text));
    return d;
  }
  function renderSlide(deck, slide) {
    const sl = el('div', { className: 'sl' });
    sl.style.width = deck.w + 'px'; sl.style.height = deck.h + 'px'; sl.style.background = slide.bg || '#ffffff';
    slide.shapes.forEach((sh, i) => sl.append(shapeEl(deck, sh, i)));
    return sl;
  }

  function layoutSlide(deck, kind) {
    const W = deck.w, H = deck.h, s = { bg: '#ffffff', notes: '', shapes: [] };
    const title = (o) => S.newShape('text', Object.assign({ text: [S.para('Clique para editar o título', { al: 'left', run: { sz: 44, b: true } })] }, o));
    if (kind === 'title') {
      s.shapes.push(title({ x: Math.round(W * .06), y: Math.round(H * .06), w: Math.round(W * .88), h: Math.round(H * .17), anchor: 'm' }));
      s.shapes.push(S.newShape('text', { x: Math.round(W * .06), y: Math.round(H * .27), w: Math.round(W * .88), h: Math.round(H * .62), text: [S.para('Primeiro ponto', { bul: true, run: { sz: 28 } }), S.para('Segundo ponto', { bul: true, run: { sz: 28 } })] }));
    } else if (kind === 'cover') {
      s.shapes.push(title({ x: Math.round(W * .1), y: Math.round(H * .28), w: Math.round(W * .8), h: Math.round(H * .22), anchor: 'b', text: [S.para('Título da apresentação', { al: 'center', run: { sz: 54, b: true } })] }));
      s.shapes.push(S.newShape('text', { x: Math.round(W * .1), y: Math.round(H * .54), w: Math.round(W * .8), h: Math.round(H * .15), text: [S.para('Subtítulo ou autor', { al: 'center', run: { sz: 28, c: '#595959' } })] }));
    } else if (kind === 'only') s.shapes.push(title({ x: Math.round(W * .06), y: Math.round(H * .06), w: Math.round(W * .88), h: Math.round(H * .17), anchor: 'm' }));
    return s;
  }

  // o: { item: { space, path, sudo, name } } abre um arquivo; { dir: { space, path, sudo } } cria uma apresentação nova, salva nessa pasta.
  DK.slideApp = function (o) {
    o = o || {};
    let item = o.item || null;
    const winKey = item ? 'slide:' + item.space + ':' + item.path : 'slide:new:' + DK.nextDocId();
    DK.openWindow(winKey, 'LiteOffice Apresentações — ' + (item ? item.name : 'Apresentação sem título'), (body, win) => {
      body.className = 'body flush';
      let deck = S.newDeck(), cur = 0, sel = -1, dirty = false, dir = o.dir || null, lossy = [], lossyOk = false, saving = false, dead = false;
      let undoSt = [], redoSt = [], editing = -1, drag = null, clipShape = null, clipText = '', k = 1, paintQ = false, thumbQ = false;
      deck.slides.push(layoutSlide(deck, 'cover'));
      const slide = () => deck.slides[cur];
      const snap = () => JSON.stringify({ w: deck.w, h: deck.h, slides: deck.slides });
      const restore = j => { const o2 = JSON.parse(j); deck.w = o2.w; deck.h = o2.h; deck.slides = o2.slides; cur = Math.min(cur, deck.slides.length - 1); sel = -1; editing = -1; };

      // ---------- barras ----------
      const bOpen = el('button', { textContent: '📂 Abrir…' }), bSave = el('button', { className: 'pri', textContent: '💾 Salvar' }), bAs = el('button', { textContent: 'Salvar como…' }), bPlay = el('button', { textContent: '▶ Apresentar', title: 'Apresentar em tela cheia (Esc sai)' });
      const fmtLbl = el('span', { className: 'meta' });
      const tb = el('div', { className: 'tb' }, bOpen, bSave, bAs, bPlay, el('span', { className: 'sp' }), fmtLbl);
      const bar = el('div', { className: 'dtool' });
      const warn = el('div', { className: 'dwarn hidden' });
      const thumbs = el('div', { className: 'sthumbs' });
      const view = el('div', { className: 'sview' });
      const notes = el('textarea', { className: 'snotes', placeholder: 'Notas do apresentador (ficam no arquivo .odp)', rows: 2 });
      const pane = el('div', { className: 'spane' }, view, notes);
      const main = el('div', { className: 'sbody', tabIndex: 0 }, thumbs, pane);
      const status = el('div', { className: 'status' });
      body.append(tb, bar, warn, main, status);

      const btn = (label, title, fn, id) => { const b = el('button', { textContent: label, title: title }); b.onmousedown = e => e.preventDefault(); b.onclick = fn; if (id) b.dataset.cmd = id; bar.append(b); return b; };
      const sep = () => bar.append(el('span', { className: 'sep' }));
      const select = (opts, title, fn, w) => { const s = el('select', { title: title }, ...opts.map(x => el('option', { value: x[0], textContent: x[1] }))); s.style.width = w; s.onchange = () => { fn(s.value); }; bar.append(s); return s; };
      const colorIn = (title, label, fn, init) => { const w = el('label', { className: 'scolor', title: title }, label), i = el('input', { type: 'color', value: init }); i.oninput = () => fn(i.value); w.append(i); bar.append(w); return w; };

      btn('↶', 'Desfazer (Ctrl+Z)', () => doUndo()); btn('↷', 'Refazer (Ctrl+Y)', () => doRedo()); sep();
      const newSel = select([['', '＋ Novo slide']].concat(LAYOUTS), 'Novo slide', v => { if (v) addSlide(v); newSel.value = ''; }, '128px');
      btn('⧉', 'Duplicar slide', () => dupSlide()); btn('✕', 'Excluir slide', () => delSlide()); btn('▲', 'Mover slide para cima', () => moveSlide(-1)); btn('▼', 'Mover slide para baixo', () => moveSlide(1)); sep();
      btn('T', 'Caixa de texto', () => addShape('text')); btn('▭', 'Retângulo', () => addShape('rect')); btn('◯', 'Elipse', () => addShape('ellipse')); btn('╱', 'Linha', () => addShape('line')); btn('➜', 'Seta', () => addShape('arrow'));
      const pic = el('input', { type: 'file', accept: 'image/*' }); pic.style.display = 'none'; body.append(pic);
      btn('🖼️', 'Inserir imagem', () => pic.click()); sep();
      btn('B', 'Negrito (Ctrl+B)', () => fmt('b'), 'b').style.fontWeight = '700'; btn('I', 'Itálico (Ctrl+I)', () => fmt('i'), 'i').style.fontStyle = 'italic';
      btn('U', 'Sublinhado (Ctrl+U)', () => fmt('u'), 'u').style.textDecoration = 'underline'; btn('S', 'Tachado', () => fmt('s'), 's').style.textDecoration = 'line-through';
      const sizeSel = select([['', 'Tam.']].concat(SIZES.map(v => [v, v + ' pt'])), 'Tamanho da letra', v => { if (v) setSize(+v); sizeSel.value = ''; }, '72px');
      colorIn('Cor do texto', 'A', v => setColor('c', v), '#000000').style.fontWeight = '700'; sep();
      btn('⇤', 'Alinhar à esquerda', () => align('left'), 'al-left'); btn('↔', 'Centralizar', () => align('center'), 'al-center'); btn('⇥', 'Alinhar à direita', () => align('right'), 'al-right');
      btn('•', 'Lista com marcadores', () => bullets(), 'bul');
      select([['', 'Alinhar vertical'], ['t', 'No topo'], ['m', 'No meio'], ['b', 'Embaixo']], 'Posição vertical do texto na forma', v => { if (v) setProp({ anchor: v }); }, '120px'); sep();
      colorIn('Cor de preenchimento', '▩', v => setProp({ fill: v }), '#4472c4'); btn('∅', 'Sem preenchimento', () => setProp({ fill: '' }));
      colorIn('Cor do contorno / da linha', '▢', v => setProp({ line: v }), '#1f3864'); btn('∅', 'Sem contorno', () => setProp({ line: '' }));
      select([['', 'Espessura'], ['1', '1 px'], ['2', '2 px'], ['4', '4 px'], ['6', '6 px'], ['10', '10 px']], 'Espessura do contorno', v => { if (v) setProp({ lw: +v }); }, '88px'); sep();
      btn('⬆', 'Trazer para frente', () => zorder(1)); btn('⬇', 'Enviar para trás', () => zorder(-1)); btn('🗑', 'Excluir forma (Delete)', () => delShape()); sep();
      colorIn('Cor de fundo do slide', 'Fundo', v => act(() => { slide().bg = v; }), '#ffffff');

      // ---------- desfazer e atualização ----------
      function act(fn) {
        if (editing >= 0) endEdit();
        const before = snap(); fn();
        if (snap() !== before) { undoSt.push(before); if (undoSt.length > 100) undoSt.shift(); redoSt = []; dirty = true; }
        refresh();
      }
      function doUndo() { if (editing >= 0) return; const j = undoSt.pop(); if (!j) return; redoSt.push(snap()); restore(j); dirty = true; refresh(); }
      function doRedo() { if (editing >= 0) return; const j = redoSt.pop(); if (!j) return; undoSt.push(snap()); restore(j); dirty = true; refresh(); }
      function refresh() { paint(); thumbsPaint(); updateUi(); }

      // ---------- palco ----------
      let sl = null, ov = null, box = null;
      function scaleFit() { const w = view.clientWidth - 40, h = view.clientHeight - 40; return Math.max(0.1, Math.min(w / deck.w, h / deck.h)); }
      function paint() {
        paintQ = false;
        if (dead) return;
        view.replaceChildren();
        k = scaleFit();
        box = el('div', { className: 'sbox' }); box.style.width = deck.w * k + 'px'; box.style.height = deck.h * k + 'px';
        sl = renderSlide(deck, slide()); sl.style.transform = 'scale(' + k + ')'; sl.style.transformOrigin = '0 0';
        ov = el('div', { className: 'sov' });
        box.append(sl, ov); view.append(box);
        if (sel >= slide().shapes.length) sel = -1;
        drawFrame();
        if (document.activeElement !== notes) notes.value = slide().notes || '';
      }
      const schedule = () => { if (!paintQ) { paintQ = true; requestAnimationFrame(paint); } };
      function drawFrame() {
        [].forEach.call(ov.querySelectorAll('.sfr'), n => n.remove());
        if (sel < 0 || !slide().shapes[sel] || editing >= 0) return;
        const sh = slide().shapes[sel], f = el('div', { className: 'sfr' });
        f.style.cssText = 'left:' + sh.x * k + 'px;top:' + sh.y * k + 'px;width:' + sh.w * k + 'px;height:' + sh.h * k + 'px;' + (sh.rot ? 'transform:rotate(' + sh.rot + 'deg);' : '');
        HANDLES.forEach(h => { const e = el('div', { className: 'sh-h h-' + h[0] }); e.dataset.h = h[0]; e.style.left = h[1] * 100 + '%'; e.style.top = h[2] * 100 + '%'; f.append(e); });
        ov.append(f);
      }
      function thumbsPaint() {
        if (thumbQ) return;
        thumbQ = true;
        requestAnimationFrame(() => {
          thumbQ = false;
          if (dead) return;
          thumbs.replaceChildren();
          const tw = 140, ks = tw / deck.w;
          deck.slides.forEach((s, i) => {
            const t = el('div', { className: 'sthumb' + (i === cur ? ' on' : '') }), inner = renderSlide(deck, s), wrap = el('div', { className: 'sthw' });
            wrap.style.width = tw + 'px'; wrap.style.height = deck.h * ks + 'px'; inner.style.transform = 'scale(' + ks + ')'; inner.style.transformOrigin = '0 0';
            wrap.append(inner); t.append(el('span', { className: 'sn', textContent: i + 1 }), wrap);
            t.onclick = () => { if (editing >= 0) endEdit(); cur = i; sel = -1; refresh(); };
            thumbs.append(t);
          });
        });
      }
      function updateUi() {
        status.textContent = 'Slide ' + (cur + 1) + ' de ' + deck.slides.length + (dirty ? ' · modificada' : ' · salva') + (item && item.space === 'machine' ? ' · arquivo do computador' + (item.sudo ? ' (sudo)' : '') : '');
        win.setTitle((dirty ? '● ' : '') + 'LiteOffice Apresentações — ' + (item ? item.name : 'Apresentação sem título'));
        fmtLbl.textContent = (item ? (DK.extOf(item.name) === '.odp' ? 'OpenDocument (.odp)' : 'PowerPoint (.pptx)') : 'nova apresentação');
        const sh = sel >= 0 ? slide().shapes[sel] : null, runs = sh && sh.text ? [].concat.apply([], sh.text.map(p => p.runs)) : [];
        [].forEach.call(bar.querySelectorAll('button[data-cmd]'), b => {
          const c = b.dataset.cmd; let on = false;
          if (c === 'b' || c === 'i' || c === 'u' || c === 's') on = runs.length > 0 && runs.every(r => r[c]);
          else if (c.indexOf('al-') === 0) on = !!(sh && sh.text && sh.text.length && sh.text.every(p => p.al === c.slice(3)));
          else if (c === 'bul') on = !!(sh && sh.text && sh.text.length && sh.text.every(p => p.bul));
          b.classList.toggle('on', on);
        });
      }

      // ---------- slides ----------
      function addSlide(kind) { act(() => { deck.slides.splice(cur + 1, 0, layoutSlide(deck, kind)); cur++; sel = -1; }); }
      function dupSlide() { act(() => { deck.slides.splice(cur + 1, 0, JSON.parse(JSON.stringify(slide()))); cur++; sel = -1; }); }
      function delSlide() {
        if (deck.slides.length < 2) { DK.toast('A apresentação precisa ter ao menos um slide.'); return; }
        act(() => { deck.slides.splice(cur, 1); cur = Math.min(cur, deck.slides.length - 1); sel = -1; });
      }
      function moveSlide(d) { const j = cur + d; if (j < 0 || j >= deck.slides.length) return; act(() => { const s = deck.slides.splice(cur, 1)[0]; deck.slides.splice(j, 0, s); cur = j; }); }

      // ---------- formas ----------
      function addShape(t) {
        const W = deck.w, H = deck.h;
        const base = { text: { w: 420, h: 90, text: [S.para('Texto', { run: { sz: 28 } })] }, rect: { w: 300, h: 180, fill: '#4472c4', line: '#1f3864', lw: 2, anchor: 'm', text: [S.para('', { al: 'center', run: { sz: 24, c: '#ffffff' } })] },
          ellipse: { w: 240, h: 180, fill: '#70ad47', line: '#375623', lw: 2, anchor: 'm', text: [S.para('', { al: 'center', run: { sz: 24, c: '#ffffff' } })] }, line: { w: 320, h: 0, line: '#333333', lw: 3 }, arrow: { w: 320, h: 0, line: '#333333', lw: 3 } }[t];
        const sh = S.newShape(t, Object.assign({ x: Math.round((W - base.w) / 2), y: Math.round((H - base.h) / 2) }, base));
        if (sh.text && sh.text[0].runs[0].t === '') sh.text[0].runs = [];
        act(() => { slide().shapes.push(sh); sel = slide().shapes.length - 1; });
        if (t === 'text') startEdit(sel);
      }
      pic.onchange = async () => {
        const f = pic.files[0]; pic.value = '';
        if (!f) return;
        try { await addImage(f); } catch (e) { DK.toast(e.message); }
      };
      async function addImage(f) {
        const im = await imageData(f);
        const k2 = Math.min(1, deck.w * .6 / im.w, deck.h * .6 / im.h), w = Math.round(im.w * k2), h = Math.round(im.h * k2), id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        deck.media[id] = im.src;
        act(() => { slide().shapes.push(S.newShape('image', { x: Math.round((deck.w - w) / 2), y: Math.round((deck.h - h) / 2), w: w, h: h, img: id })); sel = slide().shapes.length - 1; });
      }
      function delShape() { if (sel < 0) return; act(() => { slide().shapes.splice(sel, 1); sel = -1; }); }
      function zorder(d) { if (sel < 0) return; const j = sel + d, a = slide().shapes; if (j < 0 || j >= a.length) return; act(() => { const s = a.splice(sel, 1)[0]; a.splice(j, 0, s); sel = j; }); }
      function setProp(p) { if (sel < 0) return; act(() => { Object.assign(slide().shapes[sel], p); }); }

      // formatação do texto: com o cursor dentro de uma caixa em edição vale só para a seleção; fora disso, vale para o texto todo da forma
      const inEdit = () => editing >= 0 && sl && sl.querySelector('.stx[contenteditable="true"]');
      function fmt(c) {
        if (inEdit()) { document.execCommand({ b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough' }[c], false); return; }
        const sh = sel >= 0 && slide().shapes[sel]; if (!sh || !sh.text) return;
        act(() => { const runs = [].concat.apply([], sh.text.map(p => p.runs)), on = !runs.every(r => r[c]); runs.forEach(r => { if (on) r[c] = true; else delete r[c]; }); });
      }
      function setColor(key, v) {
        if (inEdit() && key === 'c') { document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, v); return; }
        const sh = sel >= 0 && slide().shapes[sel]; if (!sh || !sh.text) return;
        act(() => { sh.text.forEach(p => p.runs.forEach(r => { r[key] = v; })); });
      }
      function setSize(pt) {
        if (inEdit()) {
          document.execCommand('styleWithCSS', false, false); document.execCommand('fontSize', false, 7);
          [].slice.call(sl.querySelectorAll('font[size="7"]')).forEach(f => { const sp = el('span'); sp.style.fontSize = pt * 4 / 3 + 'px'; while (f.firstChild) sp.append(f.firstChild); f.replaceWith(sp); });
          return;
        }
        const sh = sel >= 0 && slide().shapes[sel]; if (!sh || !sh.text) return;
        act(() => { sh.text.forEach(p => p.runs.forEach(r => { r.sz = pt; })); });
      }
      function align(a) { const sh = sel >= 0 && slide().shapes[sel]; if (!sh || !sh.text) return; const keep = inEdit() ? readText(inEdit()) : null; if (keep) sh.text = keep; act(() => { sh.text.forEach(p => { p.al = a; }); }); }
      function bullets() { const sh = sel >= 0 && slide().shapes[sel]; if (!sh || !sh.text) return; const keep = inEdit() ? readText(inEdit()) : null; if (keep) sh.text = keep; act(() => { const on = !sh.text.every(p => p.bul); sh.text.forEach(p => { p.bul = on; }); }); }

      // ---------- edição de texto ----------
      function startEdit(i, keepFocus) {
        const sh = slide().shapes[i];
        if (!sh || !TEXTY[sh.t]) return;
        if (!sh.text) sh.text = [S.para('', { run: { sz: 24 } })].map(p => { p.runs = []; return p; });
        editing = i; sel = i;
        const node = sl && sl.querySelector('.sh[data-i="' + i + '"] .stx');
        if (!node) return;
        node.contentEditable = 'true'; node.spellcheck = true; node.lang = 'pt-BR';
        ov.style.pointerEvents = 'none';
        drawFrame();
        if (!keepFocus || document.activeElement !== node) {
          node.focus();
          const r = document.createRange(); r.selectNodeContents(node); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        }
        try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* padrão do navegador */ }
        node.onblur = () => { setTimeout(() => { if (editing === i && document.activeElement !== node && !bar.contains(document.activeElement)) endEdit(); }, 0); };
        node.onkeydown = e => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); endEdit(); main.focus(); }
          else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); endEdit(); doSave(false); }
        };
        node.onpaste = e => {
          e.preventDefault();
          const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
          document.execCommand('insertText', false, t);
        };
        node.oninput = () => { dirty = true; updateUi(); };
      }
      function endEdit() {
        if (editing < 0) return;
        const i = editing, node = sl && sl.querySelector('.sh[data-i="' + i + '"] .stx'), sh = slide().shapes[i];
        editing = -1;
        if (node && sh) {
          const before = snap();
          const paras = readText(node);
          sh.text = paras.length ? paras : sh.text;
          if (!sh.text.some(p => p.runs.some(r => r.t))) { if (sh.t === 'text') { slide().shapes.splice(i, 1); sel = -1; } else sh.text = null; }
          if (snap() !== before) { undoSt.push(before); if (undoSt.length > 100) undoSt.shift(); redoSt = []; dirty = true; }
        }
        ov.style.pointerEvents = '';
        refresh();
      }

      // ---------- mouse ----------
      const hitShape = (x, y) => {
        const a = slide().shapes;
        for (let i = a.length - 1; i >= 0; i--) {
          const s = a[i], pad = (s.t === 'line' || s.t === 'arrow') ? Math.max(8, (s.lw || 2)) : 0;
          if (x >= s.x - pad && x <= s.x + s.w + pad && y >= s.y - pad && y <= s.y + s.h + pad) {
            if (s.t === 'line' || s.t === 'arrow') {
              const x1 = s.x, y1 = s.flipV ? s.y + s.h : s.y, x2 = s.x + s.w, y2 = s.flipV ? s.y : s.y + s.h, dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
              const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2)), px = x1 + t * dx, py = y1 + t * dy;
              if (Math.hypot(x - px, y - py) > Math.max(8, (s.lw || 2) + 4)) continue;
            }
            return i;
          }
        }
        return -1;
      };
      const pt = e => { const b = box.getBoundingClientRect(); return { x: (e.clientX - b.left) / k, y: (e.clientY - b.top) / k }; };
      view.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        if (!box || !box.contains(e.target) && e.target !== view) return;
        if (editing >= 0 && sl.contains(e.target) && e.target.closest('.stx[contenteditable="true"]')) return;
        const p = pt(e);
        if (editing >= 0) endEdit();
        main.focus();
        const hEl = e.target.closest && e.target.closest('.sh-h');
        if (hEl && sel >= 0) { e.preventDefault(); const sh = slide().shapes[sel]; drag = { t: 'resize', h: hEl.dataset.h, x0: p.x, y0: p.y, o: { x: sh.x, y: sh.y, w: sh.w, h: sh.h }, before: snap(), moved: false }; view.setPointerCapture(e.pointerId); return; }
        const i = hitShape(p.x, p.y);
        sel = i;
        if (i >= 0) { e.preventDefault(); const sh = slide().shapes[i]; drag = { t: 'move', x0: p.x, y0: p.y, o: { x: sh.x, y: sh.y }, before: snap(), moved: false }; view.setPointerCapture(e.pointerId); }
        drawFrame(); updateUi();
      });
      view.addEventListener('pointermove', e => {
        if (!drag || !box) return;
        const p = pt(e), sh = slide().shapes[sel]; if (!sh) return;
        const dx = p.x - drag.x0, dy = p.y - drag.y0;
        if (!drag.moved && Math.hypot(dx, dy) * k < 3) return;
        drag.moved = true;
        if (drag.t === 'move') { sh.x = Math.round(drag.o.x + dx); sh.y = Math.round(drag.o.y + dy); }
        else {
          let { x, y, w, h } = drag.o; const hd = drag.h;
          if (hd.indexOf('e') >= 0) w = Math.max(4, w + dx); if (hd.indexOf('s') >= 0) h = Math.max(sh.t === 'line' || sh.t === 'arrow' ? 0 : 4, h + dy);
          if (hd.indexOf('w') >= 0) { const nw = Math.max(4, w - dx); x += w - nw; w = nw; } if (hd.indexOf('n') >= 0) { const nh = Math.max(4, h - dy); y += h - nh; h = nh; }
          if (e.shiftKey && sh.t === 'image' && drag.o.h) { h = Math.round(w * drag.o.h / drag.o.w); }
          sh.x = Math.round(x); sh.y = Math.round(y); sh.w = Math.round(w); sh.h = Math.round(h);
        }
        schedule();
      });
      const endDrag = () => {
        const d = drag; drag = null;
        if (!d) return;
        if (d.moved) { undoSt.push(d.before); if (undoSt.length > 100) undoSt.shift(); redoSt = []; dirty = true; refresh(); }
      };
      view.addEventListener('pointerup', endDrag); view.addEventListener('pointercancel', endDrag);
      view.addEventListener('dblclick', e => {
        if (!box) return;
        const p = pt(e), i = hitShape(p.x, p.y);
        if (i >= 0 && TEXTY[slide().shapes[i].t]) { sel = i; startEdit(i); }
      });
      notes.addEventListener('input', () => { slide().notes = notes.value; dirty = true; updateUi(); });

      // ---------- teclado e área de transferência ----------
      main.addEventListener('keydown', e => {
        if (editing >= 0) return;
        if (e.target === notes) return;
        const ctrl = e.ctrlKey || e.metaKey, key = e.key;
        if (ctrl) {
          const l = key.toLowerCase();
          if (l === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
          else if (l === 'y') { e.preventDefault(); doRedo(); }
          else if (l === 's') { e.preventDefault(); doSave(false); }
          else if (l === 'd') { e.preventDefault(); if (sel >= 0) dupShape(); }
          else if (l === 'b') { e.preventDefault(); fmt('b'); } else if (l === 'i') { e.preventDefault(); fmt('i'); } else if (l === 'u') { e.preventDefault(); fmt('u'); }
          return;
        }
        const sh = sel >= 0 && slide().shapes[sel];
        if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); if (sh) delShape(); else delSlide(); }
        else if (sh && (key === 'Enter' || key === 'F2')) { e.preventDefault(); if (TEXTY[sh.t]) startEdit(sel); }
        else if (sh && /^Arrow/.test(key)) { e.preventDefault(); const st = e.shiftKey ? 10 : 1; act(() => { if (key === 'ArrowLeft') sh.x -= st; else if (key === 'ArrowRight') sh.x += st; else if (key === 'ArrowUp') sh.y -= st; else sh.y += st; }); }
        else if (key === 'Escape') { sel = -1; drawFrame(); updateUi(); }
        else if (key === 'PageDown' || (!sh && (key === 'ArrowDown' || key === 'ArrowRight'))) { e.preventDefault(); if (cur < deck.slides.length - 1) { cur++; sel = -1; refresh(); } }
        else if (key === 'PageUp' || (!sh && (key === 'ArrowUp' || key === 'ArrowLeft'))) { e.preventDefault(); if (cur > 0) { cur--; sel = -1; refresh(); } }
        else if (key === 'F5') { e.preventDefault(); present(); }
        else if (!sh && key.length === 1 && !e.altKey) { /* ignora */ }
      });
      function dupShape() { act(() => { const c = JSON.parse(JSON.stringify(slide().shapes[sel])); c.x += 24; c.y += 24; slide().shapes.push(c); sel = slide().shapes.length - 1; }); }
      main.addEventListener('copy', e => {
        if (editing >= 0 || e.target === notes || sel < 0) return;
        e.preventDefault(); const sh = slide().shapes[sel];
        clipShape = JSON.parse(JSON.stringify(sh)); clipText = S.plain(sh) || '​';
        e.clipboardData.setData('text/plain', clipText);
      });
      main.addEventListener('cut', e => { if (editing >= 0 || e.target === notes || sel < 0) return; e.preventDefault(); const sh = slide().shapes[sel]; clipShape = JSON.parse(JSON.stringify(sh)); clipText = S.plain(sh) || '​'; e.clipboardData.setData('text/plain', clipText); delShape(); });
      main.addEventListener('paste', async e => {
        if (editing >= 0 || e.target === notes) return;
        e.preventDefault();
        const cd = e.clipboardData; if (!cd) return;
        const img = [].slice.call(cd.files).filter(f => /^image\//.test(f.type))[0], text = cd.getData('text/plain');
        if (img) { try { await addImage(img); } catch (x) { DK.toast(x.message); } return; }
        if (clipShape && text === clipText) { act(() => { const c = JSON.parse(JSON.stringify(clipShape)); c.x += 24; c.y += 24; slide().shapes.push(c); sel = slide().shapes.length - 1; clipShape.x += 24; clipShape.y += 24; }); return; }
        if (text.trim()) act(() => { slide().shapes.push(S.newShape('text', { x: 100, y: 100, w: Math.round(deck.w * .6), h: 120, text: text.split('\n').map(t => S.para(t, { run: { sz: 24 } })) })); sel = slide().shapes.length - 1; });
      });

      // ---------- apresentação em tela cheia ----------
      function present() {
        if (editing >= 0) endEdit();
        let i = cur;
        const layer = el('div', { className: 'splay', tabIndex: 0 }), host = el('div', { className: 'splay-in' });
        layer.append(host); document.body.append(layer);
        const draw = () => {
          host.replaceChildren();
          const W = layer.clientWidth, H = layer.clientHeight, ks = Math.min(W / deck.w, H / deck.h), s = renderSlide(deck, deck.slides[i]);
          s.style.transform = 'scale(' + ks + ')'; s.style.transformOrigin = '0 0';
          host.style.width = deck.w * ks + 'px'; host.style.height = deck.h * ks + 'px'; host.append(s);
        };
        const close = () => { window.removeEventListener('resize', draw); document.removeEventListener('fullscreenchange', fs); layer.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => 0); cur = i; sel = -1; refresh(); main.focus(); };
        const fs = () => { if (!document.fullscreenElement && document.body.contains(layer)) close(); };
        const go = d => { const j = i + d; if (j >= 0 && j < deck.slides.length) { i = j; draw(); } else if (d > 0) close(); };
        layer.addEventListener('keydown', e => {
          e.stopPropagation();
          if (e.key === 'Escape') close(); else if (/^(ArrowRight|ArrowDown|PageDown| |Enter)$/.test(e.key)) { e.preventDefault(); go(1); } else if (/^(ArrowLeft|ArrowUp|PageUp|Backspace)$/.test(e.key)) { e.preventDefault(); go(-1); }
          else if (e.key === 'Home') { i = 0; draw(); } else if (e.key === 'End') { i = deck.slides.length - 1; draw(); }
        });
        layer.addEventListener('click', () => go(1));
        layer.addEventListener('contextmenu', e => { e.preventDefault(); go(-1); });
        window.addEventListener('resize', draw);
        if (layer.requestFullscreen) layer.requestFullscreen().then(() => document.addEventListener('fullscreenchange', fs)).catch(() => 0);
        draw(); layer.focus();
      }
      bPlay.onclick = present;

      // ---------- abrir e salvar ----------
      const q = (it, extra) => '?space=' + it.space + (it.sudo ? '&sudo=1' : '') + '&path=' + encodeURIComponent(it.path) + extra;
      const put = (it, blob, overwrite) => {
        const go = () => DK.api('PUT', '/fs/file' + q(it, overwrite ? '&overwrite=1' : ''), blob, true);
        return it.space === 'machine' ? DK.withUnlock('explorer', !!it.sudo, go) : go();
      };
      async function doSave(asNew) {
        if (saving) return;
        if (editing >= 0) endEdit();
        let target = item, overwrite = !!item;
        if (asNew || !item) {
          let n = prompt('Salvar como (termine em .pptx ou .odp):', item ? item.name : 'Apresentação.pptx');
          if (!n) return;
          n = n.trim().replace(/[\/\\]/g, '_');
          if (!/\.(pptx|odp)$/i.test(n)) n += '.pptx';
          const d = dir || (item && { space: item.space, sudo: item.sudo, path: item.path.replace(/\/[^\/]*$/, '') || '/' }) || { space: 'home', path: '/' };
          target = { space: d.space, sudo: !!d.sudo, path: DK.joinPath(d.path, n), name: n, type: 'file' }; overwrite = false; dir = d;
        } else if (lossy.length && !lossyOk) {
          if (!confirm('Esta apresentação tem ' + lossy.join(', ') + ', que o LiteOffice não mantém. Substituir o original mesmo assim?\n\nOK = substituir · Cancelar = depois use “Salvar como…” para ficar com uma cópia.')) return;
          lossyOk = true;
        }
        saving = true; status.textContent = 'Salvando…';
        try {
          const r = await S.write(deck, target.name);
          try { await put(target, r.blob, overwrite); }
          catch (e) { if (e.status === 409 && confirm('“' + target.name + '” já existe. Substituir?')) await put(target, r.blob, true); else throw e; }
          if (asNew || !item) { lossy = []; lossyOk = false; warn.classList.add('hidden'); }
          item = target; dirty = false; updateUi();
          if (r.notesDropped) DK.toast('As notas do apresentador não ficam no formato .pptx (use .odp para guardá-las).');
          if (r.droppedImages) DK.toast(r.droppedImages + ' imagem(ns) não suportada(s) ficaram de fora do arquivo.');
          if (o.onSaved) o.onSaved();
        } catch (e) { status.textContent = 'Erro ao salvar: ' + e.message; }
        saving = false;
      }
      bSave.onclick = () => doSave(false); bAs.onclick = () => doSave(true);
      bOpen.onclick = () => DK.pickFile('slide', 'Abrir apresentação (.pptx ou .odp)', it => DK.slideApp({ item: it }));
      win._beforeClose = () => { const ok = !dirty || confirm('Descartar alterações não salvas?'); if (ok) dead = true; return ok; };

      new ResizeObserver(() => { if (editing < 0) schedule(); }).observe(view);
      (async () => {
        if (item) {
          status.textContent = 'Abrindo…';
          try {
            if (item.size > 40 * 1048576) throw new Error('apresentação grande demais (máximo 40 MB)');
            const r = await S.read(await DK.fetchFile(item, 'download'), item.name);
            deck = r.deck; lossy = r.info.lossy || [];
            if (lossy.length) {
              warn.textContent = '⚠ Esta apresentação tem ' + lossy.join(', ') + ', que o LiteOffice não mantém. Ao salvar por cima do original isso será perdido: use “Salvar como…” para ficar com uma cópia.';
              warn.classList.remove('hidden');
            }
          } catch (e) { status.textContent = 'Não foi possível abrir: ' + e.message; bSave.disabled = bAs.disabled = bPlay.disabled = true; return; }
        }
        cur = 0; sel = -1; dirty = false; refresh(); main.focus();
      })();
      refresh();
    }, 1040, 680, { flush: true });
  };

  DK.register({ id: 'slides', icon: '📙', label: 'LiteOffice Apresentações (.pptx / .odp)', desktop: true, open: () => DK.slideApp({ dir: { space: 'home', path: '/' } }) });
})(window.DK = window.DK || {});
