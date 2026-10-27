(function (DK) {
  // Motor de cálculo das planilhas do LiteOffice: lê fórmulas no formato do Excel/LibreOffice (nomes de função em inglês, separador ",")
  // e calcula. Também formata números e datas (formatos do tipo "0,00", "0%", "R$ #,##0.00", "dd/mm/yyyy") e entende o que o usuário digita.
  // O motor não conhece a grade: quem usa entrega cx = { sheet, get(sheet, r, c), dims(sheet) -> { rows, cols } }, com linhas e colunas a partir de 0.
  const C = DK.calc = {};

  class FErr { constructor(c) { this.c = c; } toString() { return this.c; } }
  const E = { div: new FErr('#DIV/0!'), val: new FErr('#VALUE!'), ref: new FErr('#REF!'), name: new FErr('#NAME?'), na: new FErr('#N/A'), num: new FErr('#NUM!'), circ: new FErr('#CIRC!') };
  C.FErr = FErr; C.E = E;
  const isErr = v => v instanceof FErr;
  C.errFrom = code => Object.keys(E).map(k => E[k]).filter(e => e.c === code)[0] || new FErr(code);

  // ---------- colunas e referências ----------
  const colName = c => { let s = ''; for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s; return s; };
  const colIndex = s => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  C.colName = colName; C.colIndex = colIndex;
  C.addr = (r, c) => colName(c) + (r + 1);
  C.parseAddr = a => { const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a); return m ? { r: +m[2] - 1, c: colIndex(m[1]) } : null; };

  const SHEET = "(?:'(?:[^']|'')+'|[A-Za-z_\\u00C0-\\uFFFF][\\w.\\u00C0-\\uFFFF]*)!";
  const RE_REF = new RegExp('(?:' + SHEET + ')?\\$?[A-Za-z]{1,3}\\$?[0-9]+(?::\\$?[A-Za-z]{1,3}\\$?[0-9]+)?(?![\\w(.])', 'y');
  const RE_COLS = new RegExp('(?:' + SHEET + ')?\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}(?![\\w(.])', 'y');
  const RE_NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const RE_ID = /[A-Za-z_\u00C0-\uFFFF][\w.\u00C0-\uFFFF]*/y;
  const RE_ERR = /#(?:DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!)/y;

  function parseRefText(t) {
    let sheet = null;
    const bang = t.lastIndexOf('!');
    if (bang >= 0) { sheet = t.slice(0, bang); if (sheet[0] === "'") sheet = sheet.slice(1, -1).replace(/''/g, "'"); t = t.slice(bang + 1); }
    const parts = t.split(':');
    // ar/ac: linha/coluna absoluta ($) em cada canto, como digitado; os cantos não são reordenados aqui (quem avalia usa min/max)
    const corner = p => { const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(p); return m ? { r: +m[4] - 1, c: colIndex(m[2]), ar: !!m[3], ac: !!m[1] } : null; };
    const a = corner(parts[0]);
    if (a) { const b = parts[1] ? corner(parts[1]) : a; return { t: 'ref', sheet: sheet, r1: a.r, c1: a.c, r2: b.r, c2: b.c, ar1: a.ar, ac1: a.ac, ar2: b.ar, ac2: b.ac, single: !parts[1] }; }
    const cc = parts.map(p => /^(\$?)([A-Za-z]{1,3})$/.exec(p));
    return { t: 'ref', sheet: sheet, r1: 0, c1: colIndex(cc[0][2]), r2: -1, c2: colIndex(cc[1][2]), ac1: !!cc[0][1], ac2: !!cc[1][1], ar1: false, ar2: false };   // coluna inteira (r2 = -1: até a última linha usada)
  }

  // Nomes de função em português (como no Excel em português): viram o nome em inglês ao digitar, que é o que vai para o arquivo.
  const ALIAS = { 'SOMA': 'SUM', 'MÉDIA': 'AVERAGE', 'MEDIA': 'AVERAGE', 'MÍNIMO': 'MIN', 'MINIMO': 'MIN', 'MÁXIMO': 'MAX', 'MAXIMO': 'MAX', 'SE': 'IF', 'SES': 'IFS', 'SEERRO': 'IFERROR', 'E': 'AND', 'OU': 'OR', 'NÃO': 'NOT', 'NAO': 'NOT',
    'CONT.NÚM': 'COUNT', 'CONT.NUM': 'COUNT', 'CONT.VALORES': 'COUNTA', 'CONT.SE': 'COUNTIF', 'CONT.SES': 'COUNTIFS', 'SOMASE': 'SUMIF', 'SOMASES': 'SUMIFS', 'MÉDIASE': 'AVERAGEIF', 'MEDIASE': 'AVERAGEIF',
    'PROCV': 'VLOOKUP', 'PROCH': 'HLOOKUP', 'ÍNDICE': 'INDEX', 'INDICE': 'INDEX', 'CORRESP': 'MATCH', 'ESCOLHER': 'CHOOSE', 'ARRED': 'ROUND', 'ARREDONDAR.PARA.CIMA': 'ROUNDUP', 'ARREDONDAR.PARA.BAIXO': 'ROUNDDOWN',
    'TRUNCAR': 'TRUNC', 'INT': 'INT', 'RAIZ': 'SQRT', 'POTÊNCIA': 'POWER', 'POTENCIA': 'POWER', 'RESTO': 'MOD', 'ABS': 'ABS', 'MED': 'MEDIAN', 'MAIOR': 'LARGE', 'MENOR': 'SMALL', 'HOJE': 'TODAY', 'AGORA': 'NOW',
    'DATA': 'DATE', 'ANO': 'YEAR', 'MÊS': 'MONTH', 'MES': 'MONTH', 'DIA': 'DAY', 'DIA.DA.SEMANA': 'WEEKDAY', 'CONCATENAR': 'CONCATENATE', 'UNIRTEXTO': 'TEXTJOIN', 'NÚM.CARACT': 'LEN', 'NUM.CARACT': 'LEN',
    'MAIÚSCULA': 'UPPER', 'MAIUSCULA': 'UPPER', 'MINÚSCULA': 'LOWER', 'MINUSCULA': 'LOWER', 'PRI.MAIÚSCULA': 'PROPER', 'ARRUMAR': 'TRIM', 'ESQUERDA': 'LEFT', 'DIREITA': 'RIGHT', 'EXT.TEXTO': 'MID', 'LOCALIZAR': 'SEARCH',
    'PROCURAR': 'FIND', 'SUBSTITUIR': 'SUBSTITUTE', 'REPT': 'REPT', 'VALOR': 'VALUE', 'TEXTO': 'TEXT', 'ÉCÉL.VAZIA': 'ISBLANK', 'ÉNÚM': 'ISNUMBER', 'ÉTEXTO': 'ISTEXT', 'ÉERRO': 'ISERROR', 'LIN': 'ROW', 'COL': 'COLUMN',
    'SOMARPRODUTO': 'SUMPRODUCT', 'ALEATÓRIO': 'RAND', 'ALEATORIO': 'RAND', 'ALEATÓRIOENTRE': 'RANDBETWEEN', 'VERDADEIRO': 'TRUE', 'FALSO': 'FALSE', 'DESVPAD': 'STDEV', 'VAR': 'VAR' };
  C.ALIAS = ALIAS;

  function tokenize(src) {
    const out = [], n = src.length;
    let i = 0;
    const at = (re) => { re.lastIndex = i; const m = re.exec(src); return m && m.index === i ? m[0] : null; };
    while (i < n) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"') {
        let s = '', j = i + 1;
        for (; j < n; j++) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j++; } else break; } else s += src[j]; }
        if (j >= n) throw E.name;
        out.push({ k: 'str', v: s }); i = j + 1; continue;
      }
      let m;
      if (ch === '#' && (m = at(RE_ERR))) { out.push({ k: 'err', v: m }); i += m.length; continue; }
      if ((m = at(RE_REF))) { out.push({ k: 'ref', v: m }); i += m.length; continue; }
      if ((m = at(RE_COLS))) { out.push({ k: 'ref', v: m }); i += m.length; continue; }
      if ((/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] || ''))) && (m = at(RE_NUM))) { out.push({ k: 'num', v: parseFloat(m) }); i += m.length; continue; }
      if ((m = at(RE_ID))) {
        i += m.length;
        if (src[i] === '(') out.push({ k: 'fn', v: ALIAS[m.toUpperCase()] || m.toUpperCase() });
        else if (/^(TRUE|FALSE|VERDADEIRO|FALSO)$/i.test(m)) out.push({ k: 'bool', v: /^(TRUE|VERDADEIRO)$/i.test(m) });
        else out.push({ k: 'name', v: m });
        continue;
      }
      const two = src.substr(i, 2);
      if (two === '<=' || two === '>=' || two === '<>') { out.push({ k: 'op', v: two }); i += 2; continue; }
      if ('+-*/^&=<>(),;%'.indexOf(ch) >= 0) { out.push({ k: 'op', v: ch }); i++; continue; }
      throw E.name;
    }
    return out;
  }

  // ---------- análise (precedência do Excel: comparação < & < + - < * / < ^ < unário < %) ----------
  function parse(src) {
    const tk = tokenize(src);
    let p = 0;
    const peek = () => tk[p], isOp = v => tk[p] && tk[p].k === 'op' && tk[p].v === v;
    function cmp() {
      let a = cat();
      while (tk[p] && tk[p].k === 'op' && /^(=|<>|<=|>=|<|>)$/.test(tk[p].v)) { const op = tk[p++].v; a = { t: 'bin', op: op, a: a, b: cat() }; }
      return a;
    }
    function cat() { let a = add(); while (isOp('&')) { p++; a = { t: 'bin', op: '&', a: a, b: add() }; } return a; }
    function add() { let a = mul(); while (isOp('+') || isOp('-')) { const op = tk[p++].v; a = { t: 'bin', op: op, a: a, b: mul() }; } return a; }
    function mul() { let a = pow(); while (isOp('*') || isOp('/')) { const op = tk[p++].v; a = { t: 'bin', op: op, a: a, b: pow() }; } return a; }
    function pow() { let a = unary(); while (isOp('^')) { p++; a = { t: 'bin', op: '^', a: a, b: unary() }; } return a; }
    function unary() {
      if (isOp('-') || isOp('+')) { const op = tk[p++].v; const a = unary(); return op === '-' ? { t: 'un', a: a } : a; }
      let a = primary();
      while (isOp('%')) { p++; a = { t: 'pct', a: a }; }
      return a;
    }
    function primary() {
      const t = tk[p++];
      if (!t) throw E.name;
      switch (t.k) {
        case 'num': return { t: 'num', v: t.v };
        case 'str': return { t: 'str', v: t.v };
        case 'bool': return { t: 'bool', v: t.v };
        case 'err': return { t: 'err', v: C.errFrom(t.v) };
        case 'ref': return parseRefText(t.v);
        case 'name': throw E.name;
        case 'fn': {
          p++;   // "("
          const args = [];
          if (isOp(')')) { p++; return { t: 'call', name: t.v, args: args }; }
          for (;;) {
            if (isOp(',') || isOp(';') || isOp(')')) args.push({ t: 'blank' }); else args.push(cmp());
            if (isOp(',') || isOp(';')) { p++; continue; }
            if (isOp(')')) { p++; break; }
            throw E.name;
          }
          return { t: 'call', name: t.v, args: args };
        }
        case 'op':
          if (t.v === '(') { const a = cmp(); if (!isOp(')')) throw E.name; p++; return { t: 'par', a: a }; }
      }
      throw E.name;
    }
    const ast = cmp();
    if (p < tk.length) throw E.name;
    return ast;
  }
  C.parse = function (src) { try { return parse(String(src)); } catch (e) { if (isErr(e)) return { t: 'err', v: e }; throw e; } };

  // Percorre a árvore (usado para trocar referências ao copiar/inserir). fn(refNode) pode devolver um novo nó.
  C.walk = function walk(n, fn) {
    if (!n) return n;
    if (n.t === 'ref') return fn(n) || n;
    if (n.a) n.a = walk(n.a, fn);
    if (n.b) n.b = walk(n.b, fn);
    if (n.args) n.args = n.args.map(x => walk(x, fn));
    return n;
  };

  // Texto da fórmula (sem o "=") a partir da árvore: o inverso de parse.
  const quoteSheet = s => (/^[A-Za-z_][\w.]*$/.test(s) ? s : "'" + s.replace(/'/g, "''") + "'");
  // o.ods: referências no formato do OpenDocument ([.A1:.B2], [$Folha.A1]) e ";" entre os argumentos.
  function unparse(n, o) {
    const u = x => unparse(x, o);
    switch (n.t) {
      case 'num': return String(n.v);
      case 'str': return '"' + n.v.replace(/"/g, '""') + '"';
      case 'bool': return n.v ? 'TRUE' : 'FALSE';
      case 'blank': return '';
      case 'err': return n.v.c;
      case 'par': return '(' + u(n.a) + ')';
      case 'un': return '-' + u(n.a);
      case 'pct': return u(n.a) + '%';
      case 'bin': return u(n.a) + n.op + u(n.b);
      case 'call': return n.name + '(' + n.args.map(u).join(o && o.ods ? ';' : ',') + ')';
      case 'ref': {
        if (n.bad) return '#REF!';
        const cell = (r, c, ar, ac) => (ac ? '$' : '') + colName(c) + (ar ? '$' : '') + (r + 1);
        const col = (c, ac) => (ac ? '$' : '') + colName(c);
        if (o && o.ods) {
          const sh = n.sheet ? '$' + quoteSheet(n.sheet) : '';
          if (n.r2 === -1) return '[' + sh + '.' + col(n.c1, n.ac1) + ':.' + col(n.c2, n.ac2) + ']';
          if (n.single) return '[' + sh + '.' + cell(n.r1, n.c1, n.ar1, n.ac1) + ']';
          return '[' + sh + '.' + cell(n.r1, n.c1, n.ar1, n.ac1) + ':.' + cell(n.r2, n.c2, n.ar2, n.ac2) + ']';
        }
        const pre = n.sheet ? quoteSheet(n.sheet) + '!' : '';
        if (n.r2 === -1) return pre + col(n.c1, n.ac1) + ':' + col(n.c2, n.ac2);
        if (n.single) return pre + cell(n.r1, n.c1, n.ar1, n.ac1);
        return pre + cell(n.r1, n.c1, n.ar1, n.ac1) + ':' + cell(n.r2, n.c2, n.ar2, n.ac2);
      }
    }
    return '';
  }
  C.unparse = unparse;
  // Fórmula do OpenDocument ("of:=SUM([.A1:.B2];1)") -> texto no formato do Excel ("SUM(A1:B2,1)").
  C.fromOds = function (f) {
    f = String(f).replace(/^(of:|oooc:)?=?/, '');
    let out = '', i = 0;
    while (i < f.length) {
      const ch = f[i];
      if (ch === '"') { let j = i + 1; while (j < f.length && !(f[j] === '"' && f[j + 1] !== '"')) j += f[j] === '"' ? 2 : 1; out += f.slice(i, j + 1); i = j + 1; continue; }
      if (ch === '[') {
        const j = f.indexOf(']', i), body = f.slice(i + 1, j);
        const m = /^(?:\$?('(?:[^']|'')+'|[^.:']*))?\.(\$?[A-Z]+(?:\$?\d+)?)(?::(?:\$?('(?:[^']|'')+'|[^.:']*))?\.(\$?[A-Z]+(?:\$?\d+)?))?$/.exec(body);
        if (m) { out += (m[1] ? (m[1][0] === "'" ? m[1] : quoteSheet(m[1])) + '!' : '') + m[2] + (m[4] ? ':' + m[4] : ''); i = j + 1; continue; }
      }
      out += ch === ';' ? ',' : ch; i++;
    }
    return out;
  };
  // Move as referências relativas (copiar, colar e preencher); as com $ ficam. Sai da faixa (negativo): #REF!.
  C.shift = function (ast, dr, dc) {
    return C.walk(C.clone(ast), n => {
      const m = Object.assign({}, n);
      if (n.r2 !== -1) { if (!n.ar1) m.r1 += dr; if (!n.ar2) m.r2 += dr; }
      if (!n.ac1) m.c1 += dc; if (!n.ac2) m.c2 += dc;
      if (m.r1 < 0 || m.c1 < 0 || m.c2 < 0 || (m.r2 !== -1 && m.r2 < 0)) m.bad = true;
      return m;
    });
  };
  C.clone = n => JSON.parse(JSON.stringify(n, (k, v) => (v instanceof FErr ? { __e: v.c } : v)), (k, v) => (v && v.__e ? C.errFrom(v.__e) : v));

  // ---------- conversões ----------
  class Range {
    constructor(sheet, r1, c1, r2, c2, cx) { this.sheet = sheet; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; this.cx = cx; }
    get rows() { return this.r2 - this.r1 + 1; }
    get cols() { return this.c2 - this.c1 + 1; }
    at(r, c) { return this.cx.get(this.sheet, this.r1 + r, this.c1 + c); }
    each(fn) { for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) fn(this.at(r, c), r, c); }
  }
  const sc = v => {
    if (v instanceof Range) { if (v.rows === 1 && v.cols === 1) return v.at(0, 0); throw E.val; }
    if (isErr(v)) throw v;
    return v;
  };
  const parseNumText = s => {
    s = s.trim();
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
    return NaN;
  };
  const num = v => {
    v = sc(v);
    if (typeof v === 'number') return v;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = parseNumText(v);
    if (isNaN(n)) throw E.val;
    return n;
  };
  const str = v => {
    v = sc(v);
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return fmtNum(v, '');
    return String(v);
  };
  const bool = v => {
    v = sc(v);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v === null || v === undefined) return false;
    if (/^true$/i.test(v)) return true;
    if (/^false$/i.test(v)) return false;
    throw E.val;
  };
  const rank = v => (typeof v === 'number' || v === null || v === undefined ? 0 : typeof v === 'string' ? 1 : 2);
  function compare(a, b) {
    if ((a === null || a === undefined) && typeof b === 'string') a = '';
    if ((b === null || b === undefined) && typeof a === 'string') b = '';
    if (a === null || a === undefined) a = typeof b === 'boolean' ? false : 0;
    if (b === null || b === undefined) b = typeof a === 'boolean' ? false : 0;
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (typeof a === 'string') { a = a.toLowerCase(); b = b.toLowerCase(); }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  C.compare = compare;

  // ---------- avaliação ----------
  function evalNode(n, cx) {
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'blank': return null;
      case 'err': throw n.v;
      case 'ref': {
        const sheet = n.sheet || cx.sheet;
        if (n.bad) throw E.ref;
        if (cx.exists && !cx.exists(sheet)) throw E.ref;
        const c1 = Math.min(n.c1, n.c2), c2 = Math.max(n.c1, n.c2);
        if (n.r2 === -1) { const d = cx.dims(sheet); return new Range(sheet, 0, c1, Math.max(0, d.rows - 1), c2, cx); }
        const r1 = Math.min(n.r1, n.r2), r2 = Math.max(n.r1, n.r2);
        if (r1 === r2 && c1 === c2) { const v = cx.get(sheet, r1, c1); if (isErr(v)) throw v; return v; }
        return new Range(sheet, r1, c1, r2, c2, cx);
      }
      case 'par': return evalNode(n.a, cx);
      case 'un': return -num(evalNode(n.a, cx));
      case 'pct': return num(evalNode(n.a, cx)) / 100;
      case 'bin': {
        const a = evalNode(n.a, cx), b = evalNode(n.b, cx);
        switch (n.op) {
          case '+': return num(a) + num(b);
          case '-': return num(a) - num(b);
          case '*': return num(a) * num(b);
          case '/': { const d = num(b); if (d === 0) throw E.div; return num(a) / d; }
          case '^': { const r = Math.pow(num(a), num(b)); if (!isFinite(r)) throw E.num; return r; }
          case '&': return str(a) + str(b);
        }
        const x = sc(a), y = sc(b), c = compare(x, y);
        switch (n.op) {
          case '=': return c === 0; case '<>': return c !== 0; case '<': return c < 0; case '>': return c > 0; case '<=': return c <= 0; default: return c >= 0;
        }
      }
      case 'call': return call(n, cx);
    }
    throw E.name;
  }

  C.evaluate = function (ast, cx) {
    try {
      const v = evalNode(ast, cx);
      if (v instanceof Range) { if (v.rows === 1 && v.cols === 1) return sc(v); return E.val; }
      if (typeof v === 'number' && !isFinite(v)) return E.num;
      return v === undefined ? null : v;
    } catch (e) { if (isErr(e)) return e; throw e; }
  };

  // ---------- funções ----------
  // Números dos argumentos: nas faixas só contam os números; os valores digitados direto são convertidos.
  function nums(args, cx, keepBlank) {
    const out = [];
    args.forEach(a => {
      const v = evalNode(a, cx);
      if (v instanceof Range) v.each(x => { if (isErr(x)) throw x; if (typeof x === 'number') out.push(x); });
      else if (a.t === 'blank') { if (keepBlank) out.push(0); }
      else if (v !== null) out.push(num(v));
    });
    return out;
  }
  const flat = (v) => { const out = []; if (v instanceof Range) v.each(x => out.push(x)); else out.push(v); return out; };
  const rng = (v) => { if (!(v instanceof Range)) throw E.val; return v; };
  const wild = (pat) => new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*') + '$', 'i');
  function matcher(c) {
    c = sc(c);
    if (typeof c === 'number' || typeof c === 'boolean') return v => typeof v === typeof c && v === c;
    c = c === null || c === undefined ? '' : String(c);
    const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c), op = m[1] || '=', rhs = m[2];
    const n = rhs.trim() !== '' ? parseNumText(rhs.replace(',', '.')) : NaN;
    const test = (c2) => op === '=' ? c2 === 0 : op === '<>' ? c2 !== 0 : op === '<' ? c2 < 0 : op === '>' ? c2 > 0 : op === '<=' ? c2 <= 0 : c2 >= 0;
    if (!isNaN(n)) return v => (typeof v === 'number' ? test(v < n ? -1 : v > n ? 1 : 0) : op === '<>');
    if (op === '=' || op === '<>') {
      const re = wild(rhs);
      return v => { const hit = rhs === '' ? (v === null || v === undefined || v === '') : (typeof v === 'string' || typeof v === 'number') && re.test(String(v)); return op === '=' ? hit : !hit; };
    }
    return v => typeof v === 'string' && test(compare(v, rhs));
  }
  function condRows(pairs, cx) {      // pairs: [faixaCritério, critério, ...] -> lista de [r, c] que atendem a todos
    const first = rng(evalNode(pairs[0], cx));
    const tests = [];
    for (let i = 0; i < pairs.length; i += 2) { const r = rng(evalNode(pairs[i], cx)); if (r.rows !== first.rows || r.cols !== first.cols) throw E.val; tests.push([r, matcher(evalNode(pairs[i + 1], cx))]); }
    const hits = [];
    for (let r = 0; r < first.rows; r++) for (let c = 0; c < first.cols; c++) if (tests.every(t => t[1](t[0].at(r, c)))) hits.push([r, c]);
    return { hits: hits, first: first };
  }
  const rnd = (x, d, mode) => { const f = Math.pow(10, d); const y = Math.abs(x) * f; const r = mode === 'up' ? Math.ceil(y - 1e-9) : mode === 'down' ? Math.floor(y + 1e-9) : Math.round(y + 1e-9); return Math.sign(x) * r / f; };
  const serialOf = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  const dateOf = s => new Date(Math.round(s * 86400000) + Date.UTC(1899, 11, 30));
  C.serialOf = serialOf; C.dateOf = dateOf;
  const LOOK = (key, vec, exact) => {
    const k = sc(key);
    if (exact) { for (let i = 0; i < vec.length; i++) if (compare(vec[i], k) === 0 && rank(vec[i]) === rank(k)) return i; return -1; }
    let best = -1;
    for (let i = 0; i < vec.length; i++) { if (vec[i] === null || vec[i] === undefined) continue; if (rank(vec[i]) === rank(k) && compare(vec[i], k) <= 0) best = i; else if (rank(vec[i]) === rank(k)) break; }
    return best;
  };

  const FN = {
    SUM: (a, cx) => nums(a, cx).reduce((s, x) => s + x, 0),
    PRODUCT: (a, cx) => nums(a, cx).reduce((s, x) => s * x, 1),
    AVERAGE: (a, cx) => { const v = nums(a, cx); if (!v.length) throw E.div; return v.reduce((s, x) => s + x, 0) / v.length; },
    MIN: (a, cx) => { const v = nums(a, cx); return v.length ? Math.min.apply(null, v) : 0; },
    MAX: (a, cx) => { const v = nums(a, cx); return v.length ? Math.max.apply(null, v) : 0; },
    MEDIAN: (a, cx) => { const v = nums(a, cx).sort((x, y) => x - y); if (!v.length) throw E.num; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; },
    LARGE: (a, cx) => { const v = nums([a[0]], cx).sort((x, y) => y - x), k = num(evalNode(a[1], cx)); if (k < 1 || k > v.length) throw E.num; return v[k - 1]; },
    SMALL: (a, cx) => { const v = nums([a[0]], cx).sort((x, y) => x - y), k = num(evalNode(a[1], cx)); if (k < 1 || k > v.length) throw E.num; return v[k - 1]; },
    VAR: (a, cx) => { const v = nums(a, cx); if (v.length < 2) throw E.div; const m = v.reduce((s, x) => s + x, 0) / v.length; return v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1); },
    STDEV: (a, cx) => Math.sqrt(FN.VAR(a, cx)),
    COUNT: (a, cx) => { let n = 0; a.forEach(x => { const v = evalNode(x, cx); if (v instanceof Range) v.each(y => { if (typeof y === 'number') n++; }); else if (typeof v === 'number') n++; else if (typeof v === 'string' && !isNaN(parseNumText(v))) n++; }); return n; },
    COUNTA: (a, cx) => { let n = 0; a.forEach(x => { const v = evalNode(x, cx); if (v instanceof Range) v.each(y => { if (y !== null && y !== undefined && y !== '') n++; }); else n++; }); return n; },
    COUNTBLANK: (a, cx) => { let n = 0; flat(evalNode(a[0], cx)).forEach(y => { if (y === null || y === undefined || y === '') n++; }); return n; },
    SUMPRODUCT: (a, cx) => {
      const rs = a.map(x => rng(evalNode(x, cx)));
      if (rs.some(r => r.rows !== rs[0].rows || r.cols !== rs[0].cols)) throw E.val;
      let s = 0;
      for (let r = 0; r < rs[0].rows; r++) for (let c = 0; c < rs[0].cols; c++) s += rs.reduce((p, x) => { const v = x.at(r, c); if (isErr(v)) throw v; return p * (typeof v === 'number' ? v : 0); }, 1);
      return s;
    },
    SUMIF: (a, cx) => {
      const k = condRows([a[0], a[1]], cx), sr = a[2] ? rng(evalNode(a[2], cx)) : k.first;
      return k.hits.reduce((s, h) => { const v = sr.at(h[0], h[1]); return s + (typeof v === 'number' ? v : 0); }, 0);
    },
    SUMIFS: (a, cx) => { const sr = rng(evalNode(a[0], cx)), k = condRows(a.slice(1), cx); return k.hits.reduce((s, h) => { const v = sr.at(h[0], h[1]); return s + (typeof v === 'number' ? v : 0); }, 0); },
    COUNTIF: (a, cx) => condRows([a[0], a[1]], cx).hits.length,
    COUNTIFS: (a, cx) => condRows(a, cx).hits.length,
    AVERAGEIF: (a, cx) => {
      const k = condRows([a[0], a[1]], cx), sr = a[2] ? rng(evalNode(a[2], cx)) : k.first;
      const v = k.hits.map(h => sr.at(h[0], h[1])).filter(x => typeof x === 'number');
      if (!v.length) throw E.div;
      return v.reduce((s, x) => s + x, 0) / v.length;
    },
    ABS: (a, cx) => Math.abs(num(evalNode(a[0], cx))),
    SIGN: (a, cx) => Math.sign(num(evalNode(a[0], cx))),
    INT: (a, cx) => Math.floor(num(evalNode(a[0], cx))),
    TRUNC: (a, cx) => rnd(num(evalNode(a[0], cx)), a[1] ? num(evalNode(a[1], cx)) : 0, 'down'),
    ROUND: (a, cx) => rnd(num(evalNode(a[0], cx)), a[1] ? num(evalNode(a[1], cx)) : 0),
    ROUNDUP: (a, cx) => rnd(num(evalNode(a[0], cx)), a[1] ? num(evalNode(a[1], cx)) : 0, 'up'),
    ROUNDDOWN: (a, cx) => rnd(num(evalNode(a[0], cx)), a[1] ? num(evalNode(a[1], cx)) : 0, 'down'),
    CEILING: (a, cx) => { const x = num(evalNode(a[0], cx)), s = a[1] ? num(evalNode(a[1], cx)) : 1; return s === 0 ? 0 : Math.ceil(x / s - 1e-9) * s; },
    FLOOR: (a, cx) => { const x = num(evalNode(a[0], cx)), s = a[1] ? num(evalNode(a[1], cx)) : 1; return s === 0 ? 0 : Math.floor(x / s + 1e-9) * s; },
    SQRT: (a, cx) => { const x = num(evalNode(a[0], cx)); if (x < 0) throw E.num; return Math.sqrt(x); },
    POWER: (a, cx) => { const r = Math.pow(num(evalNode(a[0], cx)), num(evalNode(a[1], cx))); if (!isFinite(r)) throw E.num; return r; },
    MOD: (a, cx) => { const x = num(evalNode(a[0], cx)), d = num(evalNode(a[1], cx)); if (d === 0) throw E.div; return x - d * Math.floor(x / d); },
    EXP: (a, cx) => Math.exp(num(evalNode(a[0], cx))),
    LN: (a, cx) => { const x = num(evalNode(a[0], cx)); if (x <= 0) throw E.num; return Math.log(x); },
    LOG: (a, cx) => { const x = num(evalNode(a[0], cx)), b = a[1] ? num(evalNode(a[1], cx)) : 10; if (x <= 0 || b <= 0 || b === 1) throw E.num; return Math.log(x) / Math.log(b); },
    LOG10: (a, cx) => { const x = num(evalNode(a[0], cx)); if (x <= 0) throw E.num; return Math.log10(x); },
    PI: () => Math.PI,
    RAND: () => Math.random(),
    RANDBETWEEN: (a, cx) => { const lo = Math.ceil(num(evalNode(a[0], cx))), hi = Math.floor(num(evalNode(a[1], cx))); if (hi < lo) throw E.num; return lo + Math.floor(Math.random() * (hi - lo + 1)); },
    AND: (a, cx) => { let r = true, any = false; a.forEach(x => flat(evalNode(x, cx)).forEach(v => { if (isErr(v)) throw v; if (v === null || typeof v === 'string') return; any = true; if (!bool(v)) r = false; })); if (!any) throw E.val; return r; },
    OR: (a, cx) => { let r = false, any = false; a.forEach(x => flat(evalNode(x, cx)).forEach(v => { if (isErr(v)) throw v; if (v === null || typeof v === 'string') return; any = true; if (bool(v)) r = true; })); if (!any) throw E.val; return r; },
    NOT: (a, cx) => !bool(evalNode(a[0], cx)),
    TRUE: () => true, FALSE: () => false,
    CONCAT: (a, cx) => a.map(x => flat(evalNode(x, cx)).map(str).join('')).join(''),
    CONCATENATE: (a, cx) => a.map(x => str(evalNode(x, cx))).join(''),
    TEXTJOIN: (a, cx) => { const d = str(evalNode(a[0], cx)), skip = bool(evalNode(a[1], cx)); let v = []; a.slice(2).forEach(x => { v = v.concat(flat(evalNode(x, cx))); }); v = v.map(x => { if (isErr(x)) throw x; return str(x); }); return (skip ? v.filter(x => x !== '') : v).join(d); },
    LEN: (a, cx) => str(evalNode(a[0], cx)).length,
    UPPER: (a, cx) => str(evalNode(a[0], cx)).toUpperCase(),
    LOWER: (a, cx) => str(evalNode(a[0], cx)).toLowerCase(),
    PROPER: (a, cx) => str(evalNode(a[0], cx)).toLowerCase().replace(/(^|[^a-zà-ÿ0-9])([a-zà-ÿ])/g, (m, p, c) => p + c.toUpperCase()),
    TRIM: (a, cx) => str(evalNode(a[0], cx)).trim().replace(/\s+/g, ' '),
    LEFT: (a, cx) => str(evalNode(a[0], cx)).slice(0, a[1] ? Math.max(0, num(evalNode(a[1], cx))) : 1),
    RIGHT: (a, cx) => { const s = str(evalNode(a[0], cx)), n = a[1] ? Math.max(0, num(evalNode(a[1], cx))) : 1; return n ? s.slice(-n) : ''; },
    MID: (a, cx) => { const st = num(evalNode(a[1], cx)), n = num(evalNode(a[2], cx)); if (st < 1 || n < 0) throw E.val; return str(evalNode(a[0], cx)).substr(st - 1, n); },
    FIND: (a, cx) => { const i = str(evalNode(a[1], cx)).indexOf(str(evalNode(a[0], cx)), a[2] ? num(evalNode(a[2], cx)) - 1 : 0); if (i < 0) throw E.val; return i + 1; },
    SEARCH: (a, cx) => { const m = wild(str(evalNode(a[0], cx))).source.slice(1, -1), s = str(evalNode(a[1], cx)).slice(a[2] ? num(evalNode(a[2], cx)) - 1 : 0), x = new RegExp(m, 'i').exec(s); if (!x) throw E.val; return x.index + 1 + (a[2] ? num(evalNode(a[2], cx)) - 1 : 0); },
    SUBSTITUTE: (a, cx) => { const s = str(evalNode(a[0], cx)), o = str(evalNode(a[1], cx)), n = str(evalNode(a[2], cx)); if (!o) return s; if (a[3]) { let k = num(evalNode(a[3], cx)), i = -1; while (k-- > 0) { i = s.indexOf(o, i + 1); if (i < 0) return s; } return s.slice(0, i) + n + s.slice(i + o.length); } return s.split(o).join(n); },
    REPT: (a, cx) => { const n = num(evalNode(a[1], cx)); if (n < 0 || n > 10000) throw E.val; return str(evalNode(a[0], cx)).repeat(n); },
    EXACT: (a, cx) => str(evalNode(a[0], cx)) === str(evalNode(a[1], cx)),
    VALUE: (a, cx) => { const v = sc(evalNode(a[0], cx)); if (typeof v === 'number') return v; const p = C.parseInput(str(v)); if (typeof p.v !== 'number') throw E.val; return p.v; },
    TEXT: (a, cx) => fmtNum(num(evalNode(a[0], cx)), str(evalNode(a[1], cx))),
    TODAY: () => { const d = new Date(); return serialOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); },
    NOW: () => { const d = new Date(); return serialOf(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; },
    DATE: (a, cx) => serialOf(num(evalNode(a[0], cx)), num(evalNode(a[1], cx)), num(evalNode(a[2], cx))),
    YEAR: (a, cx) => dateOf(num(evalNode(a[0], cx))).getUTCFullYear(),
    MONTH: (a, cx) => dateOf(num(evalNode(a[0], cx))).getUTCMonth() + 1,
    DAY: (a, cx) => dateOf(num(evalNode(a[0], cx))).getUTCDate(),
    WEEKDAY: (a, cx) => { const w = dateOf(num(evalNode(a[0], cx))).getUTCDay(), t = a[1] ? num(evalNode(a[1], cx)) : 1; return t === 2 ? (w + 6) % 7 + 1 : t === 3 ? (w + 6) % 7 : w + 1; },
    DAYS: (a, cx) => Math.trunc(num(evalNode(a[0], cx))) - Math.trunc(num(evalNode(a[1], cx))),
    ISBLANK: (a, cx) => { const v = evalNode(a[0], cx); const x = v instanceof Range ? sc(v) : v; return x === null || x === undefined; },
    ISNUMBER: (a, cx) => typeof sc(evalNode(a[0], cx)) === 'number',
    ISTEXT: (a, cx) => typeof sc(evalNode(a[0], cx)) === 'string',
    ISERROR: (a, cx) => { try { sc(evalNode(a[0], cx)); return false; } catch (e) { if (isErr(e)) return true; throw e; } },
    ISNA: (a, cx) => { try { sc(evalNode(a[0], cx)); return false; } catch (e) { if (isErr(e)) return e === E.na; throw e; } },
    ROW: (a, cx) => { if (!a.length) return (cx.at ? cx.at.r : 0) + 1; return (a[0].r1 || 0) + 1; },
    COLUMN: (a, cx) => { if (!a.length) return (cx.at ? cx.at.c : 0) + 1; return (a[0].c1 || 0) + 1; },
    ROWS: (a, cx) => { const v = evalNode(a[0], cx); return v instanceof Range ? v.rows : 1; },
    COLUMNS: (a, cx) => { const v = evalNode(a[0], cx); return v instanceof Range ? v.cols : 1; },
    CHOOSE: (a, cx) => { const i = Math.trunc(num(evalNode(a[0], cx))); if (i < 1 || i >= a.length) throw E.val; return sc(evalNode(a[i], cx)); },
    INDEX: (a, cx) => {
      const r = rng(evalNode(a[0], cx));
      let i = a[1] ? Math.trunc(num(evalNode(a[1], cx))) : 1, j = a[2] ? Math.trunc(num(evalNode(a[2], cx))) : 1;
      if (r.rows === 1 && !a[2]) { j = i; i = 1; }
      if (i < 1 || j < 1 || i > r.rows || j > r.cols) throw E.ref;
      const v = r.at(i - 1, j - 1); if (isErr(v)) throw v; return v;
    },
    MATCH: (a, cx) => {
      const k = evalNode(a[0], cx), r = rng(evalNode(a[1], cx)), t = a[2] ? num(evalNode(a[2], cx)) : 1, vec = flat(r);
      const i = t === 0 ? LOOK(k, vec, true) : LOOK(k, vec, false);
      if (i < 0) throw E.na; return i + 1;
    },
    VLOOKUP: (a, cx) => {
      const k = evalNode(a[0], cx), r = rng(evalNode(a[1], cx)), col = Math.trunc(num(evalNode(a[2], cx))), exact = a[3] ? !bool(evalNode(a[3], cx)) : false;
      if (col < 1 || col > r.cols) throw E.ref;
      const vec = []; for (let i = 0; i < r.rows; i++) vec.push(r.at(i, 0));
      const i = LOOK(k, vec, exact); if (i < 0) throw E.na;
      const v = r.at(i, col - 1); if (isErr(v)) throw v; return v;
    },
    HLOOKUP: (a, cx) => {
      const k = evalNode(a[0], cx), r = rng(evalNode(a[1], cx)), row = Math.trunc(num(evalNode(a[2], cx))), exact = a[3] ? !bool(evalNode(a[3], cx)) : false;
      if (row < 1 || row > r.rows) throw E.ref;
      const vec = []; for (let i = 0; i < r.cols; i++) vec.push(r.at(0, i));
      const i = LOOK(k, vec, exact); if (i < 0) throw E.na;
      const v = r.at(row - 1, i); if (isErr(v)) throw v; return v;
    }
  };
  C.functions = Object.keys(FN).concat(['IF', 'IFS', 'IFERROR', 'IFNA']).sort();

  function call(n, cx) {
    const a = n.args;
    switch (n.name) {
      case 'IF': {
        if (a.length < 2) throw E.val;
        if (bool(evalNode(a[0], cx))) return sc(evalNode(a[1], cx));
        return a[2] ? sc(evalNode(a[2], cx)) : false;
      }
      case 'IFS': { for (let i = 0; i + 1 < a.length; i += 2) if (bool(evalNode(a[i], cx))) return sc(evalNode(a[i + 1], cx)); throw E.na; }
      case 'IFERROR': case 'IFNA': {
        try { return sc(evalNode(a[0], cx)); } catch (e) { if (isErr(e) && (n.name === 'IFERROR' || e === E.na)) return sc(evalNode(a[1], cx)); throw e; }
      }
    }
    const f = FN[n.name.replace(/^_xlfn\./i, '')];
    if (!f) throw E.name;
    return f(a, cx);
  }

  // ---------- formatação de números ----------
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const group = (s, sep) => s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  function general(v) {
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    let s = String(+v.toPrecision(10));
    if (/e/i.test(s)) s = v.toExponential(5).replace(/\.?0+e/, 'e').replace('e+', 'E+').replace('e-', 'E-');
    return s.replace('.', ',');
  }
  function fmtDate(v, nf) {
    const d = dateOf(v);
    const hasAmPm = /AM\/PM|A\/P/i.test(nf);
    let out = '', i = 0, prevH = false;
    const toks = nf.match(/"[^"]*"|\\.|\[[^\]]*\]|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|./gi) || [];
    toks.forEach((t, k) => {
      const l = t.toLowerCase();
      if (t[0] === '"') out += t.slice(1, -1);
      else if (t[0] === '\\') out += t.slice(1);
      else if (t[0] === '[') { /* [h] etc.: ignora */ }
      else if (l === 'yyyy') out += d.getUTCFullYear();
      else if (l === 'yy') out += String(d.getUTCFullYear()).slice(-2);
      else if (l === 'mmmm') out += MESES[d.getUTCMonth()];
      else if (l === 'mmm') out += MESES[d.getUTCMonth()].slice(0, 3);
      else if (l === 'mm' || l === 'm') {
        const nextS = toks.slice(k + 1).some(x => /^s+$/i.test(x)), isMin = prevH || (nextS && !toks.slice(k + 1).some(x => /^(y|d)/i.test(x)));
        const val = isMin ? d.getUTCMinutes() : d.getUTCMonth() + 1;
        out += l === 'mm' ? String(val).padStart(2, '0') : val;
      }
      else if (l === 'dddd') out += DIAS[d.getUTCDay()];
      else if (l === 'ddd') out += DIAS[d.getUTCDay()].slice(0, 3);
      else if (l === 'dd') out += String(d.getUTCDate()).padStart(2, '0');
      else if (l === 'd') out += d.getUTCDate();
      else if (l === 'hh' || l === 'h') { let h = d.getUTCHours(); if (hasAmPm) h = h % 12 || 12; out += l === 'hh' ? String(h).padStart(2, '0') : h; }
      else if (l === 'ss') out += String(d.getUTCSeconds()).padStart(2, '0');
      else if (l === 's') out += d.getUTCSeconds();
      else if (l === 'am/pm' || l === 'a/p') out += d.getUTCHours() < 12 ? (l === 'a/p' ? 'A' : 'AM') : (l === 'a/p' ? 'P' : 'PM');
      else out += t;
      prevH = l === 'h' || l === 'hh' || (prevH && !/^[a-z]/i.test(t) && l !== ':' ? false : (l === ':' ? prevH : false));
      void i;
    });
    return out;
  }
  const isDateFmt = nf => { const s = nf.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''); return /[dmyhs]/i.test(s) && !/[#0]/.test(s); };
  C.isDateFmt = isDateFmt;
  function fmtNum(v, nf) {
    if (!nf || /^general$/i.test(nf) || nf === '@') return general(v);
    const secs = nf.split(';');
    let sec = secs[0];
    if (v < 0 && secs.length > 1) { sec = secs[1]; v = -v; } else if (v === 0 && secs.length > 2) sec = secs[2];
    if (isDateFmt(sec)) return fmtDate(v, sec);
    // literais antes e depois do padrão numérico
    const tok = sec.match(/"[^"]*"|\\.|\[[^\]]*\]|[#0?,.%]+|[^"\\[#0?,.%]+/g) || [];
    let pre = '', post = '', pat = '', pct = false, seen = false;
    tok.forEach(t => {
      if (/^[#0?,.%]+$/.test(t)) {
        if (t.indexOf('%') >= 0) pct = true;
        const core = t.replace(/%/g, '');
        if (core && !seen) { pat = core; seen = true; if (t.indexOf('%') >= 0 && /%$/.test(t)) post += '%'; }
        else if (core && seen) pat += core;
        else if (t === '%') (seen ? post : pre) && 0, seen ? (post += '%') : (pre += '%');
        return;
      }
      let lit = t[0] === '"' ? t.slice(1, -1) : t[0] === '\\' ? t.slice(1) : t[0] === '[' ? (/^\[\$([^\]-]*)/.exec(t) || [0, ''])[1] : t;
      if (seen) post += lit; else pre += lit;
    });
    if (!seen) return pre + post;
    if (pct) v *= 100;
    const dot = pat.indexOf('.'), intPart = dot < 0 ? pat : pat.slice(0, dot), decPart = dot < 0 ? '' : pat.slice(dot + 1);
    const decs = decPart.replace(/,/g, '').length, minDec = (decPart.match(/0/g) || []).length, thousands = intPart.indexOf(',') >= 0;
    let s = Math.abs(rnd(v, decs)).toFixed(decs);
    let [ip, dp] = s.split('.');
    const minInt = (intPart.match(/0/g) || []).length;
    ip = ip.replace(/^0+(?=\d)/, '');
    if (ip === '0' && minInt === 0) ip = '';
    ip = ip.padStart(minInt, '0');
    if (thousands) ip = group(ip, '.');
    if (dp) { dp = dp.replace(new RegExp('0{0,' + (decs - minDec) + '}$'), ''); }
    const body = ip + (dp ? ',' + dp : '');
    return (v < 0 && +s !== 0 && secs.length < 2 ? '-' : '') + pre + body + post;
  }
  C.format = function (v, nf) {
    if (isErr(v)) return v.c;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
    if (typeof v === 'string') return v;
    return fmtNum(v, nf);
  };

  // ---------- o que o usuário digita ----------
  // Devolve { v, nf }: número (aceita 1,5 e 1.234,56), porcentagem, moeda (R$), data (dd/mm/aaaa), verdadeiro/falso; o resto é texto.
  C.parseInput = function (t) {
    const s = String(t).trim();
    if (s === '') return { v: null };
    if (/^(true|verdadeiro)$/i.test(s)) return { v: true };
    if (/^(false|falso)$/i.test(s)) return { v: false };
    let m = /^([+-]?)\s*(R\$|\$|€)?\s*([+-]?)(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(%)?$/.exec(s);
    if (m) {
      let n = m[4];
      if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(n)) n = n.replace(/\./g, '').replace(',', '.'); else n = n.replace(',', '.');
      let v = parseFloat(n);
      if (m[1] === '-' || m[3] === '-') v = -v;
      if (m[5]) return { v: v / 100, nf: /[.,]\d/.test(m[4]) ? '0.00%' : '0%' };
      if (m[2]) return { v: v, nf: m[2] === 'R$' ? 'R$ #,##0.00' : m[2] === '€' ? '€ #,##0.00' : '$ #,##0.00' };
      return { v: v };
    }
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(s))) {
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3], mo = +m[2], d = +m[1];
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) return { v: serialOf(y, mo, d), nf: 'dd/mm/yyyy' };
    }
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return { v: serialOf(+m[1], +m[2], +m[3]), nf: 'dd/mm/yyyy' };
    if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) return { v: parseFloat(s) };
    return { v: t };
  };
})(window.DK = window.DK || {});
