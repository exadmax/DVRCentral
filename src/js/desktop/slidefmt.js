(function (DK) {
  // Conversão entre a apresentação do LiteOffice e os pacotes .pptx (PowerPoint) e .odp (LibreOffice/OpenDocument).
  // Modelo: deck = { w, h (px a 96 dpi), media: { id: 'data:image/...' }, slides: [ { bg, notes, shapes: [ forma ] } ] }
  //   forma = { t: 'text'|'rect'|'ellipse'|'line'|'arrow'|'image', x, y, w, h, rot, flipV, fill, line, lw (px), anchor: 't'|'m'|'b', img: id da mídia, text: [ parágrafo ] }
  //   parágrafo = { al: 'left'|'center'|'right'|'justify', bul: bool, runs: [ { t, b, i, u, s, sz (pt), c (#rrggbb), f (fonte) } ] }
  // O que se mantém: textos com negrito/itálico/sublinhado/tachado, tamanho, cor e fonte, alinhamento, marcadores, retângulos, elipses, linhas, setas, imagens (PNG, JPEG, GIF),
  // cor de fundo do slide e (no .odp) as notas. O que NÃO se mantém: animações e transições, tabelas, gráficos, SmartArt, vídeos, fundos com imagem ou degradê,
  // formas especiais, níveis de recuo e o slide mestre (logotipos e fundos do modelo viram parte de cada slide); read() avisa o que achou (info.lossy).
  const Z = DK.zip;
  const S = DK.slidefmt = {};

  const E = 9525;
  const xesc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function parseXml(text) {
    const d = new DOMParser().parseFromString(text, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('o conteúdo da apresentação está corrompido');
    return d;
  }
  const kids = (n, local) => (n ? [].filter.call(n.childNodes, c => c.nodeType === 1 && (!local || c.localName === local)) : []);
  const first = (n, local) => kids(n, local)[0] || null;
  const path = (n, ...names) => { for (const x of names) { n = first(n, x); if (!n) return null; } return n; };
  const attr = (n, a) => (n && n.getAttribute(a)) || '';
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' };
  const MAX_SHAPES = 20000;
  function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function fromB64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  const toDataUrl = (u8, ext) => (MIME[ext] ? 'data:' + MIME[ext] + ';base64,' + b64(u8) : '');
  const fromDataUrl = src => { const m = /^data:(image\/(?:png|jpeg|gif));base64,(.*)$/s.exec(src || ''); return m ? { type: m[1], bytes: fromB64(m[2]) } : null; };
  const lenPx = s => { const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|px)?$/.exec(String(s || '')); if (!m) return 0; return +m[1] * { cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, px: 1 }[m[2] || 'px']; };
  const px2cm = px => (px / 96 * 2.54).toFixed(3) + 'cm';
  const hex6 = v => (/^[0-9a-f]{6}$/i.test(v || '') ? '#' + v.toLowerCase() : '');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  S.newDeck = () => ({ w: 1280, h: 720, media: {}, slides: [] });
  S.newShape = (t, o) => Object.assign({ t: t, x: 100, y: 100, w: 300, h: 100, rot: 0, fill: '', line: '', lw: 2, anchor: 't', text: null }, o || {});
  S.para = (text, o) => Object.assign({ al: 'left', bul: false, runs: [Object.assign({ t: text }, o && o.run)] }, o && { al: o.al || 'left', bul: !!o.bul });
  S.plain = shape => (shape.text || []).map(p => p.runs.map(r => r.t).join('')).join('\n');

  // ---------- cores do tema (PPTX) ----------
  function hslAdjust(hex, lumMod, lumOff) {
    let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
    }
    l = clamp(l * lumMod + lumOff, 0, 1);
    const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    let R, G, B;
    if (!s) R = G = B = l; else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; R = f(p, q, h + 1 / 3); G = f(p, q, h); B = f(p, q, h - 1 / 3); }
    return '#' + [R, G, B].map(x => ('0' + Math.round(x * 255).toString(16)).slice(-2)).join('');
  }

  // =====================================================================================================================
  //                                                        PPTX
  // =====================================================================================================================
  const relsOf = async (files, file) => {
    const rp = file.replace(/([^\/]+)$/, '_rels/$1.rels'), out = {};
    if (files[rp]) kids(parseXml(Z.text(files[rp])).documentElement, 'Relationship').forEach(r => { out[r.getAttribute('Id')] = { target: r.getAttribute('Target'), type: r.getAttribute('Type') }; });
    return out;
  };
  const resolve = (base, target) => {
    if (target.charAt(0) === '/') return target.slice(1);
    const parts = base.split('/'); parts.pop();
    target.split('/').forEach(p => { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); });
    return parts.join('/');
  };

  async function readPptx(files) {
    if (!files['ppt/presentation.xml']) throw new Error('arquivo .pptx inválido');
    const flags = {}, deck = S.newDeck(), info = { lossy: [] };
    let mediaSeq = 0, count = 0;
    const pres = parseXml(Z.text(files['ppt/presentation.xml'])).documentElement;
    const prels = await relsOf(files, 'ppt/presentation.xml');
    const sz = first(pres, 'sldSz');
    if (sz && +attr(sz, 'cx') > 0 && +attr(sz, 'cy') > 0) { deck.w = Math.round(+attr(sz, 'cx') / E); deck.h = Math.round(+attr(sz, 'cy') / E); }
    // tema: cores
    const theme = {}, clrMap = {};
    const themeKey = Object.keys(prels).filter(k => /\/theme$/.test(prels[k].type))[0];
    if (themeKey && files[resolve('ppt/presentation.xml', prels[themeKey].target)]) {
      const cs = path(parseXml(Z.text(files[resolve('ppt/presentation.xml', prels[themeKey].target)])).documentElement, 'themeElements', 'clrScheme');
      kids(cs).forEach(c => { const v = first(c); if (v) theme[c.localName] = v.localName === 'sysClr' ? hex6(attr(v, 'lastClr')) : hex6(attr(v, 'val')); });
    }
    const dflt = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
    const schemeHex = name => { const m = clrMap[name] || dflt[name] || name; return theme[m] || theme[name] || ''; };
    const clrOf = el => {
      if (!el) return '';
      let c = '';
      if (el.localName === 'srgbClr') c = hex6(attr(el, 'val'));
      else if (el.localName === 'schemeClr') c = schemeHex(attr(el, 'val'));
      else if (el.localName === 'sysClr') c = hex6(attr(el, 'lastClr'));
      else if (el.localName === 'prstClr') c = ({ black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00' })[attr(el, 'val')] || '';
      if (!c) return '';
      const lm = first(el, 'lumMod'), lo = first(el, 'lumOff');
      if (lm || lo) c = hslAdjust(c, lm ? +attr(lm, 'val') / 100000 : 1, lo ? +attr(lo, 'val') / 100000 : 0);
      return c;
    };
    const fillOf = spPr => {      // '' = sem preenchimento, null = herda
      if (!spPr) return null;
      if (first(spPr, 'noFill')) return '';
      const sf = first(spPr, 'solidFill');
      if (sf) return clrOf(first(sf)) || null;
      const gf = first(spPr, 'gradFill');
      if (gf) { flags['fundos ou formas com degradê'] = 1; return clrOf(first(path(gf, 'gsLst', 'gs'))) || null; }
      if (first(spPr, 'blipFill')) { flags['fundos ou formas com imagem'] = 1; return null; }
      return null;
    };
    const lineOf = spPr => {
      const ln = first(spPr, 'ln');
      if (!ln) return null;
      const w = +attr(ln, 'w');
      if (first(ln, 'noFill')) return { c: '', w: 0 };
      const sf = first(ln, 'solidFill');
      return { c: sf ? clrOf(first(sf)) : null, w: w ? w / E : null, arrow: !!(first(ln, 'tailEnd') && attr(first(ln, 'tailEnd'), 'type') && attr(first(ln, 'tailEnd'), 'type') !== 'none') };
    };
    // mestre e layouts: geometria e estilos herdados dos marcadores de posição
    const docCache = {};
    const doc = async f => { if (!docCache[f] && files[f]) docCache[f] = parseXml(Z.text(files[f])).documentElement; return docCache[f] || null; };
    const masterPath = (() => { const k = Object.keys(prels).filter(x => /\/slideMaster$/.test(prels[x].type))[0]; return k ? resolve('ppt/presentation.xml', prels[k].target) : ''; })();
    const master = masterPath ? await doc(masterPath) : null;
    const cm = master && first(master, 'clrMap');
    if (cm) [].forEach.call(cm.attributes, a => { clrMap[a.name] = a.value; });
    const phList = tree => kids(path(tree, 'cSld', 'spTree'), 'sp').filter(sp => path(sp, 'nvSpPr', 'nvPr', 'ph'));
    const phMatch = (list, ph) => {
      const type = attr(ph, 'type') || 'body', idx = attr(ph, 'idx');
      return list.filter(sp => { const p = path(sp, 'nvSpPr', 'nvPr', 'ph'); return (idx && attr(p, 'idx') === idx) || ((attr(p, 'type') || 'body') === type && (!idx || !attr(p, 'idx'))); })[0] || list.filter(sp => (attr(path(sp, 'nvSpPr', 'nvPr', 'ph'), 'type') || 'body') === type)[0] || null;
    };
    const styleOfMaster = type => {
      const tx = path(master, 'txStyles');
      const grp = type === 'title' || type === 'ctrTitle' ? 'titleStyle' : type === 'body' || type === 'subTitle' || type === 'obj' ? 'bodyStyle' : 'otherStyle';
      return path(tx, grp, 'lvl1pPr');
    };
    const defRPr = pPr => first(pPr, 'defRPr');

    const slideOrder = kids(path(pres, 'sldIdLst'), 'sldId').map(s => prels[s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')]).filter(Boolean).map(r => resolve('ppt/presentation.xml', r.target));
    for (const sf of slideOrder) {
      if (!files[sf]) continue;
      const root = parseXml(Z.text(files[sf])).documentElement, rels = await relsOf(files, sf);
      const slide = { bg: '#ffffff', notes: '', shapes: [] };
      deck.slides.push(slide);
      const layKey = Object.keys(rels).filter(k => /\/slideLayout$/.test(rels[k].type))[0];
      const layout = layKey ? await doc(resolve(sf, rels[layKey].target)) : null;
      // fundo
      const bgOf = tree => {
        const bg = path(tree, 'cSld', 'bg');
        if (!bg) return '';
        const pr = first(bg, 'bgPr');
        if (pr) { const f = fillOf(pr); if (f) return f; }
        const ref = first(bg, 'bgRef');
        return ref ? clrOf(first(ref)) : '';
      };
      slide.bg = bgOf(root) || bgOf(layout) || bgOf(master) || '#ffffff';
      const media = id => {
        const r = rels[id];
        if (!r) return '';
        const f = resolve(sf, r.target), ext = (f.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
        if (!files[f]) return '';
        const url = toDataUrl(files[f], ext.toLowerCase());
        if (!url) { flags['imagens em formatos não suportados'] = 1; return ''; }
        const id2 = 'm' + (++mediaSeq); deck.media[id2] = url; return id2;
      };
      // transformação de grupos
      const walk = (tree, tf, own) => {
        kids(tree).forEach(n => {
          if (++count > MAX_SHAPES) throw new Error('apresentação grande demais para o LiteOffice');
          const L = n.localName;
          if (L === 'grpSp') {
            const gx = path(n, 'grpSpPr', 'xfrm');
            let t2 = tf;
            if (gx) {
              const off = first(gx, 'off'), ex = first(gx, 'ext'), co = first(gx, 'chOff'), ce = first(gx, 'chExt');
              const cx = +attr(ce, 'cx') || 1, cy = +attr(ce, 'cy') || 1;
              const sx = +attr(ex, 'cx') / cx, sy = +attr(ex, 'cy') / cy;
              t2 = { ox: tf.ox + (+attr(off, 'x') / E - (+attr(co, 'x') / E) * sx) * tf.sx, oy: tf.oy + (+attr(off, 'y') / E - (+attr(co, 'y') / E) * sy) * tf.sy, sx: tf.sx * sx, sy: tf.sy * sy };
            }
            walk(n, t2, own);
          } else if (L === 'sp' || L === 'pic' || L === 'cxnSp') {
            const s = shapeOf(n, L, tf, own);
            if (s) slide.shapes.push(s);
          } else if (L === 'graphicFrame') flags['tabelas, gráficos ou SmartArt'] = 1;
          else if (L === 'contentPart' || L === 'AlternateContent') flags['objetos incorporados'] = 1;
        });
      };
      const shapeOf = (n, L, tf, own) => {
        const nv = L === 'sp' ? first(n, 'nvSpPr') : L === 'pic' ? first(n, 'nvPicPr') : first(n, 'nvCxnSpPr');
        const phEl = path(nv, 'nvPr', 'ph');
        if (!own && phEl) return null;       // marcadores do modelo não aparecem se o slide não os usa
        const spPr = first(n, 'spPr');
        let xf = first(spPr, 'xfrm'), lyShape = null, maShape = null;
        if (phEl) {
          if (layout) lyShape = phMatch(phList(layout), phEl);
          if (master) maShape = phMatch(phList(master), phEl);
          if (!xf) xf = first(first(lyShape, 'spPr'), 'xfrm') || first(first(maShape, 'spPr'), 'xfrm');
        }
        if (!xf) return null;
        const off = first(xf, 'off'), ex = first(xf, 'ext');
        if (!off || !ex) return null;
        const sh = S.newShape('rect', {
          x: Math.round(tf.ox + +attr(off, 'x') / E * tf.sx), y: Math.round(tf.oy + +attr(off, 'y') / E * tf.sy),
          w: Math.max(1, Math.round(+attr(ex, 'cx') / E * tf.sx)), h: Math.max(0, Math.round(+attr(ex, 'cy') / E * tf.sy)), rot: (+attr(xf, 'rot') || 0) / 60000, flipV: attr(xf, 'flipV') === '1'
        });
        if (L === 'pic') {
          const blip = path(n, 'blipFill', 'blip');
          const id = blip ? media(blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')) : '';
          if (!id) return null;
          sh.t = 'image'; sh.img = id; return sh;
        }
        const prst = attr(first(spPr, 'prstGeom'), 'prst');
        const st = first(n, 'style');
        const ln = lineOf(spPr);
        if (L === 'cxnSp' || /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(prst)) {
          sh.t = ln && ln.arrow ? 'arrow' : 'line';
          sh.line = (ln && ln.c) || clrOf(first(first(st, 'lnRef'))) || '#333333'; sh.lw = (ln && ln.w) || 1.5; return sh;
        }
        if (prst === 'ellipse') sh.t = 'ellipse'; else if (prst && !/^(rect|roundRect|round1Rect|round2SameRect|flowChartProcess)$/.test(prst)) flags['formas especiais (viram retângulos)'] = 1;
        let fill = fillOf(spPr);
        if (fill === null && st && first(st, 'fillRef') && attr(first(st, 'fillRef'), 'idx') !== '0') fill = clrOf(first(first(st, 'fillRef'))) || '';
        sh.fill = fill || '';
        if (ln && ln.c !== null && ln.c !== undefined) { sh.line = ln.c; sh.lw = ln.w || 1; }
        else if (st && first(st, 'lnRef') && attr(first(st, 'lnRef'), 'idx') !== '0' && fill !== '') { sh.line = clrOf(first(first(st, 'lnRef'))) || ''; sh.lw = 1; }
        const tx = first(n, 'txBody');
        const txBox = attr(path(nv, 'cNvSpPr'), 'txBox') === '1' || !!phEl;
        if (tx) {
          const bp = first(tx, 'bodyPr');
          sh.anchor = attr(bp, 'anchor') === 'ctr' ? 'm' : attr(bp, 'anchor') === 'b' ? 'b' : 't';
          if (!attr(bp, 'anchor') && lyShape) { const a = attr(path(lyShape, 'txBody', 'bodyPr'), 'anchor') || attr(path(maShape, 'txBody', 'bodyPr'), 'anchor'); sh.anchor = a === 'ctr' ? 'm' : a === 'b' ? 'b' : 't'; }
          const scale = first(bp, 'normAutofit') && attr(first(bp, 'normAutofit'), 'fontScale') ? +attr(first(bp, 'normAutofit'), 'fontScale') / 100000 : 1;
          const type = phEl ? attr(phEl, 'type') || 'body' : '';
          const chain = [first(tx, 'lstStyle'), path(lyShape, 'txBody', 'lstStyle'), path(maShape, 'txBody', 'lstStyle')];
          const paras = kids(tx, 'p').map(p => {
            const pPr = first(p, 'pPr'), lvl = +attr(pPr, 'lvl') || 0, lvlName = 'lvl' + (lvl + 1) + 'pPr';
            const lv = chain.map(c => first(c, lvlName)).filter(Boolean).concat(lvl === 0 ? [styleOfMaster(type || 'other')] : [path(master, 'txStyles', type === 'title' || type === 'ctrTitle' ? 'titleStyle' : type ? 'bodyStyle' : 'otherStyle', lvlName)]).filter(Boolean);
            const fromChain = f => { for (const l of lv) { const v = f(l); if (v) return v; } return ''; };
            const para = { al: 'left', bul: false, runs: [] };
            const al = attr(pPr, 'algn') || fromChain(l => attr(l, 'algn'));
            para.al = al === 'ctr' ? 'center' : al === 'r' ? 'right' : al === 'just' ? 'justify' : 'left';
            const explicitNone = first(pPr, 'buNone'), explicitBu = first(pPr, 'buChar') || first(pPr, 'buAutoNum');
            para.bul = explicitBu ? true : explicitNone ? false : !!fromChain(l => (first(l, 'buChar') || first(l, 'buAutoNum') ? 'y' : '')) && !!phEl && type !== 'title' && type !== 'ctrTitle' && type !== 'subTitle';
            if (lvl > 0) flags['níveis de recuo nas listas'] = 1;
            const dr = fromChain(l => defRPr(l));
            kids(p).forEach(r => {
              if (r.localName === 'br') { para.runs.push({ t: '\n' }); return; }
              if (r.localName !== 'r' && r.localName !== 'fld') return;
              const rPr = first(r, 'rPr'), t = first(r, 't');
              if (!t) return;
              const run = { t: t.textContent };
              const szv = +attr(rPr, 'sz') || (dr ? +attr(dr, 'sz') : 0) || fromChain(l => (defRPr(l) && attr(defRPr(l), 'sz')) || '');
              run.sz = Math.round((+szv || 1800) / 100 * scale * 2) / 2;
              const bv = attr(rPr, 'b') || (dr && attr(dr, 'b')), iv = attr(rPr, 'i') || (dr && attr(dr, 'i'));
              if (bv === '1' || bv === 'true') run.b = true; if (iv === '1' || iv === 'true') run.i = true;
              const uv = attr(rPr, 'u'); if (uv && uv !== 'none') run.u = true;
              const sv = attr(rPr, 'strike'); if (sv && sv !== 'noStrike') run.s = true;
              const col = clrOf(first(first(rPr, 'solidFill'))) || clrOf(first(first(dr, 'solidFill')));
              if (col) run.c = col;
              const lat = first(rPr, 'latin'); if (lat && attr(lat, 'typeface') && attr(lat, 'typeface').charAt(0) !== '+') run.f = attr(lat, 'typeface');
              para.runs.push(run);
            });
            return para;
          });
          if (paras.some(p => p.runs.length)) { sh.text = paras; if (txBox && !sh.fill && !sh.line) sh.t = sh.t === 'ellipse' ? 'ellipse' : 'text'; }
        }
        if (sh.t === 'rect' && !sh.fill && !sh.line && !sh.text) return null;
        return sh;
      };
      // elementos do modelo e do mestre viram parte do slide
      const ident = { ox: 0, oy: 0, sx: 1, sy: 1 };
      if (attr(root, 'showMasterSp') !== '0') {
        if (master && !(layout && attr(layout, 'showMasterSp') === '0')) { const before = slide.shapes.length; walk(path(master, 'cSld', 'spTree'), ident, false); if (slide.shapes.length > before) flags['elementos do slide mestre (viram parte de cada slide)'] = 1; }
        if (layout) { const before = slide.shapes.length; walk(path(layout, 'cSld', 'spTree'), ident, false); if (slide.shapes.length > before) flags['elementos do slide mestre (viram parte de cada slide)'] = 1; }
      }
      walk(path(root, 'cSld', 'spTree'), ident, true);
      // notas
      const nk = Object.keys(rels).filter(k => /\/notesSlide$/.test(rels[k].type))[0];
      if (nk) {
        const nf = resolve(sf, rels[nk].target);
        if (files[nf]) {
          const nroot = parseXml(Z.text(files[nf])).documentElement;
          const body = kids(path(nroot, 'cSld', 'spTree'), 'sp').filter(sp => attr(path(sp, 'nvSpPr', 'nvPr', 'ph'), 'type') === 'body')[0];
          if (body) slide.notes = kids(first(body, 'txBody'), 'p').map(p => kids(p).map(r => (r.localName === 'r' ? ((first(r, 't') || {}).textContent || '') : r.localName === 'br' ? '\n' : '')).join('')).join('\n').trim();
          if (slide.notes) flags['notas do apresentador (só o formato .odp as mantém)'] = 1;
        }
      }
      if (first(root, 'transition') || first(root, 'timing')) flags['transições e animações'] = 1;
    }
    if (Object.keys(files).some(n => /^ppt\/(embeddings|charts|diagrams|media\/.*\.(mp4|mov|wmv|mp3|wav))/i.test(n))) flags['gráficos, vídeos ou objetos incorporados'] = 1;
    if (!deck.slides.length) deck.slides.push({ bg: '#ffffff', notes: '', shapes: [] });
    info.lossy = Object.keys(flags);
    return { deck: deck, info: info };
  }

  // ---- escrita do .pptx ----
  const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main', NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main', NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const emu = v => Math.round(v * E);
  const sRGB = c => '<a:solidFill><a:srgbClr val="' + c.slice(1).toUpperCase() + '"/></a:solidFill>';
  function runXml(r) {
    const parts = String(r.t).split('\n');
    return parts.map((t, i) => (i ? '<a:br><a:rPr lang="pt-BR"' + (r.sz ? ' sz="' + Math.round(r.sz * 100) + '"' : '') + '/></a:br>' : '') + (t === '' ? '' :
      '<a:r><a:rPr lang="pt-BR" sz="' + Math.round((r.sz || 18) * 100) + '"' + (r.b ? ' b="1"' : '') + (r.i ? ' i="1"' : '') + (r.u ? ' u="sng"' : '') + (r.s ? ' strike="sngStrike"' : '') + ' dirty="0">' +
      (r.c ? sRGB(r.c) : '') + (r.f ? '<a:latin typeface="' + xesc(r.f) + '"/>' : '') + '</a:rPr><a:t>' + xesc(t) + '</a:t></a:r>')).join('');
  }
  const paraXml = p => '<a:p><a:pPr algn="' + ({ center: 'ctr', right: 'r', justify: 'just' }[p.al] || 'l') + '"' + (p.bul ? ' marL="342900" indent="-342900"' : ' marL="0" indent="0"') + '>' +
    (p.bul ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : '<a:buNone/>') + '</a:pPr>' + p.runs.map(runXml).join('') + '<a:endParaRPr lang="pt-BR"' + (p.runs.length && p.runs[p.runs.length - 1].sz ? ' sz="' + Math.round(p.runs[p.runs.length - 1].sz * 100) + '"' : '') + '/></a:p>';
  function shapeXml(sh, id, rid) {
    const name = ({ text: 'Caixa de texto', rect: 'Retângulo', ellipse: 'Elipse', line: 'Linha', arrow: 'Seta', image: 'Imagem' })[sh.t] + ' ' + id;
    const xfrm = '<a:xfrm' + (sh.rot ? ' rot="' + Math.round(sh.rot * 60000) + '"' : '') + (sh.flipV ? ' flipV="1"' : '') + '><a:off x="' + emu(sh.x) + '" y="' + emu(sh.y) + '"/><a:ext cx="' + emu(Math.max(0, sh.w)) + '" cy="' + emu(Math.max(0, sh.h)) + '"/></a:xfrm>';
    if (sh.t === 'image') return '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="' + xesc(name) + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' + xfrm + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
    const lnXml = (sh.line ? '<a:ln w="' + emu(sh.lw || 1) + '">' + sRGB(sh.line) + (sh.t === 'arrow' ? '<a:tailEnd type="triangle"/>' : '') + '</a:ln>' : '<a:ln><a:noFill/></a:ln>');
    if (sh.t === 'line' || sh.t === 'arrow') return '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="' + id + '" name="' + xesc(name) + '"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>' + xfrm + '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>' + lnXml.replace('<a:ln><a:noFill/></a:ln>', '<a:ln w="19050">' + sRGB('#333333') + '</a:ln>') + '</p:spPr></p:cxnSp>';
    const geom = sh.t === 'ellipse' ? 'ellipse' : 'rect', anchor = sh.anchor === 'm' ? 'ctr' : sh.anchor === 'b' ? 'b' : 't';
    const tx = '<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="' + anchor + '"><a:noAutofit/></a:bodyPr><a:lstStyle/>' + (sh.text && sh.text.length ? sh.text.map(paraXml).join('') : '<a:p><a:endParaRPr lang="pt-BR"/></a:p>') + '</p:txBody>';
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + xesc(name) + '"/><p:cNvSpPr' + (sh.t === 'text' ? ' txBox="1"' : '') + '/><p:nvPr/></p:nvSpPr><p:spPr>' + xfrm + '<a:prstGeom prst="' + geom + '"><a:avLst/></a:prstGeom>' +
      (sh.fill ? sRGB(sh.fill) : '<a:noFill/>') + lnXml + '</p:spPr>' + tx + '</p:sp>';
  }
  const EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  const CLRS = [['dk1', '000000'], ['lt1', 'FFFFFF'], ['dk2', '44546A'], ['lt2', 'E7E6E6'], ['accent1', '4472C4'], ['accent2', 'ED7D31'], ['accent3', 'A5A5A5'], ['accent4', 'FFC000'], ['accent5', '5B9BD5'], ['accent6', '70AD47'], ['hlink', '0563C1'], ['folHlink', '954F72']];
  const THEME = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="' + NS_A + '" name="Office"><a:themeElements><a:clrScheme name="Office">' + CLRS.map(c => '<a:' + c[0] + '><a:srgbClr val="' + c[1] + '"/></a:' + c[0] + '>').join('') + '</a:clrScheme>' +
    '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="Office"><a:fillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:fillStyleLst><a:lnStyleLst>' + '<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'.repeat(3) +
    '</a:lnStyleLst><a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) + '</a:effectStyleLst><a:bgFillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';

  async function writePptx(deck) {
    const n = deck.slides.length;
    const entries = [], used = {};
    let mediaSeq = 0, dropped = 0;
    const slideFiles = deck.slides.map((sl, i) => {
      const rels = ['<Relationship Id="rId1" Type="' + NS_R + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'];
      let nextId = 2, rid = 2;
      const shapes = sl.shapes.map(sh => {
        let r = '';
        if (sh.t === 'image') {
          const media = fromDataUrl(deck.media[sh.img]);
          if (!media) { dropped++; return ''; }
          const key = sh.img;
          if (!used[key]) { used[key] = 'image' + (++mediaSeq) + '.' + EXT[media.type]; entries.push({ name: 'ppt/media/' + used[key], data: media.bytes, store: true }); }
          r = 'rId' + (rid++);
          rels.push('<Relationship Id="' + r + '" Type="' + NS_R + '/image" Target="../media/' + used[key] + '"/>');
        }
        return shapeXml(sh, ++nextId, r);
      }).join('');
      const bg = sl.bg && sl.bg !== '#ffffff' ? '<p:bg><p:bgPr>' + sRGB(sl.bg) + '<a:effectLst/></p:bgPr></p:bg>' : '';
      entries.push({ name: 'ppt/slides/slide' + (i + 1) + '.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '"><p:cSld>' + bg + '<p:spTree>' + EMPTY_TREE + shapes + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>' });
      entries.push({ name: 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>' });
      return i + 1;
    });
    const w = emu(deck.w), h = emu(deck.h);
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      slideFiles.map(i => '<Override PartName="/ppt/slides/slide' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('') + '</Types>';
    const REL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    const presXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' +
      slideFiles.map(i => '<p:sldId id="' + (255 + i) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</p:sldIdLst><p:sldSz cx="' + w + '" cy="' + h + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
    const master = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + EMPTY_TREE + '</p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';
    const layout = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '" type="blank" preserve="1"><p:cSld name="Em branco"><p:spTree>' + EMPTY_TREE + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
    const head = [
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: REL + '<Relationship Id="rId1" Type="' + NS_R + '/officeDocument" Target="ppt/presentation.xml"/></Relationships>' },
      { name: 'ppt/presentation.xml', data: presXml },
      { name: 'ppt/_rels/presentation.xml.rels', data: REL + '<Relationship Id="rId1" Type="' + NS_R + '/slideMaster" Target="slideMasters/slideMaster1.xml"/>' + slideFiles.map(i => '<Relationship Id="rId' + (i + 1) + '" Type="' + NS_R + '/slide" Target="slides/slide' + i + '.xml"/>').join('') +
        '<Relationship Id="rId' + (n + 2) + '" Type="' + NS_R + '/theme" Target="theme/theme1.xml"/></Relationships>' },
      { name: 'ppt/slideMasters/slideMaster1.xml', data: master },
      { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: REL + '<Relationship Id="rId1" Type="' + NS_R + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="' + NS_R + '/theme" Target="../theme/theme1.xml"/></Relationships>' },
      { name: 'ppt/slideLayouts/slideLayout1.xml', data: layout },
      { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: REL + '<Relationship Id="rId1" Type="' + NS_R + '/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>' },
      { name: 'ppt/theme/theme1.xml', data: THEME }
    ];
    const blob = await Z.write(head.concat(entries));
    return { blob: new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), droppedImages: dropped, notesDropped: deck.slides.some(s => s.notes) };
  }

  // =====================================================================================================================
  //                                                        ODP
  // =====================================================================================================================
  const NSO = { office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0', fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
    draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0', text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
    xlink: 'http://www.w3.org/1999/xlink', pres: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0' };
  const oa = (n, ns, l) => (n ? n.getAttributeNS(NSO[ns], l) || '' : '');
  const ODF_NS = 'xmlns:office="' + NSO.office + '" xmlns:style="' + NSO.style + '" xmlns:text="' + NSO.text + '" xmlns:draw="' + NSO.draw + '" xmlns:fo="' + NSO.fo + '" xmlns:svg="' + NSO.svg + '" xmlns:xlink="' + NSO.xlink + '" ' +
    'xmlns:presentation="' + NSO.pres + '" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"';

  async function readOdp(files) {
    if (!files['content.xml']) throw new Error('arquivo .odp inválido');
    const flags = {}, deck = S.newDeck(), info = { lossy: [] };
    const root = parseXml(Z.text(files['content.xml'])).documentElement;
    const styleRoot = files['styles.xml'] ? parseXml(Z.text(files['styles.xml'])).documentElement : null;
    const styles = {};
    [root, styleRoot].forEach(r => { if (r) [].forEach.call(r.getElementsByTagNameNS(NSO.style, 'style'), s => { styles[oa(s, 'style', 'family') + '|' + oa(s, 'style', 'name')] = s; }); });
    // tamanho da página
    const mp = styleRoot && [].filter.call(styleRoot.getElementsByTagNameNS(NSO.style, 'master-page'), m => true)[0];
    if (mp && styleRoot) {
      const plName = oa(mp, 'style', 'page-layout-name');
      [].forEach.call(styleRoot.getElementsByTagNameNS(NSO.style, 'page-layout'), pl => {
        if (oa(pl, 'style', 'name') !== plName) return;
        const pp = pl.getElementsByTagNameNS(NSO.style, 'page-layout-properties')[0];
        if (pp && lenPx(oa(pp, 'fo', 'page-width')) > 10) { deck.w = Math.round(lenPx(oa(pp, 'fo', 'page-width'))); deck.h = Math.round(lenPx(oa(pp, 'fo', 'page-height'))); }
      });
    }
    const props = (family, name, tag) => {
      const out = {}, seen = {};
      let cur = styles[family + '|' + name];
      const chain = [];
      while (cur && !seen[oa(cur, 'style', 'name')]) { seen[oa(cur, 'style', 'name')] = 1; chain.unshift(cur); const p = oa(cur, 'style', 'parent-style-name'); cur = p ? styles[family + '|' + p] : null; }
      chain.forEach(s => kids(s).forEach(k => { if (k.localName === tag) [].forEach.call(k.attributes, a => { out[a.localName] = a.value; }); }));
      return out;
    };
    let mediaSeq = 0, count = 0;
    const lenOr = v => (v ? lenPx(v) : 0);
    const textStyle = name => { const t = props('text', name, 'text-properties'); const out = {}; if (t['font-weight'] === 'bold') out.b = true; if (t['font-style'] === 'italic') out.i = true; if (t['text-underline-style'] && t['text-underline-style'] !== 'none') out.u = true; if (t['text-line-through-style'] && t['text-line-through-style'] !== 'none') out.s = true;
      if (/^#[0-9a-f]{6}$/i.test(t.color || '')) out.c = t.color.toLowerCase(); if (t['font-size'] && /pt$/.test(t['font-size'])) out.sz = Math.round(parseFloat(t['font-size']) * 2) / 2; const f = t['font-family'] || t['font-name']; if (f) out.f = f.replace(/['"]/g, ''); return out; };
    const paraAlign = name => { const a = props('paragraph', name, 'paragraph-properties')['text-align']; return a === 'center' ? 'center' : a === 'end' || a === 'right' ? 'right' : a === 'justify' ? 'justify' : 'left'; };
    const runsOf = (p, base, out, paraStyleRun) => {
      [].forEach.call(p.childNodes, c => {
        if (c.nodeType === 3) { if (c.nodeValue) out.push(Object.assign({ t: c.nodeValue }, paraStyleRun, base)); return; }
        if (c.nodeType !== 1) return;
        if (c.localName === 's') out.push(Object.assign({ t: ' '.repeat(+oa(c, 'text', 'c') || 1) }, paraStyleRun, base));
        else if (c.localName === 'tab') out.push(Object.assign({ t: '\t' }, paraStyleRun, base));
        else if (c.localName === 'line-break') out.push(Object.assign({ t: '\n' }, paraStyleRun, base));
        else if (c.localName === 'span' || c.localName === 'a') runsOf(c, Object.assign({}, base, textStyle(oa(c, 'text', 'style-name'))), out, paraStyleRun);
      });
    };
    const parasOf = box => {
      const out = [];
      const addP = (p, bul) => {
        const sn = oa(p, 'text', 'style-name'), para = { al: paraAlign(sn), bul: bul, runs: [] };
        runsOf(p, {}, para.runs, textStyle(sn));
        para.runs.forEach(r => { if (!r.sz) r.sz = 18; });
        out.push(para);
      };
      kids(box).forEach(c => {
        if (c.localName === 'p' || c.localName === 'h') addP(c, false);
        else if (c.localName === 'list') (function lst(l, lvl) { kids(l, 'list-item').forEach(li => kids(li).forEach(x => { if (x.localName === 'p') addP(x, true); else if (x.localName === 'list') { flags['níveis de recuo nas listas'] = 1; lst(x, lvl + 1); } })); })(c, 0);
      });
      return out;
    };
    const gfx = (el) => props('graphic', oa(el, 'draw', 'style-name'), 'graphic-properties');
    const boxOf = (el, tf) => {
      const x = lenOr(oa(el, 'svg', 'x')), y = lenOr(oa(el, 'svg', 'y')), w = lenOr(oa(el, 'svg', 'width')), h = lenOr(oa(el, 'svg', 'height'));
      return { x: Math.round(tf.ox + x), y: Math.round(tf.oy + y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
    };
    const slideNodes = [].slice.call(root.getElementsByTagNameNS(NSO.draw, 'page'));
    slideNodes.forEach(pg => {
      const slide = { bg: '#ffffff', notes: '', shapes: [] };
      deck.slides.push(slide);
      const dps = props('drawing-page', oa(pg, 'draw', 'style-name'), 'drawing-page-properties');
      if (dps.fill === 'solid' && /^#[0-9a-f]{6}$/i.test(dps['fill-color'] || '')) slide.bg = dps['fill-color'].toLowerCase();
      else if (dps.fill === 'gradient' || dps.fill === 'bitmap') flags['fundos ou formas com imagem ou degradê'] = 1;
      const place = (el, tf) => {
        if (++count > MAX_SHAPES) throw new Error('apresentação grande demais para o LiteOffice');
        const L = el.localName;
        if (L === 'g') { kids(el).forEach(c => place(c, tf)); return; }
        if (L === 'frame') {
          const b = boxOf(el, tf), img = first(el, 'image'), tb = first(el, 'text-box');
          if (img) {
            const href = oa(img, 'xlink', 'href'), f = files[href], ext = (href.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
            const url = f ? toDataUrl(f, ext.toLowerCase()) : '';
            if (!url) { flags['imagens em formatos não suportados'] = 1; return; }
            const id = 'm' + (++mediaSeq); deck.media[id] = url;
            slide.shapes.push(S.newShape('image', Object.assign(b, { img: id }))); return;
          }
          if (tb) {
            const g = gfx(el), cls = oa(el, 'pres', 'class');
            if (cls === 'notes') return;
            const sh = S.newShape('text', b);
            const gp = Object.keys(g).length ? g : props('presentation', oa(el, 'pres', 'style-name'), 'graphic-properties');
            if (gp.fill === 'solid' && /^#[0-9a-f]{6}$/i.test(gp['fill-color'] || '')) { sh.fill = gp['fill-color'].toLowerCase(); sh.t = 'rect'; }
            if (gp.stroke === 'solid') { sh.line = /^#[0-9a-f]{6}$/i.test(gp['stroke-color'] || '') ? gp['stroke-color'].toLowerCase() : '#000000'; sh.lw = Math.max(1, lenPx(gp['stroke-width'] || '0.02cm')); sh.t = 'rect'; }
            sh.anchor = gp['textarea-vertical-align'] === 'middle' ? 'm' : gp['textarea-vertical-align'] === 'bottom' ? 'b' : 't';
            sh.text = parasOf(tb);
            if (cls === 'outline') sh.text.forEach(p => { p.bul = true; });
            if (sh.text.length) slide.shapes.push(sh);
            return;
          }
          flags['vídeos, tabelas ou objetos incorporados'] = 1; return;
        }
        if (L === 'custom-shape' || L === 'rect' || L === 'ellipse' || L === 'circle') {
          const b = boxOf(el, tf), g = gfx(el), eg = first(el, 'enhanced-geometry');
          const kind = L === 'ellipse' || L === 'circle' || oa(eg, 'draw', 'type') === 'ellipse' ? 'ellipse' : 'rect';
          if (L === 'custom-shape' && eg && !/^(rectangle|ellipse|round-rectangle|flowchart-process|)$/.test(oa(eg, 'draw', 'type'))) flags['formas especiais (viram retângulos)'] = 1;
          const sh = S.newShape(kind, b);
          sh.fill = g.fill === 'solid' && /^#[0-9a-f]{6}$/i.test(g['fill-color'] || '') ? g['fill-color'].toLowerCase() : '';
          if (g.stroke === 'solid') { sh.line = /^#[0-9a-f]{6}$/i.test(g['stroke-color'] || '') ? g['stroke-color'].toLowerCase() : '#000000'; sh.lw = Math.max(1, lenPx(g['stroke-width'] || '0.02cm')); }
          sh.anchor = g['textarea-vertical-align'] === 'top' ? 't' : g['textarea-vertical-align'] === 'bottom' ? 'b' : 'm';
          const ps = parasOf(el); if (ps.length && ps.some(p => p.runs.length)) sh.text = ps;
          slide.shapes.push(sh); return;
        }
        if (L === 'line' || L === 'connector') {
          const g = gfx(el), x1 = tf.ox + lenOr(oa(el, 'svg', 'x1')), y1 = tf.oy + lenOr(oa(el, 'svg', 'y1')), x2 = tf.ox + lenOr(oa(el, 'svg', 'x2')), y2 = tf.oy + lenOr(oa(el, 'svg', 'y2'));
          const sh = S.newShape(g['marker-end'] ? 'arrow' : 'line', { x: Math.round(Math.min(x1, x2)), y: Math.round(Math.min(y1, y2)), w: Math.round(Math.abs(x2 - x1)), h: Math.round(Math.abs(y2 - y1)) });
          sh.flipV = (x2 - x1) * (y2 - y1) < 0;
          sh.line = /^#[0-9a-f]{6}$/i.test(g['stroke-color'] || '') ? g['stroke-color'].toLowerCase() : '#333333'; sh.lw = Math.max(1, lenPx(g['stroke-width'] || '0.03cm'));
          slide.shapes.push(sh); return;
        }
        if (L === 'notes' || L === 'page-thumbnail' || L === 'plugin') return;
        if (L === 'polygon' || L === 'polyline' || L === 'path' || L === 'regular-polygon' || L === 'control') flags['formas especiais (não aparecem)'] = 1;
      };
      kids(pg).forEach(c => { if (c.localName === 'notes') { slide.notes = [].map.call(c.getElementsByTagNameNS(NSO.text, 'p'), p => p.textContent).join('\n').trim(); return; } place(c, { ox: 0, oy: 0 }); });
      if (pg.getElementsByTagNameNS(NSO.pres, 'animations').length || pg.getElementsByTagNameNS(NSO.pres, 'show-transition').length || oa(pg, 'pres', 'transition-type')) flags['transições e animações'] = 1;
    });
    if (!deck.slides.length) deck.slides.push({ bg: '#ffffff', notes: '', shapes: [] });
    info.lossy = Object.keys(flags);
    return { deck: deck, info: info };
  }

  async function writeOdp(deck) {
    let auto = '', body = '', gi = 0, pi = 0, ti = 0, mediaSeq = 0, dropped = 0;
    const media = [], used = {};
    const pStyles = {}, tStyles = {};
    auto += '<text:list-style style:name="LB"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:space-before="0.3cm" text:min-label-width="0.6cm"/></text:list-level-style-bullet></text:list-style>';
    const paraStyle = al => { if (!pStyles[al]) { pStyles[al] = 'P' + (++pi); auto += '<style:style style:name="' + pStyles[al] + '" style:family="paragraph"><style:paragraph-properties fo:text-align="' + ({ center: 'center', right: 'end', justify: 'justify' }[al] || 'start') + '"/></style:style>'; } return pStyles[al]; };
    const runStyle = r => {
      const k = JSON.stringify([r.b, r.i, r.u, r.s, r.sz, r.c, r.f]);
      if (!tStyles[k]) { tStyles[k] = 'T' + (++ti); auto += '<style:style style:name="' + tStyles[k] + '" style:family="text"><style:text-properties fo:font-size="' + (r.sz || 18) + 'pt"' + (r.b ? ' fo:font-weight="bold"' : '') + (r.i ? ' fo:font-style="italic"' : '') + (r.u ? ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : '') + (r.s ? ' style:text-line-through-style="solid"' : '') + (r.c ? ' fo:color="' + r.c + '"' : '') + (r.f ? ' fo:font-family="' + xesc(r.f) + '"' : '') + '/></style:style>'; }
      return tStyles[k];
    };
    const runXmlO = r => String(r.t).split('\n').map(l => '<text:span text:style-name="' + runStyle(r) + '">' + xesc(l).replace(/ {2,}/g, sp => ' <text:s text:c="' + (sp.length - 1) + '"/>').replace(/\t/g, '<text:tab/>') + '</text:span>').join('<text:line-break/>');
    const textXml = paras => {
      let out = '', open = false;
      (paras || []).forEach(p => {
        const px = '<text:p text:style-name="' + paraStyle(p.al) + '">' + p.runs.map(runXmlO).join('') + '</text:p>';
        if (p.bul) { if (!open) { out += '<text:list text:style-name="LB">'; open = true; } out += '<text:list-item>' + px + '</text:list-item>'; }
        else { if (open) { out += '</text:list>'; open = false; } out += px; }
      });
      return out + (open ? '</text:list>' : '');
    };
    deck.slides.forEach((sl, si) => {
      const dp = 'dp' + (si + 1);
      auto += '<style:style style:name="' + dp + '" style:family="drawing-page"><style:drawing-page-properties presentation:background-visible="true" presentation:background-objects-visible="true" draw:background-size="border" draw:fill="solid" draw:fill-color="' + (sl.bg || '#ffffff') + '"/></style:style>';
      body += '<draw:page draw:name="Slide' + (si + 1) + '" draw:style-name="' + dp + '" draw:master-page-name="Default">';
      sl.shapes.forEach((sh, k) => {
        const g = 'gr' + (++gi), x = px2cm(sh.x), y = px2cm(sh.y), w = px2cm(Math.max(1, sh.w)), h = px2cm(Math.max(0, sh.h)), nm = 'Forma ' + (k + 1);
        if (sh.t === 'image') {
          const m = fromDataUrl(deck.media[sh.img]);
          if (!m) { dropped++; return; }
          if (!used[sh.img]) { used[sh.img] = 'Pictures/img' + (++mediaSeq) + '.' + EXT[m.type]; media.push({ name: used[sh.img], data: m.bytes, type: m.type }); }
          body += '<draw:frame draw:name="' + nm + '" svg:x="' + x + '" svg:y="' + y + '" svg:width="' + w + '" svg:height="' + h + '"><draw:image xlink:href="' + used[sh.img] + '" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>';
          return;
        }
        if (sh.t === 'line' || sh.t === 'arrow') {
          auto += '<style:style style:name="' + g + '" style:family="graphic"><style:graphic-properties draw:stroke="solid" svg:stroke-color="' + (sh.line || '#333333') + '" svg:stroke-width="' + px2cm(sh.lw || 1.5) + '"' + (sh.t === 'arrow' ? ' draw:marker-end="Arrow" draw:marker-end-width="0.3cm"' : '') + '/></style:style>';
          const x1 = sh.x, x2 = sh.x + sh.w, y1 = sh.flipV ? sh.y + sh.h : sh.y, y2 = sh.flipV ? sh.y : sh.y + sh.h;
          body += '<draw:line draw:style-name="' + g + '" draw:name="' + nm + '" svg:x1="' + px2cm(x1) + '" svg:y1="' + px2cm(y1) + '" svg:x2="' + px2cm(x2) + '" svg:y2="' + px2cm(y2) + '"/>';
          return;
        }
        auto += '<style:style style:name="' + g + '" style:family="graphic"><style:graphic-properties draw:fill="' + (sh.fill ? 'solid' : 'none') + '"' + (sh.fill ? ' draw:fill-color="' + sh.fill + '"' : '') + ' draw:stroke="' + (sh.line ? 'solid' : 'none') + '"' +
          (sh.line ? ' svg:stroke-color="' + sh.line + '" svg:stroke-width="' + px2cm(sh.lw || 1) + '"' : '') + ' draw:textarea-vertical-align="' + (sh.anchor === 'm' ? 'middle' : sh.anchor === 'b' ? 'bottom' : 'top') + '" draw:textarea-horizontal-align="left" draw:auto-grow-height="false" fo:padding-top="0.12cm" fo:padding-bottom="0.12cm" fo:padding-left="0.25cm" fo:padding-right="0.25cm"/></style:style>';
        if (sh.t === 'text') body += '<draw:frame draw:style-name="' + g + '" draw:name="' + nm + '" svg:x="' + x + '" svg:y="' + y + '" svg:width="' + w + '" svg:height="' + h + '"><draw:text-box>' + textXml(sh.text) + '</draw:text-box></draw:frame>';
        else body += '<draw:custom-shape draw:style-name="' + g + '" draw:name="' + nm + '" svg:x="' + x + '" svg:y="' + y + '" svg:width="' + w + '" svg:height="' + h + '">' + textXml(sh.text) +
          '<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="' + (sh.t === 'ellipse' ? 'ellipse' : 'rectangle') + '" draw:enhanced-path="' + (sh.t === 'ellipse' ? 'U 10800 10800 10800 10800 0 360 Z N' : 'M 0 0 L 21600 0 21600 21600 0 21600 0 0 Z N') + '"/></draw:custom-shape>';
      });
      if (sl.notes) body += '<presentation:notes draw:style-name="dp' + (si + 1) + '"><draw:page-thumbnail draw:page-number="' + (si + 1) + '" svg:x="1cm" svg:y="1cm" svg:width="10cm" svg:height="6cm"/><draw:frame presentation:class="notes" svg:x="1cm" svg:y="8cm" svg:width="18cm" svg:height="10cm"><draw:text-box>' +
        sl.notes.split('\n').map(l => '<text:p>' + xesc(l) + '</text:p>').join('') + '</draw:text-box></draw:frame></presentation:notes>';
      body += '</draw:page>';
    });
    const content = '<?xml version="1.0" encoding="UTF-8"?><office:document-content ' + ODF_NS + ' office:version="1.2"><office:automatic-styles>' + auto + '</office:automatic-styles><office:body><office:presentation>' + body + '</office:presentation></office:body></office:document-content>';
    const styles = '<?xml version="1.0" encoding="UTF-8"?><office:document-styles ' + ODF_NS + ' office:version="1.2"><office:styles><draw:marker draw:name="Arrow" svg:viewBox="0 0 20 30" svg:d="m10 0-10 30h20z"/></office:styles>' +
      '<office:automatic-styles><style:page-layout style:name="PL1"><style:page-layout-properties fo:page-width="' + px2cm(deck.w) + '" fo:page-height="' + px2cm(deck.h) + '" fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" style:print-orientation="landscape"/></style:page-layout></office:automatic-styles>' +
      '<office:master-styles><style:master-page style:name="Default" style:page-layout-name="PL1"/></office:master-styles></office:document-styles>';
    const manifest = '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.presentation"/>' +
      ['content.xml', 'styles.xml', 'meta.xml'].map(f => '<manifest:file-entry manifest:full-path="' + f + '" manifest:media-type="text/xml"/>').join('') + media.map(m => '<manifest:file-entry manifest:full-path="' + m.name + '" manifest:media-type="' + m.type + '"/>').join('') + '</manifest:manifest>';
    const meta = '<?xml version="1.0" encoding="UTF-8"?><office:document-meta ' + ODF_NS + ' office:version="1.2"><office:meta><meta:generator>Central Diogo Desktop</meta:generator><meta:creation-date>' + new Date().toISOString() + '</meta:creation-date></office:meta></office:document-meta>';
    const blob = await Z.write([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.presentation', store: true }, { name: 'content.xml', data: content }, { name: 'styles.xml', data: styles },
      { name: 'meta.xml', data: meta }, { name: 'META-INF/manifest.xml', data: manifest }].concat(media.map(m => ({ name: m.name, data: m.data, store: true }))));
    return { blob: new Blob([blob], { type: 'application/vnd.oasis.opendocument.presentation' }), droppedImages: dropped, notesDropped: false };
  }

  S.read = async function (buf, name) {
    const files = await Z.read(buf);
    return DK.extOf(name) === '.odp' ? readOdp(files) : readPptx(files);
  };
  S.write = (deck, name) => (DK.extOf(name) === '.odp' ? writeOdp(deck) : writePptx(deck));
})(window.DK = window.DK || {});
