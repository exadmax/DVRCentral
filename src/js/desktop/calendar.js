(function (DK) {
  // Calendário: agrega as agendas iCal do PRÓPRIO usuário (cadastradas aqui, guardadas no servidor) e, se ele quiser, as agendas da
  // casa (as mesmas da tela inicial). Mostra o mês ou os próximos dias e avisa dentro do Desktop dos compromissos que se aproximam.
  // O iCal é interpretado pelo mesmo código do painel (services/calendar.js), inclusive eventos que se repetem.
  const el = DK.el;
  const cal = DK.cal = { model: null, error: '', at: 0, loading: null };

  // ---------- dados ----------
  cal.load = function (force) {
    if (cal.loading) return cal.loading;
    if (!force && cal.model && Date.now() - cal.at < 60000) return Promise.resolve(cal.model);
    cal.loading = (async () => {
      const sources = [];
      const add = (s, prefix, labelPrefix) => {
        let events = [];
        try { events = s.text ? CD.calendar.parseIcs(s.text) : []; } catch (e) { s.error = 'agenda ilegível'; }
        sources.push({ who: prefix + s.who, label: (labelPrefix || '') + s.label, color: s.color, events: events, stale: !!s.stale, error: s.error || '' });
      };
      cal.error = '';
      try { (await DK.api('GET', '/calendars/feed')).sources.forEach(s => add(s, '', '')); } catch (e) { cal.error = e.message; }
      if (DK.prefs.house) {
        try { (await DK.hub('GET', '/api/ics')).sources.forEach(s => add(s, 'h', 'Casa · ')); } catch (e) { /* agendas da casa indisponíveis: segue com as do usuário */ }
      }
      cal.model = { demo: false, sources: sources };
      cal.at = Date.now();
      cal.loading = null;
      return cal.model;
    })().catch(e => { cal.loading = null; throw e; });
    return cal.loading;
  };
  const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const hhmm = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const eventsOn = day => (cal.model ? CD.calendar.eventsOn(cal.model, day) : []);

  // ---------- avisos ----------
  const nkey = () => 'dk:notified:' + (DK.me ? DK.me.id : 0);
  function readNotified() { try { return JSON.parse(localStorage.getItem(nkey()) || '{}'); } catch (e) { return {}; } }
  function writeNotified(m) {
    const limit = Date.now() - 2 * 86400000;
    Object.keys(m).forEach(k => { if (m[k] < limit) delete m[k]; });
    try { localStorage.setItem(nkey(), JSON.stringify(m)); } catch (e) { /* armazenamento bloqueado: pode repetir o aviso */ }
  }
  function tick() {
    if (!cal.model || !DK.me) return;
    const now = Date.now(), remind = DK.prefs.remind == null ? 10 : +DK.prefs.remind;
    const seen = readNotified();
    let changed = false;
    const fire = (k, ev, title, text) => {
      seen[k] = ev.start.getTime(); changed = true;
      DK.notify({ title: title, text: text, color: ev.cal.color, onclick: () => DK.calendarApp({ day: ev.start }) });
    };
    [0, 1].forEach(off => {
      eventsOn(addDays(dayStart(new Date()), off)).forEach(ev => {
        const base = ev.cal.id + '|' + ev.title + '|' + ev.start.getTime(), st = ev.start.getTime();
        const where = (ev.cal.label ? ev.cal.label : '');
        if (ev.allDay) {
          if (off === 0 && DK.prefs.allDay !== false && new Date().getHours() >= 8 && !seen[base + ':d']) fire(base + ':d', ev, 'Hoje: ' + ev.title, 'Dia inteiro · ' + where);
          return;
        }
        if (remind > 0 && !seen[base + ':r'] && now >= st - remind * 60000 && now < st) {
          const mins = Math.max(1, Math.round((st - now) / 60000));
          fire(base + ':r', ev, 'Em ' + mins + ' min: ' + ev.title, hhmm(ev.start) + ' · ' + where);
        }
        if (DK.prefs.atStart !== false && !seen[base + ':s'] && now >= st && now < st + 5 * 60000) fire(base + ':s', ev, 'Agora: ' + ev.title, hhmm(ev.start) + ' · ' + where);
      });
    });
    if (changed) writeNotified(seen);
  }
  let timers = [];
  // Liga o vigia de compromissos (chamado no login): atualiza as agendas a cada 5 minutos e confere os avisos a cada 30 segundos.
  cal.startWatching = function () {
    cal.stopWatching();
    const refresh = () => cal.load(true).then(tick).catch(() => {});
    refresh();
    timers = [setInterval(refresh, 5 * 60000), setInterval(tick, 30000)];
  };
  cal.stopWatching = function () { timers.forEach(clearInterval); timers = []; cal.model = null; };

  // ---------- janela ----------
  DK.calendarApp = function (o) {
    o = o || {};
    const win = DK.openWindow('calendar', 'Calendário', (body, win) => {
      body.className = 'body flush';
      let view = o.view || 'month', cur = dayStart(o.day || new Date()), sel = dayStart(o.day || new Date());
      const title = el('h3');
      const prev = el('button', { textContent: '◀' }), next = el('button', { textContent: '▶' }), today = el('button', { textContent: 'Hoje' });
      const bMonth = el('button', { textContent: 'Mês' }), bAgenda = el('button', { textContent: 'Próximos dias' });
      const bCfg = el('button', { textContent: '⚙ Agendas e avisos' }), rf = el('button', { textContent: '⟳', title: 'Atualizar' });
      const head = el('div', { className: 'calhead' }, prev, today, next, title, bMonth, bAgenda, el('span', { className: 'sp', style: 'flex:1' }), rf, bCfg);
      const main = el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' });
      const status = el('div', { className: 'status' });
      body.append(head, main, status);

      const dot = c => { const i = el('i'); i.style.background = c; return i; };
      function evRow(ev) {
        return el('div', { className: 'evrow' }, dot(ev.cal.color), el('span', { className: 'meta', textContent: ev.allDay ? 'dia todo' : hhmm(ev.start) }),
          el('span', {}, ev.title, ' ', el('span', { className: 'meta', textContent: ev.cal.label })));
      }
      const dayLabel = d => d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

      function drawMonth() {
        title.textContent = cur.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const grid = el('div', { className: 'cal' });
        ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].forEach(d => grid.append(el('div', { className: 'dow', textContent: d })));
        const first = new Date(cur.getFullYear(), cur.getMonth(), 1), start = addDays(first, -first.getDay()), now = new Date();
        for (let i = 0; i < 42; i++) {
          const d = addDays(start, i), evs = eventsOn(d);
          const cell = el('div', { className: 'day' + (d.getMonth() !== cur.getMonth() ? ' off' : '') + (sameDay(d, now) ? ' today' : '') + (sameDay(d, sel) ? ' sel' : ''),
            onclick: () => { sel = d; if (d.getMonth() !== cur.getMonth()) cur = new Date(d.getFullYear(), d.getMonth(), 1); draw(); } },
            el('span', { className: 'dn', textContent: d.getDate() }));
          evs.slice(0, 3).forEach(ev => cell.append(el('div', { className: 'ev' }, dot(ev.cal.color), (ev.allDay ? '' : hhmm(ev.start) + ' ') + ev.title)));
          if (evs.length > 3) cell.append(el('div', { className: 'ev more', textContent: '+' + (evs.length - 3) + ' mais' }));
          grid.append(cell);
        }
        const side = el('div', { className: 'calside' }, el('div', { className: 'evday', textContent: dayLabel(sel) }));
        const evs = eventsOn(sel);
        if (!evs.length) side.append(el('div', { className: 'meta', style: 'padding:8px 10px', textContent: 'Nenhum compromisso neste dia.' }));
        evs.forEach(ev => side.append(evRow(ev)));
        main.replaceChildren(grid, side);
      }

      function drawAgenda() {
        title.textContent = 'Próximos 14 dias';
        const box = el('div', { style: 'overflow:auto;flex:1;min-height:0' });
        let any = false;
        for (let i = 0; i < 14; i++) {
          const d = addDays(dayStart(new Date()), i), evs = eventsOn(d);
          if (!evs.length) continue;
          any = true;
          box.append(el('div', { className: 'evday', textContent: dayLabel(d) }));
          evs.forEach(ev => box.append(evRow(ev)));
        }
        if (!any) box.append(el('div', { className: 'meta', style: 'padding:14px', textContent: 'Nenhum compromisso nos próximos 14 dias.' }));
        main.replaceChildren(box);
      }

      // ---- agendas e avisos ----
      async function drawSettings() {
        title.textContent = 'Agendas e avisos';
        const box = el('div', { className: 'calset' });
        main.replaceChildren(box);
        const err = el('div', { className: 'err' });
        let list = [];
        try { list = await DK.api('GET', '/calendars'); } catch (e) { err.textContent = e.message; }

        const rows = el('table', {}, el('tbody'));
        list.forEach(c => {
          const sw = el('span', { className: 'sw' }); sw.style.background = c.color;
          const en = el('input', { type: 'checkbox', checked: c.enabled, title: 'Mostrar esta agenda' });
          en.onchange = async () => { try { await DK.api('PUT', '/calendars/' + c.id, { name: c.name, color: c.color, enabled: en.checked }); cal.load(true).then(draw); } catch (e) { err.textContent = e.message; en.checked = !en.checked; } };
          rows.firstChild.append(el('tr', {}, el('td', {}, en), el('td', {}, sw, c.name), el('td', { className: 'meta', textContent: c.url }),
            el('td', {}, el('button', { className: 'del', textContent: 'Remover', onclick: async () => {
              if (!confirm('Remover a agenda “' + c.name + '” do seu Desktop? (A agenda original não é alterada.)')) return;
              try { await DK.api('DELETE', '/calendars/' + c.id); cal.load(true); drawSettings(); } catch (e) { err.textContent = e.message; }
            } }))));
        });
        if (!list.length) rows.firstChild.append(el('tr', {}, el('td', { className: 'meta', colSpan: 4, textContent: 'Você ainda não tem agendas. Cole abaixo o endereço iCal secreto (Google Agenda → Configurações da agenda → “Endereço secreto no formato iCal”).' })));

        const name = el('input', { placeholder: 'Nome (ex.: Trabalho)', maxLength: 40 });
        const color = el('input', { type: 'color', value: '#4DA3FF', title: 'Cor' }); color.style.cssText = 'width:44px;padding:0;height:30px';
        const url = el('input', { placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics  (ou webcal://…)' });
        const add = el('button', { className: 'pri', textContent: 'Adicionar agenda' });
        add.onclick = async () => {
          err.className = 'err'; err.textContent = '';
          add.disabled = true; add.textContent = 'Conferindo…';
          try { await DK.api('POST', '/calendars', { name: name.value, color: color.value, url: url.value }); cal.load(true).then(draw); drawSettings(); }
          catch (e) { err.textContent = e.message; add.disabled = false; add.textContent = 'Adicionar agenda'; }
        };

        const chk = (k, label, def, extra) => {
          const i = el('input', { type: 'checkbox', checked: DK.prefs[k] == null ? def : !!DK.prefs[k] });
          i.onchange = () => { DK.prefs[k] = i.checked; DK.savePrefs(); if (extra) extra(i.checked); };
          return el('label', { className: 'row' }, i, label);
        };
        const rem = el('select', {}, ...[[0, 'não avisar antes'], [5, '5 minutos antes'], [10, '10 minutos antes'], [15, '15 minutos antes'], [30, '30 minutos antes'], [60, '1 hora antes']]
          .map(x => el('option', { value: x[0], textContent: x[1], selected: (DK.prefs.remind == null ? 10 : +DK.prefs.remind) === x[0] })));
        rem.onchange = () => { DK.prefs.remind = +rem.value; DK.savePrefs(); };
        const brow = el('div', { className: 'row' });
        if ('Notification' in window && window.isSecureContext) {
          const b = el('button', { textContent: Notification.permission === 'granted' ? 'Avisos do navegador: permitidos' : 'Permitir avisos do navegador', disabled: Notification.permission === 'granted' });
          b.onclick = async () => { const r = await Notification.requestPermission(); DK.prefs.browser = r === 'granted'; DK.savePrefs(); drawSettings(); };
          brow.append(b, el('span', { className: 'meta', textContent: 'aparecem quando esta aba está em segundo plano' }));
        } else brow.append(el('span', { className: 'meta', textContent: 'Avisos do navegador exigem HTTPS; dentro do Desktop os avisos aparecem normalmente (sino, tela e som).' }));

        box.append(el('div', { className: 'sec', textContent: 'Minhas agendas (só você vê)' }), rows,
          el('div', { className: 'row grow' }, name, color, url), el('div', { className: 'row' }, add), err,
          el('div', { className: 'sec', textContent: 'Avisos no Desktop' }),
          el('div', { className: 'row' }, 'Avisar ', rem), chk('atStart', 'avisar também na hora do compromisso', true), chk('allDay', 'avisar compromissos de dia inteiro às 8h', true),
          chk('sound', 'tocar um som', true), brow,
          chk('house', 'mostrar também as agendas da casa (as da tela inicial)', false, () => cal.load(true).then(draw)),
          el('div', { className: 'meta', textContent: 'Os avisos só aparecem enquanto o seu Desktop está aberto. As agendas são relidas a cada 5 minutos.' }));
      }

      function draw() {
        bMonth.className = view === 'month' ? 'pri' : ''; bAgenda.className = view === 'agenda' ? 'pri' : '';
        bCfg.className = view === 'cfg' ? 'pri' : '';
        [prev, next, today].forEach(b => { b.disabled = view !== 'month'; });
        if (view === 'cfg') { drawSettings(); status.textContent = ''; return; }
        if (!cal.model) { main.replaceChildren(el('div', { className: 'meta', style: 'padding:14px', textContent: 'Carregando agendas…' })); return; }
        (view === 'month' ? drawMonth : drawAgenda)();
        const n = cal.model.sources.length, bad = cal.model.sources.filter(s => s.error || s.stale);
        status.textContent = n ? n + ' agenda(s)' + (bad.length ? ' — problema em: ' + bad.map(s => s.label + (s.error ? ' (' + s.error + ')' : ' (cópia antiga)')).join(', ') : '') + (cal.error ? ' — ' + cal.error : '')
          : 'Nenhuma agenda ainda. Abra “Agendas e avisos” para adicionar a sua.';
      }
      const reload = force => { draw(); return cal.load(force).then(draw).catch(e => { status.textContent = e.message; }); };

      prev.onclick = () => { cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1); draw(); };
      next.onclick = () => { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); draw(); };
      today.onclick = () => { cur = dayStart(new Date()); sel = dayStart(new Date()); draw(); };
      bMonth.onclick = () => { view = 'month'; draw(); };
      bAgenda.onclick = () => { view = 'agenda'; draw(); };
      bCfg.onclick = () => { view = view === 'cfg' ? 'month' : 'cfg'; draw(); };
      rf.onclick = () => reload(true);
      win._goto = d => { cur = dayStart(d); sel = dayStart(d); view = 'month'; draw(); };
      reload(false);
    }, 780, 580, { flush: true });
    if (o.day && win._goto) win._goto(o.day);
    return win;
  };

  DK.register({ id: 'calendar', icon: '📅', label: 'Calendário', desktop: true, open: () => DK.calendarApp() });
})(window.DK = window.DK || {});
