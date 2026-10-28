(function (DK) {
  // Atualizações (Administração): mostra a versão em uso de cada componente de terceiros e se há uma mais nova (consulta npm, GitHub e o proxy do Go
  // pelo hub). O Webamp atualiza com um clique; os demais mostram o que fazer. Só o administrador. Veja desk_updates.go e docs/atualizacoes.md.
  const el = DK.el;
  const STATUS = {
    atual: ['✔ Atualizado', 'ok'], disponivel: ['⬆ Nova versão', 'upd'], informativo: ['ℹ Pelo CDN', 'meta'], erro: ['⚠ Falhou a consulta', 'err'], 'nao-verificado': ['— Não verificado', 'meta']
  };
  const when = t => (t ? new Date(t * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca');

  DK.updatesApp = function () {
    DK.openWindow('updates', 'Atualizações', (body, win) => {
      body.className = 'body flush';
      const bCheck = el('button', { className: 'pri', textContent: '🔄 Verificar agora', title: 'Consulta npm, GitHub e o proxy do Go para ver se há versões novas' });
      const info = el('span', { className: 'meta' });
      const msg = el('div', { className: 'err', style: 'padding:0 10px' });
      const list = el('div', { className: 'ulist' });
      body.append(el('div', { className: 'tb' }, bCheck, el('span', { className: 'sp' }), info), msg, list,
        el('div', { className: 'meta', style: 'padding:6px 10px', textContent: 'A consulta só lê números de versão em três endereços fixos. Instalar é com você: o Webamp atualiza aqui; os outros mostram o que fazer.' }));
      let open = '';
      const draw = j => {
        info.textContent = 'Última verificação: ' + when(j.checked_at) + (j.auto_days > 0 ? ' · automática a cada ' + j.auto_days + ' dia' + (j.auto_days > 1 ? 's' : '') : ' · automática desligada');
        list.replaceChildren();
        const tb = el('table', { className: 'utbl' }, el('tr', {}, ...['Componente', 'Em uso', 'Mais novo', 'Situação', ''].map(h => el('th', { textContent: h }))));
        for (const c of j.components) {
          const [txt, cls] = STATUS[c.status] || STATUS['nao-verificado'];
          const act = el('td', {});
          if (c.mode === 'auto' && c.status === 'disponivel') {
            const b = el('button', { className: 'pri', textContent: 'Atualizar', title: 'Baixa do npm, confere o hash e passa a usar a versão nova' });
            b.onclick = async () => {
              b.disabled = true; msg.textContent = '';
              try { draw(await DK.api('POST', '/updates/' + c.id + '/apply')); DK.toast(c.name + ' atualizado. Reabra o Player de Música para usar a versão nova.'); }
              catch (e) { msg.textContent = e.message; b.disabled = false; }
            };
            act.append(b);
          } else if (c.status === 'disponivel') {
            act.append(el('button', { textContent: open === c.id ? 'Ocultar' : 'Como atualizar', onclick: () => { open = open === c.id ? '' : c.id; draw(j); } }));
          }
          if (c.overlay) {
            const b = el('button', { textContent: 'Voltar ao pacote', title: 'Descarta a versão baixada e volta à que veio na instalação do Diogows' });
            b.onclick = async () => { try { draw(await DK.api('POST', '/updates/' + c.id + '/revert')); } catch (e) { msg.textContent = e.message; } };
            act.append(' ', b);
          }
          const lic = el('div', { className: 'meta', textContent: c.license + (c.cdn ? ' · carregado do CDN' : '') + (c.overlay ? ' · atualizado por aqui' : '') });
          tb.append(el('tr', {}, el('td', {}, c.name, lic), el('td', { textContent: c.installed || '—' }), el('td', { textContent: c.latest || '—' }),
            el('td', { className: cls, textContent: txt, title: c.error || '' }), act));
          if (open === c.id && c.how) tb.append(el('tr', {}, el('td', { colSpan: 5, className: 'meta uhow', textContent: c.how })));
        }
        list.append(tb);
      };
      const load = async () => { try { draw(await DK.api('GET', '/updates')); } catch (e) { msg.textContent = e.message; } };
      bCheck.onclick = async () => {
        bCheck.disabled = true; msg.textContent = ''; info.textContent = 'Verificando…';
        try { draw(await DK.api('POST', '/updates/check')); } catch (e) { msg.textContent = e.message; await load(); }
        bCheck.disabled = false;
      };
      load();
    }, 780, 520, { flush: true });
  };

  // Aviso ao administrador, uma vez por entrada, quando a última verificação achou algo novo (não faz consulta nenhuma: só lê o resultado guardado).
  DK.updatesNotice = async function () {
    try {
      const j = await DK.api('GET', '/updates');
      if (j.available > 0) DK.toast('Há ' + j.available + ' atualização' + (j.available > 1 ? 'ões' : '') + ' de componentes. Veja em Administração → Atualizações.');
    } catch (e) { /* desligado ou sem permissão */ }
  };

  DK.register({ id: 'updates', icon: '🔄', label: 'Atualizações', group: 1, show: me => me.is_admin, open: DK.updatesApp });
})(window.DK = window.DK || {});
