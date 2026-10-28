(function (DK) {
  // Casa: planta da casa (andares e cômodos em retângulos) com as TVs no lugar onde estão, e uma lista com o estado de cada uma.
  // Todos veem; só o administrador edita (✏️ Editar). O estado vem do hub, que pergunta a cada TV (ligada, em espera, desligada).
  const el = DK.el;
  const STATES = { on: ['Ligada', '#2e7d32'], standby: ['Em espera', '#b7791f'], off: ['Desligada', '#8a94a6'] };
  const COLORS = ['#cfe3ff', '#d6f0d9', '#ffe7c2', '#f6d5e6', '#e4dcf7', '#d5eff2'];
  const uid = p => p + Math.random().toString(36).slice(2, 8);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = v => Math.round(v * 10) / 10;
  const stateOf = (status, id) => (status[id] && STATES[status[id].state]) ? status[id].state : '';

  DK.homeApp = function () {
    DK.openWindow('home', 'Casa', (body, win) => {
      body.className = 'body flush';
      let saved = { floors: [], devices: [] }, work = null, status = {}, tab = 'plan', floorId = '', sel = null, placing = '', timer = 0, polled = 0, busy = false;
      const L = () => work || saved;
      const admin = !!(DK.me && DK.me.is_admin);

      const tb = el('div', { className: 'tb' });
      const msg = el('div', { className: 'err', style: 'padding:0 8px' });
      const main = el('div', { className: 'homemain' });
      body.append(tb, msg, main);

      const floor = () => L().floors.find(f => f.id === floorId) || null;
      const dev = id => L().devices.find(d => d.id === id) || null;
      const inRoom = (d, r) => d.floor && d.x >= r.x && d.x <= r.x + r.w && d.y >= r.y && d.y <= r.y + r.h;
      // Cômodo em que o aparelho está: o menor retângulo que o contém.
      function roomOf(d) {
        const f = L().floors.find(x => x.id === d.floor);
        if (!f) return null;
        let best = null;
        f.rooms.forEach(r => { if (inRoom(d, r) && (!best || r.w * r.h < best.w * best.h)) best = r; });
        return best;
      }
      function roomCount(f, r) {
        const ds = L().devices.filter(d => d.floor === f.id && roomOf(d) === r);
        return ds.length ? ds.filter(d => stateOf(status, d.id) === 'on').length + '/' + ds.length + ' ligadas' : '';
      }

      // ---------- dados ----------
      async function load() {
        try { saved = await DK.hub('GET', '/api/desk/home'); msg.textContent = ''; } catch (e) { msg.textContent = e.message; }
        if (!L().floors.some(f => f.id === floorId)) floorId = L().floors.length ? L().floors[0].id : '';
        draw();
        poll();
      }
      async function poll() {
        if (busy || !saved.devices.length) { if (!saved.devices.length) paintStatus(); return; }
        busy = true;
        try { status = await DK.hub('GET', '/api/desk/home/status'); polled = Date.now(); } catch (e) { /* mantém o último estado */ }
        busy = false;
        paintStatus();
      }
      timer = setInterval(() => { if (!document.hidden && !win.classList.contains('min')) poll(); }, 10000);
      win._onClose = () => clearInterval(timer);
      win._beforeClose = () => !work || confirm('Descartar as alterações da planta?');

      // Atualiza só as cores e contagens, sem refazer a tela (não atrapalha quem está editando).
      function paintStatus() {
        body.querySelectorAll('[data-dev]').forEach(n => {
          const s = stateOf(status, n.dataset.dev), info = STATES[s] || ['…', '#c3cad6'];
          if (n.classList.contains('hbadge')) { n.textContent = info[0]; n.style.background = info[1]; }
          else { const dot = n.querySelector('.dot'); if (dot) dot.style.background = info[1]; n.title = (dev(n.dataset.dev) || {}).name + ' — ' + info[0]; }
        });
        L().floors.forEach(f => f.rooms.forEach(r => {
          const c = body.querySelector('[data-room="' + r.id + '"]');
          if (c) c.textContent = roomCount(f, r);
        }));
        const all = L().devices, n = k => all.filter(d => stateOf(status, d.id) === k).length;
        const sum = body.querySelector('.homesum');
        if (sum) sum.textContent = !all.length ? '' : !polled ? 'Consultando as TVs…' : n('on') + ' ligadas · ' + n('standby') + ' em espera · ' + n('off') + ' desligadas';
      }

      // ---------- barra de ferramentas ----------
      function drawBar() {
        tb.replaceChildren();
        const t = (id, label) => el('button', { className: tab === id ? 'pri' : '', textContent: label, onclick: () => { tab = id; draw(); } });
        tb.append(t('plan', '🗺️ Planta'), t('list', '📋 Lista'), el('span', { className: 'sp' }), el('span', { className: 'meta homesum' }));
        if (!admin) return;
        if (!work) tb.append(el('button', { textContent: '✏️ Editar', onclick: () => { work = JSON.parse(JSON.stringify(saved)); sel = null; placing = ''; draw(); } }));
        else tb.append(
          el('button', { className: 'pri', textContent: '💾 Salvar', onclick: save }),
          el('button', { textContent: 'Cancelar', onclick: () => { work = null; sel = null; placing = ''; msg.textContent = ''; load(); } }));
      }
      async function save() {
        try {
          saved = await DK.api('PUT', '/admin/home', work);
          work = null; sel = null; placing = ''; msg.textContent = '';
          if (!L().floors.some(f => f.id === floorId)) floorId = L().floors.length ? L().floors[0].id : '';
          DK.toast('Planta salva.'); draw(); poll();
        } catch (e) { msg.textContent = e.message; }
      }

      function draw() {
        drawBar();
        main.replaceChildren();
        if (tab === 'list') drawList(); else drawPlan();
        paintStatus();
      }

      // ---------- lista ----------
      function drawList() {
        const l = L();
        if (!l.devices.length) {
          main.append(el('div', { className: 'meta', style: 'padding:14px', textContent: admin ? 'Nenhuma TV cadastrada. Clique em ✏️ Editar, na aba Planta, e adicione as TVs.' : 'Nenhuma TV cadastrada. Peça ao administrador.' }));
          return;
        }
        const tbody = el('tbody');
        l.devices.forEach(d => {
          const f = l.floors.find(x => x.id === d.floor), r = roomOf(d);
          const where = f ? f.name + (r ? ' › ' + r.name : '') : 'Sem lugar na planta';
          const badge = el('span', { className: 'hbadge', textContent: '…' });
          badge.dataset.dev = d.id;
          tbody.append(el('tr', {}, el('td', { textContent: '📺 ' + d.name }), el('td', { textContent: where }), el('td', {}, badge),
            el('td', { className: 'meta', textContent: ((status[d.id] || {}).model || '') + (admin && d.host ? (status[d.id] && status[d.id].model ? ' · ' : '') + d.host : '') })));
        });
        main.append(el('div', { className: 'flist' }, el('table', {}, el('thead', {}, el('tr', {}, ...['TV', 'Onde', 'Estado', 'Modelo'].map(h => el('th', { textContent: h })))), tbody)));
      }

      // ---------- planta ----------
      function drawPlan() {
        const l = L(), f = floor();
        const bar = el('div', { className: 'row homefloors' });
        l.floors.forEach(fl => {
          const on = l.devices.filter(d => d.floor === fl.id && stateOf(status, d.id) === 'on').length;
          bar.append(el('button', { className: fl.id === floorId ? 'pri' : '', textContent: fl.name + (on ? ' · ' + on + ' 📺' : ''), onclick: () => { floorId = fl.id; sel = null; draw(); } }));
        });
        if (work && f) bar.append(el('button', { textContent: '✏️ Andar', title: 'Renomear ou excluir este andar', onclick: () => { sel = { kind: 'floor', id: f.id }; draw(); } }));
        if (work && l.floors.length < 8) bar.append(el('button', { textContent: '+ Andar', onclick: () => {
          const n = { id: uid('a'), name: l.floors.length ? 'Andar ' + (l.floors.length + 1) : 'Térreo', rooms: [] };
          l.floors.push(n); floorId = n.id; sel = { kind: 'floor', id: n.id }; draw();
        } }));
        main.append(bar);

        if (!f) {
          main.append(el('div', { className: 'meta', style: 'padding:14px', textContent: work ? 'Crie o primeiro andar com “+ Andar”.' : (admin ? 'A planta está vazia. Clique em ✏️ Editar para desenhar os cômodos.' : 'A planta ainda não foi desenhada. Peça ao administrador.') }));
          if (work) drawTray();
          return;
        }

        const cv = el('div', { className: 'homecv' + (work ? ' edit' : '') + (placing ? ' placing' : '') });
        f.rooms.forEach(r => {
          const n = el('div', { className: 'homeroom' + (sel && sel.id === r.id ? ' sel' : '') });
          n.dataset.id = r.id;
          n.style.cssText = 'left:' + r.x + '%;top:' + r.y + '%;width:' + r.w + '%;height:' + r.h + '%;background:' + (r.color || COLORS[0]);
          const cnt = el('span', { className: 'cnt' }); cnt.dataset.room = r.id;
          n.append(el('span', { className: 'lbl', textContent: r.name }), cnt);
          if (work) n.append(el('i', { className: 'rzh' }));
          cv.append(n);
        });
        l.devices.filter(d => d.floor === f.id).forEach(d => {
          const n = el('div', { className: 'homedev' + (sel && sel.id === d.id ? ' sel' : '') }, el('span', { className: 'dot' }), el('span', { className: 'ic', textContent: '📺' }), el('span', { className: 'lbl', textContent: d.name }));
          n.dataset.id = d.id; n.dataset.dev = d.id;
          n.style.cssText = 'left:' + d.x + '%;top:' + d.y + '%';
          cv.append(n);
        });
        main.append(el('div', { className: 'homewrap' }, cv));

        const pt = e => { const b = cv.getBoundingClientRect(); return { x: clamp((e.clientX - b.left) / b.width * 100, 0, 100), y: clamp((e.clientY - b.top) / b.height * 100, 0, 100) }; };
        // Acompanha o arrasto com o ponteiro; ao soltar chama end() (que normalmente refaz a tela).
        function track(e, move, end) {
          e.preventDefault(); cv.setPointerCapture(e.pointerId);
          const mv = ev => move(pt(ev));
          const up = ev => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); if (end) end(pt(ev)); };
          cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
        }

        cv.addEventListener('click', e => {           // fora da edição: tocar numa TV mostra o estado dela embaixo
          if (work) return;
          const d = e.target.closest('.homedev');
          sel = d ? { kind: 'dev', id: d.dataset.id } : null;
          drawInfo(); cv.querySelectorAll('.homedev').forEach(n => n.classList.toggle('sel', !!sel && n.dataset.id === sel.id));
        });
        if (work) cv.addEventListener('pointerdown', e => {
          const p = pt(e);
          if (placing) {                               // posicionando uma TV: o próximo toque na planta a coloca ali
            const d = dev(placing);
            if (d) { d.floor = f.id; d.x = r1(p.x); d.y = r1(p.y); sel = { kind: 'dev', id: d.id }; }
            placing = ''; draw(); return;
          }
          const dn = e.target.closest('.homedev'), rz = e.target.closest('.rzh'), rn = e.target.closest('.homeroom');
          if (dn) {
            const d = dev(dn.dataset.id), o = { x: d.x, y: d.y };
            track(e, q => { d.x = r1(clamp(o.x + q.x - p.x, 0, 100)); d.y = r1(clamp(o.y + q.y - p.y, 0, 100)); dn.style.left = d.x + '%'; dn.style.top = d.y + '%'; },
              () => { sel = { kind: 'dev', id: d.id }; draw(); });
          } else if (rz) {
            const r = f.rooms.find(x => x.id === rn.dataset.id);
            track(e, q => { r.w = r1(clamp(q.x - r.x, 3, 100 - r.x)); r.h = r1(clamp(q.y - r.y, 3, 100 - r.y)); rn.style.width = r.w + '%'; rn.style.height = r.h + '%'; },
              () => { sel = { kind: 'room', id: r.id }; draw(); });
          } else if (rn) {
            const r = f.rooms.find(x => x.id === rn.dataset.id), o = { x: r.x, y: r.y };
            track(e, q => { r.x = r1(clamp(o.x + q.x - p.x, 0, 100 - r.w)); r.y = r1(clamp(o.y + q.y - p.y, 0, 100 - r.h)); rn.style.left = r.x + '%'; rn.style.top = r.y + '%'; },
              () => { sel = { kind: 'room', id: r.id }; draw(); });
          } else {                                     // fundo vazio: arrastar desenha um cômodo novo
            const box = el('div', { className: 'homeroom drawing' }); cv.append(box);
            const rect = q => ({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) });
            track(e, q => { const s = rect(q); box.style.cssText = 'left:' + s.x + '%;top:' + s.y + '%;width:' + s.w + '%;height:' + s.h + '%'; },
              q => {
                const s = rect(q);
                if (s.w < 4 || s.h < 4) { sel = null; draw(); return; }
                const r = { id: uid('c'), name: 'Cômodo ' + (f.rooms.length + 1), color: COLORS[f.rooms.length % COLORS.length], x: r1(s.x), y: r1(s.y), w: r1(s.w), h: r1(s.h) };
                f.rooms.push(r); sel = { kind: 'room', id: r.id }; draw();
                const i = main.querySelector('.homeinsp input'); if (i) { i.focus(); i.select(); }
              });
          }
        });

        if (work) {
          main.append(el('div', { className: 'meta homehint', textContent: placing ? 'Toque na planta para colocar a TV.' : 'Arraste no espaço vazio para desenhar um cômodo; arraste um cômodo ou uma TV para mover; puxe o canto do cômodo para redimensionar.' }));
        }
        drawInfo();
        if (work) drawTray();
      }

      // Painel embaixo da planta: detalhes de uma TV (visão) ou ajustes do item selecionado (edição).
      function drawInfo() {
        main.querySelectorAll('.homeinsp').forEach(n => n.remove());
        const l = L(), f = floor();
        if (!sel) return;
        const box = el('div', { className: 'homeinsp' });
        const redraw = () => { sel = null; draw(); };
        if (!work) {
          const d = dev(sel.id); if (!d) return;
          const s = stateOf(status, d.id), r = roomOf(d), model = (status[d.id] || {}).model;
          box.append(el('b', { textContent: '📺 ' + d.name }), el('span', { className: 'hbadge', textContent: (STATES[s] || ['…'])[0], style: 'background:' + (STATES[s] || ['', '#c3cad6'])[1] }),
            el('span', { className: 'meta', textContent: (f ? f.name : '') + (r ? ' › ' + r.name : '') + (model ? ' · ' + model : '') }));
        } else if (sel.kind === 'room') {
          const r = f && f.rooms.find(x => x.id === sel.id); if (!r) return;
          const name = el('input', { value: r.name, maxLength: 40, placeholder: 'Nome do cômodo', oninput: () => { r.name = name.value; const n = main.querySelector('.homeroom[data-id="' + r.id + '"] .lbl'); if (n) n.textContent = r.name; } });
          const sw = el('span', { className: 'row' });
          COLORS.forEach(c => sw.append(el('button', { className: 'swatch' + (c === r.color ? ' on' : ''), style: 'background:' + c, title: c, onclick: () => { r.color = c; draw(); } })));
          box.append(el('b', { textContent: 'Cômodo' }), name, sw, el('button', { className: 'del', textContent: 'Excluir cômodo', onclick: () => { f.rooms.splice(f.rooms.indexOf(r), 1); redraw(); } }));
        } else if (sel.kind === 'dev') {
          const d = dev(sel.id); if (!d) return;
          const name = el('input', { value: d.name, maxLength: 40, placeholder: 'Nome (ex.: TV da sala)', oninput: () => { d.name = name.value; const n = main.querySelector('.homedev[data-id="' + d.id + '"] .lbl'); if (n) n.textContent = d.name; } });
          const host = el('input', { value: d.host, placeholder: 'IP da TV (192.168.0.x)', style: 'max-width:160px', oninput: () => { d.host = host.value.trim(); } });
          box.append(el('b', { textContent: '📺 TV' }), name, host,
            el('button', { textContent: 'Tirar da planta', onclick: () => { d.floor = ''; redraw(); } }),
            el('button', { className: 'del', textContent: 'Excluir TV', onclick: () => { l.devices.splice(l.devices.indexOf(d), 1); redraw(); } }));
        } else if (sel.kind === 'floor') {
          const fl = f; if (!fl) return;
          const name = el('input', { value: fl.name, maxLength: 40, placeholder: 'Nome do andar', oninput: () => { fl.name = name.value; } });
          box.append(el('b', { textContent: 'Andar' }), name,
            el('button', { textContent: 'Aplicar nome', onclick: draw }),
            el('button', { className: 'del', textContent: 'Excluir andar', onclick: () => {
              if (fl.rooms.length && !confirm('Excluir “' + fl.name + '” e seus ' + fl.rooms.length + ' cômodo(s)? As TVs ficam sem lugar na planta.')) return;
              l.devices.forEach(d => { if (d.floor === fl.id) d.floor = ''; });
              l.floors.splice(l.floors.indexOf(fl), 1); floorId = l.floors.length ? l.floors[0].id : ''; redraw();
            } }));
        }
        main.querySelector('.homefloors').after(box);       // acima da planta, para não ficar fora da vista em janela pequena
      }

      // Edição: lista das TVs (para escolher/posicionar) e formulário para cadastrar uma nova.
      function drawTray() {
        const l = L();
        const tray = el('div', { className: 'hometray' }, el('b', { textContent: 'TVs' }));
        l.devices.forEach(d => {
          const here = d.floor === floorId;
          tray.append(el('button', { className: 'chip' + (sel && sel.id === d.id ? ' on' : ''), textContent: '📺 ' + d.name + (d.floor ? (here ? '' : ' (outro andar)') : ' (sem lugar)'),
            onclick: () => { sel = { kind: 'dev', id: d.id }; if ((!d.floor || !here) && floorId) placing = d.id; else placing = ''; draw(); } }));
        });
        const name = el('input', { placeholder: 'Nome (ex.: TV da sala)', maxLength: 40, style: 'flex:1;min-width:140px' });
        const host = el('input', { placeholder: 'IP (192.168.0.40)', style: 'max-width:150px' });
        const add = el('button', { textContent: '+ Adicionar TV', onclick: () => {
          if (l.devices.length >= 32) { msg.textContent = 'No máximo 32 aparelhos.'; return; }
          if (!name.value.trim() || !host.value.trim()) { msg.textContent = 'Informe o nome e o IP da TV.'; return; }
          const d = { id: uid('t'), name: name.value.trim(), brand: 'samsung', host: host.value.trim(), floor: '', x: 0, y: 0 };
          l.devices.push(d); msg.textContent = '';
          sel = { kind: 'dev', id: d.id }; placing = floorId ? d.id : ''; draw();
        } });
        main.append(tray, el('div', { className: 'row homeadd' }, name, host, add),
          el('div', { className: 'meta homehint', textContent: 'Por enquanto só TVs Samsung (Tizen). O IP deve ser da rede local e é bom fixá-lo no roteador. Depois de adicionar, toque na planta para posicionar.' }));
      }

      load();
    }, 780, 600);
  };

  DK.register({ id: 'home', icon: '🏠', label: 'Casa', desktop: true, open: DK.homeApp });
})(window.DK = window.DK || {});
