(function (DK) {
  // LiteOffice Planilhas: editor de planilhas (.xlsx e .ods, e CSV para abrir/exportar) que roda todo no navegador.
  // A grade é desenhada num <canvas> (só o que aparece na tela), a edição usa uma caixa de texto por cima da célula.
  // Cálculo e formatação de números: formula.js; leitura e gravação dos arquivos: sheetfmt.js.
  const el = DK.el, C = DK.calc, F = DK.sheetfmt;

  const HX = 46, HY = 24, DW = 80, DH = 22, MAXR = 1048576, MAXC = 16384;
  const FONT = 'Calibri, "Segoe UI", Arial, sans-serif';
  const NUM_FORMATS = [['', 'Geral'], ['0.00', 'Número'], ['#,##0.00', 'Milhares'], ['R$ #,##0.00', 'Moeda (R$)'], ['0.00%', 'Porcentagem'], ['dd/mm/yyyy', 'Data'], ['dd/mm/yyyy hh:mm', 'Data e hora'], ['hh:mm:ss', 'Hora'], ['@', 'Texto']];
  const key = (r, c) => r + ',' + c;
  const cl = cell => { if (!cell) return null; const o = {}; ['v', 'f', 's', 'keep', 'cv'].forEach(k => { if (cell[k] !== undefined) o[k] = cell[k]; }); return o; };
  const norm = (a, b) => ({ r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) });

  // Aumenta ou diminui as casas decimais de um formato (botões .0← e .00→).
  function moreDecimals(nf, d) {
    if (!nf || nf === '@' || C.isDateFmt(nf)) nf = d > 0 ? '0' : nf;
    const m = /([#,]*0)(\.(0*#*))?/.exec(nf);
    if (!m) return nf;
    const n = Math.max(0, (m[3] ? m[3].length : 0) + d);
    return nf.slice(0, m.index) + m[1] + (n ? '.' + '0'.repeat(n) : '') + nf.slice(m.index + m[0].length);
  }

  // o: { item: { space, path, sudo, name } } abre um arquivo; { dir: { space, path, sudo } } cria uma planilha nova, salva nessa pasta.
  DK.sheetApp = function (o) {
    o = o || {};
    let item = o.item || null;
    const winKey = item ? 'sheet:' + item.space + ':' + item.path : 'sheet:new:' + DK.nextDocId();
    DK.openWindow(winKey, 'LiteOffice Planilhas — ' + (item ? item.name : 'Planilha sem título'), (body, win) => {
      body.className = 'body flush';
      let suggest = '', book = F.newBook(), si = 0, dirty = false, dir = o.dir || null, lossy = [], lossyOk = false, saving = false;
      let cur = { r: 0, c: 0 }, ext = { r: 0, c: 0 }, editing = null, clip = null, undoSt = [], redoSt = [], tx = null, drag = null, dpr = 1, cssW = 0, cssH = 0;
      let colX, rowY, ncols = 0, nrows = 0, mTop = {}, mCov = {}, painting = false, dead = false;
      const sh = () => book.sheets[si];

      // ---------- barras ----------
      const bOpen = el('button', { textContent: '📂 Abrir…' }), bSave = el('button', { className: 'pri', textContent: '💾 Salvar' }), bAs = el('button', { textContent: 'Salvar como…' }), bCsv = el('button', { textContent: 'Exportar CSV', title: 'Salva a aba atual em .csv (valores como aparecem)' });
      const fmtLbl = el('span', { className: 'meta' });
      const tb = el('div', { className: 'tb' }, bOpen, bSave, bAs, bCsv, el('span', { className: 'sp' }), fmtLbl);
      const bar = el('div', { className: 'dtool' });
      const warn = el('div', { className: 'dwarn hidden' });
      const nameBox = el('input', { className: 'sname', title: 'Célula atual (digite um endereço para ir até ele)', spellcheck: false });
      const fbar = el('input', { className: 'sfx', spellcheck: false, placeholder: 'Valor ou fórmula (ex.: =SOMA(A1:A10))' });
      const fxRow = el('div', { className: 'sfbar' }, nameBox, el('span', { className: 'meta', textContent: 'fx' }), fbar);
      const scroller = el('div', { className: 'sscroll' }), sizer = el('div'), cv = el('canvas', { className: 'scanvas' });
      scroller.append(sizer);
      const editor = el('textarea', { className: 'sedit hidden', spellcheck: false, rows: 1 });
      const stage = el('div', { className: 'sstage', tabIndex: 0 }, scroller, cv, editor);
      const tabs = el('div', { className: 'stabs' });
      const status = el('div', { className: 'status' }), stat = el('span', { className: 'meta' });
      status.append(stat);
      body.append(tb, bar, warn, fxRow, stage, tabs, status);

      const btn = (label, title, fn, id) => { const b = el('button', { textContent: label, title: title }); b.onmousedown = e => e.preventDefault(); b.onclick = fn; if (id) b.dataset.cmd = id; bar.append(b); return b; };
      const sep = () => bar.append(el('span', { className: 'sep' }));
      const select = (opts, title, fn, w) => { const s = el('select', { title: title }, ...opts.map(x => el('option', { value: x[0], textContent: x[1] }))); s.style.width = w; s.onchange = () => { fn(s.value); }; bar.append(s); return s; };
      const colorIn = (title, label, fn, init) => {
        const w = el('label', { className: 'scolor', title: title }, label), i = el('input', { type: 'color', value: init });
        i.oninput = () => fn(i.value); w.append(i); bar.append(w); return i;
      };

      btn('↶', 'Desfazer (Ctrl+Z)', () => doUndo()); btn('↷', 'Refazer (Ctrl+Y)', () => doRedo()); sep();
      btn('B', 'Negrito (Ctrl+B)', () => toggle('b'), 'b').style.fontWeight = '700';
      btn('I', 'Itálico (Ctrl+I)', () => toggle('i'), 'i').style.fontStyle = 'italic';
      btn('U', 'Sublinhado (Ctrl+U)', () => toggle('u'), 'u').style.textDecoration = 'underline';
      btn('S', 'Tachado', () => toggle('st'), 'st').style.textDecoration = 'line-through'; sep();
      colorIn('Cor do texto', 'A', v => style({ c: v }), '#000000').parentNode.style.fontWeight = '700';
      colorIn('Cor de fundo', '▩', v => style({ bg: v }), '#ffff99');
      btn('∅', 'Remover cor de fundo', () => style({ bg: '' })); sep();
      btn('⇤', 'Alinhar à esquerda', () => style({ al: 'left' }), 'al-left'); btn('↔', 'Centralizar', () => style({ al: 'center' }), 'al-center'); btn('⇥', 'Alinhar à direita', () => style({ al: 'right' }), 'al-right');
      btn('↩', 'Quebrar texto na célula', () => toggle('wrap'), 'wrap'); btn('▦', 'Bordas', () => toggle('bd'), 'bd'); sep();
      const nfSel = select(NUM_FORMATS, 'Formato do número', v => style({ nf: v }), '104px');
      btn('.0←', 'Menos casas decimais', () => decimals(-1)); btn('.00→', 'Mais casas decimais', () => decimals(1)); sep();
      btn('⊞', 'Mesclar ou separar células', () => doMerge());
      btn('❄', 'Congelar painéis até a célula atual (clique de novo para soltar)', () => doFreeze());
      btn('Σ', 'Soma automática', () => doAutoSum()); sep();
      btn('A→Z', 'Ordenar a seleção pela coluna atual, crescente', () => doSort(1)); btn('Z→A', 'Ordenar a seleção pela coluna atual, decrescente', () => doSort(-1)); sep();
      const rcSel = select([['', 'Linhas e colunas'], ['ri', 'Inserir linha acima'], ['rd', 'Excluir linha(s)'], ['ci', 'Inserir coluna à esquerda'], ['cd', 'Excluir coluna(s)'], ['fit', 'Ajustar largura da coluna'], ['clr', 'Limpar formatação']], 'Linhas e colunas', v => { rowsCols(v); rcSel.value = ''; }, '128px');

      // ---------- layout ----------
      const frz = () => { const f = sh().freeze; return f ? { r: Math.min(f.r, nrows), c: Math.min(f.c, ncols) } : { r: 0, c: 0 }; };
      function layout(grow) {
        const s = sh(), u = F.usedRange(s);
        ncols = Math.min(MAXC, Math.max(grow ? ncols : 0, 26, u.cols + 6, s.freeze ? s.freeze.c + 1 : 0));
        nrows = Math.min(MAXR, Math.max(grow ? nrows : 0, 100, u.rows + 40, s.freeze ? s.freeze.r + 1 : 0));
        colX = new Float64Array(ncols + 1); rowY = new Float64Array(nrows + 1);
        for (let c = 0; c < ncols; c++) colX[c + 1] = colX[c] + (s.colW[c] || DW);
        for (let r = 0; r < nrows; r++) rowY[r + 1] = rowY[r] + (s.rowH[r] || DH);
        mTop = {}; mCov = {};
        s.merges.forEach(m => { mTop[key(m.r1, m.c1)] = m; for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) mCov[key(r, c)] = m; });
        const f = frz();
        sizer.style.width = (colX[ncols] - colX[f.c] + HX + colX[f.c]) + 'px';
        sizer.style.height = (rowY[nrows] - rowY[f.r] + HY + rowY[f.r]) + 'px';
      }
      const colW = c => colX[c + 1] - colX[c], rowH = r => rowY[r + 1] - rowY[r];
      const mergeAt = (r, c) => mTop[key(r, c)] || mCov[key(r, c)] || null;
      const findIdx = (arr, v, lo, hi) => { let a = lo, b = hi; while (a < b) { const m = (a + b + 1) >> 1; if (arr[m] <= v) a = m; else b = m - 1; } return a; };
      const toX = c => { const f = frz(); return c < f.c ? HX + colX[c] : HX + colX[f.c] + colX[c] - colX[f.c] - scroller.scrollLeft; };
      const toY = r => { const f = frz(); return r < f.r ? HY + rowY[r] : HY + rowY[f.r] + rowY[r] - rowY[f.r] - scroller.scrollTop; };
      function cellAt(x, y) {
        const f = frz(), fw = colX[f.c], fh = rowY[f.r];
        let c, r;
        if (x < HX + fw) c = findIdx(colX, x - HX, 0, Math.max(0, f.c)); else c = findIdx(colX, x - HX - fw + colX[f.c] + scroller.scrollLeft, f.c, ncols - 1);
        if (y < HY + fh) r = findIdx(rowY, y - HY, 0, Math.max(0, f.r)); else r = findIdx(rowY, y - HY - fh + rowY[f.r] + scroller.scrollTop, f.r, nrows - 1);
        return { r: Math.max(0, Math.min(nrows - 1, r)), c: Math.max(0, Math.min(ncols - 1, c)) };
      }
      function reveal(r, c) {
        const f = frz(), s = scroller;
        if (c >= ncols - 2 || r >= nrows - 2) { if (c >= ncols - 2) ncols = Math.min(MAXC, c + 10); if (r >= nrows - 2) nrows = Math.min(MAXR, r + 30); layout(true); }
        if (c >= f.c) {
          const availW = cssW - HX - colX[f.c], l = colX[c] - colX[f.c], rt = colX[c + 1] - colX[f.c];
          if (l < s.scrollLeft) s.scrollLeft = l; else if (rt > s.scrollLeft + availW) s.scrollLeft = rt - availW;
        }
        if (r >= f.r) {
          const availH = cssH - HY - rowY[f.r], t = rowY[r] - rowY[f.r], b = rowY[r + 1] - rowY[f.r];
          if (t < s.scrollTop) s.scrollTop = t; else if (b > s.scrollTop + availH) s.scrollTop = b - availH;
        }
      }

      // ---------- cálculo ----------
      function recalc() {
        const state = new Map(), used = new Map(), byName = {};
        book.sheets.forEach(s => { byName[s.name.toLowerCase()] = s; });
        const base = {
          get: (name, r, c) => { const s = byName[String(name).toLowerCase()]; return s ? value(s, r, c) : C.E.ref; },
          dims: name => { const s = byName[String(name).toLowerCase()]; if (!s) return { rows: 0, cols: 0 }; if (!used.has(s)) used.set(s, F.usedRange(s)); return used.get(s); },
          exists: name => !!byName[String(name).toLowerCase()]
        };
        function value(s, r, c) {
          const cell = s.cells[key(r, c)];
          if (!cell) return null;
          if (!cell.f) return cell.v === undefined ? null : cell.v;
          return calc(s, cell, r, c);
        }
        function calc(s, cell, r, c) {
          const st = state.get(cell);
          if (st === 2) return cell.v;
          if (st === 1) return C.E.circ;
          state.set(cell, 1);
          if (cell.keep && cell.cv === undefined) cell.cv = cell.v;
          if (!cell._ast || cell._src !== cell.f) { cell._ast = C.parse(cell.f); cell._src = cell.f; }
          const cx = Object.assign({}, base, { sheet: s.name, at: { r: r, c: c } });
          let v = C.evaluate(cell._ast, cx);
          if (v === C.E.name && cell.keep && cell.cv !== undefined) v = cell.cv;
          cell.v = v;
          state.set(cell, 2);
          return v;
        }
        book.sheets.forEach(s => Object.keys(s.cells).forEach(k => { const cell = s.cells[k]; if (cell.f && !state.has(cell)) { const p = k.split(','); calc(s, cell, +p[0], +p[1]); } }));
      }

      // ---------- desfazer ----------
      const begin = () => { tx = []; };
      function put(r, c, cell) {
        const s = sh(), i = si, k = key(r, c), before = cl(s.cells[k]), after = cl(cell);
        if (cell) s.cells[k] = cell; else delete s.cells[k];
        const set = v => { const t = book.sheets[i]; if (!t) return; if (v) t.cells[k] = cl(v); else delete t.cells[k]; };
        tx.push({ undo: () => set(before), redo: () => set(after) });
      }
      const snapBook = () => ({ si: si, sheets: book.sheets.map(s => { const cells = {}; Object.keys(s.cells).forEach(k => { cells[k] = cl(s.cells[k]); }); return { name: s.name, cells: cells, colW: Object.assign({}, s.colW), rowH: Object.assign({}, s.rowH), merges: s.merges.map(m => Object.assign({}, m)), freeze: s.freeze && Object.assign({}, s.freeze) }; }) });
      function restoreBook(sn) { book.sheets = sn.sheets.map(s => { const cells = {}; Object.keys(s.cells).forEach(k => { cells[k] = cl(s.cells[k]); }); return { name: s.name, cells: cells, colW: Object.assign({}, s.colW), rowH: Object.assign({}, s.rowH), merges: s.merges.map(m => Object.assign({}, m)), freeze: s.freeze && Object.assign({}, s.freeze) }; }); si = Math.min(sn.si, book.sheets.length - 1); }
      function wholeBook(fn) {      // para mudanças grandes: guarda o antes e o depois da pasta de trabalho inteira
        const before = snapBook(); fn(); const after = snapBook();
        tx.push({ undo: () => restoreBook(before), redo: () => restoreBook(after) });
      }
      function end() {
        const ops = tx; tx = null;
        if (!ops || !ops.length) return;
        undoSt.push(ops); if (undoSt.length > 100) undoSt.shift(); redoSt = [];
        changed(true);
      }
      function changed(relayout) { recalc(); dirty = true; if (relayout) layout(true); buildTabs(); schedule(); updateUi(); }
      function doUndo() { if (editing) return; const ops = undoSt.pop(); if (!ops) return; ops.slice().reverse().forEach(x => x.undo()); redoSt.push(ops); changed(true); }
      function doRedo() { if (editing) return; const ops = redoSt.pop(); if (!ops) return; ops.forEach(x => x.redo()); undoSt.push(ops); changed(true); }
      const act = fn => { begin(); try { fn(); } finally { end(); } };

      // ---------- seleção e estilos ----------
      const selRect = () => norm(cur, ext);
      const rowsAll = () => ({ r1: 0, c1: 0, r2: nrows - 1, c2: ncols - 1 });
      function styleOf(r, c) { const cell = sh().cells[key(r, c)]; return book.styles[(cell && cell.s) || 0] || {}; }
      // limita a seleção ao que tem conteúdo (+ uma folga), para não criar milhões de células ao formatar uma coluna ou linha inteira
      function limited(rc) {
        const u = F.usedRange(sh());
        return { r1: rc.r1, c1: rc.c1, r2: Math.min(rc.r2, Math.max(rc.r1, u.rows + 30)), c2: Math.min(rc.c2, Math.max(rc.c1, u.cols + 10)) };
      }
      function eachCell(rc, fn) { for (let r = rc.r1; r <= rc.r2; r++) for (let c = rc.c1; c <= rc.c2; c++) fn(r, c); }
      function style(patch) {
        if (editing) return;
        act(() => {
          const rc = limited(selRect());
          if ((rc.r2 - rc.r1 + 1) * (rc.c2 - rc.c1 + 1) > 200000) return;
          eachCell(rc, (r, c) => {
            const old = sh().cells[key(r, c)], st = Object.assign({}, book.styles[(old && old.s) || 0], patch);
            const cell = old ? cl(old) : {};
            const id = F.styleId(book, st);
            if (id) cell.s = id; else delete cell.s;
            if (cell.v === undefined && !cell.f && !cell.s) { if (old) put(r, c, null); } else put(r, c, cell);
          });
        });
        stage.focus();
      }
      function toggle(k) { const on = !styleOf(cur.r, cur.c)[k]; const p = {}; p[k] = on; style(p); }
      function decimals(d) { const nf = styleOf(cur.r, cur.c).nf || ''; style({ nf: moreDecimals(nf, d) }); }

      // ---------- edição ----------
      function rawText(r, c) {
        const cell = sh().cells[key(r, c)];
        if (!cell) return '';
        if (cell.f) return '=' + cell.f;
        const v = cell.v, st = book.styles[cell.s || 0] || {};
        if (v === null || v === undefined) return '';
        if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
        if (typeof v === 'number') {
          if (st.nf && C.isDateFmt(st.nf)) return C.format(v, st.nf);
          if (st.nf && /%/.test(st.nf)) return C.format(v * 100, '0.######').replace(/,?0+$/, '') + '%';
          return C.format(v, '').replace(/^-?\d+,?\d*E.*/, String(v).replace('.', ','));
        }
        return v instanceof C.FErr ? v.c : String(v);
      }
      function startEdit(text, fromBar) {
        if (editing) return;
        const m = mergeAt(cur.r, cur.c);
        if (m && !mTop[key(cur.r, cur.c)]) { cur = { r: m.r1, c: m.c1 }; ext = { r: m.r1, c: m.c1 }; }
        editing = { r: cur.r, c: cur.c, bar: !!fromBar };
        editor.value = text === null || text === undefined ? rawText(cur.r, cur.c) : text;
        fbar.value = editor.value;
        editor.classList.remove('hidden');
        placeEditor();
        if (!fromBar) { editor.focus(); if (text === null || text === undefined) editor.setSelectionRange(editor.value.length, editor.value.length); }
      }
      function placeEditor() {
        if (!editing) return;
        const m = mergeAt(editing.r, editing.c) || { r1: editing.r, c1: editing.c, r2: editing.r, c2: editing.c };
        const x = toX(m.c1), y = toY(m.r1), w = toX(m.c2 + 1) - x, h = toY(m.r2 + 1) - y;
        editor.style.left = x + 'px'; editor.style.top = y + 'px'; editor.style.minWidth = w + 'px'; editor.style.height = h + 'px';
        editor.style.width = Math.max(w, Math.min(cssW - x - 4, editor.value.split('\n').reduce((a, l) => Math.max(a, l.length), 0) * 8 + 24)) + 'px';
      }
      function commitEdit(text, r, c) {
        const s = sh(), old = s.cells[key(r, c)], st = book.styles[(old && old.s) || 0] || {};
        const cell = old ? cl(old) : {};
        delete cell.f; delete cell.keep; delete cell.cv;
        let t = String(text);
        if (t === '') delete cell.v;
        else if (t[0] === '=' && t.length > 1) {
          const ast = C.parse(t.slice(1));
          cell.f = ast.t === 'err' ? t.slice(1) : C.unparse(ast); cell.v = null;
        } else if (t[0] === "'") cell.v = t.slice(1);
        else if (st.nf === '@') cell.v = t;
        else {
          const p = C.parseInput(t);
          cell.v = p.v;
          if (p.nf && !st.nf) cell.s = F.styleId(book, Object.assign({}, st, { nf: p.nf }));
        }
        if (cell.v === undefined && !cell.f && !cell.s) { if (old) put(r, c, null); } else put(r, c, cell);
      }
      function endEdit(save, dr, dc) {
        if (!editing) return;
        const e = editing, text = editor.value;
        editing = null; editor.classList.add('hidden'); editor.value = '';
        if (save) act(() => commitEdit(text, e.r, e.c));
        stage.focus();
        if (dr || dc) move(dr, dc, false); else { updateBar(); schedule(); }
      }
      editor.addEventListener('input', () => { fbar.value = editor.value; placeEditor(); });
      editor.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); endEdit(true, e.shiftKey ? -1 : 1, 0); }
        else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); const p = editor.selectionStart; editor.setRangeText('\n', p, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); }
        else if (e.key === 'Tab') { e.preventDefault(); endEdit(true, 0, e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
        e.stopPropagation();
      });
      editor.addEventListener('blur', () => { if (editing && !editing.bar && !dead) setTimeout(() => { if (editing && !editing.bar && document.activeElement !== editor && document.activeElement !== fbar) endEdit(true); }, 0); });
      fbar.addEventListener('focus', () => { if (!editing) startEdit(null, true); });
      fbar.addEventListener('input', () => { if (editing) { editor.value = fbar.value; placeEditor(); } });
      fbar.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); if (editing) { editor.value = fbar.value; endEdit(true, 1, 0); } }
        else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
        e.stopPropagation();
      });
      fbar.addEventListener('blur', () => { setTimeout(() => { if (editing && editing.bar && document.activeElement !== fbar && document.activeElement !== editor) { editor.value = fbar.value; endEdit(true); } }, 0); });
      nameBox.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const t = nameBox.value.trim(), parts = t.split(':'), a = C.parseAddr(parts[0]), b = parts[1] ? C.parseAddr(parts[1]) : a;
          if (a && b && a.r < MAXR && b.r < MAXR && a.c < MAXC && b.c < MAXC) { cur = a; ext = b; reveal(a.r, a.c); schedule(); updateBar(); }
          stage.focus();
        } else if (e.key === 'Escape') { updateBar(); stage.focus(); }
        e.stopPropagation();
      });

      // ---------- movimento ----------
      function move(dr, dc, shift) {
        const from = shift ? ext : cur;
        let r = from.r + dr, c = from.c + dc;
        const m = mergeAt(from.r, from.c);
        if (m && !shift) { if (dr > 0) r = m.r2 + 1; if (dc > 0) c = m.c2 + 1; if (dr < 0) r = m.r1 - 1; if (dc < 0) c = m.c1 - 1; }
        r = Math.max(0, Math.min(MAXR - 1, r)); c = Math.max(0, Math.min(MAXC - 1, c));
        const cm = mCov[key(r, c)];
        if (cm && !shift) { r = cm.r1; c = cm.c1; }
        if (shift) ext = { r: r, c: c }; else { cur = { r: r, c: c }; ext = { r: r, c: c }; }
        reveal(r, c); schedule(); updateBar();
      }
      function jump(dr, dc, shift) {      // Ctrl + seta: até a borda do bloco de dados
        const s = sh(), from = shift ? ext : cur, u = F.usedRange(s), maxR = Math.max(u.rows - 1, 0), maxC = Math.max(u.cols - 1, 0);
        const has = (rr, cc) => { const x = s.cells[key(rr, cc)]; return !!x && ((x.v !== undefined && x.v !== null && x.v !== '') || !!x.f); };
        const lim = (rr, cc) => rr >= 0 && cc >= 0 && rr <= maxR && cc <= maxC;
        let r = from.r, c = from.c;
        if (has(r, c) && lim(r + dr, c + dc) && has(r + dr, c + dc)) { while (lim(r + dr, c + dc) && has(r + dr, c + dc)) { r += dr; c += dc; } }
        else {
          do { r += dr; c += dc; } while (lim(r, c) && !has(r, c));
          if (!lim(r, c)) { r = dr < 0 ? 0 : dr > 0 ? Math.max(from.r, maxR) : from.r; c = dc < 0 ? 0 : dc > 0 ? Math.max(from.c, maxC) : from.c; }
        }
        if (shift) ext = { r: r, c: c }; else { cur = { r: r, c: c }; ext = { r: r, c: c }; }
        reveal(r, c); schedule(); updateBar();
      }

      stage.addEventListener('keydown', e => {
        if (editing) return;
        const k = e.key, ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && !e.altKey) {
          const l = k.toLowerCase();
          if (l === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
          if (l === 'y') { e.preventDefault(); doRedo(); return; }
          if (l === 's') { e.preventDefault(); doSave(false); return; }
          if (l === 'b') { e.preventDefault(); toggle('b'); return; }
          if (l === 'i') { e.preventDefault(); toggle('i'); return; }
          if (l === 'u') { e.preventDefault(); toggle('u'); return; }
          if (l === 'a') { e.preventDefault(); cur = { r: 0, c: 0 }; const u = F.usedRange(sh()); ext = { r: Math.max(0, u.rows - 1), c: Math.max(0, u.cols - 1) }; schedule(); updateBar(); return; }
          if (l === 'd') { e.preventDefault(); fillSel('down'); return; }
          if (l === 'r') { e.preventDefault(); fillSel('right'); return; }
          if (l === 'f') { e.preventDefault(); doFind(); return; }
          if (k === 'Home') { e.preventDefault(); cur = { r: 0, c: 0 }; ext = { r: 0, c: 0 }; scroller.scrollLeft = 0; scroller.scrollTop = 0; schedule(); updateBar(); return; }
          if (k === 'ArrowUp') { e.preventDefault(); jump(-1, 0, e.shiftKey); return; }
          if (k === 'ArrowDown') { e.preventDefault(); jump(1, 0, e.shiftKey); return; }
          if (k === 'ArrowLeft') { e.preventDefault(); jump(0, -1, e.shiftKey); return; }
          if (k === 'ArrowRight') { e.preventDefault(); jump(0, 1, e.shiftKey); return; }
          if (l === 'c' || l === 'x' || l === 'v') return;      // os eventos copy/cut/paste cuidam
          return;
        }
        switch (k) {
          case 'ArrowUp': e.preventDefault(); move(-1, 0, e.shiftKey); return;
          case 'ArrowDown': e.preventDefault(); move(1, 0, e.shiftKey); return;
          case 'ArrowLeft': e.preventDefault(); move(0, -1, e.shiftKey); return;
          case 'ArrowRight': e.preventDefault(); move(0, 1, e.shiftKey); return;
          case 'Tab': e.preventDefault(); move(0, e.shiftKey ? -1 : 1, false); return;
          case 'Enter': e.preventDefault(); move(e.shiftKey ? -1 : 1, 0, false); return;
          case 'Home': e.preventDefault(); cur = { r: cur.r, c: 0 }; ext = { r: cur.r, c: 0 }; reveal(cur.r, 0); schedule(); updateBar(); return;
          case 'End': e.preventDefault(); { const u = F.usedRange(sh()); cur = { r: cur.r, c: Math.max(0, u.cols - 1) }; ext = { r: cur.r, c: cur.c }; reveal(cur.r, cur.c); schedule(); updateBar(); } return;
          case 'PageDown': e.preventDefault(); move(Math.max(1, Math.floor((cssH - HY) / DH) - 1), 0, e.shiftKey); return;
          case 'PageUp': e.preventDefault(); move(-Math.max(1, Math.floor((cssH - HY) / DH) - 1), 0, e.shiftKey); return;
          case 'F2': e.preventDefault(); startEdit(null); return;
          case 'Delete': case 'Backspace': e.preventDefault(); clearSel(); return;
          case 'Escape': if (clip) { clip = null; schedule(); } return;
        }
        if (k.length === 1 || k === 'Dead' || k === 'Process') { startEdit(''); }      // a tecla digitada cai na caixa de edição (que ganha o foco)
      });

      function clearSel() {
        act(() => {
          const rc = limited(selRect());
          eachCell(rc, (r, c) => {
            const old = sh().cells[key(r, c)];
            if (!old) return;
            if (old.s) { const n = { s: old.s }; put(r, c, n); } else put(r, c, null);
          });
        });
      }

      // ---------- mouse ----------
      const hit = (x, y) => {
        if (x < HX && y < HY) return { k: 'corner' };
        if (y < HY) {
          const p = cellAt(x, HY + 1), edge = Math.abs(x - toX(p.c + 1)) <= 3 ? p.c : Math.abs(x - toX(p.c)) <= 3 && p.c > 0 ? p.c - 1 : -1;
          return edge >= 0 ? { k: 'colEdge', c: edge } : { k: 'colHdr', c: p.c };
        }
        if (x < HX) {
          const p = cellAt(HX + 1, y), edge = Math.abs(y - toY(p.r + 1)) <= 3 ? p.r : Math.abs(y - toY(p.r)) <= 3 && p.r > 0 ? p.r - 1 : -1;
          return edge >= 0 ? { k: 'rowEdge', r: edge } : { k: 'rowHdr', r: p.r };
        }
        const rc = selRect(), hx = toX(rc.c2 + 1), hy = toY(rc.r2 + 1);
        if (Math.abs(x - hx) <= 5 && Math.abs(y - hy) <= 5) return { k: 'fill' };
        const p = cellAt(x, y); return { k: 'cell', r: p.r, c: p.c };
      };
      const pos = e => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
      cv.addEventListener('wheel', e => {
        e.preventDefault();
        const k = e.deltaMode === 1 ? 16 : 1;
        scroller.scrollLeft += (e.shiftKey ? e.deltaY : e.deltaX) * k; scroller.scrollTop += e.shiftKey ? 0 : e.deltaY * k;
      }, { passive: false });
      cv.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        const p = pos(e), h = hit(p.x, p.y);
        if (editing) {
          const t = editor.value, pre = t.slice(0, editor.selectionStart);
          if (h.k === 'cell' && t[0] === '=' && /[=(,;+\-*\/^&<>:]$/.test(pre) && !editing.bar) {
            editor.setRangeText(C.addr(h.r, h.c), editor.selectionStart, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); editor.focus(); e.preventDefault(); return;
          }
          endEdit(true);
        }
        stage.focus(); e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        if (h.k === 'colEdge') { drag = { t: 'col', c: h.c, x0: p.x, w0: colW(h.c), before: sh().colW[h.c] }; return; }
        if (h.k === 'rowEdge') { drag = { t: 'row', r: h.r, y0: p.y, h0: rowH(h.r), before: sh().rowH[h.r] }; return; }
        if (h.k === 'fill') { drag = { t: 'fill', src: selRect() }; return; }
        if (h.k === 'corner') { cur = { r: 0, c: 0 }; ext = { r: nrows - 1, c: ncols - 1 }; drag = null; schedule(); updateBar(); return; }
        if (h.k === 'colHdr') { if (e.shiftKey) ext = { r: nrows - 1, c: h.c }; else { cur = { r: 0, c: h.c }; ext = { r: nrows - 1, c: h.c }; } drag = { t: 'sel', hdr: 'col' }; schedule(); updateBar(); return; }
        if (h.k === 'rowHdr') { if (e.shiftKey) ext = { r: h.r, c: ncols - 1 }; else { cur = { r: h.r, c: 0 }; ext = { r: h.r, c: ncols - 1 }; } drag = { t: 'sel', hdr: 'row' }; schedule(); updateBar(); return; }
        const m = mCov[key(h.r, h.c)], rr = m ? m.r1 : h.r, cc = m ? m.c1 : h.c;
        if (e.shiftKey) ext = { r: rr, c: cc }; else { cur = { r: rr, c: cc }; ext = { r: rr, c: cc }; }
        drag = { t: 'sel' }; schedule(); updateBar();
      });
      cv.addEventListener('pointermove', e => {
        const p = pos(e);
        if (!drag) {
          const h = hit(p.x, p.y);
          cv.style.cursor = h.k === 'colEdge' ? 'col-resize' : h.k === 'rowEdge' ? 'row-resize' : h.k === 'fill' ? 'crosshair' : 'default';
          return;
        }
        if (drag.t === 'col') { const w = Math.max(16, Math.round(drag.w0 + p.x - drag.x0)); sh().colW[drag.c] = w; layout(true); schedule(); return; }
        if (drag.t === 'row') { const h = Math.max(10, Math.round(drag.h0 + p.y - drag.y0)); sh().rowH[drag.r] = h; layout(true); schedule(); return; }
        // rolagem automática ao arrastar para fora da grade
        if (p.x > cssW - 8) scroller.scrollLeft += 30; else if (p.x < HX + 8) scroller.scrollLeft -= 30;
        if (p.y > cssH - 8) scroller.scrollTop += 30; else if (p.y < HY + 8) scroller.scrollTop -= 30;
        const q = cellAt(Math.max(HX + 1, Math.min(cssW - 1, p.x)), Math.max(HY + 1, Math.min(cssH - 1, p.y)));
        if (drag.t === 'fill') { drag.to = q; schedule(); return; }
        if (drag.hdr === 'col') ext = { r: nrows - 1, c: q.c }; else if (drag.hdr === 'row') ext = { r: q.r, c: ncols - 1 }; else ext = { r: q.r, c: q.c };
        schedule(); updateBar();
      });
      cv.addEventListener('pointerup', () => {
        const d = drag; drag = null;
        if (!d) return;
        if (d.t === 'col' || d.t === 'row') {
          const s = sh(), i = si, arr = d.t === 'col' ? 'colW' : 'rowH', idx = d.t === 'col' ? d.c : d.r, after = s[arr][idx], before = d.before;
          const set = v => { const t = book.sheets[i]; if (v === undefined) delete t[arr][idx]; else t[arr][idx] = v; };
          if (after !== before) { begin(); tx.push({ undo: () => set(before), redo: () => set(after) }); end(); }
        } else if (d.t === 'fill' && d.to) {
          const rc = d.src, to = d.to;
          const dr = to.r > rc.r2 ? to.r - rc.r2 : to.r < rc.r1 ? to.r - rc.r1 : 0, dc = to.c > rc.c2 ? to.c - rc.c2 : to.c < rc.c1 ? to.c - rc.c1 : 0;
          if (Math.abs(dr) >= Math.abs(dc) && dr) {
            fillRange(rc, dr > 0 ? 'down' : 'up', Math.abs(dr));
            if (dr > 0) { cur = { r: rc.r1, c: rc.c1 }; ext = { r: rc.r2 + dr, c: rc.c2 }; } else { cur = { r: rc.r1 + dr, c: rc.c1 }; ext = { r: rc.r2, c: rc.c2 }; }
          } else if (dc) {
            fillRange(rc, dc > 0 ? 'right' : 'left', Math.abs(dc));
            if (dc > 0) { cur = { r: rc.r1, c: rc.c1 }; ext = { r: rc.r2, c: rc.c2 + dc }; } else { cur = { r: rc.r1, c: rc.c1 + dc }; ext = { r: rc.r2, c: rc.c2 }; }
          }
          schedule(); updateBar();
        }
      });
      cv.addEventListener('dblclick', e => {
        const p = pos(e), h = hit(p.x, p.y);
        if (h.k === 'colEdge') { fitColumn(h.c); return; }
        if (h.k === 'cell') { const m = mCov[key(h.r, h.c)]; cur = { r: m ? m.r1 : h.r, c: m ? m.c1 : h.c }; ext = { r: cur.r, c: cur.c }; startEdit(null); }
      });
      scroller.addEventListener('scroll', () => {
        if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 120 && nrows < MAXR) { nrows = Math.min(MAXR, nrows + 50); layout(true); }
        if (scroller.scrollLeft + scroller.clientWidth > scroller.scrollWidth - 120 && ncols < MAXC) { ncols = Math.min(MAXC, ncols + 10); layout(true); }
        schedule();
      });

      function fitColumn(c) {
        const g = cv.getContext('2d'); let w = 40;
        g.font = '13px ' + FONT;
        const s = sh();
        Object.keys(s.cells).forEach(k => { const p = k.split(','); if (+p[1] !== c) return; const cell = s.cells[k], st = book.styles[cell.s || 0] || {}; g.font = (st.i ? 'italic ' : '') + (st.b ? 'bold ' : '') + '13px ' + FONT; w = Math.max(w, g.measureText(disp(cell)).width + 14); });
        act(() => { const before = s.colW[c], i = si, after = Math.round(Math.min(w, 600)); s.colW[c] = after; tx.push({ undo: () => { if (before === undefined) delete book.sheets[i].colW[c]; else book.sheets[i].colW[c] = before; }, redo: () => { book.sheets[i].colW[c] = after; } }); });
      }

      // ---------- cópia, recorte e colagem ----------
      const disp = cell => { const st = book.styles[cell.s || 0] || {}; return C.format(cell.v === undefined ? null : cell.v, st.nf); };
      function tsv(rc) {
        const rows = [];
        for (let r = rc.r1; r <= rc.r2; r++) {
          const row = [];
          for (let c = rc.c1; c <= rc.c2; c++) { const cell = sh().cells[key(r, c)]; let t = cell ? disp(cell) : ''; if (/[\t\n"]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"'; row.push(t); }
          rows.push(row.join('\t'));
        }
        return rows.join('\n');
      }
      function setClip(e, cut) {
        if (editing) return;
        e.preventDefault();
        const rc = limited(selRect()), cells = [];
        for (let r = rc.r1; r <= rc.r2; r++) { const row = []; for (let c = rc.c1; c <= rc.c2; c++) row.push(cl(sh().cells[key(r, c)])); cells.push(row); }
        const text = tsv(rc);
        clip = { si: si, rc: rc, cells: cells, text: text, cut: cut };
        e.clipboardData.setData('text/plain', text);
        schedule();
      }
      stage.addEventListener('copy', e => setClip(e, false));
      stage.addEventListener('cut', e => setClip(e, true));
      function parseTsv(t) {
        const rows = [[]]; let f = '', q = false;
        for (let i = 0; i < t.length; i++) {
          const ch = t[i];
          if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
          else if (ch === '"' && f === '') q = true;
          else if (ch === '\t') { rows[rows.length - 1].push(f); f = ''; }
          else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; rows[rows.length - 1].push(f); f = ''; rows.push([]); }
          else f += ch;
        }
        if (f !== '' || rows[rows.length - 1].length) rows[rows.length - 1].push(f); else rows.pop();
        return rows;
      }
      stage.addEventListener('paste', e => {
        if (editing) return;
        e.preventDefault();
        const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
        const sel = selRect();
        act(() => {
          if (clip && clip.text === text.replace(/\r\n/g, '\n') && clip.si < book.sheets.length) {
            const src = clip, h = src.cells.length, w = src.cells[0].length;
            const big = (sel.r2 - sel.r1 + 1 > h || sel.c2 - sel.c1 + 1 > w) && h === 1 && w === 1;
            const tr1 = sel.r1, tc1 = sel.c1, tr2 = big ? sel.r2 : tr1 + h - 1, tc2 = big ? sel.c2 : tc1 + w - 1;
            if (src.cut && src.si === si) { for (let r = src.rc.r1; r <= src.rc.r2; r++) for (let c = src.rc.c1; c <= src.rc.c2; c++) put(r, c, null); }
            for (let r = tr1; r <= tr2; r++) for (let c = tc1; c <= tc2; c++) {
              const sc = src.cells[(r - tr1) % h][(c - tc1) % w];
              if (!sc) { put(r, c, null); continue; }
              const n = cl(sc);
              if (n.f && !src.cut) n.f = shiftFormula(n.f, r - (src.rc.r1 + (r - tr1) % h), c - (src.rc.c1 + (c - tc1) % w));
              put(r, c, n);
            }
            if (src.cut) clip = null;
            cur = { r: tr1, c: tc1 }; ext = { r: tr2, c: tc2 };
          } else if (text) {
            const rows = parseTsv(text.replace(/\r\n/g, '\n').replace(/\n$/, ''));
            rows.forEach((row, i) => row.forEach((t, j) => commitPaste(sel.r1 + i, sel.c1 + j, t)));
            cur = { r: sel.r1, c: sel.c1 }; ext = { r: sel.r1 + rows.length - 1, c: sel.c1 + Math.max.apply(null, rows.map(r => r.length)) - 1 };
          }
        });
        schedule(); updateBar();
      });
      function commitPaste(r, c, t) {
        if (r >= MAXR || c >= MAXC) return;
        const old = sh().cells[key(r, c)], cell = old ? cl(old) : {};
        delete cell.f; delete cell.keep; delete cell.cv;
        const p = C.parseInput(t);
        cell.v = p.v;
        if (p.nf && !(old && old.s && book.styles[old.s].nf)) cell.s = F.styleId(book, Object.assign({}, book.styles[(old && old.s) || 0], { nf: p.nf }));
        if (cell.v === undefined || cell.v === null) { delete cell.v; if (!cell.s) { if (old) put(r, c, null); return; } }
        put(r, c, cell);
      }
      // O texto de formulas copiadas é deslocado pela diferença entre a origem e o destino (tratado em shiftFrom).
      function shiftFormula(f, dr, dc) { return C.unparse(C.shift(C.parse(f), dr, dc)); }

      // ---------- preencher ----------
      const seriesNum = cell => cell && !cell.f && typeof cell.v === 'number';
      // Preenche count células a partir do bloco rc, na direção dir: copia (fórmulas acompanham a posição), continua sequências numéricas
      // (2 ou mais números) e incrementa o número no fim de um texto ("Item 1" -> "Item 2").
      function fillRange(rc, dir, count) {
        const horiz = dir === 'left' || dir === 'right', fwd = dir === 'down' || dir === 'right';
        const lines = horiz ? rc.r2 - rc.r1 + 1 : rc.c2 - rc.c1 + 1, len = horiz ? rc.c2 - rc.c1 + 1 : rc.r2 - rc.r1 + 1;
        const at = (ln, i) => (horiz ? [rc.r1 + ln, rc.c1 + i] : [rc.r1 + i, rc.c1 + ln]);
        act(() => {
          for (let ln = 0; ln < lines; ln++) {
            const src = [];
            for (let i = 0; i < len; i++) { const p = at(ln, i); src.push(sh().cells[key(p[0], p[1])] || null); }
            const nums = len > 1 && src.every(seriesNum), step = nums ? (fwd ? src[len - 1].v - src[len - 2].v : src[1].v - src[0].v) : 0;
            for (let k = 1; k <= count; k++) {
              const p = at(ln, fwd ? len - 1 + k : -k), r = p[0], c = p[1];
              if (r < 0 || c < 0 || r >= MAXR || c >= MAXC) continue;
              const idx = fwd ? (k - 1) % len : len - 1 - ((k - 1) % len), n = cl(src[idx]);
              if (!n) { put(r, c, null); continue; }
              const sp = at(ln, idx);
              if (n.f) n.f = shiftFormula(n.f, r - sp[0], c - sp[1]);
              else if (nums) n.v = (fwd ? src[len - 1].v : src[0].v) + step * (fwd ? k : -k);
              else if (len === 1 && typeof n.v === 'string') { const m = /^(.*?)(\d+)$/.exec(n.v); if (m) n.v = m[1] + String(+m[2] + (fwd ? k : -k)).padStart(m[2].length, '0'); }
              put(r, c, n);
            }
          }
        });
      }
      function fillSel(dir) {
        const rc = selRect();
        act(() => {
          for (let ln = 0; ln < (dir === 'down' ? rc.c2 - rc.c1 + 1 : rc.r2 - rc.r1 + 1); ln++) {
            const n = dir === 'down' ? rc.r2 - rc.r1 : rc.c2 - rc.c1;
            for (let k = 1; k <= n; k++) {
              const r = dir === 'down' ? rc.r1 + k : rc.r1 + ln, c = dir === 'down' ? rc.c1 + ln : rc.c1 + k;
              const srcCell = sh().cells[key(dir === 'down' ? rc.r1 : rc.r1 + ln, dir === 'down' ? rc.c1 + ln : rc.c1)];
              const nn = cl(srcCell);
              if (nn && nn.f) nn.f = shiftFormula(nn.f, dir === 'down' ? k : 0, dir === 'down' ? 0 : k);
              put(r, c, nn);
            }
          }
        });
      }

      // ---------- ações de estrutura ----------
      function doMerge() {
        const rc = selRect();
        if (rc.r1 === rc.r2 && rc.c1 === rc.c2) return;
        act(() => wholeBook(() => {
          const s = sh(), hit = s.merges.filter(m => m.r1 <= rc.r2 && m.r2 >= rc.r1 && m.c1 <= rc.c2 && m.c2 >= rc.c1);
          if (hit.length) { s.merges = s.merges.filter(m => hit.indexOf(m) < 0); return; }
          for (let r = rc.r1; r <= rc.r2; r++) for (let c = rc.c1; c <= rc.c2; c++) if (r !== rc.r1 || c !== rc.c1) delete s.cells[key(r, c)];
          s.merges.push({ r1: rc.r1, c1: rc.c1, r2: rc.r2, c2: rc.c2 });
        }));
        cur = { r: rc.r1, c: rc.c1 }; ext = { r: rc.r1, c: rc.c1 };
      }
      function doFreeze() {
        act(() => wholeBook(() => { const s = sh(); s.freeze = s.freeze ? null : (cur.r || cur.c ? { r: cur.r, c: cur.c } : null); }));
        scroller.scrollLeft = 0; scroller.scrollTop = 0;
      }
      function doAutoSum() {
        const s = sh();
        const isNum = (r, c) => { const x = s.cells[key(r, c)]; return !!x && typeof x.v === 'number'; };
        const rc = selRect();
        act(() => {
          if (rc.r1 !== rc.r2 || rc.c1 !== rc.c2) {       // seleção com números: soma na linha de baixo de cada coluna
            for (let c = rc.c1; c <= rc.c2; c++) {
              const cell = { f: 'SUM(' + C.addr(rc.r1, c) + ':' + C.addr(rc.r2, c) + ')', v: null };
              put(rc.r2 + 1, c, cell);
            }
            return;
          }
          let r = cur.r - 1;
          while (r >= 0 && isNum(r, cur.c)) r--;
          if (r < cur.r - 1) { put(cur.r, cur.c, { f: 'SUM(' + C.addr(r + 1, cur.c) + ':' + C.addr(cur.r - 1, cur.c) + ')', v: null }); return; }
          let c = cur.c - 1;
          while (c >= 0 && isNum(cur.r, c)) c--;
          if (c < cur.c - 1) put(cur.r, cur.c, { f: 'SUM(' + C.addr(cur.r, c + 1) + ':' + C.addr(cur.r, cur.c - 1) + ')', v: null });
        });
      }
      function doSort(dir) {
        const rc = selRect(), u = F.usedRange(sh());
        const r2 = Math.min(rc.r2, u.rows - 1), s = sh(), kc = Math.max(rc.c1, Math.min(cur.c, rc.c2));
        if (rc.r1 >= r2) return;
        let r1 = rc.r1;
        if (rc.r1 === 0 && r2 > 0 && typeof (s.cells[key(0, kc)] || {}).v === 'string' && typeof (s.cells[key(1, kc)] || {}).v === 'number') r1 = 1;       // cabeçalho de texto sobre números: fica no lugar
        const rows = [];
        for (let r = r1; r <= r2; r++) { const cells = []; for (let c = rc.c1; c <= rc.c2; c++) cells.push(cl(s.cells[key(r, c)])); rows.push({ r: r, cells: cells, k: (s.cells[key(r, kc)] || {}).v }); }
        const empty = x => x === undefined || x === null || x === '';
        rows.sort((a, b) => { if (empty(a.k) && empty(b.k)) return a.r - b.r; if (empty(a.k)) return 1; if (empty(b.k)) return -1; const d = C.compare(a.k, b.k) * dir; return d || a.r - b.r; });
        act(() => rows.forEach((row, i) => {
          const r = r1 + i;
          row.cells.forEach((cell, j) => { const n = cl(cell); if (n && n.f) n.f = shiftFormula(n.f, r - row.r, 0); put(r, rc.c1 + j, n); });
        }));
      }
      function doFind() {
        const t = prompt('Localizar:', ''); if (!t) return;
        const s = sh(), needle = t.toLowerCase(), keys = Object.keys(s.cells).map(k => k.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const after = keys.filter(p => p[0] > cur.r || (p[0] === cur.r && p[1] > cur.c)).concat(keys);
        const hitp = after.find(p => disp(s.cells[key(p[0], p[1])]).toLowerCase().indexOf(needle) >= 0 || (s.cells[key(p[0], p[1])].f || '').toLowerCase().indexOf(needle) >= 0);
        if (!hitp) { DK.toast('“' + t + '” não encontrado.'); return; }
        cur = { r: hitp[0], c: hitp[1] }; ext = { r: hitp[0], c: hitp[1] }; reveal(cur.r, cur.c); schedule(); updateBar();
      }

      // Ajusta as referências das fórmulas quando entram ou saem linhas e colunas. kind: 'r' | 'c'; n > 0 insere n em "at"; n < 0 exclui -n a partir de "at".
      function adjustRefs(sheetName, kind, at, n) {
        const same = x => String(x || '').toLowerCase() === sheetName.toLowerCase();
        book.sheets.forEach(s => Object.keys(s.cells).forEach(k => {
          const cell = s.cells[k];
          if (!cell.f) return;
          const ast = C.walk(C.clone(C.parse(cell.f)), ref => {
            if (!same(ref.sheet || s.name)) return null;
            const m = Object.assign({}, ref), i1 = kind === 'r' ? 'r1' : 'c1', i2 = kind === 'r' ? 'r2' : 'c2';
            if (kind === 'r' && ref.r2 === -1) return null;
            if (n > 0) { if (m[i1] >= at) m[i1] += n; if (m[i2] >= at) m[i2] += n; }
            else {
              const cnt = -n, lo = Math.min(m[i1], m[i2]), hi = Math.max(m[i1], m[i2]);
              const nl = lo < at ? lo : lo >= at + cnt ? lo - cnt : at, nh = hi < at ? hi : hi >= at + cnt ? hi - cnt : at - 1;
              if (nh < nl) m.bad = true; else { m[i1] = nl; m[i2] = nh; }
            }
            return m;
          });
          cell.f = C.unparse(ast);
        }));
      }
      function rowsCols(action) {
        if (editing) return;
        const sel = selRect();
        if (action === 'fit') { for (let c = sel.c1; c <= Math.min(sel.c2, sel.c1 + 50); c++) fitColumn(c); return; }
        if (action === 'clr') { style({ b: false, i: false, u: false, st: false, c: '', bg: '', al: '', wrap: false, bd: false, nf: '' }); return; }
        const kind = action[0] === 'r' ? 'r' : 'c', ins = action[1] === 'i', count = kind === 'r' ? sel.r2 - sel.r1 + 1 : sel.c2 - sel.c1 + 1, at = kind === 'r' ? sel.r1 : sel.c1;
        act(() => wholeBook(() => {
          const s = sh(), nc = {}, nm = [];
          const mapIdx = i => (ins ? (i >= at ? i + count : i) : (i < at ? i : i >= at + count ? i - count : -1));
          Object.keys(s.cells).forEach(k => { const p = k.split(',').map(Number); const ni = mapIdx(kind === 'r' ? p[0] : p[1]); if (ni >= 0) nc[kind === 'r' ? key(ni, p[1]) : key(p[0], ni)] = s.cells[k]; });
          const sizes = kind === 'r' ? s.rowH : s.colW, ns = {};
          Object.keys(sizes).forEach(i => { const ni = mapIdx(+i); if (ni >= 0) ns[ni] = sizes[i]; });
          s.merges.forEach(m => { const a = mapIdx(kind === 'r' ? m.r1 : m.c1), b = mapIdx(kind === 'r' ? m.r2 : m.c2); if (a >= 0 && b >= 0) { const x = Object.assign({}, m); if (kind === 'r') { x.r1 = a; x.r2 = b; } else { x.c1 = a; x.c2 = b; } if (x.r1 !== x.r2 || x.c1 !== x.c2) nm.push(x); } });
          s.cells = nc; if (kind === 'r') s.rowH = ns; else s.colW = ns; s.merges = nm;
          if (s.freeze) { if (kind === 'r' && at < s.freeze.r) s.freeze.r = Math.max(0, s.freeze.r + (ins ? count : -Math.min(count, s.freeze.r - at))); if (kind === 'c' && at < s.freeze.c) s.freeze.c = Math.max(0, s.freeze.c + (ins ? count : -Math.min(count, s.freeze.c - at))); }
          adjustRefs(s.name, kind, at, ins ? count : -count);
        }));
        cur = { r: sel.r1, c: sel.c1 }; ext = { r: sel.r1, c: sel.c1 };
      }

      // ---------- abas ----------
      function uniqueName(base, except) {
        let n = base, i = 2;
        while (book.sheets.some(s => s !== except && s.name.toLowerCase() === n.toLowerCase())) n = base + ' (' + i++ + ')';
        return n;
      }
      function selectSheet(i) {
        if (editing) endEdit(true);
        si = i; cur = { r: 0, c: 0 }; ext = { r: 0, c: 0 }; ncols = 0; nrows = 0; layout(false);
        scroller.scrollLeft = 0; scroller.scrollTop = 0; book.active = i; buildTabs(); schedule(); updateBar();
      }
      function renameSheet(i) {
        const s = book.sheets[i], n = prompt('Nome da aba:', s.name);
        if (!n || !n.trim()) return;
        const name = n.trim().replace(/[\[\]:*?\/\\]/g, '_').slice(0, 31), nn = uniqueName(name, s);
        if (nn === s.name) return;
        act(() => wholeBook(() => {
          const old = s.name;
          book.sheets.forEach(t => Object.keys(t.cells).forEach(k => {
            const cell = t.cells[k]; if (!cell.f) return;
            cell.f = C.unparse(C.walk(C.clone(C.parse(cell.f)), ref => (ref.sheet && ref.sheet.toLowerCase() === old.toLowerCase() ? Object.assign({}, ref, { sheet: nn }) : null)));
          }));
          s.name = nn;
        }));
      }
      function addSheet() {
        act(() => wholeBook(() => { book.sheets.push(F.newSheet(uniqueName('Planilha' + (book.sheets.length + 1)))); si = book.sheets.length - 1; }));
        selectSheet(si);
      }
      function delSheet(i) {
        if (book.sheets.length < 2) { DK.toast('A planilha precisa ter ao menos uma aba.'); return; }
        if (!confirm('Excluir a aba “' + book.sheets[i].name + '”? Fórmulas que a usam vão mostrar #REF!.')) return;
        act(() => wholeBook(() => { book.sheets.splice(i, 1); si = Math.min(si, book.sheets.length - 1); }));
        selectSheet(si);
      }
      function dupSheet(i) {
        act(() => wholeBook(() => {
          const s = book.sheets[i], n = F.newSheet(uniqueName(s.name + ' (cópia)'));
          Object.keys(s.cells).forEach(k => { n.cells[k] = cl(s.cells[k]); });
          n.colW = Object.assign({}, s.colW); n.rowH = Object.assign({}, s.rowH); n.merges = s.merges.map(m => Object.assign({}, m)); n.freeze = s.freeze && Object.assign({}, s.freeze);
          book.sheets.splice(i + 1, 0, n); si = i + 1;
        }));
        selectSheet(si);
      }
      function buildTabs() {
        tabs.replaceChildren();
        book.sheets.forEach((s, i) => {
          const b = el('button', { className: 'stab' + (i === si ? ' on' : ''), textContent: s.name, title: 'Duplo clique: renomear · botão direito: mais opções' });
          b.onclick = () => { if (i !== si) selectSheet(i); };
          b.ondblclick = () => renameSheet(i);
          b.oncontextmenu = e => {
            e.preventDefault();
            const a = prompt('Aba “' + s.name + '”: digite  r = renomear, d = duplicar, x = excluir', 'r');
            if (a === 'r') renameSheet(i); else if (a === 'd') dupSheet(i); else if (a === 'x') delSheet(i);
          };
          tabs.append(b);
        });
        tabs.append(el('button', { className: 'stab add', textContent: '＋', title: 'Nova aba', onclick: addSheet }));
      }

      // ---------- desenho ----------
      function schedule() { if (!painting && !dead) { painting = true; requestAnimationFrame(paint); } }
      function resizeCv() {
        cssW = scroller.clientWidth; cssH = scroller.clientHeight; dpr = window.devicePixelRatio || 1;
        cv.width = Math.max(1, Math.round(cssW * dpr)); cv.height = Math.max(1, Math.round(cssH * dpr));
        cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; schedule();
      }
      const wrapLines = (g, text, w) => {
        const out = [];
        String(text).split('\n').forEach(par => {
          let line = '';
          par.split(' ').forEach(word => { const t = line ? line + ' ' + word : word; if (line && g.measureText(t).width > w) { out.push(line); line = word; } else line = t; });
          out.push(line);
        });
        return out;
      };
      function paint() {
        painting = false;
        if (dead || !cssW) return;
        const g = cv.getContext('2d'), s = sh(), f = frz();
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#fff'; g.fillRect(0, 0, cssW, cssH);
        const fw = colX[f.c], fh = rowY[f.r], sx = scroller.scrollLeft, sy = scroller.scrollTop;
        const sc0 = findIdx(colX, colX[f.c] + sx, f.c, ncols - 1), sr0 = findIdx(rowY, rowY[f.r] + sy, f.r, nrows - 1);
        let sc1 = sc0, sr1 = sr0;
        while (sc1 < ncols && toX(sc1) < cssW) sc1++;
        while (sr1 < nrows && toY(sr1) < cssH) sr1++;
        const regions = [
          { r0: 0, r1: f.r, c0: 0, c1: f.c, x: HX, y: HY, w: fw, h: fh }, { r0: 0, r1: f.r, c0: sc0, c1: sc1, x: HX + fw, y: HY, w: cssW - HX - fw, h: fh },
          { r0: sr0, r1: sr1, c0: 0, c1: f.c, x: HX, y: HY + fh, w: fw, h: cssH - HY - fh }, { r0: sr0, r1: sr1, c0: sc0, c1: sc1, x: HX + fw, y: HY + fh, w: cssW - HX - fw, h: cssH - HY - fh }
        ].filter(g2 => g2.w > 0 && g2.h > 0 && g2.r1 > g2.r0 && g2.c1 > g2.c0);
        g.textBaseline = 'middle';
        regions.forEach(R => {
          g.save(); g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip();
          g.strokeStyle = '#e1e5ec'; g.lineWidth = 1; g.beginPath();
          for (let c = R.c0; c <= R.c1; c++) { const x = Math.round(toX(c)) - 0.5; g.moveTo(x, R.y); g.lineTo(x, R.y + R.h); }
          for (let r = R.r0; r <= R.r1; r++) { const y = Math.round(toY(r)) - 0.5; g.moveTo(R.x, y); g.lineTo(R.x + R.w, y); }
          g.stroke();
          for (let r = R.r0; r < R.r1; r++) for (let c = R.c0; c < R.c1; c++) {
            const k = key(r, c);
            if (mCov[k]) continue;
            const m = mTop[k], cell = s.cells[k];
            if (!cell && !m) continue;
            const x = toX(c), y = toY(r), w = m ? toX(m.c2 + 1) - x : colW(c), h = m ? toY(m.r2 + 1) - y : rowH(r);
            drawCell(g, cell, r, c, x, y, w, h, R);
          }
          // mesclagens que começam fora da região visível
          s.merges.forEach(m => {
            if ((m.r1 >= R.r0 && m.r1 < R.r1 && m.c1 >= R.c0 && m.c1 < R.c1) || m.r2 < R.r0 || m.r1 >= R.r1 || m.c2 < R.c0 || m.c1 >= R.c1) return;
            const x = toX(m.c1), y = toY(m.r1);
            drawCell(g, s.cells[key(m.r1, m.c1)], m.r1, m.c1, x, y, toX(m.c2 + 1) - x, toY(m.r2 + 1) - y, R);
          });
          g.restore();
        });
        // linha de congelamento
        if (f.c || f.r) { g.strokeStyle = '#8aa0c8'; g.lineWidth = 2; g.beginPath(); if (f.c) { g.moveTo(HX + fw, HY); g.lineTo(HX + fw, cssH); } if (f.r) { g.moveTo(HX, HY + fh); g.lineTo(cssW, HY + fh); } g.stroke(); }
        // cópia em andamento
        if (clip && clip.si === si) { g.save(); g.strokeStyle = '#16a34a'; g.setLineDash([5, 4]); g.lineWidth = 2; const x1 = toX(clip.rc.c1), y1 = toY(clip.rc.r1); g.strokeRect(x1, y1, toX(clip.rc.c2 + 1) - x1, toY(clip.rc.r2 + 1) - y1); g.restore(); }
        drawSelection(g);
        drawHeaders(g, f, fw, sc0, sc1, sr0, sr1);
        placeEditor();
      }
      function drawCell(g, cell, r, c, x, y, w, h, R) {
        const st = book.styles[(cell && cell.s) || 0] || {};
        if (st.bg) { g.fillStyle = st.bg; g.fillRect(x, y, w, h); }
        if (st.bd) { g.strokeStyle = '#4b5563'; g.lineWidth = 1; g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, w - 1, h - 1); }
        if (!cell || cell.v === undefined || cell.v === null || cell.v === '') return;
        const v = cell.v;
        let text = disp(cell);
        g.font = (st.i ? 'italic ' : '') + (st.b ? 'bold ' : '') + '13px ' + FONT;
        g.fillStyle = v instanceof C.FErr ? '#b91c1c' : st.c || '#111827';
        const isNum = typeof v === 'number', al = st.al || (isNum ? 'right' : typeof v === 'string' ? 'left' : 'center');
        const pad = 4;
        if (isNum && g.measureText(text).width > w - 2 * pad && !/E/.test(text)) text = '#'.repeat(Math.max(1, Math.floor((w - 2 * pad) / 8)));
        // texto à esquerda avança sobre as células vazias da direita
        let tw = w;
        if (al === 'left' && !st.wrap && typeof v === 'string' && !mTop[key(r, c)]) {
          for (let cc = c + 1; cc < Math.min(ncols, c + 30); cc++) { const n = sh().cells[key(r, cc)]; if ((n && n.v !== undefined && n.v !== null && n.v !== '') || mCov[key(r, cc)] || mTop[key(r, cc)]) break; tw += colW(cc); }
        }
        g.save(); g.beginPath(); g.rect(Math.max(x, R.x), Math.max(y, R.y), Math.min(tw, R.x + R.w - Math.max(x, R.x)), Math.min(h, R.y + R.h - Math.max(y, R.y))); g.clip();
        const lines = st.wrap ? wrapLines(g, text, w - 2 * pad) : text.split('\n').slice(0, 1), lh = 16;
        const top = st.wrap ? y + Math.max(2, (h - lines.length * lh) / 2) + lh / 2 : y + h / 2;
        lines.forEach((ln, i) => {
          const ty = top + i * lh, wd = g.measureText(ln).width;
          const tx2 = al === 'right' ? x + w - pad - wd : al === 'center' ? x + (w - wd) / 2 : x + pad;
          g.fillText(ln, tx2, ty);
          if (st.u) g.fillRect(tx2, ty + 7, wd, 1);
          if (st.st) g.fillRect(tx2, ty, wd, 1);
        });
        g.restore();
      }
      function drawSelection(g) {
        const rc = selRect();
        const mm = mergeAt(cur.r, cur.c) || { r1: cur.r, c1: cur.c, r2: cur.r, c2: cur.c };
        const x1 = toX(rc.c1), y1 = toY(rc.r1), x2 = toX(rc.c2 + 1), y2 = toY(rc.r2 + 1);
        g.save(); g.beginPath(); g.rect(HX, HY, cssW - HX, cssH - HY); g.clip();
        if (rc.r1 !== rc.r2 || rc.c1 !== rc.c2) {
          g.fillStyle = 'rgba(37,99,235,.12)'; g.fillRect(x1, y1, x2 - x1, y2 - y1);
        }
        g.strokeStyle = '#2563eb'; g.lineWidth = 2; g.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1 - 1, y2 - y1 - 1);
        const ax = toX(mm.c1), ay = toY(mm.r1);
        g.strokeRect(ax + 1, ay + 1, toX(mm.c2 + 1) - ax - 2, toY(mm.r2 + 1) - ay - 2);
        g.fillStyle = '#2563eb'; g.fillRect(x2 - 4, y2 - 4, 7, 7);
        if (drag && drag.t === 'fill' && drag.to) { g.setLineDash([4, 3]); g.strokeStyle = '#555'; g.lineWidth = 1; const t = drag.to, a = drag.src; const fx1 = toX(Math.min(a.c1, t.c)), fy1 = toY(Math.min(a.r1, t.r)); g.strokeRect(fx1, fy1, toX(Math.max(a.c2, t.c) + 1) - fx1, toY(Math.max(a.r2, t.r) + 1) - fy1); }
        g.restore();
      }
      function drawHeaders(g, f, fw, sc0, sc1, sr0, sr1) {
        const rc = selRect();
        g.fillStyle = '#f1f3f8'; g.fillRect(0, 0, cssW, HY); g.fillRect(0, 0, HX, cssH);
        g.strokeStyle = '#c7ccd6'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, HY - 0.5); g.lineTo(cssW, HY - 0.5); g.moveTo(HX - 0.5, 0); g.lineTo(HX - 0.5, cssH); g.stroke();
        g.font = '12px ' + FONT; g.textBaseline = 'middle'; g.textAlign = 'center';
        const colHdr = (c) => { const x = toX(c), w = colW(c), on = c >= rc.c1 && c <= rc.c2; if (on) { g.fillStyle = '#d3e3fd'; g.fillRect(x, 0, w, HY - 1); } g.fillStyle = on ? '#1d4ed8' : '#4b5563'; g.fillText(C.colName(c), x + w / 2, HY / 2); g.fillStyle = '#c7ccd6'; g.fillRect(x + w - 1, 0, 1, HY); };
        const rowHdr = (r) => { const y = toY(r), h = rowH(r), on = r >= rc.r1 && r <= rc.r2; if (on) { g.fillStyle = '#d3e3fd'; g.fillRect(0, y, HX - 1, h); } g.fillStyle = on ? '#1d4ed8' : '#4b5563'; g.fillText(String(r + 1), HX / 2, y + h / 2); g.fillStyle = '#c7ccd6'; g.fillRect(0, y + h - 1, HX, 1); };
        g.save(); g.beginPath(); g.rect(HX, 0, fw, HY); g.clip(); for (let c = 0; c < f.c; c++) colHdr(c); g.restore();
        g.save(); g.beginPath(); g.rect(HX + fw, 0, cssW - HX - fw, HY); g.clip(); for (let c = sc0; c < sc1; c++) colHdr(c); g.restore();
        const fh = rowY[f.r];
        g.save(); g.beginPath(); g.rect(0, HY, HX, fh); g.clip(); for (let r = 0; r < f.r; r++) rowHdr(r); g.restore();
        g.save(); g.beginPath(); g.rect(0, HY + fh, HX, cssH - HY - fh); g.clip(); for (let r = sr0; r < sr1; r++) rowHdr(r); g.restore();
        g.textAlign = 'start';
        g.fillStyle = '#e4e8ef'; g.fillRect(0, 0, HX - 1, HY - 1);
      }

      // ---------- estado da interface ----------
      function updateBar() {
        const m = mergeAt(cur.r, cur.c), r = m ? m.r1 : cur.r, c = m ? m.c1 : cur.c, rc = selRect();
        nameBox.value = (rc.r1 === rc.r2 && rc.c1 === rc.c2) || m ? C.addr(r, c) : C.addr(rc.r1, rc.c1) + ':' + C.addr(rc.r2, rc.c2);
        if (!editing) fbar.value = rawText(r, c);
        const st = styleOf(r, c);
        [].forEach.call(bar.querySelectorAll('button[data-cmd]'), b => {
          const k = b.dataset.cmd;
          b.classList.toggle('on', k.indexOf('al-') === 0 ? st.al === k.slice(3) : !!st[k]);
        });
        nfSel.value = NUM_FORMATS.some(x => x[0] === (st.nf || '')) ? (st.nf || '') : '';
        // soma, média e contagem da seleção
        let n = 0, sum = 0, cnt = 0;
        if (rc.r1 !== rc.r2 || rc.c1 !== rc.c2) {
          const lim = limited(rc), s = sh();
          if ((lim.r2 - lim.r1 + 1) * (lim.c2 - lim.c1 + 1) <= 500000) eachCell(lim, (rr, cc) => { const x = s.cells[key(rr, cc)]; if (!x || x.v === undefined || x.v === null || x.v === '') return; cnt++; if (typeof x.v === 'number') { n++; sum += x.v; } });
        }
        stat.textContent = cnt > 1 ? 'Contagem: ' + cnt + (n ? ' · Soma: ' + C.format(sum, '#,##0.######') + ' · Média: ' + C.format(sum / n, '#,##0.######') : '') : '';
      }
      function updateUi() {
        win.setTitle((dirty ? '● ' : '') + 'LiteOffice Planilhas — ' + (item ? item.name : 'Planilha sem título'));
        fmtLbl.textContent = (item ? (DK.extOf(item.name) === '.ods' ? 'OpenDocument (.ods)' : 'Excel (.xlsx)') : 'nova planilha') + (item && item.space === 'machine' ? ' · arquivo do computador' + (item.sudo ? ' (sudo)' : '') : '') + (dirty ? ' · modificada' : ' · salva');
        updateBar();
      }

      // ---------- abrir e salvar ----------
      const q = (it, extra) => '?space=' + it.space + (it.sudo ? '&sudo=1' : '') + '&path=' + encodeURIComponent(it.path) + extra;
      const put2 = (it, blob, overwrite) => {
        const go = () => DK.api('PUT', '/fs/file' + q(it, overwrite ? '&overwrite=1' : ''), blob, true);
        return it.space === 'machine' ? DK.withUnlock('explorer', !!it.sudo, go) : go();
      };
      async function saveTo(target, blob, overwrite) {
        try { await put2(target, blob, overwrite); }
        catch (e) { if (e.status === 409 && confirm('“' + target.name + '” já existe. Substituir?')) await put2(target, blob, true); else throw e; }
      }
      const targetIn = name => {
        const d = dir || (item && { space: item.space, sudo: item.sudo, path: item.path.replace(/\/[^\/]*$/, '') || '/' }) || { space: 'home', path: '/' };
        return { space: d.space, sudo: !!d.sudo, path: DK.joinPath(d.path, name), name: name, type: 'file', dir: d };
      };
      async function doSave(asNew) {
        if (saving) return;
        if (editing) endEdit(true);
        let target = item, overwrite = !!item;
        if (asNew || !item) {
          let n = prompt('Salvar como (termine em .xlsx ou .ods):', item ? item.name : (suggest || 'Planilha.xlsx'));
          if (!n) return;
          n = n.trim().replace(/[\/\\]/g, '_');
          if (!/\.(xlsx|ods)$/i.test(n)) n += '.xlsx';
          target = targetIn(n); overwrite = false; dir = target.dir; delete target.dir;
        } else if (lossy.length && !lossyOk) {
          if (!confirm('Esta planilha tem ' + lossy.join(', ') + ', que o LiteOffice não mantém. Substituir o original mesmo assim?\n\nOK = substituir · Cancelar = depois use “Salvar como…” para ficar com uma cópia.')) return;
          lossyOk = true;
        }
        saving = true; stat.textContent = 'Salvando…';
        try {
          recalc();
          const r = await F.write(book, target.name);
          await saveTo(target, r.blob, overwrite);
          if (asNew || !item) { lossy = []; lossyOk = false; warn.classList.add('hidden'); }
          item = target; dirty = false; updateUi();
          if (o.onSaved) o.onSaved();
        } catch (e) { stat.textContent = 'Erro ao salvar: ' + e.message; }
        saving = false;
      }
      async function doCsv() {
        if (editing) endEdit(true);
        const base = (item ? item.name : 'Planilha').replace(/\.[^.]+$/, '');
        let n = prompt('Exportar a aba “' + sh().name + '” como CSV:', base + '.csv');
        if (!n) return;
        n = n.trim().replace(/[\/\\]/g, '_'); if (!/\.csv$/i.test(n)) n += '.csv';
        try { const t = targetIn(n); delete t.dir; await saveTo(t, F.toCsv(sh(), cell => disp(cell)), false); DK.toast('CSV salvo: ' + n); if (o.onSaved) o.onSaved(); }
        catch (e) { stat.textContent = 'Erro ao exportar: ' + e.message; }
      }
      bSave.onclick = () => doSave(false); bAs.onclick = () => doSave(true); bCsv.onclick = doCsv;
      bOpen.onclick = () => DK.pickFile('sheet', 'Abrir planilha (.xlsx, .ods ou .csv)', it => DK.sheetApp({ item: it }));
      win._beforeClose = () => { const ok = !dirty || confirm('Descartar alterações não salvas?'); if (ok) dead = true; return ok; };
      win.addEventListener('mousedown', e => { if (e.target === cv) stage.focus(); });

      // ---------- início ----------
      new ResizeObserver(() => { resizeCv(); }).observe(scroller);
      (async () => {
        if (item) {
          stat.textContent = 'Abrindo…';
          try {
            if (item.size > 25 * 1048576) throw new Error('planilha grande demais (máximo 25 MB)');
            const r = await F.read(await DK.fetchFile(item, 'download'), item.name);
            book = r.book; lossy = r.info.lossy || [];
            if (/\.(csv|tsv)$/i.test(item.name)) { suggest = item.name.replace(/\.[^.]+$/, '.xlsx'); dir = { space: item.space, sudo: item.sudo, path: item.path.replace(/\/[^\/]*$/, '') || '/' }; item = null; dirty = true; }
            if (lossy.length) {
              warn.textContent = '⚠ Esta planilha tem ' + lossy.join(', ') + ', que o LiteOffice não mantém. Ao salvar por cima do original isso será perdido: use “Salvar como…” para ficar com uma cópia.';
              warn.classList.remove('hidden');
            }
          } catch (e) { stat.textContent = 'Não foi possível abrir: ' + e.message; bSave.disabled = bAs.disabled = bCsv.disabled = true; return; }
        }
        si = Math.max(0, Math.min(book.active || 0, book.sheets.length - 1));
        recalc(); layout(false); buildTabs(); resizeCv(); updateUi(); stage.focus();
      })();
      layout(false); buildTabs(); updateUi();
    }, 980, 640, { flush: true });
  };

  DK.register({ id: 'sheets', icon: '📗', label: 'LiteOffice Planilhas (.xlsx / .ods)', desktop: true, open: () => DK.sheetApp({ dir: { space: 'home', path: '/' } }) });
})(window.DK = window.DK || {});
