(function (CD) {
  // Aviso de validades na tela inicial: tile na fileira de atalhos com os itens vencidos ou perto de vencer.
  // Só aparece com o hub ligado e itens cadastrados; tocar leva para a aba Geladeira e Dispensa.
  const U = CD.util, S = CD.stock, I = CD.icons;
  const COLOR = { late: '#FF6B6B', soon: '#FFB020', ok: '#33E19A' };

  function render(s) {
    if (!s.stock || !s.stock.length) return '';
    const soon = S.soonDays();
    const due = s.stock.map(it => ({ it: it, x: S.expiry(it, s.now, soon) }))
      .filter(r => r.x.lvl === 'late' || r.x.lvl === 'soon')
      .sort((a, b) => a.x.d - b.x.d);
    const lvl = due.length ? due[0].x.lvl : 'ok';
    const title = due.length ? 'Validade · ' + due.length : 'Validades';
    const sub = due.length ? due.map(r => r.it.nome).join(', ') : 'Tudo em dia';
    return '<button type="button" class="lk xt ' + lvl + '" data-tab="estoque" title="Geladeira e Dispensa">' +
      I.svg(due.length ? 'alert' : 'check', COLOR[lvl], 36, 1.8) +
      '<span class="lk-t"><b>' + U.esc(title) + '</b><span>' + U.esc(sub) + '</span></span></button>';
  }

  CD.widgets = CD.widgets || {};
  CD.widgets.expiring = render;
})(window.CD = window.CD || {});
