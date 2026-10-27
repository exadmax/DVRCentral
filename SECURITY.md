# Segurança

## Modelo de ameaça
O hub é feito para uma **rede doméstica confiável**. Ele **não tem login**, o CORS é aberto e quem alcança a porta consegue ver as
câmeras, baixar e apagar gravações, mudar a configuração (inclusive chaves e endereços) e usar o botão que desativa o hub.

- **Não exponha o hub à internet** (nem por redirecionamento de porta). Para acesso remoto use uma VPN (Tailscale, WireGuard) ou um proxy
  reverso com autenticação e HTTPS na frente.
- Senhas das câmeras, chaves de API e endereços secretos de agenda ficam em `hub.config.json` e `hub.settings.json` no servidor, em texto
  (arquivos com permissão restrita ao dono). Não os versione nem os compartilhe; o `.gitignore` já os exclui.
- Gravações de câmeras são dados pessoais. Avise quem frequenta a casa e respeite a legislação local (no Brasil, a LGPD).
- A Config permite informar endereços (iCal, RTSP, planilha) que o **servidor** acessa. Em uma rede confiável isso é esperado; não dê
  acesso à Config a quem não deveria alcançar sua rede interna.

## Desktop (`desktop.html`): login, usuários e terminal
O **Desktop** é a única parte com login. Ele protege o que é *dele* (arquivos dos usuários, agendas, Terminal), mas **não protege o resto do painel**:
a página Config e as APIs de sempre continuam abertas a quem alcança a porta, a menos que você ligue `desk.protectSettings` (veja [docs/desktop.md](docs/desktop.md)).

- **Terminal e arquivos do computador** estão **desligados por padrão** (`desk.shell`). Ligados, dão a quem tem permissão o poder do usuário do serviço;
  com `install.sh --desk-shell`, o **poder de root** (sudoers NOPASSWD). A senha de um administrador do Desktop passa a ser, na prática, a senha de root.
  Cada uso exige: recurso ligado, permissão do administrador, rede local ou HTTPS, a própria senha (15 min) e, para o sudo, a senha de um administrador. Tudo vai para o journal.
- Em **HTTP puro** (o normal na rede de casa) as senhas do Desktop trafegam **sem criptografia**. Use só em rede confiável; fora de casa, VPN ou HTTPS.
- A senha inicial do `admin` é **sorteada** e aparece uma única vez no log; a troca é obrigatória. Senhas ficam com PBKDF2-SHA256 (600 mil iterações); o login tem bloqueio por tentativas.
- As **agendas iCal** de cada usuário são segredos (quem tem a URL lê a agenda): ficam no banco, saem mascaradas pela API e só o dono as vê. O servidor só baixa de endereços
  públicos (não de rede interna nem de si mesmo), para o campo de URL não servir de sonda para a sua rede.
- O **Navegador** busca as páginas pelo servidor e as entrega sem scripts (limpeza do HTML, política de segurança e iframe sem JavaScript). Só alcança **sites da internet**: endereços
  da rede da casa, do próprio servidor e de nuvem (metadados) são recusados. Os downloads vão para a pasta do usuário e nada baixado é executado no servidor. `desk.noBrowser` desliga tudo isso.
- Os **emuladores** (js-dos) rodam no navegador, num iframe isolado, sem rede (`noNetworking`) e sem a nuvem do js-dos. O Windows 95/98/ME é software proprietário e **não é distribuído**: use só imagens que você tenha licença para usar.
- O editor de documentos e o visualizador nunca interpretam HTML, SVG ou scripts de arquivos: texto, imagem, PDF e vídeo são servidos com `nosniff` e política restritiva.
- O **LiteOffice Completo** (`office.html`, LibreOffice em WebAssembly) executa, no navegador, código baixado do CDN do ZetaOffice (terceira parte) ou da cópia local configurada. O endereço de onde esse código vem só é lido da configuração (`config/settings.js`), nunca da URL da página, e os cabeçalhos de isolamento (COOP/COEP) valem só para essa página e seus scripts, não para o resto do Desktop.

## Reportar uma vulnerabilidade
Abra um *security advisory* privado no GitHub (aba **Security** do repositório) em vez de uma issue pública. Descreva o problema e
como reproduzi-lo.
