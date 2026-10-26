(function (DK) {
  // Meu Computador: dados do servidor (sistema, CPU, memória, discos, rede) e atalhos para as unidades no Explorer.
  const el = DK.el;

  const fmtUp = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + h + 'h ' + m + 'm'; };
  const bar = pct => { const i = el('i'); i.style.width = Math.min(100, pct) + '%'; if (pct >= 90) i.className = 'hot'; return el('div', { className: 'bar' }, i); };
  const stat = (k, v, extra) => { const s = el('div', { className: 'stat' }, el('b', { textContent: k }), v); if (extra) s.append(extra); return s; };

  DK.computerApp = function () {
    DK.openWindow('computer', 'Meu Computador', (body, win) => {
      const msg = el('div', { className: 'err' }), out = el('div', { style: 'display:grid;gap:10px' });
      const rf = el('button', { textContent: '⟳ Atualizar' });
      body.append(el('div', { className: 'row' }, rf, el('span', { className: 'meta', textContent: 'atualiza a cada 10 s' })), msg, out);

      function drive(icon, title, sub, pct, onclick) {
        const d = el('div', { className: 'drive', style: 'cursor:pointer', onclick: onclick });
        d.append(el('div', { className: 'ic', textContent: icon }), el('b', { textContent: title }), el('span', { className: 'meta', textContent: sub }));
        if (pct != null) { const b = bar(pct); b.style.gridColumn = '2 / 4'; d.append(b); }
        return d;
      }

      async function load() {
        try {
          const c = await DK.api('GET', '/computer');
          msg.textContent = '';
          const g = el('div', { className: 'grid' });
          g.append(stat('Computador', c.hostname), stat('Sistema', (c.platform || c.os) + ' · ' + c.arch));
          g.append(stat('Processador', (c.cpu_model ? c.cpu_model + ' · ' : '') + c.cpus + ' núcleo(s)'));
          g.append(stat('Uso da CPU', c.cpu_percent.toFixed(0) + '%', bar(c.cpu_percent)));
          if (c.mem_total) {
            const pct = Math.round(c.mem_used * 100 / c.mem_total);
            g.append(stat('Memória', DK.fmtSize(c.mem_used) + ' de ' + DK.fmtSize(c.mem_total) + ' (' + pct + '%)', bar(pct)));
          }
          if (c.uptime_sec) g.append(stat('Ligado há', fmtUp(c.uptime_sec)));
          if (c.load) g.append(stat('Carga (1/5/15 min)', c.load));
          g.append(stat('Central Diogo', (c.hub_version === 'dev' ? 'desenvolvimento' : 'V' + c.hub_version) + ' · hub usa ' + DK.fmtSize(c.hub_mem)));
          if (c.addresses.length) g.append(stat('Rede', c.addresses.join('\n')));

          const drives = el('div', { style: 'display:grid;gap:6px' });
          drives.append(drive('📂', 'Meus arquivos', 'a sua pasta no servidor', null, () => DK.explorerApp({})));
          if (DK.canMachine()) {
            drives.append(drive('💻', 'Computador', 'todos os arquivos do servidor (pede a sua senha)', null, () => DK.explorerApp({ space: 'machine', path: '/' })));
            c.disks.forEach(d => {
              const used = d.total - d.free, pct = d.total ? Math.round(used * 100 / d.total) : 0;
              drives.append(drive('🖴', d.mount + (d.device ? '  (' + d.device + ')' : ''), DK.fmtSize(used) + ' de ' + DK.fmtSize(d.total) + ' · livre ' + DK.fmtSize(d.free) + (d.fs ? ' · ' + d.fs : ''), pct,
                () => DK.explorerApp({ space: 'machine', path: d.mount })));
            });
          } else {
            c.disks.forEach(d => {
              const used = d.total - d.free;
              drives.append(drive('🖴', d.mount, DK.fmtSize(used) + ' de ' + DK.fmtSize(d.total) + ' · livre ' + DK.fmtSize(d.free), d.total ? Math.round(used * 100 / d.total) : 0,
                () => DK.toast('Navegar nos discos do servidor exige a permissão do administrador.')));
            });
          }
          out.replaceChildren(g, el('b', { textContent: 'Unidades e pastas' }), drives,
            el('div', { className: 'meta', textContent: 'Hora do servidor: ' + new Date(c.time).toLocaleString('pt-BR') }));
        } catch (e) { msg.textContent = e.message; }
      }
      rf.onclick = load; load();
      const t = setInterval(load, 10000);
      win._onClose = () => clearInterval(t);
    }, 620, 540);
  };

  DK.register({ id: 'computer', icon: '🖥️', label: 'Meu Computador', desktop: true, open: DK.computerApp });
})(window.DK = window.DK || {});
