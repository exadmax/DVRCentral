(function (CD) {
  // Aba "Contatos": prestadores de serviço e telefones importantes da casa (eletricista, encanador...), guardados no hub.
  const U = CD.util, I = CD.icons, esc = U.esc;

  // Sugestões para o campo "tipo de serviço" (somadas aos tipos já cadastrados)
  const TIPOS = ['Eletricista', 'Encanador', 'Pedreiro', 'Pintor', 'Chaveiro', 'Diarista', 'Marceneiro', 'Mecânico', 'Ar-condicionado',
    'Dedetizador', 'Vidraceiro', 'Jardineiro', 'Técnico de informática', 'Médico', 'Dentista', 'Veterinário'];

  const tipoKey = t => t.trim().toLowerCase();
  const cap = t => t.trim().charAt(0).toUpperCase() + t.trim().slice(1);        // só a exibição: "chaveiro" -> "Chaveiro"
  const byName = (a, b) => a.tipoServico.localeCompare(b.tipoServico, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR');
  const telHref = t => 'tel:' + String(t).replace(/[^\d+]/g, '');

  function mount(root) {
    const api = CD.hubApi.contatos;
    const st = { items: null, error: '', filter: '', q: '', confirmId: 0 };
    const $ = s => root.querySelector(s);

    root.innerHTML = '<section class="pg">' +
      '<div class="pg-head"><div class="h2">Contatos importantes</div><div class="pg-sum" id="sum"></div></div>' +
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

    function card(c) {
      if (st.confirmId === c.id) {
        return '<article class="cc confirm"><div class="cc-name">Excluir “' + esc(c.nome) + '”?</div><div class="rw-meta">Essa ação não pode ser desfeita.</div>' +
          '<div class="cc-act"><button type="button" class="btn danger" data-act="del" data-id="' + c.id + '">Excluir</button>' +
          '<button type="button" class="btn ghost" data-act="cancel">Cancelar</button></div></article>';
      }
      return '<article class="cc"><div class="cc-top"><div class="cc-name">' + esc(c.nome) + '</div><span class="ctag">' + esc(cap(c.tipoServico)) + '</span></div>' +
        '<a class="cc-tel" href="' + esc(telHref(c.telefone)) + '">' + I.svg('phone', 'currentColor', 26, 2) + '<span class="num">' + esc(c.telefone) + '</span></a>' +
        (c.endereco ? '<div class="cc-line">' + I.svg('pin', 'currentColor', 22, 2) + '<span>' + esc(c.endereco) + '</span></div>' : '') +
        (c.nota ? '<div class="cc-note">' + esc(c.nota) + '</div>' : '') +
        '<div class="cc-act"><button type="button" class="ib" data-act="edit" data-id="' + c.id + '" title="Editar" aria-label="Editar ' + esc(c.nome) + '">' + I.svg('edit', 'currentColor', 28, 2) + '</button>' +
        '<button type="button" class="ib danger" data-act="ask" data-id="' + c.id + '" title="Excluir" aria-label="Excluir ' + esc(c.nome) + '">' + I.svg('trash', 'currentColor', 28, 2) + '</button></div></article>';
    }

    function renderList() {
      const el = $('#list');
      let h = st.error ? '<div class="banner err"><span>' + esc(st.error) + '</span><button type="button" class="btn ghost" data-act="retry">Tentar de novo</button></div>' : '';
      if (!st.items) { el.innerHTML = h || '<div class="skel" style="height:190px"></div><div class="skel" style="height:190px"></div>'; return; }
      const q = st.q.trim().toLowerCase();
      const list = st.items.filter(c => (!st.filter || tipoKey(c.tipoServico) === st.filter) &&
        (!q || [c.nome, c.tipoServico, c.telefone, c.endereco, c.nota].join(' ').toLowerCase().indexOf(q) >= 0));
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
      const cur = c || { nome: '', tipoServico: st.filter ? (tipos().filter(t => t.key === st.filter)[0] || {}).label || '' : '', telefone: '', endereco: '', nota: '' };
      const sugestoes = [], seen = {};
      tipos().map(t => t.label).concat(TIPOS).forEach(t => { if (!seen[tipoKey(t)]) { seen[tipoKey(t)] = 1; sugestoes.push(t); } });
      const body = CD.ui.field('Nome', '<input name="nome" type="text" maxlength="120" autocomplete="off" value="' + esc(cur.nome) + '">') +
        CD.ui.field('Tipo de serviço', '<input name="tipoServico" type="text" maxlength="60" list="tipos-dl" autocomplete="off" placeholder="Ex.: Eletricista" value="' + esc(cur.tipoServico) + '">') +
        '<datalist id="tipos-dl">' + sugestoes.map(t => '<option value="' + esc(t) + '"></option>').join('') + '</datalist>' +
        CD.ui.field('Telefone', '<input name="telefone" type="tel" inputmode="tel" maxlength="40" autocomplete="off" placeholder="(11) 90000-0000" value="' + esc(cur.telefone) + '">') +
        CD.ui.field('Endereço', '<input name="endereco" type="text" maxlength="250" autocomplete="off" value="' + esc(cur.endereco) + '">', '(opcional)') +
        CD.ui.field('Nota', '<textarea name="nota" rows="3" maxlength="2000">' + esc(cur.nota) + '</textarea>', '(opcional)');

      CD.ui.modal($('#modal'), {
        title: c ? 'Editar contato' : 'Novo contato', body: body,
        read(f) {
          const el = f.elements, d = {
            nome: el.nome.value.trim(), tipoServico: el.tipoServico.value.trim(), telefone: el.telefone.value.trim(),
            endereco: el.endereco.value.trim(), nota: el.nota.value.trim()
          };
          if (!d.nome) throw new Error('Informe o nome.');
          if (!d.tipoServico) throw new Error('Informe o tipo de serviço.');
          if (!d.telefone) throw new Error('Informe o telefone.');
          if (d.telefone.replace(/\D/g, '').length < 8) throw new Error('O telefone deve ter pelo menos 8 dígitos.');
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
  CD.pages.contatos = { label: 'Contatos', icon: 'phone', mount: mount };
})(window.CD = window.CD || {});
