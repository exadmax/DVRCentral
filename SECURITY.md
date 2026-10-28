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

## Diogows (`desktop.html`): login, usuários e terminal
O **Diogows** é a única parte com login. Ele protege o que é *dele* (arquivos dos usuários, agendas, Terminal), mas **não protege o resto do painel**:
a página Config e as APIs de sempre continuam abertas a quem alcança a porta, a menos que você ligue `desk.protectSettings` (veja [docs/desktop.md](docs/desktop.md)).

- **Terminal e arquivos do computador** estão **desligados por padrão** (`desk.shell`). Ligados, dão a quem tem permissão o poder do usuário do serviço;
  com `install.sh --desk-shell`, o **poder de root** (sudoers NOPASSWD). A senha de um administrador do Diogows passa a ser, na prática, a senha de root.
  Cada uso exige: recurso ligado, permissão do administrador, rede local ou HTTPS, a própria senha (15 min) e, para o sudo, a senha de um administrador. Tudo vai para o journal.
- Em **HTTP puro** (o normal na rede de casa) as senhas do Diogows trafegam **sem criptografia**. Use só em rede confiável; fora de casa, VPN ou HTTPS.
- A senha inicial do `admin` é **sorteada** e aparece uma única vez no log; a troca é obrigatória. Senhas ficam com PBKDF2-SHA256 (600 mil iterações); o login tem bloqueio por tentativas.
- As **agendas iCal** de cada usuário são segredos (quem tem a URL lê a agenda): ficam no banco, saem mascaradas pela API e só o dono as vê. O servidor só baixa de endereços
  públicos (não de rede interna nem de si mesmo), para o campo de URL não servir de sonda para a sua rede.
- O **Navegador** busca as páginas pelo servidor e as entrega sem scripts (limpeza do HTML, política de segurança e iframe sem JavaScript). Só alcança **sites da internet**: endereços
  da rede da casa, do próprio servidor e de nuvem (metadados) são recusados. Os downloads vão para a pasta do usuário e nada baixado é executado no servidor. `desk.noBrowser` desliga tudo isso.
- Os **emuladores** (js-dos) rodam no navegador, num iframe isolado, sem rede (`noNetworking`) e sem a nuvem do js-dos. O Windows (3.x, 95, 98, ME) é software proprietário e **não é distribuído**: use só imagens que você tenha licença para usar. O disco alterado de um sistema virtual fica na pasta do próprio usuário no servidor (`Programas/Sistemas`), com o mesmo isolamento dos outros arquivos.
- O editor de documentos e o visualizador nunca interpretam HTML, SVG ou scripts de arquivos: texto, imagem, PDF e vídeo são servidos com `nosniff` e política restritiva.
- O **LiteOffice Completo** (`office.html`, LibreOffice em WebAssembly) executa, no navegador, código baixado do CDN do ZetaOffice (terceira parte) ou da cópia local configurada. O endereço de onde esse código vem só é lido da configuração (`config/settings.js`), nunca da URL da página, e os cabeçalhos de isolamento (COOP/COEP) valem só para essa página e seus scripts, não para o resto do Diogows.
- O **E-mail** guarda senhas e *refresh tokens* **cifrados** (AES-GCM) no banco, com a chave em `desk/_mail.key` (modo 0600; faça backup dela, e lembre que quem lê o disco do servidor lê a chave junto: a cifra protege cópias do banco, não um servidor comprometido).
  Só fala TLS (implícito ou STARTTLS), só conecta em endereços da internet (a menos que `desk.mail.allowPrivate`), cada usuário só alcança as próprias contas e a API nunca devolve credenciais. O HTML das mensagens roda num iframe com `sandbox`, sem scripts e sem rede;
  **imagens remotas só carregam se o usuário pedir**; anexos saem sempre como download (nunca HTML ou SVG). O login OAuth usa PKCE e `state` de uso único. Veja [docs/email.md](docs/email.md#7-segurança).
- O **perfil** (foto, nome, assinatura): a foto só é aceita se for um JPEG ou PNG **decodificável** (até 400 KB), e é servida como imagem inerte (`nosniff`, CSP restritiva). As fotos são visíveis a qualquer usuário logado.
- A busca do **ícone de um site** (Programa Web) é feita pelo servidor, só em endereços da internet (mesmo bloqueio do Navegador interno), aceita só imagens reconhecidas pelo conteúdo e limita o tamanho. `desk.noBrowser` a desliga.
- Um **Programa Web** na janela interna carrega a página sem `sandbox`: ela tem os poderes de uma aba comum. Cadastre só endereços em que confia. O WhatsApp Web e outros sites que proíbem ser exibidos dentro de outra página abrem em janela própria do navegador; o Diogows não contorna essas proteções.
- O **Paint** (JS Paint) e o **Player de Música** (Webamp) são cópias de projetos MIT dentro do hub ([docs/licencas.md](docs/licencas.md)). O Paint roda num iframe do mesmo servidor com **política de conteúdo fechada** (sem Firebase, YouTube, fontes externas nem imagens de outros sites); o Webamp é carregado direto na página do Diogows (sem iframe, mas sem usar a rede nem atalhos globais de teclado). Skins `.wsz` são arquivos de terceiros: use só os de confiança.

## Reportar uma vulnerabilidade
Abra um *security advisory* privado no GitHub (aba **Security** do repositório) em vez de uma issue pública. Descreva o problema e
como reproduzi-lo.
