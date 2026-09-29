(function (CD) {
  const U = CD.util;

  // Selo central do cabeçalho: feriado (cor por tipo), fim de semana ou dia útil
  function pill(s) {
    const h = CD.holidaysApi.today(s.holidays, s.now);
    if (h) return '<div class="pill hol ' + h.type + '"><span class="pdot"></span><span>Feriado ' + h.type + ' — ' + U.esc(h.name) + '</span></div>';
    const dow = s.now.getDay();
    return '<div class="pill">' + (dow === 0 || dow === 6 ? 'Fim de semana' : 'Dia útil') + '</div>';
  }

  function footer(s) {
    const n = CD.holidaysApi.next(s.holidays, s.now);
    let nextTxt = '';
    if (n) {
      nextTxt = n.days === 1 ? 'Amanhã é feriado — ' + U.esc(n.name)
        : 'Faltam ' + n.days + ' dias para ' + U.esc(n.name) + ' (' + U.dataCurta(n.date) + ')';
    }
    const conn = s.online && !s.wxStale
      ? '<span class="ok"><span class="cdot"></span>Conectado</span>'
      : '<span class="bad"><span class="cdot"></span>Sem conexão — dados em cache</span>';
    return '<footer class="foot"><span>' + (s.updatedAt ? 'Atualizado às ' + U.hhmm(s.updatedAt) : 'Carregando…') + '</span>' + conn + '<span>' + nextTxt + '</span></footer>';
  }

  CD.widgets = CD.widgets || {};
  CD.widgets.holidayPill = pill;
  CD.widgets.footer = footer;
})(window.CD = window.CD || {});
