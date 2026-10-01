(function (CD) {
  // Página "Vídeos" (videos.html): lista a pasta de vídeos do servidor (via hub) e abre cada arquivo no VLC, tocando direto da rede.
  // Os arquivos vêm do nginx (/videos/, com Accept-Ranges), sem copiar nada para o aparelho.
  const U = CD.util, esc = U.esc;

  function fileUrl(name) {
    const c = CD.state.cfg.videos || {}, u = new URL(CD.state.hub);
    return u.protocol + '//' + u.hostname + ':' + (c.port || 8080) + (c.path || '/videos/') + encodeURIComponent(name);
  }

  function size(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1048576)) + ' MB'; }
  function when(t) { return new Date(t * 1000).toLocaleDateString('pt-BR'); }

  // Android: intent direto para o VLC (com legenda); iPhone/iPad: x-callback do VLC; demais: baixa uma lista .m3u que o VLC abre.
  function openVlc(v) {
    const url = fileUrl(v.name), sub = v.sub ? fileUrl(v.sub) : '', ua = navigator.userAgent;
    if (/Android/i.test(ua)) {
      location.href = 'intent://' + url.replace(/^https?:\/\//, '') + '#Intent;scheme=' + url.split(':')[0] + ';package=org.videolan.vlc;type=video/*;S.title=' +
        encodeURIComponent(v.name) + (sub ? ';S.subtitles_location=' + encodeURIComponent(sub) : '') + ';end';
    } else if (/iPhone|iPad|iPod/i.test(ua)) {
      location.href = 'vlc-x-callback://x-callback-url/stream?url=' + encodeURIComponent(url) + (sub ? '&sub=' + encodeURIComponent(sub) : '');
    } else {
      const m3u = '#EXTM3U\n#EXTINF:-1,' + v.name + '\n' + (sub ? '#EXTVLCOPT:sub-file=' + sub + '\n' : '') + url + '\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([m3u], { type: 'audio/x-mpegurl' }));
      a.download = v.name.replace(/\.[^.]+$/, '') + '.m3u';
      document.body.appendChild(a); a.click(); a.remove();
    }
  }

  function copy(text, btn) {
    const done = () => { const t = btn.textContent; btn.textContent = 'Copiado!'; setTimeout(() => { btn.textContent = t; }, 1500); };
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done, () => window.prompt('Copie o link:', text)); return; }
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* cai no prompt */ }
    ta.remove();
    if (ok) done(); else window.prompt('Copie o link:', text);
  }

  // Player embutido: só para formatos que o navegador diz tocar (mp4/webm/mov/mkv); o resto fica só com o VLC.
  const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska' };
  function canPlay(name) {
    const m = MIME[(name.split('.').pop() || '').toLowerCase()], t = document.createElement('video');
    return !!(m && t.canPlayType && t.canPlayType(m));
  }

  function player(v) {
    const ov = document.createElement('div');
    ov.className = 'vp';
    const subOk = v.sub && /\.(srt|vtt)$/i.test(v.sub);
    ov.innerHTML = '<div class="vp-top"><div class="vp-name">' + esc(v.name) + '</div>' +
      '<button type="button" class="vbtn" data-a="vlc">Abrir no VLC</button><button type="button" class="vbtn" data-a="x">Fechar</button></div>' +
      '<video controls autoplay playsinline></video><div class="vp-msg">Sem imagem ou sem som? Este arquivo pode usar um formato que o navegador não lê: abra no VLC.</div>';
    const video = ov.querySelector('video'), msg = ov.querySelector('.vp-msg');
    video.src = fileUrl(v.name);
    if (subOk) {
      const tr = document.createElement('track');
      tr.kind = 'subtitles'; tr.label = 'Português'; tr.srclang = 'pt'; tr.default = true;
      tr.src = CD.state.hub + '/api/videos/sub?name=' + encodeURIComponent(v.name);
      video.appendChild(tr);
    }
    video.addEventListener('error', () => { msg.textContent = 'O navegador não consegue tocar este vídeo (formato ou codec). Abra no VLC.'; msg.className = 'vp-msg err'; });
    function close() {
      document.removeEventListener('keydown', onKey);
      video.pause(); video.removeAttribute('src'); video.load();   // solta a conexão com o servidor
      ov.remove();
    }
    function onKey(e) { if (e.key === 'Escape' || e.keyCode === 10009) close(); }
    document.addEventListener('keydown', onKey);
    ov.querySelector('[data-a="x"]').addEventListener('click', close);
    ov.querySelector('[data-a="vlc"]').addEventListener('click', () => openVlc(v));
    document.body.appendChild(ov);
    video.play().catch(() => { /* autoplay barrado: o usuário aperta play */ });
  }

  function mount(root) {
    root.innerHTML = '<section class="pg"><div class="vids" id="vids"></div></section>';
    const box = root.querySelector('#vids');
    function note(msg) { box.innerHTML = '<div class="empty">' + esc(msg) + '</div>'; }

    async function load() {
      if (!CD.state.hub) { note('Sem o hub: abra o painel pelo endereço do servidor da casa para ver os vídeos.'); return; }
      let list;
      try { list = await CD.hubApi.videos.list(); } catch (e) { note(e.message); return; }
      if (!list || !list.length) { note('Nenhum vídeo na pasta do servidor.'); return; }
      box.innerHTML = '';
      list.forEach(v => {
        const el = document.createElement('article');
        el.className = 'vid';
        el.innerHTML = '<div class="vid-main"><div class="vid-name">' + esc(v.name) + '</div><div class="vid-meta">' + size(v.size) + ' · ' + when(v.time) +
          (v.sub ? ' · com legenda' : '') + '</div></div><div class="vid-act">' +
          (canPlay(v.name) ? '<button type="button" class="vbtn main" data-a="play">Tocar aqui</button>' : '') +
          '<button type="button" class="vbtn' + (canPlay(v.name) ? '' : ' main') + '" data-a="vlc">Abrir no VLC</button>' +
          '<button type="button" class="vbtn" data-a="copy">Copiar link</button>' +
          '<a class="vbtn" href="' + esc(fileUrl(v.name)) + '" target="_blank" rel="noopener">Link direto</a></div>';
        const pl = el.querySelector('[data-a="play"]');
        if (pl) pl.addEventListener('click', () => player(v));
        el.querySelector('[data-a="vlc"]').addEventListener('click', () => openVlc(v));
        el.querySelector('[data-a="copy"]').addEventListener('click', e => copy(fileUrl(v.name), e.currentTarget));
        box.appendChild(el);
      });
    }
    load();
  }

  CD.pages = CD.pages || {};
  CD.pages.videos = { label: 'Vídeos', sub: 'abrir no VLC', icon: 'film', mount: mount };
})(window.CD = window.CD || {});
