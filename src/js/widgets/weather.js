(function (CD) {
  const I = CD.icons;

  function render(s) {
    const w = s.weather;
    if (!w) return '<section class="col"><div class="h2">Clima do dia</div><div class="skel" style="height:140px"></div><div class="skel" style="height:150px"></div></section>';

    const hour = s.now.getHours();
    const alert = w.rain
      ? '<div class="alert">' + I.svg('umbrella', '#FFB020', 34, 1.8) + '<span>' +
        (w.rain.hour <= hour ? 'Chuva agora' : 'Chuva às ' + w.rain.hour + 'h') + ' — leve guarda-chuva</span></div>'
      : '';
    const periods = w.periods.map(p => {
      const warn = p.pop >= 60;
      return '<div class="period' + (warn ? ' warn' : '') + '"><div class="p-label">' + p.label + '</div>' +
        I.weather(p.code, true, warn ? '#FFB020' : '#F2F5FA', 36, 1.8) +
        '<div class="p-temp num">' + p.temp + '°</div><div class="p-pop">' + p.pop + '% chuva</div></div>';
    }).join('');

    return '<section class="col"><div class="h2">Clima do dia' + (s.wxStale ? ' <span class="tag warn">cache</span>' : '') + '</div>' +
      '<div class="wx-big">' + I.weather(w.now.code, w.now.isDay, '#4DA3FF', 96, 1.6) +
      '<div class="wx-big-t"><div class="num big-temp">' + w.now.temp + '°</div>' +
      '<div class="sub">Mín ' + w.min + '° · Máx ' + w.max + '° · Sensação ' + w.now.feels + '°</div></div></div>' +
      alert + '<div class="periods">' + periods + '</div>' + CD.widgets.thumbs(s) +
      '<div class="wx-foot"><span>Nascer ' + w.sunrise + ' · Pôr do sol ' + w.sunset + '</span><span>Umidade ' + w.now.humidity + '%</span></div></section>';
  }

  CD.widgets = CD.widgets || {};
  CD.widgets.weather = render;
})(window.CD = window.CD || {});
