(function (DK) {
  // Jogos clássicos do Diogows: Campo Minado, Paciência (Klondike) e FreeCell. Tudo roda no navegador, sem arquivos nem servidor.
  // Cartas: clique numa carta para selecionar (ela e as de baixo) e clique no destino; duplo clique manda para a fundação. Funciona igual com toque.
  const el = DK.el;
  const store = {
    get: k => { try { return localStorage.getItem('dk.games.' + k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem('dk.games.' + k, v); } catch (e) { /* sem armazenamento: só não lembra */ } }
  };
  const fmtTime = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  // =====================================================================================================================
  // Campo Minado
  // =====================================================================================================================
  const LEVELS = {
    easy: { w: 9, h: 9, m: 10, label: 'Iniciante (9×9, 10 minas)' },
    mid: { w: 16, h: 16, m: 40, label: 'Intermediário (16×16, 40 minas)' },
    hard: { w: 30, h: 16, m: 99, label: 'Especialista (30×16, 99 minas)' }
  };

  DK.minesweeperApp = function () {
    const first = LEVELS[store.get('mines.level')] ? store.get('mines.level') : 'easy';
    DK.openWindow('minesweeper', 'Campo Minado', (body, win) => {
      body.className = 'body flush';
      let lv = first, cells, btns, over, opened, flags, started, secs, timer, flagMode = false, longPress = false, lastFlag = { i: -1, t: 0 };
      const lvSel = el('select', {}, ...Object.keys(LEVELS).map(k => el('option', { value: k, textContent: LEVELS[k].label })));
      lvSel.value = lv;
      const face = el('button', { className: 'mface', textContent: '🙂', title: 'Novo jogo' });
      const left = el('span', { className: 'mcount', textContent: '000' }), clock = el('span', { className: 'mcount', textContent: '000' });
      const flagBtn = el('button', { textContent: '🚩 Bandeira', title: 'Com isto ligado, tocar/clicar marca uma bandeira (útil no celular). Também vale o botão direito ou o toque longo.' });
      const best = el('span', { className: 'meta' });
      const tb = el('div', { className: 'tb' }, lvSel, flagBtn, el('span', { className: 'sp' }), best);
      const head = el('div', { className: 'mhead' }, left, face, clock);
      const board = el('div', { className: 'mines' });
      body.append(tb, el('div', { className: 'minewrap' }, el('div', { className: 'minebox' }, head, board)));

      const L = () => LEVELS[lv];
      const nbrs = i => {
        const { w, h } = L(), x = i % w, y = (i / w) | 0, r = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) r.push(ny * w + nx);
        }
        return r;
      };
      const pad = n => String(Math.max(-99, Math.min(999, n))).padStart(3, '0');
      const bestKey = () => 'mines.best.' + lv;
      function showBest() { const b = store.get(bestKey()); best.textContent = b ? 'Melhor tempo: ' + fmtTime(+b) : ''; }
      function paint(i) {
        const c = cells[i], b = btns[i];
        b.className = 'mc' + (c.open ? ' open' : '') + (c.flag ? ' flag' : '') + (c.boom ? ' boom' : '') + (c.wrong ? ' wrong' : '');
        b.textContent = c.open ? (c.mine ? '💣' : c.n ? c.n : '') : c.wrong ? '❌' : c.flag ? '🚩' : (over && c.mine) ? '💣' : '';
        if (c.open && c.n) b.dataset.n = c.n; else delete b.dataset.n;
      }
      function newGame() {
        clearInterval(timer);
        const { w, h } = L();
        cells = Array.from({ length: w * h }, () => ({ mine: false, n: 0, open: false, flag: false }));
        over = false; opened = 0; flags = 0; started = false; secs = 0;
        face.textContent = '🙂'; left.textContent = pad(L().m); clock.textContent = '000';
        board.style.gridTemplateColumns = 'repeat(' + w + ', 26px)';
        board.replaceChildren();
        btns = cells.map((c, i) => {
          const b = el('button', { className: 'mc' });
          b.onclick = () => { if (longPress) { longPress = false; return; } click(i, flagMode); };
          // botão direito e toque longo marcam a bandeira; o Android dispara os dois no toque longo, então o segundo é ignorado
          const flagIt = () => { if (lastFlag.i === i && Date.now() - lastFlag.t < 700) return; lastFlag = { i: i, t: Date.now() }; click(i, true); };
          b.oncontextmenu = e => { e.preventDefault(); flagIt(); };
          let pt = null;
          b.onpointerdown = e => { if (e.pointerType !== 'mouse') pt = setTimeout(() => { longPress = true; flagIt(); }, 450); };
          b.onpointerup = b.onpointerleave = b.onpointercancel = () => { clearTimeout(pt); if (longPress) setTimeout(() => { longPress = false; }, 150); };
          board.append(b);
          return b;
        });
        showBest();
      }
      function plant(safe) {       // as minas só são sorteadas no primeiro clique, que nunca cai numa mina nem ao lado de uma
        const avoid = new Set([safe].concat(nbrs(safe)));
        const pool = cells.map((c, i) => i).filter(i => !avoid.has(i));
        for (let k = 0; k < L().m; k++) { const j = k + Math.floor(Math.random() * (pool.length - k)); [pool[k], pool[j]] = [pool[j], pool[k]]; cells[pool[k]].mine = true; }
        cells.forEach((c, i) => { c.n = nbrs(i).filter(j => cells[j].mine).length; });
        started = true;
        timer = setInterval(() => { secs++; clock.textContent = pad(secs); }, 1000);
      }
      function reveal(i0) {
        const stack = [i0];
        while (stack.length) {
          const i = stack.pop(), c = cells[i];
          if (c.open || c.flag) continue;
          c.open = true; opened++; paint(i);
          if (c.mine) { c.boom = true; paint(i); return true; }
          if (!c.n) nbrs(i).forEach(j => { if (!cells[j].open) stack.push(j); });
        }
        return false;
      }
      function finish(won) {
        over = true; clearInterval(timer);
        face.textContent = won ? '😎' : '😵';
        cells.forEach((c, i) => {
          if (won && c.mine && !c.flag) { c.flag = true; flags++; }
          if (!won && c.flag && !c.mine) c.wrong = true;
          paint(i);
        });
        left.textContent = pad(L().m - flags);
        if (won) {
          const b = +store.get(bestKey());
          if (!b || secs < b) { store.set(bestKey(), String(secs)); DK.toast('Campo Minado: novo melhor tempo, ' + fmtTime(secs) + '!'); showBest(); }
        }
      }
      function click(i, asFlag) {
        if (over) return;
        const c = cells[i];
        if (asFlag) {
          if (c.open) return;
          c.flag = !c.flag; flags += c.flag ? 1 : -1; paint(i); left.textContent = pad(L().m - flags);
          return;
        }
        if (c.flag) return;
        if (c.open) {            // clicar num número já aberto, com as bandeiras certas ao redor, abre os vizinhos
          if (!c.n) return;
          const around = nbrs(i);
          if (around.filter(j => cells[j].flag).length !== c.n) return;
          let boom = false;
          around.forEach(j => { if (!cells[j].flag && !cells[j].open && reveal(j)) boom = true; });
          if (boom) finish(false); else if (opened === cells.length - L().m) finish(true);
          return;
        }
        if (!started) plant(i);
        if (reveal(i)) finish(false);
        else if (opened === cells.length - L().m) finish(true);
      }
      face.onclick = newGame;
      lvSel.onchange = () => { lv = lvSel.value; store.set('mines.level', lv); newGame(); };
      flagBtn.onclick = () => { flagMode = !flagMode; flagBtn.classList.toggle('pri', flagMode); };
      win._onClose = () => clearInterval(timer);
      newGame();
    }, first === 'hard' ? 860 : first === 'mid' ? 520 : 380, first === 'easy' ? 500 : 600);
  };

  // =====================================================================================================================
  // Cartas (Paciência e FreeCell)
  // =====================================================================================================================
  const SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const isRed = s => s === 1 || s === 2;
  const deck = () => {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ r: r, s: s, up: false });
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  };
  function cardEl(c, top, extra) {
    const lbl = RANKS[c.r - 1] + SUITS[c.s];
    const e = el('div', { className: 'pcard' + (c.up ? (isRed(c.s) ? ' red' : '') : ' back') + (extra ? ' ' + extra : '') });
    e.style.top = top + 'px';
    if (c.up) e.append(el('span', { className: 'tl', textContent: lbl }), el('span', { className: 'mid', textContent: SUITS[c.s] }), el('span', { className: 'br', textContent: lbl }));
    return e;
  }
  // Uma pilha: um retângulo que guarda as cartas empilhadas. `step` diz quanto cada carta deixa à mostra da de baixo.
  function pileEl(cards, stepOf, label, onPile, onCard, selFrom) {
    const p = el('div', { className: 'ppile' });
    if (label) p.append(el('span', { className: 'plabel', textContent: label }));
    let y = 0;
    cards.forEach((c, k) => {
      if (!c) return;
      const e = cardEl(c, y, selFrom != null && k >= selFrom ? 'sel' : '');
      e.onclick = ev => { ev.stopPropagation(); onCard(k, false); };
      e.ondblclick = ev => { ev.stopPropagation(); onCard(k, true); };
      p.append(e);
      y += stepOf(c);
    });
    p.style.height = 'calc(var(--ch) + ' + Math.max(0, y - (cards.length ? stepOf(cards[cards.length - 1]) : 0)) + 'px)';
    p.onclick = onPile;
    return p;
  }

  // ---------- Paciência (Klondike) ----------
  DK.solitaireApp = function () {
    DK.openWindow('solitaire', 'Paciência', (body, win) => {
      body.className = 'body flush';
      let g, hist = [], sel = null, moves = 0, draw3 = store.get('sol.draw3') === '1';
      const fresh = () => {
        const d = deck(), s = { stock: [], waste: [], found: [[], [], [], []], tab: [[], [], [], [], [], [], []] };
        for (let i = 0; i < 7; i++) for (let j = 0; j <= i; j++) { const c = d.pop(); c.up = j === i; s.tab[i].push(c); }
        s.stock = d;
        return s;
      };
      const newBtn = el('button', { className: 'pri', textContent: '🔄 Novo jogo' }), undoBtn = el('button', { textContent: '↩ Desfazer' });
      const modeSel = el('select', {}, el('option', { value: '1', textContent: 'Comprar 1' }), el('option', { value: '3', textContent: 'Comprar 3' }));
      modeSel.value = draw3 ? '3' : '1';
      const info = el('span', { className: 'meta' });
      const board = el('div', { className: 'cardtable' });
      body.append(el('div', { className: 'tb' }, newBtn, undoBtn, modeSel, el('span', { className: 'sp' }), info), board);

      const snap = () => { hist.push(JSON.stringify(g)); if (hist.length > 300) hist.shift(); };
      const won = () => g.found.every(f => f.length === 13);
      const canTab = (c, pile) => { const t = pile[pile.length - 1]; return t ? (t.up && t.r === c.r + 1 && isRed(t.s) !== isRed(c.s)) : c.r === 13; };
      const canFound = c => g.found[c.s].length === c.r - 1;
      const cardsOf = s => s.zone === 'tab' ? g.tab[s.i].slice(s.k) : s.zone === 'waste' ? g.waste.slice(-1) : g.found[s.i].slice(-1);
      function take(s) {
        if (s.zone === 'tab') { const r = g.tab[s.i].splice(s.k); const t = g.tab[s.i]; if (t.length) t[t.length - 1].up = true; return r; }
        if (s.zone === 'waste') return [g.waste.pop()];
        return [g.found[s.i].pop()];
      }
      function tryMove(s, to) {
        const cs = cardsOf(s);
        if (!cs.length) return false;
        if (to.zone === 'found') { if (cs.length !== 1 || !canFound(cs[0]) || s.zone === 'found') return false; }
        else if (!canTab(cs[0], g.tab[to.i]) || (s.zone === 'tab' && s.i === to.i)) return false;
        snap(); moves++;
        const m = take(s);
        if (to.zone === 'found') g.found[m[0].s].push(m[0]); else g.tab[to.i].push(...m);
        return true;
      }
      function drawStock() {
        snap(); moves++;
        if (g.stock.length) { for (let n = draw3 ? 3 : 1; n > 0 && g.stock.length; n--) { const c = g.stock.pop(); c.up = true; g.waste.push(c); } }
        else if (g.waste.length) { g.stock = g.waste.reverse(); g.stock.forEach(c => { c.up = false; }); g.waste = []; }
        else { hist.pop(); moves--; }
      }
      function pick(zone, i, k, dbl) {
        const s = { zone: zone, i: i, k: k };
        const c = cardsOf(s)[0];
        if (zone === 'tab' && !g.tab[i][k].up) return dropOn('tab', i);        // carta virada: vale como clique na pilha
        if (!c) { sel = null; return draw_(); }
        if (dbl) { sel = null; if (cardsOf(s).length === 1) tryMove(s, { zone: 'found' }); return draw_(); }
        if (sel) {
          if (sel.zone === zone && sel.i === i && sel.k === k) sel = null;              // clicar de novo na mesma carta solta a seleção
          else if (zone === 'found') { if (!tryMove(sel, { zone: 'found' })) sel = s; else sel = null; }
          else if (zone === 'tab' && tryMove(sel, { zone: 'tab', i: i })) sel = null;
          else sel = s;
        } else sel = s;
        draw_();
      }
      function dropOn(zone, i) {
        if (sel) tryMove(sel, { zone: zone, i: i });
        sel = null; draw_();
      }
      function draw_() {
        board.replaceChildren();
        const top = el('div', { className: 'prow' });
        const stock = pileEl(g.stock.slice(-1), () => 0, g.stock.length ? '' : '↻', () => { sel = null; drawStock(); draw_(); }, () => { sel = null; drawStock(); draw_(); });
        stock.classList.add('stock');
        const wl = g.waste.slice(-(draw3 ? 3 : 1));
        const waste = pileEl(wl, () => 18, '', () => {}, k => pick('waste', 0, g.waste.length - wl.length + k, false), sel && sel.zone === 'waste' ? wl.length - 1 : null);
        waste.style.width = 'calc(var(--cw) + ' + (draw3 ? 36 : 0) + 'px)';
        waste.querySelectorAll('.pcard').forEach((e, k) => { if (k < wl.length - 1) e.onclick = e.ondblclick = ev => ev.stopPropagation(); else e.ondblclick = ev => { ev.stopPropagation(); pick('waste', 0, g.waste.length - 1, true); }; });
        top.append(stock, waste, el('div', { className: 'psp' }));
        g.found.forEach((f, i) => {
          const p = pileEl(f.slice(-1), () => 0, SUITS[i], () => dropOn('found', i), () => pick('found', i, f.length - 1, false), sel && sel.zone === 'found' && sel.i === i ? 0 : null);
          p.classList.add('found'); top.append(p);
        });
        const tab = el('div', { className: 'prow' });
        g.tab.forEach((pile, i) => tab.append(pileEl(pile, c => c.up ? 26 : 12, 'K', () => dropOn('tab', i), (k, d) => pick('tab', i, k, d), sel && sel.zone === 'tab' && sel.i === i ? sel.k : null)));
        board.append(top, tab);
        info.textContent = moves + ' jogadas';
        undoBtn.disabled = !hist.length;
        if (won()) { info.textContent = '🎉 Você ganhou em ' + moves + ' jogadas!'; board.append(el('div', { className: 'cwin', textContent: '🎉 Parabéns!' })); }
      }
      function reset() { g = fresh(); hist = []; sel = null; moves = 0; draw_(); }
      newBtn.onclick = reset;
      undoBtn.onclick = () => { if (hist.length) { g = JSON.parse(hist.pop()); sel = null; moves = Math.max(0, moves - 1); draw_(); } };
      modeSel.onchange = () => { draw3 = modeSel.value === '3'; store.set('sol.draw3', draw3 ? '1' : '0'); reset(); };
      reset();
    }, 640, 600);
  };

  // ---------- FreeCell ----------
  DK.freecellApp = function () {
    DK.openWindow('freecell', 'FreeCell', (body, win) => {
      body.className = 'body flush';
      let g, hist = [], sel = null, moves = 0;
      const fresh = () => {
        const d = deck(), s = { free: [null, null, null, null], found: [[], [], [], []], tab: [[], [], [], [], [], [], [], []] };
        d.forEach((c, i) => { c.up = true; s.tab[i % 8].push(c); });
        return s;
      };
      const newBtn = el('button', { className: 'pri', textContent: '🔄 Novo jogo' }), undoBtn = el('button', { textContent: '↩ Desfazer' }), autoBtn = el('button', { textContent: '⚡ Auto', title: 'Manda para as fundações todas as cartas que já podem ir' });
      const info = el('span', { className: 'meta' });
      const board = el('div', { className: 'cardtable' });
      body.append(el('div', { className: 'tb' }, newBtn, undoBtn, autoBtn, el('span', { className: 'sp' }), info), board);

      const snap = () => { hist.push(JSON.stringify(g)); if (hist.length > 400) hist.shift(); };
      const won = () => g.found.every(f => f.length === 13);
      const canFound = c => g.found[c.s].length === c.r - 1;
      const fits = (c, t) => t.r === c.r + 1 && isRed(t.s) !== isRed(c.s);
      // as cartas de k até o fim formam uma sequência descendente em cores alternadas?
      const isRun = (pile, k) => { for (let j = k; j < pile.length - 1; j++) if (!fits(pile[j + 1], pile[j])) return false; return true; };
      const cardsOf = s => s.zone === 'tab' ? g.tab[s.i].slice(s.k) : s.zone === 'free' ? [g.free[s.i]] : g.found[s.i].slice(-1);
      // quantas cartas cabem num movimento só: (células livres + 1) × 2^(colunas vazias)
      const maxRun = (toEmpty) => {
        const fr = g.free.filter(x => !x).length, em = g.tab.filter(p => !p.length).length - (toEmpty ? 1 : 0);
        return (fr + 1) * Math.pow(2, Math.max(0, em));
      };
      function remove(s) { if (s.zone === 'tab') return g.tab[s.i].splice(s.k); if (s.zone === 'free') { const c = g.free[s.i]; g.free[s.i] = null; return [c]; } return [g.found[s.i].pop()]; }
      function tryMove(s, to) {
        const cs = cardsOf(s);
        if (!cs.length || !cs[0]) return false;
        if (to.zone === 'found') { if (cs.length !== 1 || !canFound(cs[0]) || s.zone === 'found') return false; }
        else if (to.zone === 'free') { if (cs.length !== 1 || g.free[to.i] || s.zone === 'found') return false; }
        else {
          if (s.zone === 'tab' && s.i === to.i) return false;
          const t = g.tab[to.i][g.tab[to.i].length - 1];
          if (t ? !fits(cs[0], t) : false) return false;
          if (cs.length > maxRun(!t)) return false;
        }
        snap(); moves++;
        const m = remove(s);
        if (to.zone === 'found') g.found[m[0].s].push(m[0]); else if (to.zone === 'free') g.free[to.i] = m[0]; else g.tab[to.i].push(...m);
        return true;
      }
      function pick(zone, i, k, dbl) {
        const s = { zone: zone, i: i, k: k };
        const c = cardsOf(s)[0];
        if (!c) { return; }
        if (zone === 'tab' && !isRun(g.tab[i], k)) { sel = null; return draw_(); }
        if (dbl) { sel = null; if (cardsOf(s).length === 1) tryMove(s, { zone: 'found' }); return draw_(); }
        if (sel) {
          if (sel.zone === zone && sel.i === i && sel.k === k) sel = null;
          else if (zone === 'found') sel = tryMove(sel, { zone: 'found' }) ? null : s;
          else if (zone === 'tab' && tryMove(sel, { zone: 'tab', i: i })) sel = null;
          else sel = s;
        } else sel = s;
        draw_();
      }
      function drop(zone, i) {
        if (sel) tryMove(sel, { zone: zone, i: i });
        sel = null; draw_();
      }
      function auto() {
        let again = true, any = false;
        while (again) {
          again = false;
          const srcs = [];
          g.free.forEach((c, i) => { if (c) srcs.push({ zone: 'free', i: i }); });
          g.tab.forEach((p, i) => { if (p.length) srcs.push({ zone: 'tab', i: i, k: p.length - 1 }); });
          for (const s of srcs) if (tryMove(s, { zone: 'found' })) { again = any = true; break; }
        }
        sel = null; draw_();
      }
      function draw_() {
        board.replaceChildren();
        const top = el('div', { className: 'prow' });
        g.free.forEach((c, i) => top.append(pileEl(c ? [c] : [], () => 0, '', () => drop('free', i), () => pick('free', i, 0, false), sel && sel.zone === 'free' && sel.i === i ? 0 : null)));
        top.append(el('div', { className: 'psp' }));
        g.found.forEach((f, i) => { const p = pileEl(f.slice(-1), () => 0, SUITS[i], () => drop('found', i), () => pick('found', i, f.length - 1, false)); p.classList.add('found'); top.append(p); });
        const tab = el('div', { className: 'prow' });
        g.tab.forEach((pile, i) => tab.append(pileEl(pile, () => 26, '', () => drop('tab', i), (k, d) => pick('tab', i, k, d), sel && sel.zone === 'tab' && sel.i === i ? sel.k : null)));
        board.append(top, tab);
        info.textContent = moves + ' jogadas';
        undoBtn.disabled = !hist.length;
        if (won()) { info.textContent = '🎉 Você ganhou em ' + moves + ' jogadas!'; board.append(el('div', { className: 'cwin', textContent: '🎉 Parabéns!' })); }
      }
      function reset() { g = fresh(); hist = []; sel = null; moves = 0; draw_(); }
      newBtn.onclick = reset; autoBtn.onclick = auto;
      undoBtn.onclick = () => { if (hist.length) { g = JSON.parse(hist.pop()); sel = null; moves = Math.max(0, moves - 1); draw_(); } };
      reset();
    }, 760, 640);
  };

})(window.DK = window.DK || {});
