(function (CD) {
  const U = CD.util;

  // Selo central do cabeçalho: feriado (cor por tipo), fim de semana ou dia útil
  function pill(s) {
    const h = CD.holidaysApi.today(s.holidays, s.now);
    if (h) return '<div class="pill hol ' + h.type + '"><span class="pdot"></span><span>Feriado ' + h.type + ' — ' + U.esc(h.name) + '</span></div>';
    const dow = s.now.getDay();
    return '<div class="pill">' + (dow === 0 || dow === 6 ? 'Fim de semana' : 'Dia útil') + '</div>';
  }

  const nf = (n, d) => n.toFixed(d).replace('.', ',');
  function bytes(b) { return b >= 1073741824 ? nf(b / 1073741824, 1) + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB'; }

  // Uso de CPU/memória do hub e da máquina (vem de /api/system; atualizado no lugar por CD.widgets.sysText)
  function sysText(y) {
    if (!y) return '';
    return 'Hub: ' + nf(y.appCpuPercent, 0) + '% CPU · ' + bytes(y.appMem) + ' (' + nf(y.appMemPercent, 1) + '% da RAM)' +
      ' — Máquina: ' + nf(y.cpuPercent, 0) + '% de ' + y.cores + ' CPU · ' + bytes(y.memUsed) + ' de ' + bytes(y.memTotal) + ' (' + nf(y.memPercent, 0) + '%)';
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
    const night = s.nightSkipped ? '<button type="button" class="nightbtn" data-night="on">Ativar modo noturno</button>' : '';   // desligado à mão nesta noite
    const ver = s.version ? ' · ' + (/^\d/.test(s.version) ? 'V' : '') + U.esc(s.version) : '';      // versão instalada no hub (V1.0.1; "dev" fora do servidor)
    return '<footer class="foot"><span>' + (s.updatedAt ? 'Atualizado às ' + U.hhmm(s.updatedAt) : 'Carregando…') + ver + '</span><span id="sysinfo" class="sysinfo">' + U.esc(sysText(s.sys)) + '</span>' + conn + night + '<span>' + nextTxt + '</span></footer>';
  }

  CD.widgets = CD.widgets || {};
  CD.widgets.holidayPill = pill;
  CD.widgets.footer = footer;
  CD.widgets.sysText = sysText;
})(window.CD = window.CD || {});
