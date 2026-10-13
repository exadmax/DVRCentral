(function (CD) {
  // Config → Painel e Integrações: o que antes ficava fixo em arquivos.
  //  • Painel (vale na hora): localização do clima, modo noturno, rodízio das câmeras, aviso de validade, locais do estoque,
  //    página Vídeos e feriados locais. O painel guarda tudo no hub (/api/settings/panel); TV e celular buscam de lá.
  //  • Hub (vale depois de reiniciar o hub): pastas, cópia para o Drive, planilha de profissionais, jogos, tempos de cache e rede
  //    (/api/settings/hub). Segredos nunca voltam do hub: o campo fica em branco e “configurada” aparece ao lado.
  // Cada cartão é redesenhado sozinho (não o conjunto), para não perder o que está sendo digitado nos outros.
  const U = CD.util, esc = U.esc, ui = CD.cfgUi;
  const fld = ui.fld, btn = ui.btn;

  const HOURS = Array.from({ length: 24 }, (_, h) => [h, String(h).padStart(2, '0') + ':00']);
  const HTYPES = [['municipal', 'Municipal'], ['estadual', 'Estadual'], ['nacional', 'Nacional']];

  const input = (f, v, o) => {
    o = o || {};
    return '<input data-f="' + f + '" type="' + (o.type || 'text') + '" value="' + esc(v == null ? '' : v) + '"' + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') +
      (o.attr ? ' ' + o.attr : '') + ' autocomplete="' + (o.type === 'password' ? 'new-password' : 'off') + '" spellcheck="false">';
  };
  const num = (f, v, min, max, step) => input(f, v, { type: 'number', attr: 'min="' + min + '" max="' + max + '"' + (step ? ' step="' + step + '"' : '') });
  const select = (f, v, opts) => '<select data-f="' + f + '">' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
  const check = (f, v, label) => '<label class="cfg-chk"><input type="checkbox" data-f="' + f + '"' + (v ? ' checked' : '') + '>' + esc(label) + '</label>';

  function read(el) {
    const o = {};
    el.querySelectorAll('[data-f]').forEach(e => { o[e.getAttribute('data-f')] = e.type === 'checkbox' ? e.checked : e.value; });
    return o;
  }
  const int = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
  const flt = (v, d) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? d : n; };

  function mount(root) {
    root.innerHTML = '';
    const cfg = CD.state.cfg;
    const st = { hub: null, locais: null, hol: null }, msgs = {}, busy = {};
    const say = (id, text, bad) => { msgs[id] = text ? { text: text, bad: !!bad } : null; };

    // ---------- esqueleto dos cartões ----------
    function card(id, tab, title, hint, body, save) {
      const m = msgs[id];
      return '<div class="cfg-card" data-tab="' + tab + '" data-card="' + id + '"><h2>' + esc(title) + '</h2>' + (hint ? '<div class="cfg-hint">' + hint + '</div>' : '') + body +
        (m ? '<div class="cfg-msg' + (m.bad ? ' cfg-err' : '') + '">' + esc(m.text) + '</div>' : '') +
        (save === false ? '' : '<div class="cfg-bar2">' + (save || '') + btn('save:' + id, 'Salvar', '', busy[id]) + '</div>') + '</div>';
    }
    const grid = html => '<div class="cfg-grid">' + html + '</div>';

    // ---------- Painel ----------
    function cLoc() {
      const l = cfg.location || {};
      return card('loc', 'painel', 'Localização e clima', 'Usada no clima (Open-Meteo) e no cabeçalho da tela inicial.',
        grid(fld('Cidade', input('city', l.city)) + fld('Estado', input('state', l.state)) +
          fld('Latitude', num('lat', l.lat, -90, 90, 'any')) + fld('Longitude', num('lon', l.lon, -180, 180, 'any')) +
          fld('Fuso horário', input('timezone', l.timezone, { ph: 'America/Sao_Paulo' })) +
          fld('Atualizar o clima a cada (minutos)', num('refreshMinutes', cfg.refreshMinutes || 15, 5, 240))));
    }
    function cNight() {
      const n = cfg.night || { from: 23, until: 5 };
      return card('night', 'painel', 'Modo noturno', 'Nesse período a tela inicial fica escura, só com o clima e os eventos de amanhã.',
        grid(fld('Começa às', select('from', n.from, HOURS)) + fld('Termina às', select('until', n.until, HOURS))));
    }
    function cRot() {
      return card('rot', 'painel', 'Câmeras na tela inicial', 'Cada câmera aparece no lugar do Clima por este tempo e depois o Clima volta (rodízio).',
        grid(fld('Segundos por câmera', num('rotateSeconds', (cfg.cameras || {}).rotateSeconds || 60, 5, 3600))));
    }
    function cSoon() {
      return card('soon', 'painel', 'Aviso de validade', 'Itens da geladeira e da dispensa que vencem em até N dias ficam em destaque âmbar (vencidos, em vermelho).',
        grid(fld('Avisar com quantos dias de antecedência', num('soonDays', (cfg.estoque || {}).soonDays == null ? 3 : cfg.estoque.soonDays, 0, 365))));
    }
    function cVid() {
      const v = cfg.videos || {};
      return card('vid', 'painel', 'Página Vídeos (endereço de reprodução)', 'Os arquivos são entregues por um servidor web da máquina (nginx). A pasta que o hub lista fica em Integrações.',
        grid(fld('Porta', num('port', v.port || 8080, 1, 65535)) + fld('Caminho', input('path', v.path || '/videos/', { ph: '/videos/' }))));
    }

    function localRow(l, i) {
      return '<div class="cfg-item" data-r="' + i + '"><div class="cfg-grid">' + fld('Nome', input('label', l.label, { ph: 'Ex.: Garagem' })) +
        fld('Cor', '<input type="color" data-f="color" value="' + esc(l.color || '#4DA3FF') + '">') +
        fld('Ícone', select('icon', l.icon || 'box', ui.ICONS)) + '</div><div class="cfg-ia">' + btn('del:locais:' + i, 'Remover', 'ghost') + '</div></div>';
    }
    function cLocais() {
      return card('locais', 'painel', 'Locais do estoque', 'Onde os itens são guardados (aparecem como abas em Geladeira e Dispensa). Um local só pode ser removido quando estiver vazio.',
        st.locais.map(localRow).join(''), btn('add:locais', '+ Adicionar local'));
    }

    function holRow(h, i) {
      return '<div class="cfg-item" data-r="' + i + '"><div class="cfg-grid">' + fld('Dia e mês', input('date', h.date ? '2000-' + h.date : '', { type: 'date' })) +
        fld('Nome', input('name', h.name, { ph: 'Ex.: Aniversário da cidade' })) + fld('Tipo', select('type', h.type || 'municipal', HTYPES)) +
        '</div><div class="cfg-ia">' + btn('del:hol:' + i, 'Remover', 'ghost') + '</div></div>';
    }
    function cHol() {
      return card('hol', 'painel', 'Feriados locais', 'Feriados estaduais e municipais que a BrasilAPI não traz. Repetem todo ano (só importam o dia e o mês).',
        st.hol.map(holRow).join(''), btn('add:hol', '+ Adicionar feriado'));
    }

    // ---------- Hub ----------
    function pendingBanner() {
      const h = st.hub;
      if (!h || !h.pending) return '';
      return '<div class="cfg-banner"><span>Há mudanças salvas que só valem depois de reiniciar o hub.' + (h.canRestart ? '' : ' (Reinicie à mão: sudo systemctl restart centraldiogo-hub)') + '</span>' +
        (h.canRestart ? btn('restart', busy.restart ? 'Reiniciando…' : 'Reiniciar o hub agora', '', busy.restart) : '') + '</div>';
    }
    const secret = (f, label, set, ph) => '<div class="fld wide"><span>' + esc(label) + '</span>' +
      input(f, '', { type: 'password', ph: set ? 'configurada (em branco = manter)' : ph || 'cole aqui' }) +
      (set ? '<label class="cfg-chk"><input type="checkbox" data-clear="' + f + '">apagar a configurada</label>' : '') + '</div>';

    function cDrive() {
      const h = st.hub;
      return card('hubdrive', 'cameras', 'Gravações: pasta e Google Drive', 'Vale depois de reiniciar o hub. O envio usa o rclone já configurado no servidor.',
        grid(fld('Pasta das gravações no servidor', input('recordingsDir', h.recordingsDir, { ph: '/home/usuario/securityCam' }), 'wide') +
          '<div class="wide">' + check('driveEnabled', h.driveEnabled, 'Copiar as gravações para o Google Drive todo dia') + '</div>' +
          fld('Destino no rclone (REMOTE:Pasta)', input('driveRemote', h.driveRemote, { ph: 'GDrive:CameraSeguranca' }), 'wide') +
          fld('Hora do envio automático', select('driveHour', h.driveHour, HOURS)) +
          fld('Maior arquivo enviado inteiro (MB; acima disso é dividido; 0 = 1024)', num('driveMaxFileMB', h.driveMaxFileMB, 0, 1048576))));
    }
    function cSheet() {
      const h = st.hub;
      return card('hubsheet', 'integracoes', 'Planilha de profissionais', 'CSV da aba de profissionais no Google Planilhas. Deixe o endereço em branco para desligar a sincronização.',
        grid(fld('Endereço do CSV', input('sheetUrl', h.sheetUrl, { ph: 'https://docs.google.com/spreadsheets/d/ID/gviz/tq?tqx=out:csv&sheet=profissionais' }), 'wide') +
          fld('Sincronizar a cada (minutos)', num('sheetMinutes', h.sheetMinutes || 5, 1, 1440))));
    }
    function cGames() {
      const h = st.hub;
      return card('hubgames', 'integracoes', 'Jogos e conquistas', 'Contas usadas para listar jogos e troféus. As chaves ficam só no servidor.',
        grid(fld('Atualizar a cada (minutos)', num('gamesCacheMinutes', h.gamesCacheMinutes || 360, 1, 10080), 'wide') +
          '<div class="cfg-sub wide">Steam</div>' + fld('Usuário (URL personalizada ou SteamID64)', input('steamUser', h.steamUser)) + secret('steamKey', 'Chave da API', h.steamKeySet) +
          '<div class="cfg-sub wide">PlayStation</div>' + fld('Usuário (só para exibição)', input('psnUser', h.psnUser)) + secret('psnNpsso', 'Cookie npsso', h.psnNpssoSet) +
          '<div class="cfg-sub wide">Xbox</div>' + fld('Gamertag', input('xboxGamertag', h.xboxGamertag)) + fld('Client ID (opcional)', input('xboxClientId', h.xboxClientId)) +
          secret('xboxClientSecret', 'Client secret (opcional)', h.xboxClientSecretSet) +
          '<div class="cfg-sub wide">RetroAchievements</div>' + fld('Usuário', input('retroUser', h.retroUser)) + secret('retroKey', 'Chave da API', h.retroKeySet)));
    }
    function cMisc() {
      const h = st.hub;
      return card('hubmisc', 'integracoes', 'Vídeos, cache e rede', 'Vale depois de reiniciar o hub.',
        grid(fld('Pasta dos vídeos no servidor (vazio = desliga a página Vídeos)', input('videosDir', h.videosDir, { ph: '/home/usuario/Videos' }), 'wide') +
          fld('Agendas: guardar por (minutos)', num('calendarCacheMinutes', h.calendarCacheMinutes, 1, 1440)) +
          fld('Trânsito: consultar no máximo a cada (minutos)', num('trafficCacheMinutes', h.trafficCacheMinutes, 1, 1440)) +
          '<div class="wide">' + check('forceIPv4', h.forceIPv4, 'Usar só IPv4 nas consultas externas (chaves do Google com restrição de IP)') + '</div>'));
    }

    // ---------- desenho ----------
    const R = { loc: cLoc, night: cNight, rot: cRot, soon: cSoon, vid: cVid, locais: cLocais, hol: cHol,
      hubdrive: cDrive, hubsheet: cSheet, hubgames: cGames, hubmisc: cMisc };
    const HUBCARDS = ['hubdrive', 'hubsheet', 'hubgames', 'hubmisc'];
    const ORDER = ['loc', 'night', 'rot', 'soon', 'locais', 'vid', 'hol', 'hubdrive', 'hubsheet', 'hubgames', 'hubmisc'];

    function cardEl(id) { return root.querySelector('[data-card="' + id + '"]'); }
    function redraw(id) {
      const el = cardEl(id);
      if (!el || (HUBCARDS.indexOf(id) >= 0 && !st.hub)) return;
      const t = document.createElement('div');
      t.innerHTML = R[id]();
      el.parentNode.replaceChild(t.firstChild, el);
    }
    function drawBanner() { const b = root.querySelector('#cp-banner'); if (b) b.innerHTML = pendingBanner(); }
    function drawAll() {
      if (!CD.state.hub) { root.innerHTML = ''; return; }
      root.innerHTML = '<div id="cp-banner"></div>' + ORDER.filter(id => HUBCARDS.indexOf(id) < 0 || st.hub).map(id => R[id]()).join('');
      drawBanner();
    }

    // ---------- listas (locais e feriados) ----------
    function collectList(kind) {
      const el = cardEl(kind), rows = kind === 'locais' ? st.locais : st.hol;
      if (!el) return;
      el.querySelectorAll('.cfg-item').forEach((it, i) => {
        const o = read(it), r = rows[i];
        if (!r) return;
        if (kind === 'locais') { r.label = o.label; r.color = o.color; r.icon = o.icon; }
        else { r.date = (o.date || '').slice(5); r.name = o.name; r.type = o.type; }
      });
    }

    // ---------- salvar ----------
    // Mostra a mensagem do cartão sem redesenhá-lo (assim um erro de validação não apaga o que foi digitado)
    function showMsg(id) {
      const el = cardEl(id), x = msgs[id];
      if (!el) return;
      let m = el.querySelector('.cfg-msg');
      if (!x) { if (m) m.remove(); return; }
      if (!m) { m = document.createElement('div'); el.insertBefore(m, el.querySelector('.cfg-bar2')); }
      m.className = 'cfg-msg' + (x.bad ? ' cfg-err' : '');
      m.textContent = x.text;
    }
    function setBusy(id, on) {
      busy[id] = on;
      const el = cardEl(id), b = el && el.querySelector('[data-a="save:' + id + '"]');
      if (b) b.disabled = on;
    }
    function resyncLists() {
      st.locais = (CD.stock ? CD.stock.LOCAIS : []).map(l => Object.assign({}, l));
      st.hol = (cfg.localHolidays || window.CD_LOCAL_HOLIDAYS || []).map(h => Object.assign({}, h));
    }

    async function savePanel(id, payload, resync) {
      setBusy(id, true); say(id, 'Salvando…'); showMsg(id);
      let ok = false;
      try {
        await CD.hubApi.settings.save('panel', payload);
        await CD.hubApi.settings.loadPanel(cfg);
        say(id, 'Salvo. As telas abertas atualizam em até 5 minutos.'); ok = true;
      } catch (e) { say(id, e.message, true); }
      setBusy(id, false);
      if (ok || resync) { resyncLists(); redraw(id); } else showMsg(id);
    }

    function panelPayload(id) {
      const el = cardEl(id), o = el ? read(el) : {};
      if (id === 'loc') return { location: { city: o.city, state: o.state, lat: flt(o.lat, 0), lon: flt(o.lon, 0), timezone: o.timezone }, refreshMinutes: int(o.refreshMinutes, 15) };
      if (id === 'night') return { night: { from: int(o.from, 23), until: int(o.until, 5) } };
      if (id === 'rot') return { cameras: { rotateSeconds: int(o.rotateSeconds, 60) } };
      if (id === 'soon') return { estoque: { soonDays: int(o.soonDays, 3) } };
      if (id === 'vid') return { videos: { port: int(o.port, 8080), path: o.path } };
      collectList(id);
      if (id === 'locais') return { locais: st.locais.filter(l => l.id || (l.label || '').trim()).map(l => ({ id: l.id || '', label: l.label, color: l.color, icon: l.icon })) };
      return { localHolidays: st.hol.filter(h => h.date || (h.name || '').trim()).map(h => ({ date: h.date, name: h.name, type: h.type })) };
    }

    const NUMERIC = ['driveHour', 'driveMaxFileMB', 'sheetMinutes', 'gamesCacheMinutes', 'calendarCacheMinutes', 'trafficCacheMinutes'];
    async function saveHub(from) {
      const body = {}, clear = [];
      HUBCARDS.forEach(id => {
        const el = cardEl(id);
        if (!el) return;
        const o = read(el);
        Object.keys(o).forEach(k => { body[k] = NUMERIC.indexOf(k) >= 0 ? int(o[k], 0) : o[k]; });
        el.querySelectorAll('[data-clear]:checked').forEach(c => clear.push(c.getAttribute('data-clear')));
      });
      body.clearSecrets = clear;
      setBusy(from, true); say(from, 'Salvando…'); showMsg(from);
      try {
        st.hub = await CD.hubApi.settings.save('hub', body);
        say(from, st.hub.pending ? 'Salvo. Falta reiniciar o hub para valer.' : 'Salvo.');
      } catch (e) { say(from, e.message, true); setBusy(from, false); showMsg(from); return; }
      setBusy(from, false);
      HUBCARDS.forEach(redraw); drawBanner();
    }

    async function restart() {
      if (!confirm('Reiniciar o hub agora? As câmeras, a agenda e o painel ficam fora do ar por alguns segundos.')) return;
      busy.restart = true; drawBanner();
      try { await CD.hubApi.settings.restartHub(); } catch (e) { busy.restart = false; say('hubmisc', e.message, true); redraw('hubmisc'); drawBanner(); return; }
      const t0 = Date.now();
      const poll = async () => {
        try { await U.getJson(CD.state.hub + '/api/health', 2500); if (Date.now() - t0 > 2500) { busy.restart = false; st.hub = await CD.hubApi.settings.get('hub'); HUBCARDS.forEach(redraw); drawBanner(); return; } } catch (e) { /* ainda reiniciando */ }
        if (Date.now() - t0 > 90000) { busy.restart = false; drawBanner(); return; }
        setTimeout(poll, 2000);
      };
      setTimeout(poll, 2500);
    }

    // ---------- ações ----------
    root.addEventListener('click', async e => {
      const b = e.target.closest && e.target.closest('[data-a]');
      if (!b || b.disabled) return;
      const p = b.getAttribute('data-a').split(':'), op = p[0], what = p[1];
      if (op === 'restart') return restart();
      if (op === 'save') return HUBCARDS.indexOf(what) >= 0 ? saveHub(what) : savePanel(what, panelPayload(what));
      if (what !== 'locais' && what !== 'hol') return;
      collectList(what);
      const rows = what === 'locais' ? st.locais : st.hol;
      if (op === 'add') {
        rows.push(what === 'locais' ? { id: '', label: '', color: '#4DA3FF', icon: 'box' } : { date: '', name: '', type: 'municipal' });
        say(what, ''); return redraw(what);
      }
      if (op === 'del') {
        const i = +p[2], r = rows[i], fresh = what === 'locais' ? !r.id : false;
        const blank = !(r.label || r.name || r.date || '').trim();
        if (!blank && !confirm('Remover "' + (r.label || r.name || 'este item') + '"?')) return;
        rows.splice(i, 1);
        say(what, ''); redraw(what);
        if (fresh || (what === 'hol' && blank)) return;
        return savePanel(what, panelPayload(what), true);   // remover vale na hora (se o local ainda tiver itens, o hub recusa e a lista volta)
      }
    });

    // ---------- carga ----------
    async function load() {
      if (!CD.state.hub) return drawAll();
      resyncLists();
      try { st.hub = await CD.hubApi.settings.get('hub'); } catch (e) { st.hub = null; }
      drawAll();
      if (!st.hub) root.insertAdjacentHTML('beforeend', '<div class="cfg-card" data-tab="integracoes"><h2>Opções do hub</h2><div class="cfg-msg">Este hub é antigo e não tem estas opções: atualize o hub no servidor.</div></div>');
    }
    load();
  }

  CD.configPanel = { mount: mount };
})(window.CD = window.CD || {});
