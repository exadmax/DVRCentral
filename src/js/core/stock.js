(function (CD) {
  // Regras de estoque compartilhadas pela aba Geladeira e Dispensa e pelo aviso de validades da tela inicial.
  const LOCAIS = [
    { id: 'geladeira', label: 'Geladeira', color: '#4DA3FF', icon: 'fridge' },
    { id: 'freezer', label: 'Freezer', color: '#7EE7F2', icon: 'snow' },
    { id: 'dispensa', label: 'Dispensa', color: '#C89BFF', icon: 'box' }
  ];

  const parseDate = s => { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };

  // Dias até vencer (negativo = já venceu); null quando o item não tem validade
  function daysLeft(it, now) {
    if (!it.validade) return null;
    return Math.round((parseDate(it.validade) - CD.util.startOfDay(now)) / 86400000);
  }

  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

  // Situação da validade: lvl = 'none' | 'ok' | 'soon' | 'late', com o texto curto para mostrar
  function expiry(it, now, soonDays) {
    const d = daysLeft(it, now);
    if (d === null) return { lvl: 'none', d: null, text: 'Sem validade' };
    if (d < 0) return { lvl: 'late', d: d, text: 'Vencido há ' + plural(-d, 'dia', 'dias') };
    if (d === 0) return { lvl: 'soon', d: d, text: 'Vence hoje' };
    if (d === 1) return { lvl: 'soon', d: d, text: 'Vence amanhã' };
    return { lvl: d <= soonDays ? 'soon' : 'ok', d: d, text: 'Vence em ' + plural(d, 'dia', 'dias') };
  }

  function num(n) { return String(+Number(n).toFixed(3)).replace('.', ','); }

  function qty(it) {
    const p = [];
    if (it.quantidade != null) p.push(num(it.quantidade) + ' un');
    if (it.pesoKg != null) p.push(num(it.pesoKg) + ' kg');
    return p.join(' · ');
  }

  const dataBr = v => { const p = String(v).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };

  CD.stock = {
    LOCAIS: LOCAIS,
    local: id => LOCAIS.filter(l => l.id === id)[0] || LOCAIS[0],
    soonDays: () => Math.max(0, +((CD.state && CD.state.cfg.estoque && CD.state.cfg.estoque.soonDays) || 3)),
    daysLeft: daysLeft, expiry: expiry, qty: qty, num: num, dataBr: dataBr, plural: plural
  };
})(window.CD = window.CD || {});
