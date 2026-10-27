(function (DK) {
  // Conversão entre a planilha do LiteOffice e os pacotes .xlsx (Excel) e .ods (LibreOffice/OpenDocument).
  // Modelo: book = { sheets: [ { name, cells: { 'r,c': { v, f, s } }, colW: { c: px }, rowH: { r: px }, merges: [ { r1, c1, r2, c2 } ], freeze: { r, c } | null } ], styles: [ estilo ], active }
  //   v = valor (número, texto, booleano ou erro; nas fórmulas, o último valor calculado), f = fórmula no formato do Excel (sem "="), s = índice em styles.
  //   estilo = { b, i, u, st (tachado), c (cor do texto #rrggbb), bg (fundo), al (left|center|right), wrap, bd (bordas), nf (formato numérico no estilo do Excel) }
  // O que se mantém: valores, fórmulas, várias abas, negrito/itálico/sublinhado/tachado, cores, alinhamento, quebra de linha, bordas, formatos de número e data,
  // larguras e alturas, células mescladas e painéis congelados (só no .xlsx). O que NÃO se mantém: gráficos, imagens, tabelas dinâmicas, comentários, macros,
  // formatação condicional, validação de dados e filtros; read() avisa o que encontrou (info.lossy).
  const Z = DK.zip, C = DK.calc;
  const F = DK.sheetfmt = {};

  const xesc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function parseXml(text) {
    const d = new DOMParser().parseFromString(text, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('o conteúdo da planilha está corrompido');
    return d;
  }
  const kids = (n, local) => (n ? [].filter.call(n.childNodes, c => c.nodeType === 1 && (!local || c.localName === local)) : []);
  const first = (n, local) => kids(n, local)[0] || null;
  const MAX_CELLS = 600000;

  // ---------- modelo ----------
  F.newSheet = name => ({ name: name, cells: {}, colW: {}, rowH: {}, merges: [], freeze: null });
  F.newBook = () => ({ sheets: [F.newSheet('Planilha1')], styles: [{}], active: 0 });
  F.styleId = function (book, st) {
    const k = {};
    Object.keys(st).sort().forEach(x => { if (st[x]) k[x] = st[x]; });
    const j = JSON.stringify(k);
    for (let i = 0; i < book.styles.length; i++) if (JSON.stringify(book.styles[i]) === j) return i;
    book.styles.push(k); return book.styles.length - 1;
  };
  F.usedRange = function (sh) {
    let r = -1, c = -1;
    Object.keys(sh.cells).forEach(k => { const p = k.split(','); if (+p[0] > r) r = +p[0]; if (+p[1] > c) c = +p[1]; });
    return { rows: r + 1, cols: c + 1 };
  };
  const key = (r, c) => r + ',' + c;
  const hexColor = v => (v && /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : '');
  const px2cm = px => (px / 96 * 2.54).toFixed(3) + 'cm';
  const lenPx = s => { const m = /^([\d.]+)\s*(cm|mm|in|pt|px)?$/.exec(String(s || '')); if (!m) return 0; const k = { cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, px: 1 }[m[2] || 'px']; return Math.round(+m[1] * k); };

  // Funções que o motor não conhece: a célula guarda o último valor calculado pelo programa de origem.
  function unknownFns(ast, out) {
    if (!ast) return out;
    if (ast.t === 'call' && C.functions.indexOf(ast.name.replace(/^_XLFN\./i, '')) < 0) out[ast.name] = 1;
    if (ast.a) unknownFns(ast.a, out);
    if (ast.b) unknownFns(ast.b, out);
    (ast.args || []).forEach(x => unknownFns(x, out));
    return out;
  }
  function noteFormula(book, info, cell) {
    const ast = C.parse(cell.f);
    if (ast.t === 'err' || Object.keys(unknownFns(ast, {})).length) { cell.keep = true; info.unsupported = true; }
  }

  // ---------- formatos de número: Excel <-> OpenDocument ----------
  const BUILTIN = { 0: '', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 14: 'dd/mm/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
    20: 'h:mm', 21: 'h:mm:ss', 22: 'dd/mm/yyyy hh:mm', 37: '#,##0;-#,##0', 38: '#,##0;-#,##0', 39: '#,##0.00;-#,##0.00', 40: '#,##0.00;-#,##0.00', 44: '#,##0.00', 45: 'mm:ss', 46: 'h:mm:ss', 47: 'mm:ss', 49: '@' };
  const isTimeOnly = nf => C.isDateFmt(nf) && !/y|d|mmm|(^|[^h:])m(?![ms:])/i.test(nf.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && /h|s/i.test(nf);

  function nfParts(nf) {      // { pre, pat, post, pct } do primeiro trecho do formato numérico
    const sec = nf.split(';')[0], tok = sec.match(/"[^"]*"|\\.|\[[^\]]*\]|[#0?,.%]+|[^"\\[#0?,.%]+/g) || [];
    let pre = '', post = '', pat = '', pct = false, seen = false;
    tok.forEach(t => {
      if (/^[#0?,.%]+$/.test(t)) {
        if (t.indexOf('%') >= 0) pct = true;
        const core = t.replace(/%/g, '');
        if (core) { pat += core; seen = true; }
        return;
      }
      const lit = t[0] === '"' ? t.slice(1, -1) : t[0] === '\\' ? t.slice(1) : t[0] === '[' ? (/^\[\$([^\]-]*)/.exec(t) || [0, ''])[1] : t;
      if (seen) post += lit; else pre += lit;
    });
    return { pre: pre, pat: pat, post: post, pct: pct, seen: seen };
  }
  function odsDataStyle(nf, name) {
    const txt = s => (s ? '<number:text>' + xesc(s) + '</number:text>' : '');
    if (C.isDateFmt(nf)) {
      const time = isTimeOnly(nf);
      const toks = nf.split(';')[0].match(/"[^"]*"|\\.|\[[^\]]*\]|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|./gi) || [];
      let prevH = false, body = '';
      toks.forEach((t, k) => {
        const l = t.toLowerCase();
        if (l === 'yyyy') body += '<number:year number:style="long"/>'; else if (l === 'yy') body += '<number:year/>';
        else if (l === 'mmmm') body += '<number:month number:textual="true" number:style="long"/>'; else if (l === 'mmm') body += '<number:month number:textual="true"/>';
        else if (l === 'mm' || l === 'm') {
          const isMin = prevH || (toks.slice(k + 1).some(x => /^s+$/i.test(x)) && !toks.slice(k + 1).some(x => /^(y|d)/i.test(x)));
          body += isMin ? '<number:minutes' + (l === 'mm' ? ' number:style="long"' : '') + '/>' : '<number:month' + (l === 'mm' ? ' number:style="long"' : '') + '/>';
        }
        else if (l === 'dddd') body += '<number:day-of-week number:style="long"/>'; else if (l === 'ddd') body += '<number:day-of-week/>';
        else if (l === 'dd') body += '<number:day number:style="long"/>'; else if (l === 'd') body += '<number:day/>';
        else if (l === 'hh') body += '<number:hours number:style="long"/>'; else if (l === 'h') body += '<number:hours/>';
        else if (l === 'ss') body += '<number:seconds number:style="long"/>'; else if (l === 's') body += '<number:seconds/>';
        else if (l === 'am/pm' || l === 'a/p') body += '<number:am-pm/>';
        else if (t[0] === '[') { /* ignora */ }
        else body += txt(t[0] === '"' ? t.slice(1, -1) : t[0] === '\\' ? t.slice(1) : t);
        prevH = l === 'h' || l === 'hh';
      });
      return '<number:' + (time ? 'time' : 'date') + '-style style:name="' + name + '">' + body + '</number:' + (time ? 'time' : 'date') + '-style>';
    }
    const p = nfParts(nf);
    if (!p.seen && !p.pct) return '';
    const dot = p.pat.indexOf('.'), ip = dot < 0 ? p.pat : p.pat.slice(0, dot), dp = dot < 0 ? '' : p.pat.slice(dot + 1);
    const num = '<number:number number:decimal-places="' + dp.replace(/,/g, '').length + '" number:min-integer-digits="' + Math.max(1, (ip.match(/0/g) || []).length) + '"' + (ip.indexOf(',') >= 0 ? ' number:grouping="true"' : '') + '/>';
    if (p.pct) return '<number:percentage-style style:name="' + name + '">' + txt(p.pre) + num + '<number:text>%</number:text>' + txt(p.post) + '</number:percentage-style>';
    return '<number:number-style style:name="' + name + '">' + txt(p.pre) + num + txt(p.post) + '</number:number-style>';
  }
  function nfFromOds(el) {
    const L = el.localName, parts = kids(el);
    const lit = s => (/^[\/\-:. ,]+$/.test(s) ? s : '"' + s.replace(/"/g, '') + '"');
    if (L === 'date-style' || L === 'time-style') {
      let out = '';
      parts.forEach(p => {
        const lg = p.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0', 'style') === 'long';
        switch (p.localName) {
          case 'year': out += lg ? 'yyyy' : 'yy'; break;
          case 'month': out += p.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0', 'textual') === 'true' ? (lg ? 'mmmm' : 'mmm') : (lg ? 'mm' : 'm'); break;
          case 'day': out += lg ? 'dd' : 'd'; break;
          case 'day-of-week': out += lg ? 'dddd' : 'ddd'; break;
          case 'hours': out += lg ? 'hh' : 'h'; break;
          case 'minutes': out += lg ? 'mm' : 'm'; break;
          case 'seconds': out += lg ? 'ss' : 's'; break;
          case 'am-pm': out += 'AM/PM'; break;
          case 'text': out += lit(p.textContent); break;
        }
      });
      return out;
    }
    if (L !== 'number-style' && L !== 'percentage-style' && L !== 'currency-style') return '';
    let pre = '', post = '', pat = '', seen = false;
    parts.forEach(p => {
      if (p.localName === 'number' || p.localName === 'scientific-number') {
        const dp = +p.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0', 'decimal-places') || 0, mi = +p.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0', 'min-integer-digits') || 1;
        const grp = p.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0', 'grouping') === 'true';
        pat = (grp ? '#,' + '#'.repeat(Math.max(0, 3 - mi)) + '0'.repeat(Math.max(1, Math.min(mi, 3))) : '0'.repeat(mi)) + (dp ? '.' + '0'.repeat(dp) : '') + (p.localName === 'scientific-number' ? 'E+00' : '');
        seen = true;
      } else if (p.localName === 'text' || p.localName === 'currency-symbol') {
        const t = p.textContent;
        const s = t === '%' ? '%' : lit(t);
        if (seen) post += s; else pre += s;
      }
    });
    if (!seen) return '';
    return pre + pat + post;
  }

  // =====================================================================================================================
  //                                                       XLSX
  // =====================================================================================================================
  const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const argb = v => (v && /^[0-9a-f]{8}$/i.test(v) ? hexColor(v.slice(2)) : '');

  function xlsxStyles(files, book) {
    const out = { xf: [] };
    if (!files['xl/styles.xml']) return out;
    const d = parseXml(Z.text(files['xl/styles.xml'])).documentElement;
    const nfmt = {};
    kids(first(d, 'numFmts'), 'numFmt').forEach(n => { nfmt[n.getAttribute('numFmtId')] = n.getAttribute('formatCode'); });
    const fonts = kids(first(d, 'fonts'), 'font').map(f => {
      const o = {};
      const on = n => { const e = first(f, n); return !!e && e.getAttribute('val') !== '0' && e.getAttribute('val') !== 'false'; };
      if (on('b')) o.b = true; if (on('i')) o.i = true; if (on('strike')) o.st = true;
      const u = first(f, 'u'); if (u && u.getAttribute('val') !== 'none') o.u = true;
      const c = first(f, 'color'); if (c && argb(c.getAttribute('rgb')) && argb(c.getAttribute('rgb')) !== '#000000') o.c = argb(c.getAttribute('rgb'));
      return o;
    });
    const fills = kids(first(d, 'fills'), 'fill').map(f => {
      const p = first(f, 'patternFill');
      if (!p || p.getAttribute('patternType') !== 'solid') return '';
      const fg = first(p, 'fgColor');
      return fg ? argb(fg.getAttribute('rgb')) : '';
    });
    const borders = kids(first(d, 'borders'), 'border').map(b => ['left', 'right', 'top', 'bottom'].some(s => { const e = first(b, s); return e && e.getAttribute('style'); }));
    kids(first(d, 'cellXfs'), 'xf').forEach(x => {
      const st = {}, nid = x.getAttribute('numFmtId') || '0';
      Object.assign(st, fonts[+x.getAttribute('fontId') || 0] || {});
      const bg = fills[+x.getAttribute('fillId') || 0]; if (bg) st.bg = bg;
      if (borders[+x.getAttribute('borderId') || 0]) st.bd = true;
      const nf = nfmt[nid] !== undefined ? nfmt[nid] : BUILTIN[nid];
      if (nf && nf !== 'General') st.nf = nf;
      const al = first(x, 'alignment');
      if (al) { const h = al.getAttribute('horizontal'); if (h === 'left' || h === 'center' || h === 'right') st.al = h; if (al.getAttribute('wrapText') === '1' || al.getAttribute('wrapText') === 'true') st.wrap = true; }
      out.xf.push(F.styleId(book, st));
    });
    return out;
  }
  const textOf = si => { let s = ''; (function walk(n) { kids(n).forEach(c => { if (c.localName === 't') s += c.textContent; else if (c.localName !== 'rPh' && c.localName !== 'phoneticPr') walk(c); }); })(si); return s; };

  async function readXlsx(files) {
    const info = { lossy: [], unsupported: false };
    const book = { sheets: [], styles: [{}], active: 0 };
    if (!files['xl/workbook.xml']) throw new Error('arquivo .xlsx inválido');
    const wbx = parseXml(Z.text(files['xl/workbook.xml'])).documentElement;
    const rels = {};
    if (files['xl/_rels/workbook.xml.rels']) kids(parseXml(Z.text(files['xl/_rels/workbook.xml.rels'])).documentElement, 'Relationship').forEach(r => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const shared = [];
    if (files['xl/sharedStrings.xml']) kids(parseXml(Z.text(files['xl/sharedStrings.xml'])).documentElement, 'si').forEach(si => shared.push(textOf(si)));
    const sty = xlsxStyles(files, book);
    const pr = first(wbx, 'workbookPr');
    if (pr && (pr.getAttribute('date1904') === '1' || pr.getAttribute('date1904') === 'true')) info.lossy.push('datas no sistema 1904 (podem aparecer 4 anos deslocadas)');
    const flags = {};
    let total = 0;
    for (const sEl of kids(first(wbx, 'sheets'), 'sheet')) {
      const rid = sEl.getAttributeNS(NS_R, 'id');
      let target = rels[rid] || '';
      target = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target;
      const sh = F.newSheet(sEl.getAttribute('name') || 'Planilha' + (book.sheets.length + 1));
      book.sheets.push(sh);
      if (!files[target]) continue;       // aba de gráfico ou vazia
      const txt = Z.text(files[target]);
      if (/<conditionalFormatting/.test(txt)) flags['formatação condicional'] = 1;
      if (/<dataValidations/.test(txt)) flags['validação de dados'] = 1;
      if (/<autoFilter/.test(txt)) flags['filtros'] = 1;
      if (/<drawing /.test(txt)) flags['gráficos ou imagens'] = 1;
      if (/<legacyDrawing/.test(txt)) flags['comentários'] = 1;
      const root = parseXml(txt).documentElement;
      kids(first(root, 'cols'), 'col').forEach(c => {
        const w = Math.round(((+c.getAttribute('width') || 0) * 7 + 5)), lo = +c.getAttribute('min') - 1, hi = Math.min(+c.getAttribute('max') - 1, lo + 200);
        if (w > 5 && c.getAttribute('hidden') !== '1') for (let i = lo; i <= hi; i++) sh.colW[i] = w;
      });
      const pane = first(first(first(root, 'sheetViews'), 'sheetView'), 'pane');
      if (pane && pane.getAttribute('state') && /frozen/.test(pane.getAttribute('state'))) sh.freeze = { r: +pane.getAttribute('ySplit') || 0, c: +pane.getAttribute('xSplit') || 0 };
      kids(first(root, 'mergeCells'), 'mergeCell').forEach(m => {
        const p = (m.getAttribute('ref') || '').split(':'), a = C.parseAddr(p[0]), b = C.parseAddr(p[1] || p[0]);
        if (a && b) sh.merges.push({ r1: a.r, c1: a.c, r2: b.r, c2: b.c });
      });
      const masters = {};
      let rowSeq = 0;
      kids(first(root, 'sheetData'), 'row').forEach(row => {
        const r = (+row.getAttribute('r') || (rowSeq + 1)) - 1; rowSeq = r + 1;
        if (row.getAttribute('ht') && row.getAttribute('customHeight') !== '0') { const h = Math.round(+row.getAttribute('ht') / 0.75); if (h > 4) sh.rowH[r] = h; }
        let colSeq = 0;
        kids(row, 'c').forEach(c => {
          const a = C.parseAddr(c.getAttribute('r') || ''), cc = a ? a.c : colSeq; colSeq = cc + 1;
          const t = c.getAttribute('t') || 'n', vEl = first(c, 'v'), fEl = first(c, 'f'), s = sty.xf[+c.getAttribute('s') || 0] || 0;
          let v = null;
          const raw = vEl ? vEl.textContent : '';
          if (t === 's') v = shared[+raw] !== undefined ? shared[+raw] : '';
          else if (t === 'str') v = raw;
          else if (t === 'inlineStr') v = textOf(first(c, 'is') || c);
          else if (t === 'b') v = raw === '1';
          else if (t === 'e') v = C.errFrom(raw);
          else if (t === 'd') { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw); v = m ? C.serialOf(+m[1], +m[2], +m[3]) : null; }
          else if (raw !== '') { v = parseFloat(raw); if (isNaN(v)) v = null; }
          const cell = {};
          if (v !== null && v !== '') cell.v = v; else if (v === '' && !fEl) cell.v = '';
          if (fEl) {
            let f = fEl.textContent;
            if (fEl.getAttribute('t') === 'shared') {
              const si = fEl.getAttribute('si');
              if (f) masters[si] = { ast: C.parse(f), r: r, c: cc };
              else if (masters[si]) f = C.unparse(C.shift(masters[si].ast, r - masters[si].r, cc - masters[si].c));
            }
            if (f) { cell.f = f; if (cell.v === undefined) cell.v = null; noteFormula(book, info, cell); }
          }
          if (s) cell.s = s;
          if (cell.v !== undefined || cell.f || cell.s) { sh.cells[key(r, cc)] = cell; if (++total > MAX_CELLS) throw new Error('planilha grande demais para o LiteOffice (mais de ' + MAX_CELLS + ' células)'); }
        });
      });
    }
    Object.keys(files).forEach(n => {
      if (/^xl\/(charts|drawings|media)\//.test(n)) flags['gráficos ou imagens'] = 1;
      if (/^xl\/pivot/.test(n)) flags['tabelas dinâmicas'] = 1;
      if (/^xl\/(comments|threadedComments)/.test(n)) flags['comentários'] = 1;
      if (/vbaProject/.test(n)) flags['macros'] = 1;
    });
    info.lossy = info.lossy.concat(Object.keys(flags));
    if (info.unsupported) info.lossy.push('fórmulas com funções que o LiteOffice não calcula (mantêm o último valor)');
    if (!book.sheets.length) book.sheets.push(F.newSheet('Planilha1'));
    return { book: book, info: info };
  }

  async function writeXlsx(book) {
    // estilos
    const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>', '<border><left style="thin"><color rgb="FF9AA4B2"/></left><right style="thin"><color rgb="FF9AA4B2"/></right><top style="thin"><color rgb="FF9AA4B2"/></top><bottom style="thin"><color rgb="FF9AA4B2"/></bottom><diagonal/></border>'];
    const numFmts = [], idx = {};
    const get = (arr, x) => { let i = arr.indexOf(x); if (i < 0) { arr.push(x); i = arr.length - 1; } return i; };
    const xfs = book.styles.map(s => {
      const f = '<font>' + (s.b ? '<b/>' : '') + (s.i ? '<i/>' : '') + (s.st ? '<strike/>' : '') + (s.u ? '<u/>' : '') + '<sz val="11"/>' + (s.c ? '<color rgb="FF' + s.c.slice(1) + '"/>' : '') + '<name val="Calibri"/></font>';
      const fi = get(fonts, f), fl = s.bg ? get(fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + s.bg.slice(1) + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
      let nid = 0;
      if (s.nf) {
        const std = Object.keys(BUILTIN).filter(k => BUILTIN[k] === s.nf && +k !== 14 && +k < 40)[0];
        if (std) nid = +std; else { if (!(s.nf in idx)) { idx[s.nf] = 164 + numFmts.length; numFmts.push(s.nf); } nid = idx[s.nf]; }
      }
      const al = (s.al || s.wrap) ? '<alignment' + (s.al ? ' horizontal="' + s.al + '"' : '') + (s.wrap ? ' wrapText="1"' : '') + '/>' : '';
      return '<xf numFmtId="' + nid + '" fontId="' + fi + '" fillId="' + fl + '" borderId="' + (s.bd ? 1 : 0) + '" xfId="0"' + (nid ? ' applyNumberFormat="1"' : '') + ' applyFont="1"' + (fl ? ' applyFill="1"' : '') + (s.bd ? ' applyBorder="1"' : '') + (al ? ' applyAlignment="1">' + al + '</xf>' : '/>');
    });
    const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' + NS_MAIN + '">' +
      (numFmts.length ? '<numFmts count="' + numFmts.length + '">' + numFmts.map((n, i) => '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + xesc(n) + '"/>').join('') + '</numFmts>' : '') +
      '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts><fills count="' + fills.length + '">' + fills.join('') + '</fills><borders count="' + borders.length + '">' + borders.join('') + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

    const sheetXml = sh => {
      const rows = {};
      Object.keys(sh.cells).forEach(k => { const p = k.split(','); (rows[p[0]] = rows[p[0]] || []).push([+p[1], sh.cells[k]]); });
      Object.keys(sh.rowH).forEach(r => { rows[r] = rows[r] || []; });
      const used = F.usedRange(sh);
      let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="' + NS_MAIN + '" xmlns:r="' + NS_R + '">';
      x += '<dimension ref="A1' + (used.rows ? ':' + C.addr(used.rows - 1, used.cols - 1) : '') + '"/>';
      const tab = book.sheets.indexOf(sh) === book.active ? ' tabSelected="1"' : '';
      x += '<sheetViews><sheetView workbookViewId="0"' + tab + '>' + (sh.freeze && (sh.freeze.r || sh.freeze.c) ?
        '<pane' + (sh.freeze.c ? ' xSplit="' + sh.freeze.c + '"' : '') + (sh.freeze.r ? ' ySplit="' + sh.freeze.r + '"' : '') + ' topLeftCell="' + C.addr(sh.freeze.r, sh.freeze.c) + '" activePane="' + (sh.freeze.r && sh.freeze.c ? 'bottomRight' : sh.freeze.r ? 'bottomLeft' : 'topRight') + '" state="frozen"/>' : '') + '</sheetView></sheetViews>';
      x += '<sheetFormatPr defaultRowHeight="15" defaultColWidth="11.4"/>';
      const cw = Object.keys(sh.colW).map(Number).sort((a, b) => a - b);
      if (cw.length) x += '<cols>' + cw.map(c => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + (Math.max(1, (sh.colW[c] - 5) / 7)).toFixed(2) + '" customWidth="1"/>').join('') + '</cols>';
      x += '<sheetData>';
      Object.keys(rows).map(Number).sort((a, b) => a - b).forEach(r => {
        x += '<row r="' + (r + 1) + '"' + (sh.rowH[r] ? ' ht="' + (sh.rowH[r] * 0.75).toFixed(2) + '" customHeight="1"' : '') + '>';
        rows[r].sort((a, b) => a[0] - b[0]).forEach(([c, cell]) => {
          const a = C.addr(r, c), s = cell.s ? ' s="' + cell.s + '"' : '', v = cell.v;
          let t = '', body = '';
          if (v instanceof C.FErr) { t = ' t="e"'; body = '<v>' + xesc(v.c) + '</v>'; }
          else if (typeof v === 'boolean') { t = ' t="b"'; body = '<v>' + (v ? 1 : 0) + '</v>'; }
          else if (typeof v === 'number') body = '<v>' + v + '</v>';
          else if (typeof v === 'string') { if (cell.f) { t = ' t="str"'; body = '<v>' + xesc(v) + '</v>'; } else { t = ' t="inlineStr"'; body = '<is><t xml:space="preserve">' + xesc(v) + '</t></is>'; } }
          if (cell.f) body = '<f>' + xesc(cell.f) + '</f>' + body;
          x += '<c r="' + a + '"' + s + t + (body ? '>' + body + '</c>' : '/>');
        });
        x += '</row>';
      });
      x += '</sheetData>';
      if (sh.merges.length) x += '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map(m => '<mergeCell ref="' + C.addr(m.r1, m.c1) + ':' + C.addr(m.r2, m.c2) + '"/>').join('') + '</mergeCells>';
      return x + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
    };
    const n = book.sheets.length;
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      book.sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>';
    const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS_REL + '"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    const wbXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_R + '"><bookViews><workbookView activeTab="' + book.active + '"/></bookViews><sheets>' +
      book.sheets.map((s, i) => '<sheet name="' + xesc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
    const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS_REL + '">' +
      book.sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    const blob = await Z.write([{ name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rootRels }, { name: 'xl/workbook.xml', data: wbXml }, { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
      { name: 'xl/styles.xml', data: stylesXml }].concat(book.sheets.map((s, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s) }))));
    return { blob: new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) };
  }

  // =====================================================================================================================
  //                                                       ODS
  // =====================================================================================================================
  const NSO = { office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0', style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
    fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0', text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0' };
  const oa = (n, ns, l) => n.getAttributeNS(NSO[ns], l) || '';
  function odsText(p) {
    let s = '';
    (function walk(n) {
      [].forEach.call(n.childNodes, c => {
        if (c.nodeType === 3) s += c.nodeValue;
        else if (c.nodeType === 1) {
          if (c.localName === 's') s += ' '.repeat(+oa(c, 'text', 'c') || 1);
          else if (c.localName === 'tab') s += '\t';
          else if (c.localName === 'line-break') s += '\n';
          else walk(c);
        }
      });
    })(p);
    return s;
  }
  function odsCellStyles(files, book) {
    const styles = {}, dataStyles = {};
    ['content.xml', 'styles.xml'].forEach(f => {
      if (!files[f]) return;
      const root = parseXml(Z.text(files[f])).documentElement;
      (function walk(n) {
        kids(n).forEach(c => {
          if (c.localName === 'style' && c.namespaceURI === NSO.style) styles[oa(c, 'style', 'name') + '|' + oa(c, 'style', 'family')] = c;
          else if (/-style$/.test(c.localName) && c.namespaceURI === 'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0') dataStyles[oa(c, 'style', 'name')] = c;
          else if (c.localName !== 'body') walk(c);
        });
      })(root);
    });
    const cache = {};
    const resolve = (name, family) => {
      const k = name + '|' + family;
      if (cache[k] !== undefined) return cache[k];
      const el = styles[k], st = {};
      cache[k] = st;
      if (!el) return st;
      const parent = oa(el, 'style', 'parent-style-name');
      if (parent) Object.assign(st, resolve(parent, family));
      const dsn = oa(el, 'style', 'data-style-name');
      if (dsn && dataStyles[dsn]) { const nf = nfFromOds(dataStyles[dsn]); if (nf) st.nf = nf; }
      const tp = first(el, 'text-properties'), cp = first(el, 'table-cell-properties'), pp = first(el, 'paragraph-properties');
      if (tp) {
        if (oa(tp, 'fo', 'font-weight') === 'bold') st.b = true; if (oa(tp, 'fo', 'font-style') === 'italic') st.i = true;
        const u = oa(tp, 'style', 'text-underline-style'); if (u && u !== 'none') st.u = true;
        const lt = oa(tp, 'style', 'text-line-through-style'); if (lt && lt !== 'none') st.st = true;
        const col = oa(tp, 'fo', 'color'); if (/^#[0-9a-f]{6}$/i.test(col) && col.toLowerCase() !== '#000000') st.c = col.toLowerCase();
      }
      if (cp) {
        const bg = oa(cp, 'fo', 'background-color'); if (/^#[0-9a-f]{6}$/i.test(bg)) st.bg = bg.toLowerCase();
        ['border', 'border-left', 'border-right', 'border-top', 'border-bottom'].forEach(b => { const v = oa(cp, 'fo', b); if (v && v !== 'none' && parseFloat(v) > 0) st.bd = true; });
        if (oa(cp, 'fo', 'wrap-option') === 'wrap') st.wrap = true;
      }
      if (pp) { const a = oa(pp, 'fo', 'text-align'); if (a === 'center') st.al = 'center'; else if (a === 'end' || a === 'right') st.al = 'right'; else if (a === 'start' || a === 'left') st.al = 'left'; }
      return st;
    };
    const ids = {};
    return {
      id: name => { if (!name) return 0; if (ids[name] === undefined) ids[name] = F.styleId(book, resolve(name, 'table-cell')); return ids[name]; },
      raw: (name, family) => styles[name + '|' + family] || null
    };
  }
  const isoDate = s => {
    const m = /^(-?\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(s);
    return m ? { v: C.serialOf(+m[1], +m[2], +m[3]) + (m[4] ? (+m[4] * 3600 + +m[5] * 60 + +m[6]) / 86400 : 0), time: !!m[4] } : null;
  };

  async function readOds(files) {
    if (!files['content.xml']) throw new Error('arquivo .ods inválido');
    const info = { lossy: [], unsupported: false };
    const book = { sheets: [], styles: [{}], active: 0 };
    const st = odsCellStyles(files, book);
    const root = parseXml(Z.text(files['content.xml'])).documentElement;
    const spread = first(first(root, 'body'), 'spreadsheet');
    if (!spread) throw new Error('o arquivo não é uma planilha');
    const flags = {};
    let total = 0;
    kids(spread, 'table').forEach(tEl => {
      const sh = F.newSheet(oa(tEl, 'table', 'name') || 'Planilha' + (book.sheets.length + 1));
      book.sheets.push(sh);
      const colStyle = [];
      let ci = 0;
      (function cols(n) {
        kids(n).forEach(c => {
          if (c.localName === 'table-column') {
            const rep = Math.min(+oa(c, 'table', 'number-columns-repeated') || 1, 1024), el = st.raw(oa(c, 'table', 'style-name'), 'table-column'), cp = el && first(el, 'table-column-properties');
            const w = cp ? lenPx(oa(cp, 'style', 'column-width')) : 0, ds = oa(c, 'table', 'default-cell-style-name');
            for (let k = 0; k < rep; k++, ci++) { if (w) sh.colW[ci] = w; colStyle[ci] = ds; }
          } else if (c.localName === 'table-header-columns' || c.localName === 'table-columns' || c.localName === 'table-column-group') cols(c);
        });
      })(tEl);
      let r = 0;
      const rowsOf = n => {
        kids(n).forEach(rowEl => {
          if (rowEl.localName === 'table-header-rows' || rowEl.localName === 'table-rows' || rowEl.localName === 'table-row-group') { rowsOf(rowEl); return; }
          if (rowEl.localName !== 'table-row') return;
          const rrep = Math.min(+oa(rowEl, 'table', 'number-rows-repeated') || 1, 5000);
          const rel = st.raw(oa(rowEl, 'table', 'style-name'), 'table-row'), rp = rel && first(rel, 'table-row-properties'), rh = rp ? lenPx(oa(rp, 'style', 'row-height')) : 0;
          const rowDefault = oa(rowEl, 'table', 'default-cell-style-name');
          const cellsOf = [];
          let c = 0;
          kids(rowEl).forEach(cEl => {
            const L = cEl.localName;
            if (L !== 'table-cell' && L !== 'covered-table-cell') return;
            const crep = +oa(cEl, 'table', 'number-columns-repeated') || 1;
            if (L === 'covered-table-cell') { c += crep; return; }
            const vt = oa(cEl, 'office', 'value-type'), fo = oa(cEl, 'table', 'formula'), sname = oa(cEl, 'table', 'style-name') || rowDefault || colStyle[c] || '';
            let v;
            if (vt === 'float' || vt === 'percentage' || vt === 'currency') v = parseFloat(oa(cEl, 'office', 'value'));
            else if (vt === 'date') { const d = isoDate(oa(cEl, 'office', 'date-value')); v = d ? d.v : null; }
            else if (vt === 'time') { const m = /^PT(\d+)H(\d+)M(\d+)/.exec(oa(cEl, 'office', 'time-value')); v = m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) / 86400 : null; }
            else if (vt === 'boolean') v = oa(cEl, 'office', 'boolean-value') === 'true';
            else if (vt === 'string') v = cEl.hasAttributeNS(NSO.office, 'string-value') ? oa(cEl, 'office', 'string-value') : kids(cEl, 'p').map(odsText).join('\n');
            else v = null;
            let sid = st.id(sname);
            if (vt === 'date' && !(book.styles[sid] && book.styles[sid].nf)) sid = F.styleId(book, Object.assign({}, book.styles[sid], { nf: /T/.test(oa(cEl, 'office', 'date-value')) ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy' }));
            if (vt === 'time' && !(book.styles[sid] && book.styles[sid].nf)) sid = F.styleId(book, Object.assign({}, book.styles[sid], { nf: 'hh:mm:ss' }));
            const cell = {};
            if (v !== null && !(typeof v === 'number' && isNaN(v))) cell.v = v;
            if (fo) {
              if (typeof cell.v === 'string' && /^(#DIV\/0!|#VALUE!|#REF!|#NAME\?|#N\/A|#NUM!)$/.test(cell.v)) cell.v = C.errFrom(cell.v);
              cell.f = C.fromOds(fo); if (cell.v === undefined) cell.v = null; noteFormula(book, info, cell); }
            if (sid) cell.s = sid;
            const spanC = +oa(cEl, 'table', 'number-columns-spanned') || 1, spanR = +oa(cEl, 'table', 'number-rows-spanned') || 1;
            const hasData = cell.v !== undefined || cell.f || (cell.s && (book.styles[cell.s].bg || book.styles[cell.s].bd));
            if (hasData && !(crep > 100 && cell.v === undefined)) {
              for (let k = 0; k < Math.min(crep, 1024); k++) cellsOf.push([c + k, k === 0 ? cell : Object.assign({}, cell), k === 0 ? [spanR, spanC] : null]);
            }
            if (cEl.getElementsByTagNameNS(NSO.office, 'annotation').length) flags['comentários'] = 1;
            if (cEl.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'frame').length) flags['gráficos ou imagens'] = 1;
            c += crep;
          });
          for (let k = 0; k < rrep; k++) {
            if (!cellsOf.length && !rh) { r++; continue; }
            if (rh) sh.rowH[r] = rh;
            cellsOf.forEach(([cc, cell, span]) => {
              sh.cells[key(r, cc)] = k === 0 ? cell : JSON.parse(JSON.stringify(cell, (kk, vv) => (vv instanceof C.FErr ? { __e: vv.c } : vv)));
              if (++total > MAX_CELLS) throw new Error('planilha grande demais para o LiteOffice (mais de ' + MAX_CELLS + ' células)');
              if (k === 0 && span && (span[0] > 1 || span[1] > 1)) sh.merges.push({ r1: r, c1: cc, r2: r + span[0] - 1, c2: cc + span[1] - 1 });
            });
            r++;
          }
        });
      };
      rowsOf(tEl);
    });
    if (files['Pictures/'] || Object.keys(files).some(n => /^(Pictures|Object )/.test(n))) flags['gráficos ou imagens'] = 1;
    info.lossy = Object.keys(flags);
    if (info.unsupported) info.lossy.push('fórmulas com funções que o LiteOffice não calcula (mantêm o último valor)');
    if (!book.sheets.length) book.sheets.push(F.newSheet('Planilha1'));
    return { book: book, info: info };
  }

  const ODS_NS = 'xmlns:office="' + NSO.office + '" xmlns:style="' + NSO.style + '" xmlns:text="' + NSO.text + '" xmlns:table="' + NSO.table + '" xmlns:fo="' + NSO.fo + '" ' +
    'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"';

  async function writeOds(book) {
    const dataStyles = [], dsIdx = {};
    const cellStyles = book.styles.map((s, i) => {
      if (!i && !Object.keys(s).length) return '';
      let ds = '';
      if (s.nf) {
        if (!(s.nf in dsIdx)) { const x = odsDataStyle(s.nf, 'N' + dataStyles.length); dsIdx[s.nf] = x ? 'N' + dataStyles.length : ''; if (x) dataStyles.push(x); }
        ds = dsIdx[s.nf];
      }
      const bd = s.bd ? ' fo:border="0.5pt solid #9aa4b2"' : '';
      return '<style:style style:name="ce' + i + '" style:family="table-cell" style:parent-style-name="Default"' + (ds ? ' style:data-style-name="' + ds + '"' : '') + '>' +
        '<style:table-cell-properties' + (s.bg ? ' fo:background-color="' + s.bg + '"' : '') + bd + (s.wrap ? ' fo:wrap-option="wrap"' : '') + '/>' +
        (s.al ? '<style:paragraph-properties fo:text-align="' + (s.al === 'left' ? 'start' : s.al === 'right' ? 'end' : 'center') + '"/>' : '') +
        '<style:text-properties' + (s.b ? ' fo:font-weight="bold"' : '') + (s.i ? ' fo:font-style="italic"' : '') + (s.u ? ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : '') +
        (s.st ? ' style:text-line-through-style="solid"' : '') + (s.c ? ' fo:color="' + s.c + '"' : '') + '/></style:style>';
    });
    let auto = '', body = '';
    book.sheets.forEach((sh, si) => {
      const used = F.usedRange(sh), cols = Math.max(used.cols, 1), rows = used.rows;
      auto += Array.from({ length: cols }, (_, c) => '<style:style style:name="co' + si + '_' + c + '" style:family="table-column"><style:table-column-properties style:column-width="' + px2cm(sh.colW[c] || 80) + '"/></style:style>').join('');
      Object.keys(sh.rowH).forEach(r => { auto += '<style:style style:name="ro' + si + '_' + r + '" style:family="table-row"><style:table-row-properties style:row-height="' + px2cm(sh.rowH[r]) + '" style:use-optimal-row-height="false"/></style:style>'; });
      const cover = {}, span = {};
      sh.merges.forEach(m => {
        span[key(m.r1, m.c1)] = m;
        for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) cover[key(r, c)] = 1;
      });
      body += '<table:table table:name="' + xesc(sh.name) + '">';
      for (let c = 0; c < cols; c++) body += '<table:table-column table:style-name="co' + si + '_' + c + '"/>';
      let emptyRows = 0;
      const flushEmpty = () => { if (emptyRows) { body += '<table:table-row' + (emptyRows > 1 ? ' table:number-rows-repeated="' + emptyRows + '"' : '') + '><table:table-cell table:number-columns-repeated="' + cols + '"/></table:table-row>'; emptyRows = 0; } };
      for (let r = 0; r < rows; r++) {
        let any = false;
        for (let c = 0; c < cols && !any; c++) if (sh.cells[key(r, c)] || cover[key(r, c)]) any = true;
        if (!any && !sh.rowH[r]) { emptyRows++; continue; }
        flushEmpty();
        body += '<table:table-row' + (sh.rowH[r] ? ' table:style-name="ro' + si + '_' + r + '"' : '') + '>';
        let blank = 0;
        const flushBlank = () => { if (blank) { body += '<table:table-cell' + (blank > 1 ? ' table:number-columns-repeated="' + blank + '"' : '') + '/>'; blank = 0; } };
        for (let c = 0; c < cols; c++) {
          const cell = sh.cells[key(r, c)];
          if (cover[key(r, c)]) { flushBlank(); body += '<table:covered-table-cell/>'; continue; }
          if (!cell) { blank++; continue; }
          flushBlank();
          const s = book.styles[cell.s || 0] || {}, v = cell.v, m = span[key(r, c)];
          let a = (cell.s ? ' table:style-name="ce' + cell.s + '"' : '') + (m ? ' table:number-columns-spanned="' + (m.c2 - m.c1 + 1) + '" table:number-rows-spanned="' + (m.r2 - m.r1 + 1) + '"' : '');
          if (cell.f) a += ' table:formula="of:=' + xesc(C.unparse(C.parse(cell.f), { ods: true })) + '"';
          let inner = '';
          if (v instanceof C.FErr) { a += ' office:value-type="string" office:string-value="' + xesc(v.c) + '"'; inner = '<text:p>' + xesc(v.c) + '</text:p>'; }
          else if (typeof v === 'number') {
            const nf = s.nf || '';
            if (nf && C.isDateFmt(nf)) {
              if (isTimeOnly(nf)) { const t = Math.round((v % 1) * 86400); a += ' office:value-type="time" office:time-value="PT' + String(Math.floor(t / 3600)).padStart(2, '0') + 'H' + String(Math.floor(t / 60) % 60).padStart(2, '0') + 'M' + String(t % 60).padStart(2, '0') + 'S"'; }
              else { const d = C.dateOf(v); a += ' office:value-type="date" office:date-value="' + d.toISOString().slice(0, /h|s/i.test(nf) ? 19 : 10) + '"'; }
            } else if (nf && nfParts(nf).pct) a += ' office:value-type="percentage" office:value="' + v + '"';
            else a += ' office:value-type="float" office:value="' + v + '"';
            inner = '<text:p>' + xesc(C.format(v, nf)) + '</text:p>';
          }
          else if (typeof v === 'boolean') { a += ' office:value-type="boolean" office:boolean-value="' + v + '"'; inner = '<text:p>' + (v ? 'TRUE' : 'FALSE') + '</text:p>'; }
          else if (typeof v === 'string') { a += ' office:value-type="string"'; inner = String(v).split('\n').map(l => '<text:p>' + xesc(l).replace(/ {2,}/g, sp => ' <text:s text:c="' + (sp.length - 1) + '"/>').replace(/\t/g, '<text:tab/>') + '</text:p>').join(''); }
          body += '<table:table-cell' + a + (inner ? '>' + inner + '</table:table-cell>' : '/>');
        }
        body += '</table:table-row>';
      }
      body += '</table:table>';
    });
    const content = '<?xml version="1.0" encoding="UTF-8"?><office:document-content ' + ODS_NS + ' office:version="1.2"><office:automatic-styles>' + dataStyles.join('') + auto + cellStyles.join('') + '</office:automatic-styles><office:body><office:spreadsheet>' + body + '</office:spreadsheet></office:body></office:document-content>';
    const styles = '<?xml version="1.0" encoding="UTF-8"?><office:document-styles ' + ODS_NS + ' office:version="1.2"><office:styles><style:style style:name="Default" style:family="table-cell"><style:text-properties style:font-name="Calibri" fo:font-size="11pt"/></style:style></office:styles></office:document-styles>';
    const manifest = '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>' +
      ['content.xml', 'styles.xml', 'meta.xml'].map(f => '<manifest:file-entry manifest:full-path="' + f + '" manifest:media-type="text/xml"/>').join('') + '</manifest:manifest>';
    const meta = '<?xml version="1.0" encoding="UTF-8"?><office:document-meta ' + ODS_NS + ' office:version="1.2"><office:meta><meta:generator>Central Diogo Desktop</meta:generator><meta:creation-date>' + new Date().toISOString() + '</meta:creation-date></office:meta></office:document-meta>';
    const blob = await Z.write([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.spreadsheet', store: true }, { name: 'content.xml', data: content }, { name: 'styles.xml', data: styles },
      { name: 'meta.xml', data: meta }, { name: 'META-INF/manifest.xml', data: manifest }]);
    return { blob: new Blob([blob], { type: 'application/vnd.oasis.opendocument.spreadsheet' }) };
  }

  // ---------- CSV ----------
  F.fromCsv = function (text, name) {
    const book = F.newBook(), sh = book.sheets[0];
    sh.name = (name || 'Planilha1').replace(/\.[^.]+$/, '').slice(0, 31) || 'Planilha1';
    const first = text.slice(0, 2000), sep = [';', '\t', ','].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
    let r = 0, c = 0, f = '', q = false, any = false;
    const push = () => {
      const p = C.parseInput(f);
      const cell = {};
      if (p.v !== null && p.v !== undefined && p.v !== '') cell.v = p.v;
      if (p.nf) cell.s = F.styleId(book, { nf: p.nf });
      if (cell.v !== undefined) sh.cells[key(r, c)] = cell;
      f = ''; c++; any = true;
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"' && f === '') q = true;
      else if (ch === sep) push();
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; push(); r++; c = 0; any = false; }
      else f += ch;
    }
    if (any || f) push();
    return book;
  };

  // ---------- entrada e saída ----------
  F.read = async function (buf, name) {
    const ext = DK.extOf(name);
    if (ext === '.csv' || ext === '.tsv') { const d = DK.decodeText(buf); return { book: F.fromCsv(d.text.replace(/^\uFEFF/, ''), name), info: { lossy: [] } }; }
    const files = await Z.read(buf);
    return ext === '.ods' ? readOds(files) : readXlsx(files);
  };
  F.write = (book, name) => (DK.extOf(name) === '.ods' ? writeOds(book) : writeXlsx(book));
  F.toCsv = function (sh, display) {
    const u = F.usedRange(sh), out = [];
    for (let r = 0; r < u.rows; r++) {
      const row = [];
      for (let c = 0; c < u.cols; c++) {
        const cell = sh.cells[key(r, c)];
        let s = cell ? display(cell, r, c) : '';
        if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        row.push(s);
      }
      out.push(row.join(';'));
    }
    return new Blob(['\uFEFF' + out.join('\r\n')], { type: 'text/csv' });
  };
})(window.DK = window.DK || {});
