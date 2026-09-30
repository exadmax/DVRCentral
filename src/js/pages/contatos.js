(function (CD) {
  // Página "Contatos" (contatos.html): profissionais e prestadores de serviço da casa (eletricista, encanador...), guardados no hub.
  const U = CD.util, I = CD.icons, esc = U.esc;

  // Sugestões para o campo "tipo de serviço" (somadas aos tipos já cadastrados)
  const TIPOS = ['Eletricista', 'Encanador', 'Pedreiro', 'Pintor', 'Chaveiro', 'Diarista', 'Marceneiro', 'Mecânico', 'Ar-condicionado',
    'Dedetizador', 'Vidraceiro', 'Jardineiro', 'Técnico de informática', 'Médico', 'Dentista', 'Veterinário'];

  const tipoKey = t => t.trim().toLowerCase();
  const cap = t => t.trim().charAt(0).toUpperCase() + t.trim().slice(1);        // só a exibição: "chaveiro" -> "Chaveiro"
  const byName = (a, b) => a.tipoServico.localeCompare(b.tipoServico, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR');
  // O campo "contato" aceita telefone, e-mail ou site; vira link conforme o que for (vários números juntos ficam só como texto)
  function contatoLink(c) {
    const t = c.trim();
    if (/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/.test(t)) return { href: 'mailto:' + t, icon: 'mail' };
    if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return { href: /^www\./i.test(t) ? 'https://' + t : t, icon: 'link', blank: true };
    if (/^[\d\s()+\-.]{8,}$/.test(t)) return { href: 'tel:' + t.replace(/[^\d+]/g, ''), icon: 'phone' };
    return { icon: 'phone' };
  }

  function mount(root) {
    const api = CD.hubApi.contatos;
    const st = { items: null, error: '', filter: '', q: '', confirmId: 0 };
    const $ = s => root.querySelector(s);

    root.innerHTML = '<section class="pg">' +
      '<div class="pg-sum" id="sum"></div>' +
      '<div class="pg-tools"><nav class="chips" id="chips"></nav>' +
      '<label class="search">' + I.svg('search', 'currentColor', 26, 2) + '<input type="search" id="q" placeholder="Buscar contato" autocomplete="off"></label>' +
      '<button type="button" class="btn" data-act="new">' + I.svg('plus', 'currentColor', 26, 2.2) + '<span>Novo contato</span></button></div>' +
      '<div class="pg-list cards" id="list"></div><div id="modal"></div></section>';

    function all() { return st.items || []; }

    // Tipos já usados, sem repetir por maiúsculas/minúsculas, com a grafia da primeira ocorrência
    function tipos() {
      const seen = {}, out = [];
      all().forEach(c => { const k = tipoKey(c.tipoServico); if (!seen[k]) { seen[k] = 1; out.push({ key: k, label: cap(c.tipoServico) }); } });
      return out.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    }

    function renderChips() {
      const count = k => all().filter(c => !k || tipoKey(c.tipoServico) === k).length;
      const chips = [{ key: '', label: 'Todos' }].concat(tipos());
      if (st.filter && !chips.some(c => c.key === st.filter)) st.filter = '';        // o último do tipo foi excluído
      $('#chips').innerHTML = chips.map(c => '<button type="button" class="chip' + (st.filter === c.key ? ' on' : '') + '" data-filter="' + esc(c.key) + '">' +
        esc(c.label) + '<b>' + count(c.key) + '</b></button>').join('');
      $('#sum').innerHTML = all().length ? '<span class="spill ok">' + all().length + (all().length === 1 ? ' contato' : ' contatos') + '</span>' : '';
    }

    function contatoHtml(c) {
      const l = contatoLink(c), inner = I.svg(l.icon, 'currentColor', 26, 2) + '<span class="num">' + esc(c) + '</span>';
      return l.href ? '<a class="cc-tel" href="' + esc(l.href) + '"' + (l.blank ? ' target="_blank" rel="noopener"' : '') + '>' + inner + '</a>'
        : '<div class="cc-tel">' + inner + '</div>';
    }

    function card(c) {
      if (st.confirmId === c.id) {
        return '<article class="cc confirm"><div class="cc-name">Excluir “' + esc(c.nome) + '”?</div><div class="rw-meta">Essa ação não pode ser desfeita.</div>' +
          '<div class="cc-act"><button type="button" class="btn danger" data-act="del" data-id="' + c.id + '">Excluir</button>' +
          '<button type="button" class="btn ghost" data-act="cancel">Cancelar</button></div></article>';
      }
      return '<article class="cc"><div class="cc-top"><div class="cc-name">' + esc(c.nome) + '</div><span class="ctag">' + esc(cap(c.tipoServico)) + '</span></div>' +
        (c.contato ? contatoHtml(c.contato) : '') +
        (c.servico ? '<div class="cc-note">' + esc(c.servico) + '</div>' : '') +
        (c.indicacao ? '<div class="cc-line">' + I.svg('user', 'currentColor', 22, 2) + '<span>' + esc(c.indicacao) + '</span></div>' : '') +
        '<div class="cc-act"><button type="button" class="ib" data-act="edit" data-id="' + c.id + '" title="Editar" aria-label="Editar ' + esc(c.nome) + '">' + I.svg('edit', 'currentColor', 28, 2) + '</button>' +
        '<button type="button" class="ib danger" data-act="ask" data-id="' + c.id + '" title="Excluir" aria-label="Excluir ' + esc(c.nome) + '">' + I.svg('trash', 'currentColor', 28, 2) + '</button></div></article>';
    }

    function renderList() {
      const el = $('#list');
      let h = st.error ? '<div class="banner err"><span>' + esc(st.error) + '</span><button type="button" class="btn ghost" data-act="retry">Tentar de novo</button></div>' : '';
      if (!st.items) { el.innerHTML = h || '<div class="skel" style="height:190px"></div><div class="skel" style="height:190px"></div>'; return; }
      const q = st.q.trim().toLowerCase();
      const list = st.items.filter(c => (!st.filter || tipoKey(c.tipoServico) === st.filter) &&
        (!q || [c.nome, c.tipoServico, c.contato, c.indicacao, c.servico].join(' ').toLowerCase().indexOf(q) >= 0));
      if (!list.length) h += '<div class="empty">' + (st.items.length ? 'Nenhum contato encontrado' : 'Nenhum contato cadastrado. Toque em “Novo contato” para começar.') + '</div>';
      else h += list.map(card).join('');
      el.innerHTML = h;
    }

    function renderAll() { renderChips(); renderList(); }

    function changed() { st.items.sort(byName); renderAll(); }

    async function load() {
      st.error = '';
      try { st.items = await api.list(); } catch (e) { st.error = e.message; }
      renderAll();
    }

    function form(c) {
      const cur = c || { nome: '', tipoServico: st.filter ? (tipos().filter(t => t.key === st.filter)[0] || {}).label || '' : '', contato: '', indicacao: '', servico: '' };
      const sugestoes = [], seen = {};
      tipos().map(t => t.label).concat(TIPOS).forEach(t => { if (!seen[tipoKey(t)]) { seen[tipoKey(t)] = 1; sugestoes.push(t); } });
      const body = CD.ui.field('Nome', '<input name="nome" type="text" maxlength="120" autocomplete="off" value="' + esc(cur.nome) + '">') +
        CD.ui.field('Tipo de serviço', '<input name="tipoServico" type="text" maxlength="60" list="tipos-dl" autocomplete="off" placeholder="Ex.: Eletricista" value="' + esc(cur.tipoServico) + '">') +
        '<datalist id="tipos-dl">' + sugestoes.map(t => '<option value="' + esc(t) + '"></option>').join('') + '</datalist>' +
        CD.ui.field('Contato', '<input name="contato" type="text" maxlength="250" autocomplete="off" placeholder="Telefone, e-mail ou site" value="' + esc(cur.contato) + '">', '(opcional)') +
        CD.ui.field('Indicação', '<input name="indicacao" type="text" maxlength="500" autocomplete="off" placeholder="Quem indicou, se recomenda..." value="' + esc(cur.indicacao) + '">', '(opcional)') +
        CD.ui.field('Serviço', '<textarea name="servico" rows="3" maxlength="2000" placeholder="O que ele vai fazer / fez">' + esc(cur.servico) + '</textarea>', '(opcional)');

      CD.ui.modal($('#modal'), {
        title: c ? 'Editar contato' : 'Novo contato', body: body,
        read(f) {
          const el = f.elements, d = {
            nome: el.nome.value.trim(), tipoServico: el.tipoServico.value.trim(), contato: el.contato.value.trim(),
            indicacao: el.indicacao.value.trim(), servico: el.servico.value.trim()
          };
          if (!d.nome) throw new Error('Informe o nome.');
          if (!d.tipoServico) throw new Error('Informe o tipo de serviço.');
          return d;
        },
        async save(data) {
          if (c) { const r = await api.update(c.id, data); st.items[st.items.indexOf(c)] = r; }
          else st.items.push(await api.create(data));
          st.error = ''; changed();
        }
      });
    }

    root.addEventListener('click', async e => {
      const b = e.target.closest && e.target.closest('[data-act],[data-filter]');
      if (!b) return;
      if (b.hasAttribute('data-filter')) { st.filter = b.getAttribute('data-filter'); st.confirmId = 0; renderChips(); renderList(); return; }
      const act = b.getAttribute('data-act'), id = +b.getAttribute('data-id');
      const c = all().filter(x => x.id === id)[0];
      if (act === 'new') form(null);
      else if (act === 'edit' && c) form(c);
      else if (act === 'ask' && c) { st.confirmId = id; renderList(); }
      else if (act === 'cancel') { st.confirmId = 0; renderList(); }
      else if (act === 'retry') { st.items = null; renderList(); load(); }
      else if (act === 'del' && c) {
        b.disabled = true;
        try { await api.remove(id); st.items = st.items.filter(x => x.id !== id); st.error = ''; }
        catch (x) { st.error = x.message; }
        st.confirmId = 0; changed();
      }
    });
    $('#q').addEventListener('input', e => { st.q = e.target.value; st.confirmId = 0; renderList(); });

    renderAll();
    load();
  }

  CD.pages = CD.pages || {};
  CD.pages.contatos = { label: 'Contatos', sub: 'profissionais e telefones', icon: 'phone', mount: mount };
})(window.CD = window.CD || {});
