(function (CD) {
  // Alerta de validades para o item "Geladeira" do menu de atalhos (links.js): itens vencidos ou perto de vencer.
  // Devolve null (item normal do menu) quando o hub está fora do ar ou não há itens cadastrados.
  const S = CD.stock;
  const COLOR = { late: '#FF6B6B', soon: '#FFB020', ok: '#33E19A' };

  function alertFor(s) {
    if (!s.stock || !s.stock.length) return null;
    const soon = S.soonDays();
    let late = 0, warn = 0;
    s.stock.forEach(it => { const x = S.expiry(it, s.now, soon); if (x.lvl === 'late') late++; else if (x.lvl === 'soon') warn++; });
    if (!late && !warn) return { lvl: 'ok', icon: 'check', color: COLOR.ok, sub: 'Tudo em dia' };
    const parts = [];
    if (late) parts.push(S.plural(late, 'vencido', 'vencidos'));
    if (warn) parts.push(warn + ' a vencer');
    return { lvl: late ? 'late' : 'soon', icon: 'alert', color: late ? COLOR.late : COLOR.soon, sub: parts.join(' · ') };
  }

  CD.widgets = CD.widgets || {};
  CD.widgets.expiring = alertFor;
})(window.CD = window.CD || {});
