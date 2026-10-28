(function (DK) {
  // Paint: o JS Paint (um clone do MS Paint em JavaScript, MIT, https://github.com/1j01/jspaint) dentro do hub, em src/vendor/jspaint.
  // Roda num iframe do mesmo servidor; aqui só trocamos o abrir/salvar dele (systemHooks) pelos arquivos do usuário no Diogows (Meus arquivos),
  // e ligamos o fechar da janela ao "salvar alterações?" dele. Nada sai do servidor (a CSP do index.html é fechada).
  const el = DK.el;
  const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp', '.tif': 'image/tiff', '.tiff': 'image/tiff' };
  const DIR = '/Imagens';
  const home = p => ({ space: 'home', path: p });
  const mkdir = p => DK.api('POST', '/fs/mkdir', { space: 'home', path: p }).catch(() => { /* já existe */ });
  const toFile = async it => new File([await DK.fetchFile(it, 'download')], it.name, { type: MIME[DK.extOf(it.name)] || '' });
  let lastDir = null;

  // Diálogo "Salvar como": nome, formato e pasta (Meus arquivos). Devolve uma promessa que resolve quando salvou (ou nunca, se a pessoa desistir).
  function saveDialog(opt) {
    const { formats, defaultFileName, defaultFileFormatID, getBlob, savedCallbackUnreliable } = opt;
    DK.openWindow('paintsave:' + Date.now(), 'Salvar como', (body, win) => {
      const fmtSel = el('select', {}, ...formats.map(f => el('option', { value: f.formatID, textContent: f.name + ' (' + f.extensions.map(x => '.' + x).join(', ') + ')' })));
      const guess = formats.find(f => f.formatID === defaultFileFormatID) || formats.find(f => f.extensions.indexOf(DK.extOf(defaultFileName).slice(1)) >= 0) || formats[0];
      fmtSel.value = guess.formatID;
      const base = String(defaultFileName || 'imagem').replace(/\.[^.\/\\]*$/, '');
      const name = el('input', { value: base, maxLength: 120 });
      let dir = lastDir || DIR, space = 'home';
      const where = el('span', { className: 'meta', textContent: 'Meus arquivos' + dir });
      const choose = el('button', { textContent: '📁 Escolher pasta…', onclick: () => DK.explorerApp({ pick: 'any', pickDir: true, title: 'Escolha a pasta para salvar', onPick: it => { if (it.space !== 'home') { DK.toast('Escolha uma pasta de Meus arquivos.'); return; } dir = it.path; where.textContent = 'Meus arquivos' + dir; } }) });
      const msg = el('div', { className: 'err' });
      const ok = el('button', { className: 'pri', textContent: 'Salvar' });
      ok.onclick = async () => {
        msg.textContent = '';
        const f = formats.find(x => x.formatID === fmtSel.value);
        let nm = name.value.trim().replace(/[\/\\:*?"<>|]/g, '_');
        if (!nm) { msg.textContent = 'Dê um nome ao arquivo.'; return; }
        if (f.extensions.indexOf(DK.extOf(nm).slice(1)) < 0) nm += '.' + f.extensions[0];
        ok.disabled = true;
        try {
          await mkdir(DIR);
          const blob = await getBlob(f.formatID);
          const path = DK.joinPath(dir, nm);
          try { await DK.api('PUT', '/fs/file?space=home&path=' + encodeURIComponent(path), blob, true); }
          catch (e) {
            if (e.status !== 409 || !confirm('“' + nm + '” já existe nesta pasta. Substituir?')) throw e.status === 409 ? new Error('Salvar cancelado.') : e;
            await DK.api('PUT', '/fs/file?space=home&overwrite=1&path=' + encodeURIComponent(path), blob, true);
          }
          lastDir = dir;
          DK.closeWin(win, true);
          DK.toast('Salvo em Meus arquivos' + path);
          if (savedCallbackUnreliable) savedCallbackUnreliable({ newFileName: nm, newFileFormatID: f.formatID, newFileHandle: { space: 'home', path: path, name: nm }, newBlob: blob });
        } catch (e) { msg.textContent = e.message; ok.disabled = false; }
      };
      body.append(el('label', {}, 'Nome', name), el('label', {}, 'Tipo', fmtSel), el('div', { className: 'row' }, choose, where), el('div', { className: 'row' }, ok), msg);
    }, 460, 250);
  }

  DK.paintApp = function (o) {
    o = o || {};
    const it = o.item || null;
    DK.openWindow('paint' + (it ? ':' + it.space + it.path : ''), it ? it.name + ' — Paint' : 'Paint', (body, win) => {
      body.className = 'body flush';
      try { if (!localStorage['jspaint language']) localStorage['jspaint language'] = 'pt-br'; } catch (e) { /* sem armazenamento: o Paint usa o idioma do navegador */ }   // o Diogows é em português
      const frame = el('iframe', { className: 'fill', title: 'Paint', src: 'vendor/jspaint/index.html' });
      frame.setAttribute('allow', 'fullscreen; clipboard-read; clipboard-write');
      body.append(frame);
      let jw = null, ready = false;

      async function init() {
        for (let i = 0; i < 150 && !ready; i++) {      // os módulos do JS Paint terminam de carregar depois do onload do iframe
          const w = frame.contentWindow;
          if (w && w.systemHooks && w.systemHooks.showSaveFileDialog && w.open_from_file && w.are_you_sure) { jw = w; ready = true; } else await new Promise(r => setTimeout(r, 100));
        }
        if (!ready) { DK.toast('Não consegui iniciar o Paint.'); return; }
        const h = jw.systemHooks;
        h.showOpenFileDialog = () => new Promise(res => DK.pickFile('image', 'Abrir imagem', async x => {
          try { res({ file: await toFile(x), fileHandle: x }); } catch (e) { DK.toast(e.message); }
        }));
        h.readBlobFromHandle = async x => { try { return await toFile(x); } catch (e) { DK.toast(e.message); } };
        h.writeBlobToHandle = async (x, blob) => {
          try { await DK.api('PUT', '/fs/file?space=' + encodeURIComponent(x.space) + '&overwrite=1&path=' + encodeURIComponent(x.path) + (x.sudo ? '&sudo=1' : ''), blob, true); DK.toast('Salvo: ' + x.name); return true; }
          catch (e) { DK.toast('Não consegui salvar: ' + e.message); return false; }
        };
        h.showSaveFileDialog = async opt => saveDialog(opt);
        h.setWallpaperCentered = h.setWallpaperTiled = canvas => {      // "Definir como plano de fundo" vira o fundo do Diogows
          canvas.toBlob(async b => {
            try {
              await mkdir(DIR);
              const p = DIR + '/plano-de-fundo.png';
              await DK.api('PUT', '/fs/file?space=home&overwrite=1&path=' + encodeURIComponent(p), b, true);
              DK.toast('Imagem salva em Meus arquivos' + p + '. Use-a em Personalizar → Fundo da Área de Trabalho.');
            } catch (e) { DK.toast(e.message); }
          }, 'image/png');
        };
        if (it) {
          try { jw.open_from_file(await toFile(it), it); } catch (e) { DK.toast(e.message); }
        }
      }
      frame.onload = init;
      // fechar a janela: se há alterações não salvas, o próprio Paint pergunta se quer salvar
      let closing = false;
      win._beforeClose = () => {
        if (!ready || closing) return true;
        closing = true;
        try { jw.are_you_sure(() => DK.closeWin(win, true), () => { closing = false; }); } catch (e) { return true; }
        return false;
      };
      win._onClose = () => { frame.src = 'about:blank'; };
    }, 940, 660, { flush: true });
  };

})(window.DK = window.DK || {});
