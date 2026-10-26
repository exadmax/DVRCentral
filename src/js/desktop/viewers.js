(function (DK) {
  // Visualizadores: Bloco de Notas (com realce de cores), imagens e PDF. Abrem arquivos de "Meus arquivos" e do Computador.
  const el = DK.el, esc = DK.esc;

  // Baixa o conteúdo de um arquivo (it = { space, path, sudo }). Arquivos do computador pedem o desbloqueio de novo se ele expirou.
  DK.fetchFile = function (it, mode) {
    const go = async () => {
      const r = await fetch(DK.fileUrl(it, mode), { credentials: 'same-origin' });
      if (!r.ok) {
        let m = 'erro ' + r.status;
        try { m = (await r.json()).error || m; } catch (e) { /* sem corpo */ }
        const e = new Error(m); e.status = r.status; throw e;
      }
      return r.arrayBuffer();
    };
    return it.space === 'machine' ? DK.withUnlock('explorer', !!it.sudo, go) : go();
  };
  // Texto de um arquivo: UTF-8 e, se não for, Windows-1252 (arquivos antigos). legacy avisa que foi preciso o plano B.
  DK.decodeText = function (buf) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), legacy: false }; }
    catch (e) { return { text: new TextDecoder('windows-1252').decode(buf), legacy: true }; }
  };
  const winKey = (p, it) => p + ':' + it.space + ':' + (it.sudo ? 's:' : '') + it.path;

  // ---------- realce de sintaxe ----------
  const WORD = { re: /\s+|\w+/y, cls: '' };
  const STR2 = /"(?:[^"\\\n]|\\.)*"/y;
  const NUM = { re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y, cls: 'c-num' };
  const KW = 'abstract|as|async|await|base|bool|break|case|catch|char|class|const|continue|def|default|defer|delete|do|double|elif|else|enum|except|export|extends|false|finally|float|fn|for|foreach|from|func|function|go|if|import|in|int|interface|is|let|long|namespace|new|nil|null|override|package|param|private|protected|public|range|readonly|return|select|self|static|string|struct|switch|this|throw|true|try|type|typeof|using|var|virtual|void|while|with|yield|None|True|False|echo|fi|then|done|esac|SELECT|FROM|WHERE|INSERT|INTO|UPDATE|DELETE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|CREATE|TABLE|ALTER|DROP|INDEX|VALUES|SET|AND|OR|NOT|NULL|AS|LIMIT|UNION|DISTINCT';
  const RULES = {
    json: [{ re: /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, cls: 'c-key' }, { re: STR2, cls: 'c-str' }, NUM, { re: /\b(?:true|false|null)\b/y, cls: 'c-kw' }, { re: /[{}\[\],:]/y, cls: 'c-punct' }, WORD],
    log: [
      { re: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/y, cls: 'c-ts' },
      { re: /\b(?:error|err|fatal|critical|fail(?:ed|ure)?|exception)\b/iy, cls: 'c-err' },
      { re: /\bwarn(?:ing)?\b/iy, cls: 'c-warn' }, { re: /\b(?:info|notice|success)\b/iy, cls: 'c-info' },
      { re: /\b(?:debug|trace|verbose)\b/iy, cls: 'c-dbg' }, { re: /\x1b\[[0-9;]*m/y, cls: 'c-dbg' },
      { re: STR2, cls: 'c-str' }, { re: /\[[^\]\n]{1,40}\]/y, cls: 'c-key' }, WORD],
    markdown: [{ re: /^#{1,6}[^\n]*/my, cls: 'c-h' }, { re: /^```[^\n]*/my, cls: 'c-com' }, { re: /`[^`\n]+`/y, cls: 'c-str' }, { re: /\*\*[^*\n]+\*\*/y, cls: 'c-b' },
      { re: /^[ \t]*(?:[-*+]|\d+\.)[ \t]/my, cls: 'c-kw' }, { re: /^>[^\n]*/my, cls: 'c-com' }, { re: /\[[^\]\n]*\]\([^)\n]*\)/y, cls: 'c-key' }, WORD],
    ini: [{ re: /^[ \t]*[#;][^\n]*/my, cls: 'c-com' }, { re: /(?<=\s)#[^\n]*/y, cls: 'c-com' }, { re: /^\[[^\]\n]*\]/my, cls: 'c-h' },
      { re: /^[ \t]*-?[ \t]*[\w.\-]+(?=[ \t]*[=:])/my, cls: 'c-key' }, { re: /"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/y, cls: 'c-str' },
      { re: /\b(?:true|false|null|yes|no|on|off)\b/iy, cls: 'c-kw' }, NUM, WORD],
    xml: [{ re: /<!--[\s\S]*?-->/y, cls: 'c-com' }, { re: /<\/?[A-Za-z][\w:.-]*/y, cls: 'c-tag' }, { re: /\/?>/y, cls: 'c-tag' },
      { re: /[\w:.-]+(?=\s*=)/y, cls: 'c-attr' }, { re: /"[^"]*"|'[^']*'/y, cls: 'c-str' }, { re: /&\w+;/y, cls: 'c-num' }, WORD],
    code: [{ re: /\/\*[\s\S]*?\*\//y, cls: 'c-com' }, { re: /\/\/[^\n]*|(?<![\w)\]])--[^\n]*|(?<![\w$])#[^\n]*/y, cls: 'c-com' },
      { re: /"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/y, cls: 'c-str' },
      { re: /\$[A-Za-z_]\w*/y, cls: 'c-attr' }, { re: /\b0x[\da-fA-F]+\b|\b\d+(?:\.\d+)?\b/y, cls: 'c-num' },
      { re: new RegExp('\\b(?:' + KW + ')\\b', 'y'), cls: 'c-kw' }, WORD]
  };
  function tokenize(text, rules) {
    let out = '', plain = '', i = 0;
    const n = text.length;
    while (i < n) {
      let hit = false;
      for (const r of rules) {
        r.re.lastIndex = i;
        const m = r.re.exec(text);
        if (m && m[0].length) {
          if (plain) { out += esc(plain); plain = ''; }
          out += r.cls ? '<span class="' + r.cls + '">' + esc(m[0]) + '</span>' : esc(m[0]);
          i += m[0].length; hit = true; break;
        }
      }
      if (!hit) plain += text[i++];
    }
    return out + esc(plain);
  }
  function highlightCsv(text, sep) {
    return text.split('\n').map((line, li) => {
      let out = '', col = 0, field = '', q = false;
      const flush = () => { out += '<span class="' + (li === 0 ? 'c-b ' : '') + 'c-col' + (col % 6) + '">' + esc(field) + '</span>'; field = ''; };
      for (const ch of line) {
        if (ch === '"') q = !q;
        if (ch === sep && !q) { flush(); out += '<span class="c-punct">' + esc(ch) + '</span>'; col++; } else field += ch;
      }
      flush();
      return out;
    }).join('\n');
  }
  const MODES = [['plain', 'Texto simples'], ['json', 'JSON'], ['log', 'Log'], ['markdown', 'Markdown'], ['csv', 'CSV'], ['ini', 'INI / ENV / YAML'], ['xml', 'XML / HTML'], ['code', 'Código (C#, JS, SQL, PS, sh…)']];
  function modeOf(name) {
    const e = DK.extOf(name);
    if (e === '.json') return 'json';
    if (e === '.log') return 'log';
    if (e === '.md') return 'markdown';
    if (e === '.csv' || e === '.tsv') return 'csv';
    if (['.ini', '.env', '.conf', '.cfg', '.properties', '.yaml', '.yml', '.toml', '.service', '.list', '.rules'].indexOf(e) >= 0) return 'ini';
    if (['.xml', '.html', '.htm', '.config', '.csproj', '.xaml'].indexOf(e) >= 0) return 'xml';
    if (['.js', '.ts', '.cs', '.java', '.go', '.py', '.sh', '.ps1', '.bat', '.sql', '.css', '.c', '.cpp', '.php'].indexOf(e) >= 0) return 'code';
    return 'plain';
  }
  function highlight(text, mode, name) {
    if (mode === 'plain' || text.length > 300000) return esc(text);
    if (mode === 'csv') {
      const first = text.split('\n')[0];
      return highlightCsv(text, DK.extOf(name || '') === '.tsv' ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ','));
    }
    return tokenize(text, RULES[mode]);
  }

  // ---------- Bloco de Notas ----------
  // o: { item: { space, path, sudo, name, size } } abre um arquivo; { dir: { space, path, sudo } } cria um novo, salvo nessa pasta.
  DK.notepadApp = function (o) {
    let item = o.item || null;
    const key = item ? winKey('np', item) : 'np:new:' + DK.nextDocId();
    DK.openWindow(key, item ? item.name : 'Sem título', (body, win) => {
      body.className = 'body flush';
      let dirty = false, saved = '', dir = o.dir || null;
      const mode = el('select', {}, ...MODES.map(m => el('option', { value: m[0], textContent: m[1] })));
      const dark = el('input', { type: 'checkbox' });
      const bSave = el('button', { className: 'pri', textContent: '💾 Salvar' });
      const bAs = el('button', { textContent: 'Salvar como…' });
      const bCopy = el('button', { textContent: 'Copiar tudo' });
      const bOpen = el('button', { textContent: '📂 Abrir…', onclick: () => DK.pickFile('text', 'Abrir arquivo de texto', it => DK.notepadApp({ item: it })) });
      const tb = el('div', { className: 'tb' }, bOpen, bSave, bAs, bCopy, el('span', { className: 'sp' }), mode, el('label', {}, dark, ' escuro'));
      const wrap = el('div', { className: 'np' });
      const hl = el('pre', { className: 'hl' }), hlIn = el('div'); hl.append(hlIn);
      const ta = el('textarea', { wrap: 'off', spellcheck: false });
      wrap.append(hl, ta);
      const status = el('div', { className: 'status' });
      body.append(tb, wrap, status);
      let note = '';

      const nameNow = () => (item ? item.name : '');
      function paint() {
        hlIn.innerHTML = highlight(ta.value, mode.value, nameNow()) + '\n';
        hlIn.style.transform = 'translate(' + (-ta.scrollLeft) + 'px,' + (-ta.scrollTop) + 'px)';
      }
      function info() {
        const before = ta.value.slice(0, ta.selectionStart).split('\n');
        status.textContent = 'Lin ' + before.length + ', Col ' + (before[before.length - 1].length + 1) + ' · ' + new Blob([ta.value]).size + ' bytes · ' +
          (dirty ? 'modificado' : 'salvo') + (item && item.space === 'machine' ? ' · arquivo do computador' + (item.sudo ? ' (sudo)' : '') : '') + note;
        win.setTitle((dirty ? '● ' : '') + (item ? item.name : 'Sem título'));
      }
      let raf = 0;
      ta.oninput = () => { dirty = ta.value !== saved; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { paint(); info(); }); };
      ta.onscroll = () => { hlIn.style.transform = 'translate(' + (-ta.scrollLeft) + 'px,' + (-ta.scrollTop) + 'px)'; };
      ta.onkeyup = ta.onclick = info;
      ta.onkeydown = e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
        if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end'); ta.oninput(); }
      };
      mode.onchange = paint;
      dark.onchange = () => wrap.classList.toggle('dark', dark.checked);
      bCopy.onclick = async () => { await DK.copyText(ta.value); bCopy.textContent = 'Copiado ✓'; setTimeout(() => { bCopy.textContent = 'Copiar tudo'; }, 1200); };

      const put = (it, overwrite) => {
        const q = '?space=' + it.space + (it.sudo ? '&sudo=1' : '') + '&path=' + encodeURIComponent(it.path) + '&text=1' + (overwrite ? '&overwrite=1' : '');
        const go = () => DK.api('PUT', '/fs/file' + q, ta.value, true);
        return it.space === 'machine' ? DK.withUnlock('explorer', !!it.sudo, go) : go();
      };
      async function save() {
        if (!item) return saveAs();
        try { await put(item, true); saved = ta.value; dirty = false; note = ''; info(); if (o.onSaved) o.onSaved(); }
        catch (e) { status.textContent = 'Erro ao salvar: ' + e.message; }
      }
      async function saveAs() {
        const n = prompt('Salvar como (nome do arquivo):', item ? item.name : 'novo.txt');
        if (!n) return;
        const d = dir || (item && { space: item.space, sudo: item.sudo, path: item.path.replace(/\/[^\/]*$/, '') || '/' }) || { space: 'home', path: '/' };
        const it = { space: d.space, sudo: !!d.sudo, path: DK.joinPath(d.path, n), name: n, type: 'file' };
        try {
          try { await put(it, false); }
          catch (e) { if (e.status === 409 && confirm('“' + n + '” já existe. Substituir?')) await put(it, true); else throw e; }
          item = it; dir = d; saved = ta.value; dirty = false; mode.value = modeOf(n); note = ''; paint(); info(); if (o.onSaved) o.onSaved();
        } catch (e) { status.textContent = 'Erro ao salvar: ' + e.message; }
      }
      bSave.onclick = save; bAs.onclick = saveAs;
      win._beforeClose = () => !dirty || confirm('Descartar alterações não salvas?');

      (async () => {
        if (item) {
          if (item.size > 1048576) { status.textContent = 'Arquivo maior que 1 MB: use o Explorer para baixar.'; ta.disabled = true; bSave.disabled = bAs.disabled = true; return; }
          try {
            const r = DK.decodeText(await DK.fetchFile(item, 'text'));
            ta.value = r.text;
            if (r.legacy) note = ' · codificação antiga (Windows-1252): ao salvar vira UTF-8';
          } catch (e) { status.textContent = e.message; return; }
          saved = ta.value; mode.value = modeOf(item.name);
        }
        paint(); info(); ta.focus();
      })();
    }, 700, 500, { flush: true });
  };

  // ---------- Visualizador de imagens ----------
  DK.imageApp = function (o) {
    const isImg = it => DK.kindOf(Object.assign({ type: 'file' }, it)) === 'image';
    DK.openWindow(winKey('img', o.item), o.item.name, (body, win) => {
      body.className = 'body flush';
      const list = (o.siblings && o.siblings.length ? o.siblings : [o.item]).filter(isImg);
      let idx = Math.max(0, list.findIndex(x => x.path === o.item.path)), zoom = 0; // 0 = ajustar
      const prev = el('button', { textContent: '◀' }), next = el('button', { textContent: '▶' });
      const zo = el('button', { textContent: '−' }), zi = el('button', { textContent: '+' });
      const fit = el('button', { textContent: 'Ajustar' }), one = el('button', { textContent: '100%' });
      const lbl = el('span', { className: 'meta' });
      const open = el('button', { textContent: '📂 Abrir…' });
      const tb = el('div', { className: 'tb' }, open, prev, next, zo, zi, fit, one, el('span', { className: 'sp' }), lbl);
      const area = el('div', { className: 'imgarea fit' }), img = el('img', { alt: '' });
      area.append(img);
      body.append(tb, area);
      const label = () => { lbl.textContent = (idx + 1) + ' / ' + list.length + (zoom ? ' · ' + Math.round(zoom * 100) + '%' : ' · ajustado'); };
      function show() { const it = list[idx]; win.setTitle(it.name); img.src = DK.fileUrl(it, 'view'); label(); }
      function applyZoom() {
        if (!zoom) { area.classList.add('fit'); img.style.width = ''; }
        else { area.classList.remove('fit'); img.style.width = Math.round(img.naturalWidth * zoom) + 'px'; }
        label();
      }
      img.onload = applyZoom;
      img.onerror = () => { lbl.textContent = 'Não foi possível carregar a imagem (o acesso ao computador pode ter expirado).'; };
      prev.onclick = () => { idx = (idx - 1 + list.length) % list.length; show(); };
      next.onclick = () => { idx = (idx + 1) % list.length; show(); };
      zi.onclick = () => { zoom = Math.min(8, (zoom || 1) * 1.25); applyZoom(); };
      zo.onclick = () => { zoom = Math.max(0.1, (zoom || 1) / 1.25); applyZoom(); };
      fit.onclick = () => { zoom = 0; applyZoom(); };
      one.onclick = () => { zoom = 1; applyZoom(); };
      open.onclick = () => DK.pickFile('image', 'Abrir imagem', it => DK.imageApp({ item: it }));
      show();
    }, 660, 480, { flush: true });
  };

  // ---------- Visualizador de PDF ----------
  DK.pdfApp = function (o) {
    DK.openWindow(winKey('pdf', o.item), o.item.name, body => {
      body.className = 'body flush';
      const url = DK.fileUrl(o.item, 'view');
      const open = el('button', { textContent: '📂 Abrir…', onclick: () => DK.pickFile('pdf', 'Abrir PDF', it => DK.pdfApp({ item: it })) });
      const tb = el('div', { className: 'tb' }, open, el('a', { href: url, target: '_blank', textContent: 'Abrir em nova aba' }), ' ',
        el('a', { href: DK.fileUrl(o.item, 'download'), download: o.item.name, textContent: 'Baixar' }),
        el('span', { className: 'sp' }), el('span', { className: 'meta', textContent: 'Usa o leitor de PDF do seu navegador' }));
      body.append(tb, el('iframe', { className: 'fill', src: url, title: o.item.name }));
    }, 740, 560, { flush: true });
  };

  // ---------- registro ----------
  DK.register({ id: 'notepad', icon: '📝', label: 'Bloco de Notas', open: () => DK.notepadApp({ dir: { space: 'home', path: '/' } }) });
  DK.register({ id: 'images', icon: '🖼️', label: 'Visualizador de Imagens', open: () => DK.pickFile('image', 'Abrir imagem', it => DK.imageApp({ item: it })) });
  DK.register({ id: 'pdf', icon: '📕', label: 'Visualizador de PDF', open: () => DK.pickFile('pdf', 'Abrir PDF', it => DK.pdfApp({ item: it })) });
})(window.DK = window.DK || {});
