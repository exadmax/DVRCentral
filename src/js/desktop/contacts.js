(function (DK) {
  // Gestor de Contatos: os profissionais e prestadores de serviço da casa (a mesma lista da página Serviços, em /api/contatos).
  const el = DK.el;

  const tipoKey = t => t.trim().toLowerCase();
  const cap = t => t.trim().charAt(0).toUpperCase() + t.trim().slice(1);
  const TIPOS = ['Eletricista', 'Encanador', 'Pintor', 'Marceneiro', 'Chaveiro', 'Diarista', 'Jardineiro', 'Pedreiro', 'Mecânico', 'Veterinário'];

  // Link do WhatsApp (wa.me): com "+" ou "00" já vem com o país; 10-11 dígitos (DDD + número) são do Brasil (55).
  function whatsappUrl(t) {
    let d = t.replace(/\D/g, ''), min = 12;
    if (/^\s*\+/.test(t) || /^\s*00/.test(t)) { d = d.replace(/^0+/, ''); min = 8; }
    else { d = d.replace(/^0+/, ''); if (d.length === 10 || d.length === 11) d = '55' + d; }
    return d.length >= min && d.length <= 15 ? 'https://wa.me/' + d : '';
  }
  // O campo "contato" aceita telefone, e-mail ou site.
  function contatoLinks(c) {
    const t = c.trim(), out = [];
    if (/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/.test(t)) out.push(['✉️ ' + t, 'mailto:' + t]);
    else if (/^(https?:\/\/|www\.)\S+$/i.test(t)) out.push(['🔗 ' + t, /^www\./i.test(t) ? 'https://' + t : t, true]);
    else if (/^[\d\s()+\-.]{8,}$/.test(t)) {
      out.push(['📞 ' + t, 'tel:' + t.replace(/[^\d+]/g, '')]);
      const wa = whatsappUrl(t);
      if (wa) out.push(['WhatsApp', wa, true]);
    } else out.push(['📞 ' + t, null]);
    return out;
  }

  DK.contactsApp = function () {
    DK.openWindow('contacts', 'Gestor de Contatos', (body, win) => {
      body.className = 'body flush';
      let items = [], filter = '', q = '';
      const msg = el('div', { className: 'err', style: 'padding:0 10px' });
      const search = el('input', { type: 'search', placeholder: 'Buscar…' }); search.style.maxWidth = '220px';
      const novo = el('button', { className: 'pri', textContent: '+ Novo contato' });
      const tb = el('div', { className: 'tb' }, novo, el('span', { className: 'sp' }), search);
      const chips = el('div', { className: 'chips' });
      const list = el('div', { className: 'clist' });
      const status = el('div', { className: 'status' });
      const main = el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' }, tb, chips, msg, list, status);
      body.append(main);

      function tipos() {
        const seen = {}, out = [];
        items.forEach(c => { const k = tipoKey(c.tipoServico); if (!seen[k]) { seen[k] = 1; out.push({ key: k, label: cap(c.tipoServico) }); } });
        return out.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
      }
      function drawChips() {
        chips.replaceChildren();
        if (filter && !tipos().some(t => t.key === filter)) filter = '';
        [{ key: '', label: 'Todos' }].concat(tipos()).forEach(t => {
          const n = items.filter(c => !t.key || tipoKey(c.tipoServico) === t.key).length;
          chips.append(el('button', { className: 'chip' + (filter === t.key ? ' on' : ''), textContent: t.label + ' (' + n + ')', onclick: () => { filter = t.key; draw(); } }));
        });
      }
      function draw() {
        drawChips();
        list.replaceChildren();
        const needle = q.trim().toLowerCase();
        const shown = items.filter(c => (!filter || tipoKey(c.tipoServico) === filter) &&
          (!needle || [c.nome, c.tipoServico, c.contato, c.indicacao, c.servico, c.obs].join(' ').toLowerCase().indexOf(needle) >= 0));
        if (!shown.length) list.append(el('div', { className: 'meta', style: 'padding:14px', textContent: items.length ? 'Nada encontrado.' : 'Nenhum contato cadastrado ainda.' }));
        shown.forEach(c => {
          const row = el('div', { className: 'crow' });
          row.append(el('div', {}, el('span', { className: 'nm', textContent: c.nome }), ' ', el('span', { className: 'tag', textContent: cap(c.tipoServico) })));
          const act = el('div', { className: 'act' },
            el('button', { textContent: '✎', title: 'Editar', onclick: () => form(c) }),
            el('button', { className: 'del', textContent: '🗑', title: 'Apagar', onclick: async () => {
              if (!confirm('Apagar “' + c.nome + '”? Isto não pode ser desfeito.')) return;
              try { await DK.hub('DELETE', '/api/contatos/' + c.id); items = items.filter(x => x.id !== c.id); draw(); } catch (e) { msg.textContent = e.message; }
            } }));
          row.append(act);
          if (c.contato) {
            const l = el('div', { className: 'row' });
            contatoLinks(c.contato).forEach(x => l.append(x[1] ? el('a', { href: x[1], textContent: x[0], target: x[2] ? '_blank' : '', rel: 'noopener' }) : x[0]));
            row.append(l);
          }
          if (c.servico) row.append(el('div', { textContent: c.servico }));
          const extra = [c.indicacao && 'Indicação: ' + c.indicacao, c.obs && 'Obs.: ' + c.obs].filter(Boolean).join(' · ');
          if (extra) row.append(el('div', { className: 'meta', textContent: extra }));
          list.append(row);
        });
        status.textContent = items.length + ' contato(s)';
      }

      function form(c) {
        const cur = c || { nome: '', tipoServico: filter ? (tipos().filter(t => t.key === filter)[0] || {}).label || '' : '', contato: '', indicacao: '', servico: '', obs: '' };
        const f = {};
        const field = (k, label, props) => {
          const inp = props.area ? el('textarea', { value: cur[k], rows: props.rows || 2, maxLength: props.max }) : el('input', { value: cur[k], maxLength: props.max, placeholder: props.ph || '' });
          if (props.list) inp.setAttribute('list', 'dk-tipos');
          f[k] = inp;
          return el('label', {}, label + (props.opt ? ' (opcional)' : ''), inp);
        };
        const dl = el('datalist', { id: 'dk-tipos' });
        const seen = {};
        tipos().map(t => t.label).concat(TIPOS).forEach(t => { if (!seen[tipoKey(t)]) { seen[tipoKey(t)] = 1; dl.append(el('option', { value: t })); } });
        const err = el('div', { className: 'err' });
        const save = el('button', { className: 'pri', textContent: 'Salvar' }), cancel = el('button', { textContent: 'Cancelar' });
        const frm = el('form', { className: 'form' }, el('b', { textContent: c ? 'Editar contato' : 'Novo contato' }),
          field('nome', 'Nome', { max: 120 }), field('tipoServico', 'Tipo de serviço', { max: 60, list: true, ph: 'Eletricista, Encanador…' }), dl,
          field('contato', 'Contato — telefone, e-mail ou site', { max: 250, opt: true, ph: '(11) 91234-5678' }),
          field('indicacao', 'Indicação', { max: 500, opt: true }), field('servico', 'Serviço', { max: 2000, area: true, rows: 3, opt: true }),
          field('obs', 'Observações', { max: 2000, area: true, opt: true }), err, el('div', { className: 'row' }, save, cancel));
        cancel.type = 'button';
        cancel.onclick = () => { frm.remove(); main.classList.remove('hidden'); };
        frm.onsubmit = async e => {
          e.preventDefault();
          const d = {};
          Object.keys(f).forEach(k => { d[k] = f[k].value.trim(); });
          if (!d.nome) { err.textContent = 'Informe o nome.'; return; }
          if (!d.tipoServico) { err.textContent = 'Informe o tipo de serviço.'; return; }
          try {
            const r = c ? await DK.hub('PUT', '/api/contatos/' + c.id, d) : await DK.hub('POST', '/api/contatos', d);
            if (c) items[items.indexOf(c)] = r; else items.push(r);
            items.sort((a, b) => a.tipoServico.localeCompare(b.tipoServico, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'));
            frm.remove(); main.classList.remove('hidden'); draw();
          } catch (x) { err.textContent = x.message; }
        };
        main.classList.add('hidden');
        body.append(frm);
        f.nome.focus();
      }

      novo.onclick = () => form(null);
      search.oninput = () => { q = search.value; draw(); };
      (async () => {
        try { items = await DK.hub('GET', '/api/contatos'); } catch (e) { msg.textContent = e.message; }
        draw();
      })();
    }, 620, 500, { flush: true });
  };

  DK.register({ id: 'contacts', icon: '📇', label: 'Contatos', desktop: true, open: DK.contactsApp });
})(window.DK = window.DK || {});
