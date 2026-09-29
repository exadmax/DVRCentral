(function (CD) {
  // Atalhos para os outros serviços da máquina (WebRCade, Navidrome, vídeos, ROMs).
  // Só aparecem quando existe um endereço-base: o hub configurado ou o servidor que entregou a página.
  function base(s) {
    if (s.hub) return s.hub;
    return /^https?:/.test(location.protocol) ? location.origin : '';
  }

  function href(l, b) {
    let u;
    try { u = new URL(b); } catch (e) { return null; }
    const host = u.protocol + '//' + u.hostname;                 // mesmo host, sem porta
    const origin = l.port ? host + ':' + l.port : u.origin;
    return origin + l.path.replace('{host}', host);
  }

  function render(s) {
    const b = base(s), list = s.cfg.links || [];
    if (!b || !list.length) return '';
    return '<nav class="links">' + list.map(l => {
      const h = href(l, b);
      return h ? '<a class="lk" target="_top" href="' + CD.util.esc(h) + '">' + CD.icons.svg(l.icon, '#4DA3FF', 36, 1.8) +
        '<span class="lk-t"><b>' + CD.util.esc(l.label) + '</b><span>' + CD.util.esc(l.sub || '') + '</span></span></a>' : '';
    }).join('') + '</nav>';
  }

  CD.widgets = CD.widgets || {};
  CD.widgets.links = render;
})(window.CD = window.CD || {});
