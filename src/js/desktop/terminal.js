(function (DK) {
  // Terminal: executa comandos no servidor (de qualquer aparelho da rede), com a opção de rodar como root (sudo).
  // Fica atrás dos portões do servidor (desk_shell.go): recurso ligado, permissão, rede e desbloqueio com a senha.
  const el = DK.el, esc = DK.esc;

  function ansiHtml(text) {
    let open = false;
    const html = esc(text).replace(/\x1b\[([0-9;]*)m/g, (m, c) => {
      const cls = c.split(';').map(x => x.replace(/^9/, '3')).filter(x => /^(1|3[0-7])$/.test(x)).map(x => 'a' + x);
      let r = open ? '</span>' : '';
      open = false;
      if (cls.length) { r += '<span class="' + cls.join(' ') + '">'; open = true; }
      return r;
    }).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    return html + (open ? '</span>' : '');
  }

  DK.terminalApp = function () {
    DK.openWindow('terminal', 'Terminal', (body, win) => {
      body.className = 'body flush';
      const out = el('div', { className: 'term' });
      const prompt = el('span', { textContent: '$' });
      const inp = el('input', { spellcheck: false, autocomplete: 'off', placeholder: 'digite um comando' });
      const stop = el('button', { textContent: '■ Interromper' }), clear = el('button', { textContent: 'Limpar' });
      const sudoB = el('button', { textContent: '🔓 sudo (root)', title: 'Executar os comandos como root (pede a senha de um administrador)' });
      const lockB = el('button', { textContent: '🔒 Bloquear' });
      stop.classList.add('hidden');
      const tb = el('div', { className: 'tb' }, clear, stop, sudoB, lockB, el('span', { className: 'sp' }),
        el('span', { className: 'meta', textContent: 'sem TTY: top/vim não funcionam (use top -bn1)' }));
      const tin = el('div', { className: 'tin' }, prompt, inp);
      body.append(tb, el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' }, out, tin));
      let cwd = '', who = '', hist = [], hi = 0, ctrl = null, root = false, ready = false;
      const setPrompt = () => { prompt.textContent = (who ? who + ':' : '') + (cwd || '~') + (root ? ' #' : ' $'); tin.classList.toggle('root', root); };
      const stick = () => { out.scrollTop = out.scrollHeight; };
      win._onClose = () => { if (ctrl) ctrl.abort(); };

      async function run(cmd, hidden) {
        const ac = new AbortController();
        ctrl = ac; stop.classList.remove('hidden'); inp.disabled = true;
        let blk = null;
        if (!hidden) {
          out.append(el('div', {}, el('span', { className: 'pr', textContent: prompt.textContent + ' ' }), cmd));
          blk = el('div'); out.append(blk);
        }
        let text = '';
        const paint = () => {
          const i = text.search(/\n__DESKEND__/);
          if (blk) { blk.innerHTML = ansiHtml(i >= 0 ? text.slice(0, i) : text); stick(); }
        };
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            const res = await fetch('/api/desk/shell/run', { method: 'POST', credentials: 'same-origin', signal: ac.signal,
              headers: { 'X-Desk': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd, cwd: cwd, sudo: root }) });
            if (!res.ok) {
              let m = 'erro ' + res.status;
              try { m = (await res.json()).error || m; } catch (e) { /* sem corpo */ }
              if (attempt === 0 && m === 'locked') { await DK.ensureMachine('terminal'); continue; }
              if (attempt === 0 && m === 'sudo_locked') { await DK.ensureSudo('terminal'); continue; }
              if (blk) blk.append(el('span', { className: 'ex', textContent: m }));
              return;
            }
            const rd = res.body.getReader(), dec = new TextDecoder();
            for (;;) { const r = await rd.read(); if (r.done) break; text += dec.decode(r.value, { stream: true }); paint(); }
            break;
          }
          const m = text.match(/\n__DESKEND__(\S*?)\|([^\r\n]*)\r?\n?$/);
          paint();
          if (m) {
            cwd = m[2];
            if (hidden) who = text.slice(0, text.search(/\n__DESKEND__/)).trim();
            else if (m[1] !== '0' && m[1] !== '' && blk) blk.append(el('div', { className: 'ex', textContent: '[código de saída ' + m[1] + ']' }));
          }
        } catch (e) {
          if (blk) blk.append(el('div', { className: 'ex', textContent: e.name === 'AbortError' ? '^C interrompido' : e.message }));
        } finally {
          ctrl = null; stop.classList.add('hidden'); inp.disabled = false; setPrompt(); inp.focus(); stick();
        }
      }
      const identity = () => run('echo "$(whoami)@$(hostname)"', true);

      inp.onkeydown = e => {
        if (e.key === 'Enter') {
          const cmd = inp.value; inp.value = '';
          if (!cmd.trim()) return;
          hist.push(cmd); hi = hist.length;
          if (cmd.trim() === 'clear') { out.replaceChildren(); return; }
          run(cmd);
        } else if (e.key === 'ArrowUp') { if (hi > 0) inp.value = hist[--hi]; e.preventDefault(); }
        else if (e.key === 'ArrowDown') { inp.value = hi < hist.length - 1 ? hist[++hi] : (hi = hist.length, ''); e.preventDefault(); }
        else if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); out.replaceChildren(); }
        else if (e.ctrlKey && e.key.toLowerCase() === 'c' && ctrl) ctrl.abort();
      };
      stop.onclick = () => { if (ctrl) ctrl.abort(); };
      clear.onclick = () => { out.replaceChildren(); inp.focus(); };
      sudoB.onclick = async () => {
        if (root) { root = false; sudoB.textContent = '🔓 sudo (root)'; sudoB.classList.remove('sudo-on'); await identity(); return; }
        try { await DK.ensureSudo('terminal'); }
        catch (e) { if (e.message !== 'Cancelado.') out.append(el('div', { className: 'ex', textContent: e.message })); return; }
        root = true; sudoB.textContent = '🔒 sair do sudo'; sudoB.classList.add('sudo-on');
        out.append(el('div', { className: 'okc', textContent: 'Modo root (sudo): os comandos agora rodam como root.' }));
        await identity();
      };
      lockB.onclick = async () => {
        try { await DK.api('POST', '/shell/lock', {}); } catch (e) { /* já trancado */ }
        out.append(el('div', { className: 'okc', textContent: 'Bloqueado. Reabra o Terminal para digitar a senha de novo.' }));
        inp.disabled = true; ready = false;
      };
      out.onclick = () => { if (!String(getSelection())) inp.focus(); };
      (async () => {
        try { await DK.ensureMachine('terminal'); }
        catch (e) { out.append(el('div', { className: 'ex', textContent: e.message })); inp.disabled = true; return; }
        ready = true;
        out.append(el('div', { className: 'okc', textContent: 'Terminal liberado. Cada comando fica registrado no servidor (usuário e IP).' }));
        await identity(); setPrompt(); inp.focus();
      })();
    }, 760, 480, { flush: true });
  };

  DK.register({ id: 'terminal', icon: '⌨️', label: 'Terminal', desktop: true, group: 1,
    show: me => me.shell && (me.is_admin || me.can_terminal), open: DK.terminalApp });
})(window.DK = window.DK || {});
