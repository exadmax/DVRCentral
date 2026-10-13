(function (CD) {
  // Parte editável da página Config: câmeras, agendas (iCal), rotas do trânsito (origem/destino) e atalhos do menu, mais o
  // modo compatibilidade. Tudo é guardado no hub (hub.settings.json) e vale na hora, sem reiniciar. Senhas e chaves nunca
  // voltam do hub: o campo mostra a versão mascarada e, deixado em branco, mantém o valor atual.
  // Esta área só é redesenhada por ações do usuário (nunca pelo recarregamento periódico da página), para não perder o que está sendo digitado.
  const U = CD.util, esc = U.esc;
  const ICONS = [['gamepad', 'Jogos'], ['fridge', 'Geladeira'], ['phone', 'Telefone'], ['camera', 'Câmera'], ['music', 'Música'], ['film', 'Filme'],
    ['folder', 'Pasta'], ['gear', 'Engrenagem'], ['home', 'Casa'], ['link', 'Link'], ['box', 'Caixa'], ['clock', 'Relógio'], ['mail', 'E-mail'],
    ['user', 'Pessoa'], ['pin', 'Local'], ['trophy', 'Troféu'], ['umbrella', 'Guarda-chuva'], ['search', 'Busca']];
  const DAYS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb'], [0, 'Dom']];
  const HEX = /^#[0-9a-fA-F]{6}$/;

  const fld = (label, inner, cls) => '<label class="fld' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + '</span>' + inner + '</label>';
  const inp = (k, v, ph, extra) => '<input data-k="' + k + '" value="' + esc(v) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' autocomplete="off" spellcheck="false"' + (extra || '') + '>';
  const btn = (a, label, cls, dis) => '<button type="button" class="btn ' + (cls || 'ghost') + '" data-a="' + a + '"' + (dis ? ' disabled' : '') + '>' + esc(label) + '</button>';

  CD.cfgUi = { fld: fld, inp: inp, btn: btn, ICONS: ICONS };       // usado também por configPanel.js

  const TAB = { cameras: 'cameras', calendars: 'agendas', traffic: 'agendas', menu: 'menu' };

  function mount(root) {
    root.innerHTML = '<div class="cfg" id="ce"></div>';
    const box = root.firstChild;
    const ed = { cameras: null, calendars: null, traffic: null, menu: null, menuCustom: false };
    const msgs = {}, busy = {};

    const say = (sec, text, bad) => { msgs[sec] = text ? { text: text, bad: !!bad } : null; };
    const note = sec => msgs[sec] ? '<div class="cfg-msg' + (msgs[sec].bad ? ' cfg-err' : '') + '">' + esc(msgs[sec].text) + '</div>' : '';
    const card = (sec, title, intro, body) => '<div class="cfg-card" data-tab="' + TAB[sec] + '" data-sec="' + sec + '"><h2>' + esc(title) + '</h2><div class="cfg-hint">' + intro + '</div>' + body + note(sec) + '</div>';

    // ---------- câmeras ----------
    function camRow(c, i) {
      return '<div class="cfg-item" data-i="' + i + '"><div class="cfg-grid">' +
        fld('Nome', inp('name', c.name, 'Ex.: Garagem')) +
        fld('Endereço RTSP', inp('url', c.url, c.masked ? c.masked + '  (em branco = manter)' : 'rtsp://usuario:senha@192.168.0.10:554/cam/realmonitor?channel=1&subtype=1', ' type="text"'), 'wide') +
        '</div><div class="cfg-ia">' + btn('del:cameras:' + i, 'Remover', 'ghost') + '</div></div>';
    }
    function camerasCard() {
      if (!ed.cameras) return card('cameras', 'Câmeras', 'Carregando…', '');
      return card('cameras', 'Câmeras', 'Câmeras RTSP (H.264) de casa. Use o substream (ex.: <code>subtype=1</code>) para pesar menos. A senha fica só no servidor. ' +
        'Câmera nova começa a gravar se a gravação geral estiver ligada.',
        ed.cameras.map(camRow).join('') + '<div class="cfg-bar2">' + btn('add:cameras', '+ Adicionar câmera') + btn('save:cameras', 'Salvar câmeras', '', busy.cameras) + '</div>');
    }

    // ---------- agendas ----------
    function calRow(c, i) {
      const hex = HEX.test(c.color) ? c.color : '#B48CFF';      // cor não sólida (degradê) não cabe no seletor: só muda se o usuário escolher outra
      return '<div class="cfg-item" data-i="' + i + '"><div class="cfg-grid">' +
        fld('Nome', inp('label', c.label, 'Ex.: Casal')) +
        fld('Cor', '<input type="color" data-k="color" data-touched="' + (c.colorTouched ? 1 : 0) + '" value="' + hex + '">') +
        fld('Endereço iCal (.ics)', inp('url', c.url, c.masked ? c.masked + '  (em branco = manter)' : 'https://calendar.google.com/calendar/ical/.../basic.ics'), 'wide') +
        '</div><div class="cfg-ia">' + btn('del:calendars:' + i, 'Remover', 'ghost') + '</div></div>';
    }
    function calendarsCard() {
      if (!ed.calendars) return card('calendars', 'Agendas (iCal)', 'Carregando…', '');
      return card('calendars', 'Agendas (iCal)', 'Endereço secreto do Google Agenda (Configurações → Integrar agenda → Endereço secreto em formato iCal). O hub confere se a agenda abre antes de salvar.',
        ed.calendars.map(calRow).join('') + '<div class="cfg-bar2">' + btn('add:calendars', '+ Adicionar agenda') + btn('save:calendars', 'Salvar agendas', '', busy.calendars) + '</div>');
    }

    // ---------- rotas do trânsito ----------
    function routeRow(p, r, pi, ri) {
      const days = DAYS.map(d => '<label><input type="checkbox" data-day="' + d[0] + '"' + (r.days.indexOf(d[0]) >= 0 ? ' checked' : '') + '>' + d[1] + '</label>').join('');
      return '<div class="cfg-item" data-r="' + ri + '"><div class="cfg-grid">' +
        fld('Nome da rota', inp('name', r.name, 'Ex.: Escritório')) +
        fld('A partir de (opcional)', inp('after', r.after, 'HH:MM', ' type="time"')) +
        (r.home ? '' : fld('Origem (vazio = casa)', inp('from', r.from, 'Endereço de saída'), 'wide') + fld('Destino', inp('to', r.to, 'Endereço de chegada'), 'wide')) +
        '</div><label class="cfg-chk"><input type="checkbox" data-k="home"' + (r.home ? ' checked' : '') + ' data-redraw="1">Home office (sem deslocamento)</label>' +
        '<div class="cfg-days">' + days + '</div>' +
        '<div class="cfg-ia">' + btn('del:route:' + pi + ':' + ri, 'Remover rota', 'ghost') + '</div></div>';
    }
    // Regras de consulta da API de rotas (as mesmas que diferenciam o Diogo e a Cássia):
    //  • ondemand — só consulta quando alguém toca em “Ver trânsito” (vale por 10 min); não gasta cota sozinho. (Diogo)
    //  • window   — consulta sozinho só entre dois horários; antes mostra “Disponível às…”, depois mostra o último resultado e some no horário de esconder. (Cássia)
    //  • always   — consulta sempre que o painel atualiza (respeitando o intervalo de cache do hub).
    const MODES = [['ondemand', 'Só quando eu pedir (botão “Ver trânsito”)'], ['window', 'Automático numa janela de horário'], ['always', 'Sempre (a cada atualização)']];
    const MODE_HELP = {
      ondemand: 'O cartão mostra o botão “Ver trânsito”. Ao tocar, o hub consulta a API e o resultado fica na tela por 10 minutos. Poupa a cota.',
      window: 'O hub só consulta a API dentro da janela (ex.: 06:00 às 08:00). Antes dela o cartão diz “Disponível às…”; depois dela mostra o último resultado, sem nova consulta, até o horário de esconder.',
      always: 'O hub consulta a API em toda atualização do painel (no máximo a cada o tempo de cache em Integrações).'
    };
    function personBlock(p, pi) {
      const mode = p.mode || 'always';
      return '<div class="cfg-cam" data-p="' + pi + '"><div class="cfg-sub">Pessoa ' + (pi + 1) + '</div>' +
        '<div class="cfg-grid">' + fld('Nome da pessoa', inp('label', p.label, 'Ex.: Cássia')) + fld('Precisa chegar às', inp('arriveBy', p.arriveBy, 'HH:MM', ' type="time"')) + '</div>' +
        '<div class="cfg-grid">' + fld('Quando consultar a API de rotas', '<select data-k="mode" data-redraw="1">' + MODES.map(m => '<option value="' + m[0] + '"' + (m[0] === mode ? ' selected' : '') + '>' + esc(m[1]) + '</option>').join('') + '</select>', 'wide') +
        (mode === 'window' ? fld('Janela: a partir das', inp('windowFrom', p.windowFrom, 'HH:MM', ' type="time"')) + fld('…até as', inp('windowTo', p.windowTo, 'HH:MM', ' type="time"')) +
          fld('Esconder o cartão depois das', inp('showUntil', p.showUntil, 'HH:MM', ' type="time"')) : '') + '</div>' +
        '<div class="cfg-hint">' + MODE_HELP[mode] + '</div>' +
        p.routes.map((r, ri) => routeRow(p, r, pi, ri)).join('') +
        '<div class="cfg-bar2">' + btn('add:route:' + pi, '+ Adicionar rota') + btn('del:person:' + pi, 'Remover ' + (p.label || 'pessoa'), 'ghost') + '</div></div>';
    }
    function trafficCard() {
      const t = ed.traffic;
      if (!t) return card('traffic', 'Rotas (trânsito)', 'Carregando…', '');
      return card('traffic', 'Rotas (trânsito)', 'Origem e destino de cada trajeto, por dia da semana. O tempo vem da API Google Routes; a chave fica só no servidor.',
        '<div class="cfg-grid">' + fld('Endereço de casa (origem padrão)', '<input data-t="home" value="' + esc(t.home) + '" placeholder="Rua, número, cidade" autocomplete="off">', 'wide') +
        fld('Chave da API Google Routes', '<input data-t="key" type="password" value="' + esc(t.key) + '" placeholder="' + (t.keySet ? 'configurada (em branco = manter)' : 'cole a chave aqui') + '" autocomplete="new-password">', 'wide') + '</div>' +
        t.people.map(personBlock).join('') + '<div class="cfg-bar2">' + btn('add:person', '+ Adicionar pessoa') + btn('save:traffic', 'Salvar rotas', '', busy.traffic) + '</div>');
    }

    // ---------- menu ----------
    function menuRow(l, i, n) {
      const icons = ICONS.some(x => x[0] === l.icon) || !l.icon ? ICONS : ICONS.concat([[l.icon, l.icon]]);
      const locked = !l.port && l.path === '/config.html';
      return '<div class="cfg-item" data-i="' + i + '"><div class="cfg-grid">' +
        fld('Nome', inp('label', l.label, 'Ex.: Vídeos')) + fld('Descrição', inp('sub', l.sub, 'Ex.: Abrir no VLC')) +
        fld('Ícone', '<select data-k="icon">' + icons.map(x => '<option value="' + esc(x[0]) + '"' + (x[0] === (l.icon || 'link') ? ' selected' : '') + '>' + esc(x[1]) + '</option>').join('') + '</select>') +
        fld('Porta (vazio = este servidor)', inp('port', l.port || '', 'Ex.: 4533', ' type="number" min="1" max="65535"')) +
        fld('Caminho', inp('path', l.path, '/estoque.html'), 'wide') + '</div>' +
        '<div class="cfg-ia">' + btn('up:menu:' + i, '↑', 'ghost', i === 0) + btn('down:menu:' + i, '↓', 'ghost', i === n - 1) +
        '<span class="grow cfg-hint">' + (locked ? 'Este atalho leva a esta tela e não pode ser removido.' : '') + '</span>' + btn('del:menu:' + i, 'Remover', 'ghost', locked) + '</div></div>';
    }
    function menuCard() {
      if (!ed.menu) return card('menu', 'Menu de atalhos', 'Carregando…', '');
      return card('menu', 'Menu de atalhos', 'Os botões do rodapé da tela inicial. Páginas do painel: porta em branco e caminho como <code>/estoque.html</code>. ' +
        'Outros serviços da máquina: informe a porta (ex.: 4533) e o caminho (ex.: <code>/</code>). ' + (ed.menuCustom ? 'Menu personalizado.' : 'Hoje é o menu padrão; ao salvar passa a ser personalizado.'),
        ed.menu.map((l, i) => menuRow(l, i, ed.menu.length)).join('') + '<div class="cfg-bar2">' + btn('add:menu', '+ Adicionar atalho') + btn('save:menu', 'Salvar menu', '', busy.menu) +
        (ed.menuCustom ? btn('reset:menu', 'Voltar ao menu padrão') : '') + '</div>');
    }

    // ---------- modo compatibilidade ----------
    function compatCard() {
      const C = CD.compat, m = C.mode();
      const opts = [['auto', 'Automático (liga em navegador de TV)'], ['on', 'Sempre ligado'], ['off', 'Sempre desligado']];
      return '<div class="cfg-card" data-tab="compat" data-sec="compat"><h2>Modo compatibilidade</h2>' +
        '<div class="cfg-hint">Navegadores de TV (Samsung, LG, Chromecast…) não conseguem mostrar várias câmeras ao vivo ao mesmo tempo. No modo compatibilidade a página Câmeras mostra <b>uma câmera por vez</b>, com botões para trocar. Vale só para este aparelho.</div>' +
        '<div class="cfg-a"><div class="cfg-at"><b>Modo</b><span id="compat-st">' + esc(status()) + '</span></div>' +
        '<select class="cfg-sel" id="compat-sel">' + opts.map(o => '<option value="' + o[0] + '"' + (o[0] === m ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></div></div>';
    }
    function status() {
      const C = CD.compat;
      return (C.active() ? 'Ligado neste aparelho: uma câmera por vez.' : 'Desligado neste aparelho: todas as câmeras ao mesmo tempo.') +
        ' Navegador de TV detectado: ' + (C.detected() ? 'sim' : 'não') + '.';
    }

    function draw() {
      if (!CD.state.hub) { box.innerHTML = compatCard(); return; }
      box.innerHTML = camerasCard() + calendarsCard() + trafficCard() + menuCard() + compatCard();
    }

    // ---------- DOM -> estado ----------
    const val = (item, k) => { const e = item.querySelector('[data-k="' + k + '"]'); return !e ? '' : e.type === 'checkbox' ? e.checked : e.value; };
    function collect() {
      const sec = n => box.querySelectorAll('[data-sec="' + n + '"] > .cfg-item');
      if (ed.cameras) sec('cameras').forEach((it, i) => { if (ed.cameras[i]) { ed.cameras[i].name = val(it, 'name'); ed.cameras[i].url = val(it, 'url'); } });
      if (ed.calendars) sec('calendars').forEach((it, i) => {
        const c = ed.calendars[i]; if (!c) return;
        c.label = val(it, 'label'); c.url = val(it, 'url');
        const col = it.querySelector('[data-k="color"]');
        if (col && col.getAttribute('data-touched') === '1') { c.color = col.value; c.colorTouched = true; }
      });
      if (ed.traffic) {
        const t = ed.traffic, h = box.querySelector('[data-t="home"]'), k = box.querySelector('[data-t="key"]');
        if (h) t.home = h.value;
        if (k) t.key = k.value;
        box.querySelectorAll('.cfg-cam[data-p]').forEach(pb => {
          const p = t.people[+pb.getAttribute('data-p')]; if (!p) return;
          p.label = val(pb, 'label'); p.arriveBy = val(pb, 'arriveBy'); p.mode = val(pb, 'mode');
          if (p.mode === 'window') {                      // ao escolher a janela pela primeira vez, sugere a da manhã
            p.windowFrom = pb.querySelector('[data-k="windowFrom"]') ? val(pb, 'windowFrom') : (p.windowFrom || '06:00');
            p.windowTo = pb.querySelector('[data-k="windowTo"]') ? val(pb, 'windowTo') : (p.windowTo || '08:00');
            p.showUntil = pb.querySelector('[data-k="showUntil"]') ? val(pb, 'showUntil') : (p.showUntil || '09:00');
          }
          pb.querySelectorAll('.cfg-item[data-r]').forEach(it => {
            const r = p.routes[+it.getAttribute('data-r')]; if (!r) return;
            r.name = val(it, 'name'); r.after = val(it, 'after'); r.home = val(it, 'home');
            if (!r.home) { r.from = val(it, 'from'); r.to = val(it, 'to'); }
            r.days = []; it.querySelectorAll('[data-day]').forEach(d => { if (d.checked) r.days.push(+d.getAttribute('data-day')); });
          });
        });
      }
      if (ed.menu) sec('menu').forEach((it, i) => {
        const l = ed.menu[i]; if (!l) return;
        l.label = val(it, 'label'); l.sub = val(it, 'sub'); l.icon = val(it, 'icon'); l.port = parseInt(val(it, 'port'), 10) || 0; l.path = val(it, 'path');
      });
    }

    // ---------- hub -> estado ----------
    const fromCams = l => l.map(c => ({ id: c.id, name: c.name, masked: c.url, url: '' }));
    const fromCals = l => l.map(c => ({ who: c.who, label: c.label, color: c.color, masked: c.url, url: '', colorTouched: false }));
    function fromTraffic(t) {
      t.key = '';
      t.people.forEach(p => { p.mode = p.onDemand ? 'ondemand' : (p.windowFrom ? 'window' : 'always'); p.arriveBy = p.arriveBy || ''; p.windowFrom = p.windowFrom || ''; p.windowTo = p.windowTo || ''; p.showUntil = p.showUntil || ''; });
      t.people.forEach(p => p.routes.forEach(r => { r.name = r.name || ''; r.from = r.from || ''; r.to = r.to || ''; r.after = r.after || ''; }));
      return t;
    }
    function fromMenu(j) {
      ed.menuCustom = Array.isArray(j.links);
      const src = ed.menuCustom ? j.links : ((CD.state.cfg && CD.state.cfg.links) || []);
      ed.menu = src.map(l => ({ label: l.label || '', sub: l.sub || '', icon: l.icon || 'link', port: l.port || 0, path: l.path || '/', alert: l.alert || '' }));
    }

    async function load() {
      if (!CD.state.hub) return draw();
      draw();
      const A = CD.hubApi.settings;
      try { ed.cameras = fromCams(await A.get('cameras')); } catch (e) { say('cameras', e.message, true); ed.cameras = []; }
      try { ed.calendars = fromCals(await A.get('calendars')); } catch (e) { say('calendars', e.message, true); ed.calendars = []; }
      try { ed.traffic = fromTraffic(await A.get('traffic')); } catch (e) { say('traffic', e.message, true); }
      try { fromMenu(await A.get('menu')); } catch (e) { say('menu', e.message, true); }
      draw();
    }

    async function save(sec) {
      collect();
      const A = CD.hubApi.settings;
      let payload;
      if (sec === 'cameras') payload = ed.cameras.filter(c => c.id || c.name.trim() || c.url.trim()).map(c => ({ id: c.id || '', name: c.name, url: c.url }));
      else if (sec === 'calendars') payload = ed.calendars.filter(c => c.who || c.label.trim() || c.url.trim()).map(c => ({ who: c.who || '', label: c.label, color: c.color, url: c.url }));
      else if (sec === 'traffic') payload = { home: ed.traffic.home, key: ed.traffic.key, people: ed.traffic.people.map(p => ({
        id: p.id, label: p.label, arriveBy: p.arriveBy, routes: p.routes, onDemand: p.mode === 'ondemand',
        windowFrom: p.mode === 'window' ? p.windowFrom : '', windowTo: p.mode === 'window' ? p.windowTo : '', showUntil: p.mode === 'window' ? p.showUntil : '' })) };
      else payload = { links: ed.menu.map(l => ({ label: l.label, sub: l.sub, icon: l.icon, port: l.port, path: l.path, alert: l.alert })) };
      busy[sec] = true; say(sec, 'Salvando…'); draw();
      try {
        const r = await A.save(sec, payload);
        if (sec === 'cameras') ed.cameras = fromCams(r);
        else if (sec === 'calendars') ed.calendars = fromCals(r);
        else if (sec === 'traffic') ed.traffic = fromTraffic(r);
        else fromMenu(r);
        say(sec, 'Salvo. Já está valendo.');
      } catch (e) { say(sec, e.message, true); }
      busy[sec] = false; draw();
    }

    async function resetMenu() {
      if (!confirm('Voltar o menu ao padrão do painel?')) return;
      busy.menu = true; say('menu', 'Salvando…'); draw();
      try { fromMenu(await CD.hubApi.settings.save('menu', { links: null })); say('menu', 'Menu padrão restaurado.'); } catch (e) { say('menu', e.message, true); }
      busy.menu = false; draw();
    }

    function act(a) {
      const p = a.split(':'), op = p[0], what = p[1];
      if (op === 'save') return save(what);
      if (op === 'reset') return resetMenu();
      collect();
      if (op === 'add') {
        say(what === 'route' || what === 'person' ? 'traffic' : what, '');
        if (what === 'cameras') ed.cameras.push({ id: '', name: '', masked: '', url: '' });
        else if (what === 'calendars') ed.calendars.push({ who: '', label: '', color: '#B48CFF', masked: '', url: '', colorTouched: true });
        else if (what === 'person') ed.traffic.people.push({ id: '', label: '', arriveBy: '', mode: 'always', onDemand: false, windowFrom: '', windowTo: '', showUntil: '', routes: [] });
        else if (what === 'route') ed.traffic.people[+p[2]].routes.push({ name: '', from: '', to: '', home: false, after: '', days: [1, 2, 3, 4, 5] });
        else ed.menu.push({ label: '', sub: '', icon: 'link', port: 0, path: '/', alert: '' });
        return draw();
      }
      if (op === 'up' || op === 'down') {
        const i = +p[2], j = op === 'up' ? i - 1 : i + 1;
        if (j >= 0 && j < ed.menu.length) { const t = ed.menu[i]; ed.menu[i] = ed.menu[j]; ed.menu[j] = t; }
        say('menu', 'Ordem alterada: clique em Salvar menu.');
        return draw();
      }
      if (op === 'del') {
        let row, sec = what, fresh = false;
        if (what === 'cameras') { row = ed.cameras[+p[2]]; fresh = !row.id; }
        else if (what === 'calendars') { row = ed.calendars[+p[2]]; fresh = !row.who; }
        else if (what === 'person') { sec = 'traffic'; row = ed.traffic.people[+p[2]]; fresh = !row.id; row.name = row.label; }
        else if (what === 'route') { sec = 'traffic'; row = ed.traffic.people[+p[2]].routes[+p[3]]; }
        else row = ed.menu[+p[2]];
        const nome = (row.name || row.label || '').trim() || 'este item';
        if (!(fresh && !(row.name || row.label || row.url || '').trim()) && !confirm('Remover "' + nome + '"?')) return;
        if (what === 'cameras') ed.cameras.splice(+p[2], 1);
        else if (what === 'calendars') ed.calendars.splice(+p[2], 1);
        else if (what === 'person') ed.traffic.people.splice(+p[2], 1);
        else if (what === 'route') ed.traffic.people[+p[2]].routes.splice(+p[3], 1);
        else ed.menu.splice(+p[2], 1);
        draw();                                           // a tela volta a refletir a lista antes de salvar
        if (fresh) { say(sec, ''); return draw(); }      // linha nova, ainda não salva: some sem falar com o hub
        return save(sec);                                 // remover vale na hora (junto com o que mais estiver editado na seção)
      }
    }

    box.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-a]');
      if (b && !b.disabled) act(b.getAttribute('data-a'));
    });
    box.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'compat-sel') { CD.compat.setMode(t.value); const s = box.querySelector('#compat-st'); if (s) s.textContent = status(); return; }
      if (t.getAttribute && t.getAttribute('data-k') === 'color') t.setAttribute('data-touched', '1');
      if (t.hasAttribute && t.hasAttribute('data-redraw')) { collect(); draw(); }    // home office troca os campos de origem/destino
    });

    load();
  }

  CD.configEdit = { mount: mount };
})(window.CD = window.CD || {});
