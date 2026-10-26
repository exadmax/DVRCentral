(function (DK) {
  // Editor de Documentos (.docx e .odt): abre e salva nas pastas dos usuários (Meus arquivos) e, para quem tem permissão, no Computador.
  // A edição usa um <div contenteditable>; a conversão de/para os pacotes fica em docfmt.js (sem bibliotecas externas).
  const el = DK.el;

  const FONTS = ['Calibri', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Consolas'];
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
  const LEGACY_PT = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };

  // Limpa o HTML colado: só tags e estilos que o editor entende (também evita scripts e atributos de evento de páginas coladas).
  const KEEP_TAGS = /^(P|H1|H2|H3|B|STRONG|I|EM|U|S|STRIKE|DEL|BR|UL|OL|LI|TABLE|TBODY|THEAD|TR|TD|TH|A|SPAN|FONT)$/;
  function sanitize(html) {
    const src = new DOMParser().parseFromString(html, 'text/html').body, out = document.createElement('div');
    const walk = (n, into) => {
      [].forEach.call(n.childNodes, c => {
        if (c.nodeType === 3) { into.append(document.createTextNode(c.nodeValue)); return; }
        if (c.nodeType !== 1) return;
        let tag = c.tagName;
        if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|HEAD|META|LINK|NOSCRIPT)$/.test(tag)) return;
        if (tag === 'DIV' || tag === 'BLOCKQUOTE' || tag === 'PRE') tag = 'P';
        if (/^H[4-6]$/.test(tag)) tag = 'H3';
        if (tag === 'IMG') { const s = c.getAttribute('src') || ''; if (/^data:image\/(png|jpeg|gif);base64,/.test(s)) { const i = document.createElement('img'); i.src = s; into.append(i); } return; }
        if (!KEEP_TAGS.test(tag)) { walk(c, into); return; }
        const e = document.createElement(tag.toLowerCase());
        if (tag === 'A') { const h = c.getAttribute('href') || ''; if (/^(https?:|mailto:|tel:)/i.test(h)) e.setAttribute('href', h); }
        if (tag === 'FONT') { if (c.getAttribute('face')) e.setAttribute('face', c.getAttribute('face')); if (c.getAttribute('color')) e.setAttribute('color', c.getAttribute('color')); }
        if (tag === 'TD' || tag === 'TH') { const cs = +c.getAttribute('colspan'); if (cs > 1 && cs < 50) e.colSpan = cs; }
        ['fontWeight', 'fontStyle', 'textDecoration', 'fontFamily', 'fontSize', 'color', 'textAlign'].forEach(k => { if (c.style && c.style[k]) e.style[k] = c.style[k]; });
        walk(c, e);
        into.append(e);
      });
    };
    walk(src, out);
    return out.innerHTML;
  }

  // Imagens: só PNG, JPEG e GIF vão para o documento (outros formatos viram PNG); largura limitada à da página.
  function imageData(file) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onerror = () => reject(new Error('não foi possível ler a imagem'));
      rd.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('imagem inválida'));
        img.onload = () => {
          let src = rd.result, w = img.naturalWidth, h = img.naturalHeight;
          if (!/^data:image\/(png|jpeg|gif);/.test(src)) {
            const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(img, 0, 0); src = cv.toDataURL('image/png');
          }
          if (w > 600) { h = Math.round(h * 600 / w); w = 600; }
          resolve({ src: src, w: w, h: h });
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }

  // o: { item: { space, path, sudo, name } } abre um documento; { dir: { space, path, sudo } } cria um novo, salvo nessa pasta.
  DK.docApp = function (o) {
    o = o || {};
    let item = o.item || null;
    const key = item ? 'doc:' + item.space + ':' + item.path : 'doc:new:' + DK.nextDocId();
    DK.openWindow(key, item ? item.name : 'Documento sem título', (body, win) => {
      body.className = 'body flush';
      let dirty = false, dir = o.dir || null, lossy = [], lossyOk = false, saving = false, pendingSize = 12, range = null;

      // ---- barras ----
      const bOpen = el('button', { textContent: '📂 Abrir…' }), bSave = el('button', { className: 'pri', textContent: '💾 Salvar' }), bAs = el('button', { textContent: 'Salvar como…' });
      const fmtLbl = el('span', { className: 'meta' });
      const tb = el('div', { className: 'tb' }, bOpen, bSave, bAs, el('span', { className: 'sp' }), fmtLbl);
      const bar = el('div', { className: 'dtool' });
      const warn = el('div', { className: 'dwarn hidden' });
      const paper = el('div', { className: 'dpaper', contentEditable: 'true', spellcheck: true, lang: 'pt-BR' });
      const status = el('div', { className: 'status' });
      body.append(tb, bar, warn, el('div', { className: 'dpage' }, paper), status);

      const cmd = (c, v) => { restore(); paper.focus(); document.execCommand(c, false, v); fonts(); touched(); refresh(); };
      const btn = (label, title, fn, id) => { const b = el('button', { textContent: label, title: title }); b.onmousedown = e => e.preventDefault(); b.onclick = fn; if (id) b.dataset.cmd = id; bar.append(b); return b; };
      const sep = () => bar.append(el('span', { className: 'sep' }));
      const select = (opts, title, fn, w) => { const s = el('select', { title: title }, ...opts.map(x => el('option', { value: x[0], textContent: x[1] }))); s.style.width = w; s.onchange = () => { fn(s.value); }; bar.append(s); return s; };

      btn('↶', 'Desfazer (Ctrl+Z)', () => cmd('undo')); btn('↷', 'Refazer (Ctrl+Y)', () => cmd('redo')); sep();
      const blockSel = select([['p', 'Parágrafo'], ['h1', 'Título 1'], ['h2', 'Título 2'], ['h3', 'Título 3']], 'Estilo do parágrafo', v => cmd('formatBlock', '<' + v + '>'), '112px');
      const fontSel = select([['', 'Fonte']].concat(FONTS.map(f => [f, f])), 'Fonte', v => { if (v) { fonts(); cmd('fontName', v); } fontSel.value = ''; }, '112px');
      const sizeSel = select([['', 'Tam.']].concat(SIZES.map(s => [s, s + ' pt'])), 'Tamanho da letra', v => { if (v) { pendingSize = +v; cmd('fontSize', 7); } sizeSel.value = ''; }, '72px');
      const color = el('input', { type: 'color', value: '#000000', title: 'Cor do texto' }); color.style.cssText = 'width:32px;height:26px;padding:0';
      color.onmousedown = () => save(); color.oninput = () => cmd('foreColor', color.value); bar.append(color); sep();
      btn('B', 'Negrito (Ctrl+B)', () => cmd('bold'), 'bold').style.fontWeight = '700';
      btn('I', 'Itálico (Ctrl+I)', () => cmd('italic'), 'italic').style.fontStyle = 'italic';
      btn('U', 'Sublinhado (Ctrl+U)', () => cmd('underline'), 'underline').style.textDecoration = 'underline';
      btn('S', 'Tachado', () => cmd('strikeThrough'), 'strikeThrough').style.textDecoration = 'line-through'; sep();
      btn('⇤', 'Alinhar à esquerda', () => cmd('justifyLeft'), 'justifyLeft'); btn('↔', 'Centralizar', () => cmd('justifyCenter'), 'justifyCenter');
      btn('⇥', 'Alinhar à direita', () => cmd('justifyRight'), 'justifyRight'); btn('☰', 'Justificar', () => cmd('justifyFull'), 'justifyFull'); sep();
      btn('• Lista', 'Lista com marcadores', () => cmd('insertUnorderedList'), 'insertUnorderedList'); btn('1. Lista', 'Lista numerada', () => cmd('insertOrderedList'), 'insertOrderedList');
      btn('⇠', 'Diminuir recuo (sobe o nível da lista)', () => cmd('outdent')); btn('⇢', 'Aumentar recuo (desce o nível da lista)', () => cmd('indent')); sep();
      btn('▦ Tabela', 'Inserir tabela', () => {
        const r = prompt('Tabela: linhas x colunas', '3x3'); const m = /^(\d{1,2})\s*[x×]\s*(\d{1,2})$/i.exec(r || '');
        if (!m) return;
        cmd('insertHTML', '<table><tbody>' + ('<tr>' + '<td><br></td>'.repeat(+m[2]) + '</tr>').repeat(+m[1]) + '</tbody></table><p><br></p>');
      });
      btn('🔗', 'Inserir link', () => {
        let u = prompt('Endereço do link:', 'https://'); if (!u) return;
        if (!/^(https?:|mailto:|tel:)/i.test(u)) u = 'https://' + u;
        cmd('createLink', u);
      });
      const pic = el('input', { type: 'file', accept: 'image/*' }); pic.style.display = 'none'; body.append(pic);
      btn('🖼️ Imagem', 'Inserir imagem', () => { save(); pic.click(); });
      pic.onchange = async () => {
        const f = pic.files[0]; pic.value = '';
        if (!f) return;
        try { const im = await imageData(f); cmd('insertHTML', '<img src="' + im.src + '" width="' + im.w + '" height="' + im.h + '">'); } catch (e) { status.textContent = e.message; }
      };
      btn('Tx', 'Limpar formatação', () => cmd('removeFormat'));

      // ---- seleção e estado dos botões ----
      function save() { const s = getSelection(); if (s.rangeCount && paper.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange(); }
      function restore() { if (range) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); } }
      function refresh() {
        [].forEach.call(bar.querySelectorAll('button[data-cmd]'), b => { let on = false; try { on = document.queryCommandState(b.dataset.cmd); } catch (e) { /* sem estado */ } b.classList.toggle('on', on); });
        try { const v = String(document.queryCommandValue('formatBlock') || '').toLowerCase().replace(/[<>]/g, ''); blockSel.value = /^h[1-3]$/.test(v) ? v : 'p'; } catch (e) { /* sem estado */ }
      }
      document.addEventListener('selectionchange', function onSel() {
        if (!document.body.contains(win)) { document.removeEventListener('selectionchange', onSel); return; }
        const s = getSelection();
        if (s.rangeCount && paper.contains(s.anchorNode)) { save(); refresh(); }
      });

      // O navegador cria <font size=7 face=...>; aqui isso vira <span style="font-size:..pt;font-family:...">, que o conversor entende.
      function fonts() {
        [].slice.call(paper.querySelectorAll('font')).forEach(f => {
          const sp = el('span');
          if (f.getAttribute('face')) sp.style.fontFamily = '"' + f.getAttribute('face').replace(/"/g, '') + '"';
          if (f.getAttribute('color')) sp.style.color = f.getAttribute('color');
          if (f.getAttribute('size')) sp.style.fontSize = (f.getAttribute('size') === '7' ? pendingSize : LEGACY_PT[f.getAttribute('size')] || 12) + 'pt';
          while (f.firstChild) sp.append(f.firstChild);
          f.replaceWith(sp);
        });
      }

      function info() {
        const text = paper.innerText.trim(), words = text ? text.split(/\s+/).length : 0;
        status.textContent = words + ' palavra(s) · ' + (dirty ? 'modificado' : 'salvo') + (item && item.space === 'machine' ? ' · arquivo do computador' + (item.sudo ? ' (sudo)' : '') : '');
        win.setTitle((dirty ? '● ' : '') + (item ? item.name : 'Documento sem título'));
        fmtLbl.textContent = item ? (DK.extOf(item.name) === '.odt' ? 'OpenDocument (.odt)' : 'Word (.docx)') : 'novo documento';
      }
      function touched() { dirty = true; info(); }
      paper.addEventListener('input', () => { fonts(); touched(); });
      paper.addEventListener('focus', () => { try { document.execCommand('styleWithCSS', false, false); document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* padrão do navegador */ } });
      paper.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(false); }
        if (e.key === 'Tab') { e.preventDefault(); cmd('insertText', '\t'); }
      });
      paper.addEventListener('paste', async e => {
        const cd = e.clipboardData; if (!cd) return;
        e.preventDefault();
        const img = [].slice.call(cd.files).filter(f => /^image\//.test(f.type))[0], html = cd.getData('text/html');
        if (img) { try { const im = await imageData(img); cmd('insertHTML', '<img src="' + im.src + '" width="' + im.w + '" height="' + im.h + '">'); } catch (x) { status.textContent = x.message; } }
        else if (html) cmd('insertHTML', sanitize(html));
        else cmd('insertText', cd.getData('text/plain'));
      });

      // ---- abrir e salvar ----
      const q = (it, extra) => '?space=' + it.space + (it.sudo ? '&sudo=1' : '') + '&path=' + encodeURIComponent(it.path) + extra;
      const put = (it, blob, overwrite) => {
        const go = () => DK.api('PUT', '/fs/file' + q(it, overwrite ? '&overwrite=1' : ''), blob, true);
        return it.space === 'machine' ? DK.withUnlock('explorer', !!it.sudo, go) : go();
      };

      async function doSave(asNew) {
        if (saving) return;
        let target = item, overwrite = !!item;
        if (asNew || !item) {
          const cur = item ? item.name : 'Documento.docx';
          let n = prompt('Salvar como (termine em .docx ou .odt):', cur);
          if (!n) return;
          n = n.trim().replace(/[\/\\]/g, '_');
          if (!/\.(docx|odt)$/i.test(n)) n += '.docx';
          const d = dir || (item && { space: item.space, sudo: item.sudo, path: item.path.replace(/\/[^\/]*$/, '') || '/' }) || { space: 'home', path: '/' };
          target = { space: d.space, sudo: !!d.sudo, path: DK.joinPath(d.path, n), name: n, type: 'file' };
          overwrite = false; dir = d;
        } else if (lossy.length && !lossyOk) {
          if (!confirm('Este documento tem ' + lossy.join(', ') + ', que o editor não mantém. Substituir o original mesmo assim?\n\nOK = substituir · Cancelar = depois use “Salvar como…” para ficar com uma cópia.')) return;
          lossyOk = true;
        }
        saving = true; status.textContent = 'Salvando…';
        try {
          fonts();
          const r = await DK.docfmt.write(paper, target.name);
          try { await put(target, r.blob, overwrite); }
          catch (e) { if (e.status === 409 && confirm('“' + target.name + '” já existe. Substituir?')) await put(target, r.blob, true); else throw e; }
          if (asNew || !item) { lossy = []; lossyOk = false; warn.classList.add('hidden'); }
          item = target; dirty = false; info();
          if (r.skippedImages) DK.toast(r.skippedImages + ' imagem(ns) não suportada(s) ficaram de fora do arquivo.');
          if (o.onSaved) o.onSaved();
        } catch (e) { status.textContent = 'Erro ao salvar: ' + e.message; }
        saving = false;
      }
      bSave.onclick = () => doSave(false); bAs.onclick = () => doSave(true);
      bOpen.onclick = () => DK.pickFile('doc', 'Abrir documento (.docx ou .odt)', it => DK.docApp({ item: it }));
      win._beforeClose = () => !dirty || confirm('Descartar alterações não salvas?');

      (async () => {
        if (item) {
          status.textContent = 'Abrindo…';
          try {
            if (item.size > 25 * 1048576) throw new Error('documento grande demais para o editor (máximo 25 MB)');
            const r = await DK.docfmt.read(await DK.fetchFile(item, 'download'), item.name);
            paper.replaceChildren.apply(paper, [].slice.call(r.node.childNodes));
            lossy = r.info.lossy;
            if (lossy.length) {
              warn.textContent = '⚠ Este documento tem ' + lossy.join(', ') + ', que o editor não mantém. Ao salvar por cima do original isso será perdido: use “Salvar como…” para ficar com uma cópia.';
              warn.classList.remove('hidden');
            }
          } catch (e) { status.textContent = 'Não foi possível abrir: ' + e.message; paper.contentEditable = 'false'; bSave.disabled = bAs.disabled = true; return; }
        }
        if (!paper.childNodes.length) paper.innerHTML = '<p><br></p>';
        dirty = false; info(); paper.focus();
      })();
    }, 860, 600, { flush: true });
  };

  DK.register({ id: 'docs', icon: '📘', label: 'Documentos (.docx / .odt)', desktop: true, open: () => DK.docApp({ dir: { space: 'home', path: '/' } }) });
})(window.DK = window.DK || {});
