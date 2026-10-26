(function (DK) {
  // Conversão entre o HTML do editor e os pacotes .docx (Word) e .odt (LibreOffice/OpenDocument).
  // O que o editor mantém: parágrafos, títulos 1-3, negrito, itálico, sublinhado, tachado, fonte, tamanho, cor, alinhamento, listas
  // (com níveis), tabelas, links e imagens. O que ele NÃO mantém: cabeçalho e rodapé, notas, comentários, caixas de texto,
  // espaçamentos e estilos avançados; read() avisa quando encontra isso (info.lossy) para a tela perguntar antes de substituir o original.
  const Z = DK.zip;
  const F = DK.docfmt = {};

  // ---------- utilidades ----------
  const xesc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const mk = (tag, props) => { const e = document.createElement(tag); if (props) Object.assign(e, props); return e; };
  const safeHref = h => (/^(https?:|mailto:|tel:)/i.test(h || '') ? h : '');
  const px2emu = px => Math.round(px * 9525);
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' };
  function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function fromB64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function dataUrl(u8, ext) { const m = MIME[ext]; return m ? 'data:' + m + ';base64,' + b64(u8) : ''; }
  function parseDataUrl(src) { const m = /^data:(image\/(?:png|jpeg|gif));base64,(.*)$/s.exec(src || ''); return m ? { type: m[1], bytes: fromB64(m[2]) } : null; }
  function parseXml(text) {
    const d = new DOMParser().parseFromString(text, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('o conteúdo do documento está corrompido');
    return d;
  }
  const kids = (n, local) => [].filter.call(n.childNodes, c => c.nodeType === 1 && (!local || c.localName === local));
  const first = (n, local) => kids(n, local)[0] || null;
  const attrNs = (n, ns, local) => (n.getAttributeNS(ns, local) || '');

  // ---------- HTML do editor -> blocos ----------
  // bloco: { t: 'p', h: 0-3, align, list: { type: 'ul'|'ol', level }|null, runs } | { t: 'table', rows: [[ { blocks, span } ]] }
  // run:   { text, b, i, u, s, f, sz (pt), c (#rrggbb), href } | { br: true } | { img, w, h }
  function rgbHex(v) {
    v = String(v || '').trim();
    let m = /^#([0-9a-f]{6})$/i.exec(v); if (m) return '#' + m[1].toLowerCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v); if (m) return ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase();
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    return m ? '#' + [m[1], m[2], m[3]].map(x => ('0' + (+x).toString(16)).slice(-2)).join('') : '';
  }
  function fmtOf(n, base) {
    const f = Object.assign({}, base), s = n.style || {}, tag = n.tagName;
    if (tag === 'B' || tag === 'STRONG') f.b = true;
    if (tag === 'I' || tag === 'EM') f.i = true;
    if (tag === 'U') f.u = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.s = true;
    if (s.fontWeight === 'bold' || +s.fontWeight >= 600) f.b = true;
    if (s.fontStyle === 'italic') f.i = true;
    const td = s.textDecorationLine || s.textDecoration || '';
    if (td.indexOf('underline') >= 0) f.u = true;
    if (td.indexOf('line-through') >= 0) f.s = true;
    if (s.fontFamily) f.f = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    const sz = /^([\d.]+)pt$/.exec(s.fontSize || ''); if (sz) f.sz = +sz[1];
    else { const pxs = /^([\d.]+)px$/.exec(s.fontSize || ''); if (pxs) f.sz = Math.round(+pxs[1] * 0.75 * 2) / 2; }
    const c = rgbHex(s.color); if (c) f.c = c;
    if (tag === 'A' && safeHref(n.getAttribute('href'))) f.href = n.getAttribute('href');
    if (tag === 'FONT') { const fc = rgbHex(n.getAttribute('color')); if (fc) f.c = fc; if (n.getAttribute('face')) f.f = n.getAttribute('face'); }
    return f;
  }
  const BLOCK = /^(P|DIV|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|LI)$/;
  function inlineRuns(node, fmt, runs, deep) {
    [].forEach.call(node.childNodes, c => {
      if (c.nodeType === 3) { if (c.nodeValue) runs.push(Object.assign({ text: c.nodeValue }, fmt)); return; }
      if (c.nodeType !== 1) return;
      const tag = c.tagName;
      if (tag === 'BR') runs.push({ br: true });
      else if (tag === 'IMG') { const w = +c.getAttribute('width') || c.width || 0, h = +c.getAttribute('height') || c.height || 0; runs.push({ img: c.getAttribute('src') || '', w: w, h: h }); }
      else if (tag === 'UL' || tag === 'OL' || tag === 'TABLE') { /* tratados como blocos */ }
      else if (BLOCK.test(tag)) { if (deep) { if (runs.length) runs.push({ br: true }); inlineRuns(c, fmtOf(c, fmt), runs, deep); } }
      else inlineRuns(c, fmtOf(c, fmt), runs, deep);
    });
  }
  const alignOf = n => { const a = (n.style && n.style.textAlign) || n.getAttribute('align') || ''; return { center: 'center', right: 'right', justify: 'justify', end: 'right' }[a] || ''; };

  function domToBlocks(root, out) {
    out = out || [];
    let pend = [];
    const flush = () => { if (pend.some(r => r.br || r.img || (r.text && r.text.trim()))) out.push({ t: 'p', h: 0, align: '', list: null, runs: pend }); pend = []; };
    [].forEach.call(root.childNodes, c => {
      if (c.nodeType === 3) { if (c.nodeValue) pend.push({ text: c.nodeValue }); return; }
      if (c.nodeType !== 1) return;
      const tag = c.tagName;
      if (tag === 'UL' || tag === 'OL') { flush(); listBlocks(c, 0, out); }
      else if (tag === 'TABLE') { flush(); out.push(tableBlock(c)); }
      else if (/^(P|H[1-6]|BLOCKQUOTE|PRE)$/.test(tag) || (tag === 'DIV' && !kids(c).some(k => BLOCK.test(k.tagName)))) {
        flush();
        const runs = [];
        inlineRuns(c, fmtOf(c, {}), runs, false);
        out.push({ t: 'p', h: /^H[1-6]$/.test(tag) ? Math.min(+tag[1], 3) : 0, align: alignOf(c), list: null, runs: runs });
      } else if (tag === 'DIV') { flush(); domToBlocks(c, out); }
      else { const runs = []; inlineRuns({ childNodes: [c] }, {}, runs, false); pend = pend.concat(runs); }
    });
    flush();
    return out;
  }
  function listBlocks(list, level, out) {
    const type = list.tagName === 'OL' ? 'ol' : 'ul';
    kids(list, 'li').forEach(li => {
      const runs = [];
      inlineRuns(li, fmtOf(li, {}), runs, true);
      out.push({ t: 'p', h: 0, align: '', list: { type: type, level: Math.min(level, 8) }, runs: runs });
      kids(li).filter(k => k.tagName === 'UL' || k.tagName === 'OL').forEach(sub => listBlocks(sub, level + 1, out));
    });
  }
  function tableBlock(tbl) {
    const rows = [];
    [].forEach.call(tbl.querySelectorAll('tr'), tr => {
      if (tr.closest('table') !== tbl) return;                         // linhas de tabelas aninhadas ficam com a tabela delas
      rows.push(kids(tr).filter(c => /^(TD|TH)$/.test(c.tagName)).map(td => {
        const b = domToBlocks(td);
        return { blocks: b.length ? b : [{ t: 'p', h: 0, align: '', list: null, runs: [] }], span: +td.getAttribute('colspan') || 1 };
      }));
    });
    return { t: 'table', rows: rows.filter(r => r.length) };
  }
  F.blocksOf = domToBlocks;

  // ---------- blocos -> DOCX ----------
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

  function docxRunProps(r) {
    let p = '';
    if (r.f) p += '<w:rFonts w:ascii="' + xesc(r.f) + '" w:hAnsi="' + xesc(r.f) + '" w:cs="' + xesc(r.f) + '"/>';
    if (r.b) p += '<w:b/>';
    if (r.i) p += '<w:i/>';
    if (r.s) p += '<w:strike/>';
    if (r.c) p += '<w:color w:val="' + r.c.slice(1) + '"/>';
    else if (r.href) p += '<w:color w:val="0563C1"/>';
    if (r.sz) p += '<w:sz w:val="' + Math.round(r.sz * 2) + '"/><w:szCs w:val="' + Math.round(r.sz * 2) + '"/>';
    if (r.u || r.href) p += '<w:u w:val="single"/>';
    return p ? '<w:rPr>' + p + '</w:rPr>' : '';
  }
  function docxRun(r, ctx) {
    if (r.br) return '<w:r><w:br/></w:r>';
    if (r.img !== undefined) return docxImage(r, ctx);
    const rp = docxRunProps(r), parts = String(r.text).split(/(\t|\r?\n)/);
    let x = '';
    parts.forEach(p => {
      if (p === '\t') x += '<w:tab/>';
      else if (p === '\n' || p === '\r\n') x += '<w:br/>';
      else if (p) x += '<w:t xml:space="preserve">' + xesc(p) + '</w:t>';
    });
    return x ? '<w:r>' + rp + x + '</w:r>' : '';
  }
  function docxImage(r, ctx) {
    const d = parseDataUrl(r.img);
    if (!d) { ctx.skippedImages++; return ''; }
    const n = ++ctx.imgN, ext = EXT[d.type], rid = 'rId' + (100 + n);
    ctx.media.push({ name: 'word/media/image' + n + '.' + ext, data: d.bytes });
    ctx.rels.push('<Relationship Id="' + rid + '" Type="' + REL + 'image" Target="media/image' + n + '.' + ext + '"/>');
    const w = px2emu(r.w || 300), h = px2emu(r.h || 200);
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + w + '" cy="' + h + '"/><wp:docPr id="' + n + '" name="Imagem ' + n + '"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + n + '" name="image' + n + '.' + ext + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }
  function docxParagraph(b, ctx) {
    let ppr = '';
    if (b.h) ppr += '<w:pStyle w:val="Heading' + b.h + '"/>';
    else if (b.list) ppr += '<w:pStyle w:val="ListParagraph"/>';
    if (b.list) ppr += '<w:numPr><w:ilvl w:val="' + b.list.level + '"/><w:numId w:val="' + b.numId + '"/></w:numPr>';
    const jc = { center: 'center', right: 'right', justify: 'both' }[b.align];
    if (jc) ppr += '<w:jc w:val="' + jc + '"/>';
    let body = '';
    for (let i = 0; i < b.runs.length;) {                                  // runs seguidos com o mesmo link viram um <w:hyperlink>
      const r = b.runs[i];
      if (r.href) {
        let j = i, inner = '';
        while (j < b.runs.length && b.runs[j].href === r.href) inner += docxRun(b.runs[j++], ctx);
        const rid = 'rId' + (500 + ++ctx.linkN);
        ctx.rels.push('<Relationship Id="' + rid + '" Type="' + REL + 'hyperlink" Target="' + xesc(r.href) + '" TargetMode="External"/>');
        body += '<w:hyperlink r:id="' + rid + '" w:history="1">' + inner + '</w:hyperlink>';
        i = j;
      } else body += docxRun(r, ctx), i++;
    }
    return '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + body + '</w:p>';
  }
  function docxBlocks(blocks, ctx) {
    let x = '', prev = null, prevTable = false;                            // prev: lista do parágrafo anterior (null se não era de lista)
    blocks.forEach(b => {
      if (b.t === 'table') { x += (prevTable ? '<w:p/>' : '') + docxTable(b, ctx); prev = null; prevTable = true; return; }
      prevTable = false;
      if (b.list) {
        if (b.list.type === 'ol') {
          // uma lista numerada nova recomeça em 1; um item aninhado ou o item seguinte continua a numeração
          if (!prev || !ctx.lastOl || (prev.type === 'ul' && prev.level === 0 && b.list.level === 0)) ctx.lastOl = ctx.newNum();
          b.numId = ctx.lastOl;
        } else b.numId = 1;
      }
      prev = b.list || null;
      x += docxParagraph(b, ctx);
    });
    return prevTable ? x + '<w:p/>' : x;                                   // o Word exige um parágrafo depois de uma tabela no fim do corpo/célula
  }
  function docxTable(t, ctx) {
    const cols = Math.max.apply(null, t.rows.map(r => r.reduce((n, c) => n + c.span, 0)));
    let x = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="808080"/>').join('') +
      '</w:tblBorders></w:tblPr><w:tblGrid>' + ('<w:gridCol w:w="' + Math.floor(9000 / cols) + '"/>').repeat(cols) + '</w:tblGrid>';
    t.rows.forEach(r => {
      x += '<w:tr>';
      r.forEach(c => {
        const saved = ctx.lastOl;
        ctx.lastOl = 0;
        const inner = docxBlocks(c.blocks, ctx);
        ctx.lastOl = saved;
        x += '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>' + (c.span > 1 ? '<w:gridSpan w:val="' + c.span + '"/>' : '') + '</w:tcPr>' + (inner.endsWith('</w:p>') ? inner : inner + '<w:p/>') + '</w:tc>';
      });
      x += '</w:tr>';
    });
    return x + '</w:tbl>';
  }
  const lvlXml = (kind, i) => '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + (kind === 'ul' ? 'bullet' : 'decimal') + '"/><w:lvlText w:val="' +
    (kind === 'ul' ? '•' : '%' + (i + 1) + '.') + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 * (i + 1)) + '" w:hanging="360"/></w:pPr></w:lvl>';

  F.toDocx = async function (root, meta) {
    const blocks = domToBlocks(root);
    const nums = [];
    const ctx = { rels: [], media: [], imgN: 0, linkN: 0, skippedImages: 0, lastOl: 0, newNum: null };
    ctx.newNum = () => { const id = 3 + nums.length; nums.push(id); return id; };
    const body = docxBlocks(blocks, ctx);
    const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="' + W_NS + '" xmlns:r="' + R_NS + '" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1134" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="' + W_NS + '"><w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      [[1, 36, 240], [2, 30, 200], [3, 26, 160]].map(h => '<w:style w:type="paragraph" w:styleId="Heading' + h[0] + '"><w:name w:val="heading ' + h[0] + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
        '<w:pPr><w:keepNext/><w:spacing w:before="' + h[2] + '" w:after="80"/><w:outlineLvl w:val="' + (h[0] - 1) + '"/></w:pPr><w:rPr><w:b/><w:sz w:val="' + h[1] + '"/><w:szCs w:val="' + h[1] + '"/></w:rPr></w:style>').join('') +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style></w:styles>';
    let lv = { ul: '', ol: '' };
    for (let i = 0; i < 9; i++) { lv.ul += lvlXml('ul', i); lv.ol += lvlXml('ol', i); }
    const numbering = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="' + W_NS + '">' +
      '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + lv.ul + '</w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + lv.ol + '</w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
      nums.map(id => '<w:num w:numId="' + id + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>').join('') + '</w:numbering>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + REL + 'styles" Target="styles.xml"/><Relationship Id="rId2" Type="' + REL + 'numbering" Target="numbering.xml"/>' + ctx.rels.join('') + '</Relationships>';
    const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>';
    const root_rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + REL + 'officeDocument" Target="word/document.xml"/></Relationships>';
    const blob = await Z.write([{ name: '[Content_Types].xml', data: types }, { name: '_rels/.rels', data: root_rels }, { name: 'word/document.xml', data: doc },
      { name: 'word/styles.xml', data: styles }, { name: 'word/numbering.xml', data: numbering }, { name: 'word/_rels/document.xml.rels', data: rels }]
      .concat(ctx.media.map(m => ({ name: m.name, data: m.data, store: true }))));
    return { blob: blob, skippedImages: ctx.skippedImages };
  };

  // ---------- DOCX -> HTML ----------
  F.fromDocx = async function (buf) {
    const files = await Z.read(buf);
    if (!files['word/document.xml']) throw new Error('não é um documento do Word (.docx)');
    const info = { lossy: [], format: 'docx' };
    const doc = parseXml(Z.text(files['word/document.xml']));
    const styleNames = {}, numType = {}, rels = {};
    if (files['word/styles.xml']) kids(parseXml(Z.text(files['word/styles.xml'])).documentElement, 'style').forEach(s => {
      const n = first(s, 'name'); styleNames[attrNs(s, W_NS, 'styleId')] = n ? attrNs(n, W_NS, 'val').toLowerCase() : '';
    });
    if (files['word/numbering.xml']) {
      const nd = parseXml(Z.text(files['word/numbering.xml'])).documentElement, abs = {};
      kids(nd, 'abstractNum').forEach(a => { const l = first(a, 'lvl'); const f = l && first(l, 'numFmt'); abs[attrNs(a, W_NS, 'abstractNumId')] = f ? attrNs(f, W_NS, 'val') : 'bullet'; });
      kids(nd, 'num').forEach(n => { const a = first(n, 'abstractNumId'); numType[attrNs(n, W_NS, 'numId')] = a && abs[attrNs(a, W_NS, 'val')] !== 'bullet' ? 'ol' : 'ul'; });
    }
    if (files['word/_rels/document.xml.rels']) kids(parseXml(Z.text(files['word/_rels/document.xml.rels'])).documentElement, 'Relationship').forEach(r => { rels[r.getAttribute('Id')] = { target: r.getAttribute('Target'), mode: r.getAttribute('TargetMode') }; });
    Object.keys(files).forEach(n => {
      if (/^word\/(header|footer)\d*\.xml$/.test(n) && /<w:t[ >]/.test(Z.text(files[n]))) info.lossy.push('cabeçalho/rodapé');
      if (/^word\/(comments|endnotes)\.xml$/.test(n) && /<w:t[ >]/.test(Z.text(files[n]))) info.lossy.push('comentários/notas de fim');
      if (/^word\/(charts|diagrams|embeddings)\//.test(n)) info.lossy.push('gráficos/objetos');
    });
    const out = mk('div');
    const note = what => { if (info.lossy.indexOf(what) < 0) info.lossy.push(what); };

    function runFmt(r) {
      const pr = first(r, 'rPr'), f = {};
      if (!pr) return f;
      const on = n => { const e = first(pr, n); if (!e) return false; const v = attrNs(e, W_NS, 'val'); return v !== '0' && v !== 'false' && v !== 'none'; };
      if (on('b')) f.b = true; if (on('i')) f.i = true; if (on('u')) f.u = true; if (on('strike')) f.s = true;
      const fo = first(pr, 'rFonts'); if (fo) f.f = attrNs(fo, W_NS, 'ascii') || attrNs(fo, W_NS, 'hAnsi');
      const sz = first(pr, 'sz'); if (sz) f.sz = (+attrNs(sz, W_NS, 'val')) / 2;
      const co = first(pr, 'color'); if (co) { const v = attrNs(co, W_NS, 'val'); if (/^[0-9a-f]{6}$/i.test(v)) f.c = '#' + v.toLowerCase(); }
      return f;
    }
    function styleSpan(text, f) {
      if (!f.b && !f.i && !f.u && !f.s && !f.f && !f.sz && !f.c && !f.href) return document.createTextNode(text);
      let n = f.href ? mk('a', { href: f.href }) : mk('span');
      const s = n.style;
      if (f.b) s.fontWeight = 'bold'; if (f.i) s.fontStyle = 'italic';
      const td = [f.u ? 'underline' : '', f.s ? 'line-through' : ''].filter(Boolean).join(' '); if (td) s.textDecoration = td;
      if (f.f) s.fontFamily = '"' + f.f.replace(/"/g, '') + '"'; if (f.sz) s.fontSize = f.sz + 'pt'; if (f.c) s.color = f.c;
      n.append(text);
      return n;
    }
    function image(drawing) {
      const blip = drawing.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')[0];
      if (!blip) return null;
      const rel = rels[attrNs(blip, R_NS, 'embed')];
      if (!rel) return null;
      const file = files['word/' + rel.target.replace(/^\.?\//, '')] || files[rel.target.replace(/^\//, '')];
      const ext = (rel.target.split('.').pop() || '').toLowerCase();
      if (!file || !MIME[ext]) { note('imagens em formato não suportado'); return null; }
      const img = mk('img', { src: dataUrl(file, ext), alt: '' });
      const ex = drawing.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0];
      if (ex) { img.width = Math.round(+ex.getAttribute('cx') / 9525); img.height = Math.round(+ex.getAttribute('cy') / 9525); }
      return img;
    }
    function inline(node, into, href) {
      kids(node).forEach(c => {
        const n = c.localName;
        if (n === 'r') {
          const f = runFmt(c); if (href) f.href = href;
          let buf = '';
          const flush = () => { if (buf) { into.append(styleSpan(buf, f)); buf = ''; } };
          kids(c).forEach(x => {
            const l = x.localName;
            if (l === 't') buf += x.textContent;
            else if (l === 'tab') buf += '\t';
            else if (l === 'br' || l === 'cr') { if (attrNs(x, W_NS, 'type') !== 'page') { flush(); into.append(mk('br')); } }
            else if (l === 'noBreakHyphen') buf += '-';
            else if (l === 'drawing') { flush(); const im = image(x); if (im) into.append(im); }
            else if (l === 'pict' || l === 'object') note('objetos incorporados');
            else if (l === 'footnoteReference' || l === 'endnoteReference') note('notas de rodapé');
          });
          flush();
        } else if (n === 'hyperlink') {
          const rel = rels[attrNs(c, R_NS, 'id')];
          inline(c, into, rel && rel.mode === 'External' ? safeHref(rel.target) || href : href);
        } else if (n === 'del' || n === 'moveFrom') { note('alterações controladas (trechos excluídos foram ocultados)'); }
        else if (n === 'ins' || n === 'fldSimple' || n === 'smartTag' || n === 'sdt' || n === 'sdtContent' || n === 'moveTo') inline(n === 'sdt' ? (first(c, 'sdtContent') || c) : c, into, href);
        else if (n === 'txbxContent') note('caixas de texto');
      });
    }
    function block(p, host, state) {
      const ppr = first(p, 'pPr');
      let h = 0, align = '', list = null;
      if (ppr) {
        const ps = first(ppr, 'pStyle');
        if (ps) { const id = attrNs(ps, W_NS, 'val'), nm = styleNames[id] || id.toLowerCase(); const m = /heading\s*(\d)/.exec(nm); if (m) h = Math.min(+m[1], 3); else if (nm === 'title') h = 1; else if (nm === 'subtitle') h = 2; }
        const np = first(ppr, 'numPr');
        if (np) { const id = first(np, 'numId'), lv = first(np, 'ilvl'); const nid = id ? attrNs(id, W_NS, 'val') : ''; if (nid && nid !== '0') list = { type: numType[nid] || 'ul', level: lv ? +attrNs(lv, W_NS, 'val') : 0 }; }
        const jc = first(ppr, 'jc'); if (jc) align = { center: 'center', right: 'right', end: 'right', both: 'justify' }[attrNs(jc, W_NS, 'val')] || '';
      }
      let target;
      if (list) {
        target = listItem(state, host, Math.min(list.level, 8), list.type);
      } else {
        state.stack = [];
        target = mk(h ? 'h' + h : 'p');
        if (align) target.style.textAlign = align;
        host.append(target);
      }
      inline(p, target, '');
      if (!list && !target.childNodes.length) target.append(mk('br'));
    }
    function listItem(state, host, level, type) {
      const st = state.stack;
      while (st.length > level + 1) st.pop();
      if (st.length === level + 1 && st[level].tagName.toLowerCase() !== type) st.pop();
      while (st.length < level + 1) {
        const l = mk(st.length === level ? type : 'ul');
        const parent = st.length ? (st[st.length - 1].lastElementChild || st[st.length - 1].appendChild(mk('li'))) : host;
        parent.append(l); st.push(l);
      }
      const li = mk('li');
      st[level].append(li);
      return li;
    }
    function table(tbl, host, state) {
      state.stack = [];
      const t = mk('table'), tb = mk('tbody'); t.append(tb);
      kids(tbl, 'tr').forEach(tr => {
        const row = mk('tr');
        kids(tr, 'tc').forEach(tc => {
          const pr = first(tc, 'tcPr'), span = pr && first(pr, 'gridSpan'), vm = pr && first(pr, 'vMerge');
          if (vm && attrNs(vm, W_NS, 'val') !== 'restart') { row.append(mk('td')); return; }   // continuação de célula mesclada: mantém a coluna
          const cell = mk('td'); if (span && +attrNs(span, W_NS, 'val') > 1) cell.colSpan = +attrNs(span, W_NS, 'val');
          container(tc, cell);
          if (!cell.childNodes.length) cell.append(mk('p', { innerHTML: '<br>' }));
          row.append(cell);
        });
        tb.append(row);
      });
      host.append(t);
    }
    function container(node, host) {
      const state = { stack: [] };
      kids(node).forEach(c => {
        const n = c.localName;
        if (n === 'p') block(c, host, state);
        else if (n === 'tbl') table(c, host, state);
        else if (n === 'sdt') container(first(c, 'sdtContent') || c, host);
      });
    }
    container(doc.getElementsByTagNameNS(W_NS, 'body')[0], out);
    info.lossy = info.lossy.filter((v, i, a) => a.indexOf(v) === i);
    return { node: out, info: info };
  };

  // ---------- blocos -> ODT ----------
  const ODF_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
    'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"';
  const px2cm = px => (px / 96 * 2.54).toFixed(2) + 'cm';

  F.toOdt = async function (root) {
    const blocks = domToBlocks(root);
    const styles = {}, media = [];
    let sN = 0, imgN = 0, skipped = 0;
    const spanStyle = r => {
      const key = [r.b, r.i, r.u, r.s, r.f, r.sz, r.c, r.href ? 1 : 0].join('|');
      if (!styles[key]) {
        let p = '';
        if (r.b) p += ' fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"';
        if (r.i) p += ' fo:font-style="italic"';
        if (r.u || r.href) p += ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"';
        if (r.s) p += ' style:text-line-through-style="solid"';
        if (r.f) p += ' fo:font-family="' + xesc(r.f) + '"';
        if (r.sz) p += ' fo:font-size="' + r.sz + 'pt"';
        if (r.c || r.href) p += ' fo:color="' + (r.c || '#0563c1') + '"';
        styles[key] = { name: 'T' + (++sN), xml: '<style:style style:name="T' + sN + '" style:family="text"><style:text-properties' + p + '/></style:style>' };
      }
      return styles[key].name;
    };
    const odtRun = r => {
      if (r.br) return '<text:line-break/>';
      if (r.img !== undefined) {
        const d = parseDataUrl(r.img);
        if (!d) { skipped++; return ''; }
        const n = ++imgN, name = 'Pictures/image' + n + '.' + EXT[d.type];
        media.push({ name: name, data: d.bytes, type: d.type });
        return '<draw:frame draw:name="Imagem' + n + '" text:anchor-type="as-char" svg:width="' + px2cm(r.w || 300) + '" svg:height="' + px2cm(r.h || 200) + '"><draw:image xlink:href="' + name + '" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>';
      }
      const plain = !(r.b || r.i || r.u || r.s || r.f || r.sz || r.c || r.href);
      let t = xesc(r.text).replace(/\t/g, '<text:tab/>').replace(/\r?\n/g, '<text:line-break/>').replace(/ {2,}/g, m => ' <text:s text:c="' + (m.length - 1) + '"/>');
      if (!plain) t = '<text:span text:style-name="' + spanStyle(r) + '">' + t + '</text:span>';
      return r.href ? '<text:a xlink:type="simple" xlink:href="' + xesc(r.href) + '">' + t + '</text:a>' : t;
    };
    // junta runs seguidos com o mesmo link num só <text:a>
    const odtRuns = runs => {
      let x = '';
      for (let i = 0; i < runs.length;) {
        const r = runs[i];
        if (r.href) {
          let j = i, inner = '';
          while (j < runs.length && runs[j].href === r.href) { const c = Object.assign({}, runs[j], { href: '' }); inner += odtRun(Object.assign(c, { u: true, c: c.c || '#0563c1' })); j++; }
          x += '<text:a xlink:type="simple" xlink:href="' + xesc(r.href) + '">' + inner + '</text:a>';
          i = j;
        } else x += odtRun(r), i++;
      }
      return x;
    };
    const pAttr = b => ' text:style-name="' + (b.h ? 'Heading_20_' + b.h : ({ center: 'PC', right: 'PR', justify: 'PJ' }[b.align] || 'Standard')) + '"';
    const para = b => (b.h ? '<text:h' + pAttr(b) + ' text:outline-level="' + b.h + '">' + odtRuns(b.runs) + '</text:h>' : '<text:p' + pAttr(b) + '>' + odtRuns(b.runs) + '</text:p>');

    function body(bl) {
      let x = '', stack = [];                                                 // stack: tipo da lista aberta em cada nível
      const closeTo = n => { while (stack.length > n) { x += '</text:list-item></text:list>'; stack.pop(); } };
      bl.forEach(b => {
        if (b.t === 'table') { closeTo(0); x += odtTable(b); return; }
        if (!b.list) { closeTo(0); x += para(b); return; }
        const lv = b.list.level;
        if (stack.length > lv + 1) closeTo(lv + 1);
        if (stack.length === lv + 1 && stack[lv] !== b.list.type) closeTo(lv);
        if (stack.length === lv + 1) x += '</text:list-item><text:list-item>';  // novo item no mesmo nível
        while (stack.length < lv + 1) { const ty = stack.length === lv ? b.list.type : 'ul'; x += '<text:list text:style-name="' + (ty === 'ol' ? 'LN' : 'LB') + '"><text:list-item>'; stack.push(ty); }
        x += '<text:p text:style-name="List_20_Paragraph">' + odtRuns(b.runs) + '</text:p>';
      });
      closeTo(0);
      return x;
    }
    function odtTable(t) {
      const cols = Math.max.apply(null, t.rows.map(r => r.reduce((n, c) => n + c.span, 0)));
      let x = '<table:table table:name="Tabela' + (++sN) + '" table:style-name="Tbl"><table:table-column table:number-columns-repeated="' + cols + '"/>';
      t.rows.forEach(r => {
        x += '<table:table-row>';
        r.forEach(c => {
          x += '<table:table-cell table:style-name="Cell" office:value-type="string"' + (c.span > 1 ? ' table:number-columns-spanned="' + c.span + '"' : '') + '>' + body(c.blocks) + '</table:table-cell>';
          for (let k = 1; k < c.span; k++) x += '<table:covered-table-cell/>';
        });
        x += '</table:table-row>';
      });
      return x + '</table:table>';
    }
    const content = body(blocks);
    const listLevels = kind => { let l = ''; for (let i = 1; i <= 9; i++) l += (kind === 'ul'
      ? '<text:list-level-style-bullet text:level="' + i + '" text:bullet-char="•">'
      : '<text:list-level-style-number text:level="' + i + '" style:num-suffix="." style:num-format="1">') +
      '<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="' + (1.27 * i).toFixed(2) + 'cm" fo:text-indent="-0.635cm" fo:margin-left="' + (1.27 * i).toFixed(2) + 'cm"/></style:list-level-properties>' +
      (kind === 'ul' ? '</text:list-level-style-bullet>' : '</text:list-level-style-number>'); return l; };
    const auto = Object.keys(styles).map(k => styles[k].xml).join('') +
      ['PC:center', 'PR:end', 'PJ:justify'].map(s => '<style:style style:name="' + s.split(':')[0] + '" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="' + s.split(':')[1] + '"/></style:style>').join('') +
      '<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="17cm" table:align="margins"/></style:style>' +
      '<style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #808080"/></style:style>' +
      '<text:list-style style:name="LB">' + listLevels('ul') + '</text:list-style><text:list-style style:name="LN">' + listLevels('ol') + '</text:list-style>';
    const contentXml = '<?xml version="1.0" encoding="UTF-8"?><office:document-content ' + ODF_NS + ' office:version="1.2"><office:automatic-styles>' + auto + '</office:automatic-styles><office:body><office:text>' + content + '</office:text></office:body></office:document-content>';
    const stylesXml = '<?xml version="1.0" encoding="UTF-8"?><office:document-styles ' + ODF_NS + ' office:version="1.2"><office:styles>' +
      '<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.2cm"/><style:text-properties fo:font-family="Calibri" fo:font-size="11pt" fo:language="pt" fo:country="BR"/></style:default-style>' +
      '<style:style style:name="Standard" style:family="paragraph" style:class="text"/>' +
      [[1, '18pt', '0.4cm'], [2, '15pt', '0.35cm'], [3, '13pt', '0.3cm']].map(h => '<style:style style:name="Heading_20_' + h[0] + '" style:display-name="Heading ' + h[0] + '" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="text" ' +
        'default-outline-level="' + h[0] + '"><style:paragraph-properties fo:margin-top="' + h[2] + '" fo:margin-bottom="0.15cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="' + h[1] + '" fo:font-weight="bold"/></style:style>').join('') +
      '<style:style style:name="List_20_Paragraph" style:display-name="List Paragraph" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.1cm"/></style:style>' +
      '</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2.5cm" fo:margin-bottom="2cm" fo:margin-left="2.5cm" fo:margin-right="2cm"/></style:page-layout></office:automatic-styles>' +
      '<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>';
    const manifest = '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
      '<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
      ['content.xml', 'styles.xml', 'meta.xml'].map(f => '<manifest:file-entry manifest:full-path="' + f + '" manifest:media-type="text/xml"/>').join('') +
      media.map(m => '<manifest:file-entry manifest:full-path="' + m.name + '" manifest:media-type="' + m.type + '"/>').join('') + '</manifest:manifest>';
    const meta = '<?xml version="1.0" encoding="UTF-8"?><office:document-meta ' + ODF_NS + ' office:version="1.2"><office:meta><meta:generator>Central Diogo Desktop</meta:generator><meta:creation-date>' + new Date().toISOString() + '</meta:creation-date></office:meta></office:document-meta>';
    const blob = await Z.write([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true }, { name: 'content.xml', data: contentXml }, { name: 'styles.xml', data: stylesXml },
      { name: 'meta.xml', data: meta }, { name: 'META-INF/manifest.xml', data: manifest }].concat(media.map(m => ({ name: m.name, data: m.data, store: true }))));
    return { blob: blob, skippedImages: skipped };
  };

  // ---------- ODT -> HTML ----------
  F.fromOdt = async function (buf) {
    const files = await Z.read(buf);
    if (!files['content.xml']) throw new Error('não é um documento do LibreOffice (.odt)');
    const info = { lossy: [], format: 'odt' };
    const NS = { text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0', fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
      table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0', draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', xlink: 'http://www.w3.org/1999/xlink', svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0', office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0' };
    const content = parseXml(Z.text(files['content.xml'])), styled = files['styles.xml'] ? parseXml(Z.text(files['styles.xml'])) : null;
    const sty = {}, listType = {};
    const collect = d => {
      if (!d) return;
      [].forEach.call(d.getElementsByTagNameNS(NS.style, 'style'), s => {
        const name = attrNs(s, NS.style, 'name'), tp = s.getElementsByTagNameNS(NS.style, 'text-properties')[0], pp = s.getElementsByTagNameNS(NS.style, 'paragraph-properties')[0];
        const o = { parent: attrNs(s, NS.style, 'parent-style-name'), display: attrNs(s, NS.style, 'display-name') };
        if (tp) {
          const w = attrNs(tp, NS.fo, 'font-weight'); if (w === 'bold' || +w >= 600) o.b = true;
          if (attrNs(tp, NS.fo, 'font-style') === 'italic') o.i = true;
          const u = attrNs(tp, NS.style, 'text-underline-style'); if (u && u !== 'none') o.u = true;
          const l = attrNs(tp, NS.style, 'text-line-through-style'); if (l && l !== 'none') o.s = true;
          const f = attrNs(tp, NS.fo, 'font-family') || attrNs(tp, NS.style, 'font-name'); if (f) o.f = f.replace(/['"]/g, '');
          const sz = /^([\d.]+)pt$/.exec(attrNs(tp, NS.fo, 'font-size')); if (sz) o.sz = +sz[1];
          const c = attrNs(tp, NS.fo, 'color'); if (/^#[0-9a-f]{6}$/i.test(c)) o.c = c.toLowerCase();
        }
        if (pp) { const a = attrNs(pp, NS.fo, 'text-align'); o.align = { center: 'center', end: 'right', right: 'right', justify: 'justify' }[a] || ''; }
        sty[name] = o;
      });
      [].forEach.call(d.getElementsByTagNameNS(NS.text, 'list-style'), ls => {
        const lv = ls.firstElementChild; listType[attrNs(ls, NS.style, 'name')] = lv && lv.localName === 'list-level-style-number' ? 'ol' : 'ul';
      });
    };
    collect(styled); collect(content);
    const resolve = (name, key) => { for (let i = 0; name && i < 6; i++) { const s = sty[name]; if (!s) return undefined; if (s[key] !== undefined) return s[key]; name = s.parent; } return undefined; };
    const propsOf = name => { const f = {}; ['b', 'i', 'u', 's', 'f', 'sz', 'c'].forEach(k => { const v = resolve(name, k); if (v !== undefined) f[k] = v; }); return f; };
    const len = v => { const m = /^([\d.]+)(cm|mm|in|pt|px)$/.exec(v || ''); if (!m) return 0; return Math.round(+m[1] * { cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, px: 1 }[m[2]]); };
    const note = what => { if (info.lossy.indexOf(what) < 0) info.lossy.push(what); };
    if (styled && styled.getElementsByTagNameNS(NS.style, 'header').length + styled.getElementsByTagNameNS(NS.style, 'footer').length) {
      const t = [].some.call(styled.getElementsByTagNameNS(NS.style, 'header'), h => h.textContent.trim()) || [].some.call(styled.getElementsByTagNameNS(NS.style, 'footer'), h => h.textContent.trim());
      if (t) note('cabeçalho/rodapé');
    }
    const out = mk('div');

    function styleSpan(text, f) {
      if (!f.b && !f.i && !f.u && !f.s && !f.f && !f.sz && !f.c && !f.href) return document.createTextNode(text);
      const n = f.href ? mk('a', { href: f.href }) : mk('span'), s = n.style;
      if (f.b) s.fontWeight = 'bold'; if (f.i) s.fontStyle = 'italic';
      const td = [f.u ? 'underline' : '', f.s ? 'line-through' : ''].filter(Boolean).join(' '); if (td) s.textDecoration = td;
      if (f.f) s.fontFamily = '"' + f.f.replace(/"/g, '') + '"'; if (f.sz) s.fontSize = f.sz + 'pt'; if (f.c) s.color = f.c;
      n.append(text);
      return n;
    }
    function inline(node, into, fmt) {
      [].forEach.call(node.childNodes, c => {
        if (c.nodeType === 3) { if (c.nodeValue) into.append(styleSpan(c.nodeValue, fmt)); return; }
        if (c.nodeType !== 1) return;
        const n = c.localName;
        if (n === 'span') inline(c, into, Object.assign({}, fmt, propsOf(attrNs(c, NS.text, 'style-name'))));
        else if (n === 'a') inline(c, into, Object.assign({}, fmt, { href: safeHref(attrNs(c, NS.xlink, 'href')) || undefined }));
        else if (n === 's') into.append(styleSpan(' '.repeat(+attrNs(c, NS.text, 'c') || 1), fmt));
        else if (n === 'tab') into.append(styleSpan('\t', fmt));
        else if (n === 'line-break') into.append(mk('br'));
        else if (n === 'frame') {
          const im = c.getElementsByTagNameNS(NS.draw, 'image')[0];
          if (!im) { note('caixas de texto/objetos'); return; }
          const href = attrNs(im, NS.xlink, 'href'), file = files[href], ext = (href.split('.').pop() || '').toLowerCase();
          if (!file || !MIME[ext]) { note('imagens em formato não suportado'); return; }
          const img = mk('img', { src: dataUrl(file, ext), alt: '' });
          const w = len(attrNs(c, NS.svg, 'width')), h = len(attrNs(c, NS.svg, 'height')); if (w) img.width = w; if (h) img.height = h;
          into.append(img);
        } else if (n === 'note') note('notas de rodapé');
        else if (n === 'soft-page-break' || n === 'bookmark' || n === 'bookmark-start' || n === 'bookmark-end') { /* sem efeito no texto */ }
        else inline(c, into, fmt);
      });
    }
    function paragraph(p, host, level) {
      const sn = attrNs(p, NS.text, 'style-name');
      let h = 0;
      if (p.localName === 'h') h = Math.min(+attrNs(p, NS.text, 'outline-level') || 1, 3);
      else { const disp = (sty[sn] && sty[sn].display) || sn; if (/^title$/i.test(disp)) h = 1; else if (/^subtitle$/i.test(disp)) h = 2; }
      const el = mk(h ? 'h' + h : 'p');
      const al = resolve(sn, 'align'); if (al) el.style.textAlign = al;
      inline(p, el, h ? {} : propsOf(sn));
      if (!el.childNodes.length) el.append(mk('br'));
      host.append(el);
    }
    function list(l, host) {
      const sn = attrNs(l, NS.text, 'style-name');
      const ul = mk(listType[sn] || 'ul');
      kids(l, 'list-item').concat(kids(l, 'list-header')).forEach(it => {
        const li = mk('li');
        kids(it).forEach(c => {
          if (c.localName === 'list') list(c, li);
          else if (c.localName === 'p' || c.localName === 'h') { if (li.childNodes.length && li.lastChild.nodeName !== 'UL' && li.lastChild.nodeName !== 'OL') li.append(mk('br')); inline(c, li, propsOf(attrNs(c, NS.text, 'style-name'))); }
        });
        ul.append(li);
      });
      host.append(ul);
    }
    function table(t, host) {
      const tb = mk('tbody'), tab = mk('table'); tab.append(tb);
      const rows = [];
      const grab = n => kids(n).forEach(c => { if (c.localName === 'table-row') rows.push(c); else if (c.localName === 'table-header-rows' || c.localName === 'table-row-group') grab(c); });
      grab(t);
      rows.forEach(r => {
        const row = mk('tr');
        kids(r).forEach(c => {
          if (c.localName !== 'table-cell') return;
          const cell = mk('td'), span = +attrNs(c, NS.table, 'number-columns-spanned') || 1;
          if (span > 1) cell.colSpan = span;
          container(c, cell);
          if (!cell.childNodes.length) cell.append(mk('p', { innerHTML: '<br>' }));
          const rep = Math.min(+attrNs(c, NS.table, 'number-columns-repeated') || 1, 50);
          row.append(cell);
          for (let k = 1; k < rep; k++) row.append(cell.cloneNode(true));
        });
        tb.append(row);
      });
      host.append(tab);
    }
    function container(node, host) {
      kids(node).forEach(c => {
        const n = c.localName;
        if (n === 'p' || n === 'h') paragraph(c, host);
        else if (n === 'list') list(c, host);
        else if (n === 'table') table(c, host);
        else if (n === 'section') container(c, host);
      });
    }
    container(content.getElementsByTagNameNS(NS.office, 'text')[0], out);
    return { node: out, info: info };
  };

  // ---------- entrada única ----------
  F.read = async function (buf, name) {
    const ext = DK.extOf(name);
    if (ext === '.docx') return F.fromDocx(buf);
    if (ext === '.odt') return F.fromOdt(buf);
    throw new Error('formato não suportado (use .docx ou .odt)');
  };
  F.write = (root, name) => (DK.extOf(name) === '.odt' ? F.toOdt(root) : F.toDocx(root));
})(window.DK = window.DK || {});
