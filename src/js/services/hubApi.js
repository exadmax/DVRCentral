(function (CD) {
  // Cliente da API CRUD do hub (/api/estoque, /api/contatos). Erros viram Error com a mensagem do servidor.
  async function call(method, path, body, headers) {
    const base = CD.state && CD.state.hub;
    if (!base) throw new Error('Sem o hub: abra o painel pelo endereço do servidor da casa para usar esta página.');
    const opt = { method: method };
    if (headers) opt.headers = headers;
    if (body !== undefined) { opt.headers = Object.assign({ 'Content-Type': 'application/json' }, headers); opt.body = JSON.stringify(body); }
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

  CD.hubApi = {
    estoque: resource('/api/estoque'), contatos: resource('/api/contatos'),
    // câmeras ao vivo: a lista vem do hub (a URL com a senha nunca sai de lá); o vídeo é um MP4 contínuo em /stream
    // Config: uso de CPU/memória e os botões que param o desktop / o hub (o cabeçalho X-CD-Action evita disparo por outra página)
    system() { return call('GET', '/api/system'); },
    power(what) { return call('POST', '/api/admin/' + what, undefined, { 'X-CD-Action': 'confirm' }); },
    videos: { list() { return call('GET', '/api/videos'); } },
    // gravações das câmeras: arquivos de 1 hora no servidor; as configurações (liga/desliga, câmeras, retenção) ficam na página Config
    recordings: {
      list() { return call('GET', '/api/recordings'); },
      settings() { return call('GET', '/api/recordings/settings'); },
      save(obj) { return call('PUT', '/api/recordings/settings', obj, { 'X-CD-Action': 'confirm' }); },
      remove(name) { return call('DELETE', '/api/recordings/file/' + encodeURIComponent(name), undefined, { 'X-CD-Action': 'confirm' }); },
      fileUrl(name, download) { return CD.state.hub + '/api/recordings/file/' + encodeURIComponent(name) + (download ? '?download=1' : ''); }
    },
    cameras: { list() { return call('GET', '/api/cameras'); }, streamUrl(id) { return CD.state.hub + '/api/cameras/' + encodeURIComponent(id) + '/stream'; } }
  };
})(window.CD = window.CD || {});
