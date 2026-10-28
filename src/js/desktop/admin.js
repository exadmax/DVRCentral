(function (DK) {
  // Administração: Usuários (e o que cada um pode usar), Minha conta e Configurações do painel (só administrador).
  const el = DK.el;

  DK.usersApp = function () {
    DK.openWindow('users', 'Usuários', body => {
      const u = el('input', { placeholder: 'Novo usuário', autocomplete: 'off' });
      const p = el('input', { type: 'password', placeholder: 'Senha provisória (mín. 8)', autocomplete: 'new-password' });
      const chk = (label, title) => { const i = el('input', { type: 'checkbox' }); return { i: i, l: el('label', { title: title }, i, ' ' + label) }; };
      const adm = chk('administrador', 'Administra usuários, câmeras e configurações; usa o sudo com a própria senha');
      const term = chk('Terminal', 'Pode usar o Terminal no servidor');
      const expl = chk('Arquivos do computador', 'Pode navegar e alterar os arquivos do servidor (Explorer → Computador)');
      const add = el('button', { className: 'pri', textContent: 'Adicionar' });
      const msg = el('div', { className: 'err' });
      const tb = el('tbody');
      body.append(el('div', { className: 'row grow' }, u, p), el('div', { className: 'row' }, adm.l, term.l, expl.l, add), msg,
        el('table', {}, el('thead', {}, el('tr', {}, ...['Usuário', 'Perfil', 'Terminal', 'Arquivos do PC', ''].map(t => el('th', { textContent: t })))), tb),
        el('div', { className: 'meta', textContent: 'A senha definida aqui é provisória: a pessoa precisa trocá-la no primeiro login. Terminal e arquivos do computador só funcionam se estiverem ligados no servidor (desk.shell) e o sudo sempre pede a senha de um administrador.' }));

      async function refresh() {
        try {
          const us = await DK.api('GET', '/admin/users');
          tb.replaceChildren(...us.map(x => {
            const perm = (key, label) => {
              const i = el('input', { type: 'checkbox', checked: x.is_admin || x[key], disabled: x.is_admin, title: x.is_admin ? 'Administradores podem tudo' : label });
              i.onchange = async () => {
                try { const b = {}; b[key] = i.checked; await DK.api('PATCH', '/admin/users/' + x.id, b); msg.textContent = ''; }
                catch (e) { msg.textContent = e.message; i.checked = !i.checked; }
              };
              return el('td', {}, i);
            };
            const acts = el('td', { className: 'row' });
            acts.append(el('button', { textContent: 'Redefinir senha', onclick: async () => {
              const np = prompt('Nova senha provisória para ' + x.username + ' (mín. 8):');
              if (!np) return;
              try { await DK.api('POST', '/admin/users/' + x.id + '/password', { password: np }); msg.className = 'ok'; msg.textContent = 'Senha de ' + x.username + ' redefinida.'; }
              catch (e) { msg.className = 'err'; msg.textContent = e.message; }
            } }));
            if (x.id !== DK.me.id) {
              acts.append(el('button', { className: 'del', textContent: 'Remover', onclick: async () => {
                if (!confirm('Remover ' + x.username + ' e TUDO que é dele (arquivos, agendas e preferências)?')) return;
                try { await DK.api('DELETE', '/admin/users/' + x.id); refresh(); } catch (e) { msg.className = 'err'; msg.textContent = e.message; }
              } }));
            }
            return el('tr', {}, el('td', { textContent: x.username + (x.must_change ? ' (senha pendente)' : '') }),
              el('td', {}, el('span', { className: 'tag', textContent: x.is_admin ? 'admin' : 'usuário' })),
              perm('can_terminal', 'Pode usar o Terminal'), perm('can_explorer', 'Pode navegar nos arquivos do computador'), acts);
          }));
        } catch (e) { msg.className = 'err'; msg.textContent = e.message; }
      }
      add.onclick = async () => {
        msg.textContent = ''; msg.className = 'err';
        try {
          await DK.api('POST', '/admin/users', { username: u.value.trim(), password: p.value, is_admin: adm.i.checked, can_terminal: term.i.checked, can_explorer: expl.i.checked });
          u.value = p.value = ''; adm.i.checked = term.i.checked = expl.i.checked = false; refresh();
        } catch (e) { msg.textContent = e.message; }
      };
      refresh();
    }, 640, 480);
  };

  DK.accountApp = function () {
    DK.openWindow('account', 'Minha conta', body => {
      // ----- perfil: nome, foto e assinatura (tudo opcional) -----
      const P = DK.me.profile || {};
      const first = el('input', { placeholder: 'Nome', maxLength: 40, value: P.first_name || '' });
      const last = el('input', { placeholder: 'Sobrenome', maxLength: 40, value: P.last_name || '' });
      const sign = el('input', { type: 'checkbox', checked: !!P.sign_email });
      const sig = el('textarea', { rows: 3, maxLength: 500, placeholder: 'Assinatura (se ficar vazia, vale o seu nome completo)' });
      sig.value = P.signature || '';
      const av = el('span', { className: 'avwrap' });
      const pmsg = el('div', { className: 'err' });
      const showAv = () => av.replaceChildren(DK.avatar(DK.me.id, (first.value + ' ' + last.value).trim() || DK.me.username, (DK.me.profile || {}).photo_ver, 72));
      const setProfile = p => { DK.me.profile = p; showAv(); DK.$('who').textContent = DK.displayName() + (DK.me.is_admin ? ' (admin)' : ''); if (DK.refreshShell) DK.refreshShell(); };
      // a foto é reduzida aqui (quadrado de 256 px, JPEG): o servidor só guarda algumas dezenas de KB
      async function shrink(file) {
        const bmp = await createImageBitmap(file);
        const s = Math.min(bmp.width, bmp.height), cv = el('canvas', { width: 256, height: 256 });
        cv.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 256, 256);
        return new Promise((ok, no) => cv.toBlob(b => (b ? ok(b) : no(new Error('não consegui reduzir a imagem'))), 'image/jpeg', 0.88));
      }
      const fileIn = el('input', { type: 'file', accept: 'image/*' }); fileIn.style.display = 'none';
      fileIn.onchange = async () => {
        const f = fileIn.files[0]; fileIn.value = '';
        if (!f) return;
        pmsg.className = 'err'; pmsg.textContent = '';
        try { setProfile(await DK.api('PUT', '/profile/photo', await shrink(f), true)); } catch (e) { pmsg.textContent = e.message; }
      };
      const bPhoto = el('button', { textContent: '📷 Escolher foto…', onclick: () => fileIn.click() });
      const bNoPhoto = el('button', { textContent: 'Remover foto', onclick: async () => { try { setProfile(await DK.api('DELETE', '/profile/photo')); } catch (e) { pmsg.textContent = e.message; } } });
      const bSave = el('button', { className: 'pri', textContent: 'Salvar perfil' });
      bSave.onclick = async () => {
        try {
          setProfile(await DK.api('PUT', '/profile', { first_name: first.value, last_name: last.value, sign_email: sign.checked, signature: sig.value }));
          pmsg.className = 'ok'; pmsg.textContent = 'Perfil salvo.';
        } catch (e) { pmsg.className = 'err'; pmsg.textContent = e.message; }
      };
      showAv();
      body.append(el('b', { textContent: 'Perfil (opcional)' }),
        el('div', { className: 'row' }, av, el('div', { style: 'display:grid;gap:6px;flex:1' }, first, last)),
        el('div', { className: 'row' }, bPhoto, bNoPhoto, fileIn),
        el('label', { className: 'row' }, sign, ' Usar meu nome nos e-mails (remetente e assinatura)'), sig,
        el('div', { className: 'meta', textContent: 'O nome e a foto aparecem para os outros usuários em Mensagens. Sem nome, vale o nome de usuário (' + DK.me.username + ').' }),
        el('div', { className: 'row' }, bSave), pmsg, el('hr'), el('b', { textContent: 'Senha' }));
      const c = el('input', { type: 'password', placeholder: 'Senha atual', autocomplete: 'current-password' });
      const n = el('input', { type: 'password', placeholder: 'Nova senha (mín. 8)', autocomplete: 'new-password' });
      const b = el('button', { className: 'pri', textContent: 'Trocar senha' });
      const msg = el('div', { className: 'err' });
      const perms = [DK.me.is_admin ? 'administrador' : 'usuário'];
      if (!DK.me.is_admin && DK.me.can_terminal) perms.push('Terminal');
      if (!DK.me.is_admin && DK.me.can_explorer) perms.push('arquivos do computador');
      body.append(el('div', { textContent: 'Usuário: ' + DK.me.username }), el('div', { className: 'meta', textContent: 'Perfil: ' + perms.join(', ') }), c, n, b, msg);
      b.onclick = async () => {
        try { await DK.api('POST', '/password', { current: c.value, new: n.value }); c.value = n.value = ''; msg.className = 'ok'; msg.textContent = 'Senha alterada.'; }
        catch (e) { msg.className = 'err'; msg.textContent = e.message; }
      };
    }, 420, 640);
  };

  // As configurações do painel (câmeras, agendas da casa, trânsito, menu, livros, desligar desktop/hub...) ficam na página Config.
  // Aqui ela abre numa janela, só para o administrador.
  DK.configApp = function (o) {
    const tab = (o && o.tab) || '';
    DK.openWindow('config' + (tab ? ':' + tab : ''), 'Configurações' + (tab ? ' · ' + tab : ''), body => {
      body.className = 'body flush';
      const url = 'config.html' + (tab ? '#' + tab : '');
      body.append(el('div', { className: 'tb' }, el('a', { href: url, target: '_blank', textContent: 'Abrir em nova aba ↗' }),
        el('span', { className: 'sp' }), el('span', { className: 'meta', textContent: 'Só o administrador vê esta janela' })),
        el('iframe', { className: 'fill', src: url, title: 'Configurações' }));
    }, 860, 600, { flush: true });
  };

  DK.register({ id: 'users', icon: '👥', label: 'Usuários', group: 1, show: me => me.is_admin, open: DK.usersApp });
  DK.register({ id: 'config', icon: '🛠️', label: 'Configurações', group: 1, show: me => me.is_admin, open: DK.configApp });
  DK.register({ id: 'account', icon: '⚙️', label: 'Minha conta', group: 1, open: DK.accountApp });
})(window.DK = window.DK || {});
