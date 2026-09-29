(function (CD) {
  // Cliente da API CRUD do hub (/api/estoque, /api/contatos). Erros viram Error com a mensagem do servidor.
  async function call(method, path, body) {
    const base = CD.state && CD.state.hub;
    if (!base) throw new Error('Sem o hub: abra o painel pelo endereço do servidor da casa para usar esta aba.');
    const opt = { method: method };
    if (body !== undefined) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctl) opt.signal = ctl.signal;
    const timer = setTimeout(() => ctl && ctl.abort(), 12000);
    try {
      const r = await fetch(base + path, opt);
      if (r.status === 204) return null;
      let j = null;
      try { j = await r.json(); } catch (e) { /* corpo vazio ou não JSON */ }
      if (!r.ok) throw new Error((j && j.error) || 'Erro ' + r.status + ' no servidor');
      return j;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('O servidor demorou demais para responder.');
      if (e instanceof TypeError) throw new Error('Sem conexão com o servidor da casa.');
      throw e;
    } finally { clearTimeout(timer); }
  }

  function resource(path) {
    return {
      list() { return call('GET', path); },
      create(obj) { return call('POST', path, obj); },
      update(id, obj) { return call('PUT', path + '/' + id, obj); },
      remove(id) { return call('DELETE', path + '/' + id); }
    };
  }

  CD.hubApi = { estoque: resource('/api/estoque'), contatos: resource('/api/contatos') };
})(window.CD = window.CD || {});
