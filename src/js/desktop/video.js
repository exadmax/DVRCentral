(function (DK) {
  // Player de Vídeo: toca no navegador os vídeos da biblioteca do servidor (a pasta de Vídeos da casa), da sua pasta e do Computador.
  // Avançar e voltar funcionam porque o servidor entrega o arquivo em pedaços (Range). Formatos que o navegador não decodifica
  // (AVI, WMV...) têm download e o aviso para usar o VLC, como na página Vídeos.
  const el = DK.el;

  DK.videoApp = function (o) {
    o = o || {};
    const win = DK.openWindow('video', 'Player de Vídeo', (body, win) => {
      body.className = 'body flush';
      let list = [], idx = -1;
      const lib = el('button', { textContent: '📚 Biblioteca', title: 'Vídeos da pasta de vídeos da casa' });
      const open = el('button', { textContent: '📂 Abrir arquivo…' });
      const prev = el('button', { textContent: '⏮' }), next = el('button', { textContent: '⏭' });
      const speed = el('select', {}, ...[0.5, 0.75, 1, 1.25, 1.5, 2].map(v => el('option', { value: v, textContent: v + '×', selected: v === 1 })));
      const dl = el('a', { textContent: 'Baixar', style: 'font-size:12px' }); dl.classList.add('hidden');
      const tb = el('div', { className: 'tb' }, lib, open, prev, next, speed, dl);
      const video = el('video', { controls: true, playsInline: true });
      const msg = el('div', { className: 'vmsg' });
      const wrap = el('div', { className: 'vwrap' }, video, msg);
      const box = el('div', { className: 'vlist' });
      body.append(tb, wrap, box);

      function drawList() {
        box.replaceChildren();
        box.classList.toggle('hidden', list.length < 2);
        list.forEach((v, i) => box.append(el('button', { className: i === idx ? 'on' : '', textContent: (i === idx ? '▶ ' : '') + v.title, onclick: () => play(i) })));
      }
      function play(i) {
        idx = i;
        const v = list[i];
        win.setTitle(v.title);
        msg.textContent = '';
        video.replaceChildren();
        if (v.sub) {
          const tr = el('track', { kind: 'subtitles', label: 'Legenda', src: v.sub, default: true });
          video.append(tr);
        }
        video.src = v.src;
        video.playbackRate = +speed.value;
        dl.href = v.dl || v.src; dl.download = v.title; dl.classList.toggle('hidden', !v.dl);
        const p = video.play();
        if (p && p.catch) p.catch(() => { /* o navegador barrou o autoplay: a pessoa aperta play */ });
        drawList();
      }
      video.onerror = () => {
        msg.textContent = 'Este formato não toca no navegador (ou o acesso expirou). Baixe o arquivo e abra no VLC.';
        if (idx >= 0 && list[idx].dl) dl.classList.remove('hidden');
      };
      video.onended = () => { if (idx + 1 < list.length) play(idx + 1); };
      prev.onclick = () => { if (idx > 0) play(idx - 1); };
      next.onclick = () => { if (idx + 1 < list.length) play(idx + 1); };
      speed.onchange = () => { video.playbackRate = +speed.value; };

      // item de arquivo (Meus arquivos / Computador): it = { space, path, sudo, name }
      const fromFile = it => ({ title: it.name, src: DK.fileUrl(it, 'view'), dl: DK.fileUrl(it, 'download') });
      win._openFile = (it, siblings) => {
        const sib = (siblings && siblings.length ? siblings : [it]).filter(x => DK.kindOf(Object.assign({ type: 'file' }, x)) === 'video');
        list = sib.map(fromFile);
        const i = sib.findIndex(x => x.path === it.path);
        play(i < 0 ? 0 : i);
      };
      async function library() {
        try {
          const vids = await DK.api('GET', '/videos');
          if (!vids.length) { msg.textContent = 'A pasta de vídeos da casa está vazia.'; return; }
          list = vids.map(v => ({
            title: v.name, src: '/api/desk/videos/file?name=' + encodeURIComponent(v.name), dl: '/api/desk/videos/file?name=' + encodeURIComponent(v.name),
            sub: v.sub && /\.(srt|vtt)$/i.test(v.sub) ? '/api/videos/sub?name=' + encodeURIComponent(v.name) : ''
          }));
          idx = -1; drawList(); msg.textContent = 'Escolha um vídeo da lista.';
        } catch (e) { msg.textContent = e.message; }
      }
      win._library = library;
      lib.onclick = library;
      open.onclick = () => DK.pickFile('video', 'Abrir vídeo', it => DK.videoApp({ item: it }));
      win._onClose = () => { video.pause(); video.removeAttribute('src'); video.load(); };   // solta a conexão com o servidor
      msg.textContent = 'Abra um arquivo ou use a Biblioteca.';
    }, 800, 540, { flush: true });
    if (o.item) win._openFile(o.item, o.siblings);
    else if (o.library) win._library();
    return win;
  };

  DK.register({ id: 'video', icon: '🎬', label: 'Player de Vídeo', desktop: true, open: () => DK.videoApp({ library: true }) });
})(window.DK = window.DK || {});
