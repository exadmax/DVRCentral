# Desktop (área de trabalho no navegador)

Uma **interface a mais** do Central Diogo, no molde de um WebDesktop: janelas, menu Iniciar, ícones e barra de tarefas, com login e
**vários usuários**. Fica em `http://<servidor>/desktop.html`. O painel de sempre (Início, Geladeira, Serviços, Câmeras, Vídeos, Livros,
Config) **continua como era**: nada foi trocado, o Desktop só se soma a ele.

- No painel atual há o atalho **Desktop** no rodapé (menu padrão). Se o seu menu já foi editado na Config, acrescente o atalho lá:
  *Config → aba Menu → + Adicionar atalho*, com nome "Desktop" e caminho `/desktop.html`.
- No Desktop, o menu **Iniciar** traz também **todos os atalhos do painel**, na mesma lista da Config: **Jogos (WebRCade)**, **Música
  (Navidrome)**, Geladeira, Serviços, Vídeos, Livros e os demais, e os serviços externos (Jogos, Música) ganham ícone na área de
  trabalho. Eles abrem em outra aba e usam a mesma regra de endereço do painel (porta própria, `{host}`). Nada foi removido nem duplicado.

## Primeiro acesso

Na primeira vez que o hub sobe com o banco novo, ele cria o usuário **`admin`** com uma **senha inicial sorteada**, que aparece **uma única
vez no log do hub** (não existe senha fixa no código):

```bash
sudo journalctl -u centraldiogo-hub | grep "desktop: primeira instalação"
```

No primeiro login o Desktop obriga a trocar a senha. Apagar usuários depois nunca recria o `admin` (só acontece com a tabela vazia).
Senha esquecida do único administrador: apague as linhas de `desk_users` e `desk_sessions` do banco com o hub parado e reinicie
(`sqlite3 centraldiogo.db "DELETE FROM desk_users; DELETE FROM desk_sessions;"`): um novo `admin` é sorteado e mostrado no log.

## Usuários e permissões

| O que | Administrador | Usuário comum | Usuário com Terminal / Arquivos liberados |
|---|---|---|---|
| Meu Computador (informações) | ✅ | ✅ | ✅ |
| Meus arquivos (pasta própria), visualizadores, Documentos, Vídeo, Contatos, Calendário | ✅ | ✅ | ✅ |
| Ver as câmeras (cada uma em janela própria) | ✅ | ✅ | ✅ |
| **Adicionar, renomear e remover câmeras** | ✅ | ❌ | ❌ |
| **Configurações** (a página Config do painel numa janela) | ✅ | ❌ | ❌ |
| Gerenciar usuários e liberar permissões | ✅ | ❌ | ❌ |
| Terminal | ✅ | ❌ | ✅ se o admin liberar |
| Explorer → **Computador** (arquivos do servidor) | ✅ | ❌ | ✅ se o admin liberar |
| sudo (root) no Terminal e no Explorer | ✅ com a própria senha | ❌ | ✅ com a **senha de um administrador** |

O administrador libera *Terminal* e *Arquivos do computador* usuário por usuário no app **Usuários**. Cada usuário tem a própria pasta
(**Meus arquivos**), que ninguém mais enxerga, em `desk/<id>/files/` ao lado do `hub.config.json`. Remover um usuário apaga também os
arquivos, as agendas e as preferências dele.

Senhas: PBKDF2-SHA256 com 600 mil iterações e sal por usuário. Sessão: cookie `HttpOnly` + `SameSite=Strict`, 12 h, só o hash do token fica
no banco. Todo pedido que altera algo exige o cabeçalho `X-Desk` e origem igual à do hub. Cinco senhas erradas seguidas, por IP e usuário,
bloqueiam por 5 minutos.

## Aplicativos

| App | Quem | O que faz |
|---|---|---|
| **Meu Computador** (também na área de trabalho) | todos | Sistema, CPU, memória, tempo ligado, carga, rede, discos e atalhos para as unidades no Explorer |
| **Explorer** | todos | Navega, cria pastas, envia (botão ou arrastando), renomeia, **move arrastando**, baixa e apaga. **Meus arquivos** para todos; **💻 Computador** para quem tem permissão, com o botão **🔓 sudo** para agir como root |
| **Bloco de Notas** | todos | Texto até 1 MB com **realce de cores** por tipo (JSON, log, Markdown, CSV, INI/ENV/YAML, XML/HTML, código); abre arquivos de *Meus arquivos* ou do *Computador* |
| **LiteOffice (Documentos)** | todos | Editor leve de documentos (.docx / .odt) que abre e salva nas pastas dos usuários (veja abaixo) |
| **Visualizador de Imagens / PDF** | todos | Abrem os da sua pasta ou, com permissão, os do computador (zoom, anterior/próxima, leitor de PDF do navegador) |
| **Player de Vídeo** | todos | Biblioteca de vídeos da casa (com legenda `.srt`/`.vtt`) e arquivos do Explorer; avançar e voltar, velocidade, lista de reprodução |
| **Painel de Controle** | todos (itens do admin só para ele) | Um lugar só: programas, sistema, contas, calendário, câmeras, rede e o **Config do painel aba por aba** (só admin), além de **executar os programas Windows 95/98 e DOS instalados** |
| **Instalar Programas e Acessórios** | todos | Instala programas DOS e Windows 95/98/ME na sua pasta e escolhe a engine; também liga ou desliga os acessórios do Desktop (abaixo) |
| **Navegador** | todos | Abre páginas pelo servidor e **baixa arquivos para Meus arquivos/Downloads** (abaixo) |
| **Calculadora** | todos | Acessório simples |
| **Câmeras** | todos veem; só o admin altera | Cada câmera abre numa **janela separada** (ou todas, ou em mosaico); a aba *Gerenciar* edita as câmeras (só admin) |
| **Contatos** | todos | Os profissionais da casa (mesma lista da página Serviços): busca, filtro por tipo, ligar, WhatsApp, e-mail |
| **Mensagens** | todos | Conversa entre usuários do Desktop, com envio de arquivos e imagens (arraste, cole um print ou use 📎), avisos no sino e “visto”. Ninguém envia mensagens ao administrador; ele escreve aos demais. Anexos ficam em `desk/_chat/` e podem ser salvos em *Meus arquivos/Recebidos* |
| **Calendário** | cada um o seu | Agregador de agendas iCal por usuário, com visão mensal e dos próximos dias, e **avisos** (abaixo) |
| **Terminal** | admin e liberados | Comandos no servidor, de qualquer aparelho da rede, com a opção **sudo** |
| **Usuários / Configurações / Minha conta** | admin / admin / todos | Administração, a página Config numa janela e troca de senha |

Cada janela tem minimizar, maximizar/restaurar (ou duplo clique no título) e redimensiona pelas bordas e cantos.

## Terminal e arquivos do computador (como root, se quiser)

É **execução de comando no servidor**, então tem portões, todos conferidos a cada chamada:

1. **Ligado no servidor:** `"desk": {"shell": true}` no `hub.config.json` (**desligado por padrão**). Reinicie o hub depois de mudar.
2. **Permissão:** administrador, ou usuário que o administrador liberou (Terminal e/ou Arquivos do computador, separados).
3. **Rede:** aparelhos da rede local (192.168.x.x, 10.x, 172.16–31.x) ou HTTPS. Pedido vindo da internet em HTTP puro é recusado
   (`"shellAnyNetwork": true` desfaz isso; não recomendado). Se houver um proxy no próprio servidor, vale o IP que ele repassa em `X-Forwarded-For`.
4. **Desbloqueio:** a pessoa redigita a **própria senha**; vale 15 minutos por sessão e some ao sair ou em *🔒 Bloquear*.
5. **sudo:** pede a **senha de um administrador** (a própria, se for administrador); também vale 15 minutos.

Cada login, desbloqueio, comando, listagem, leitura e gravação no computador vai para o journal com usuário e IP
(`journalctl -u centraldiogo-hub | grep desktop`). O Terminal roda como o usuário do serviço; **não tem TTY**: `top` e `vim` não funcionam
(use `top -bn1`). Limite de 5 min e 2 MB por comando. As pastas do primeiro nível (`/etc`, `/home`...) nunca são apagadas nem renomeadas.

### Habilitar o sudo (Linux)

O serviço roda com `NoNewPrivileges=true` e sem sudo. Para liberar o sudo do Desktop é preciso um passo explícito:

```bash
sudo bash install.sh --desk-shell      # sudoers NOPASSWD para o usuário do serviço + NoNewPrivileges=false (drop-in do systemd)
# e, no hub.config.json:  "desk": {"shell": true}
sudo systemctl restart centraldiogo-hub
sudo bash install.sh --no-desk-shell   # desfaz
```

> ⚠️ Isto dá ao hub o poder de root. Quem tiver a permissão **e** a senha de um administrador do Desktop passa a administrar a máquina.
> Na prática, a senha do administrador do Desktop passa a valer como senha de root: use uma senha longa e só em rede confiável.
> Em HTTP puro (rede local) as senhas trafegam sem criptografia; para sair da rede de casa use VPN ou HTTPS.

## Navegador e downloads

O **Navegador** do Desktop abre as páginas **pelo servidor**: o hub busca o site, tira scripts, objetos e iframes, e a janela mostra o resultado
sem executar nada. Os arquivos (zip, exe, iso, pdf...) não passam pelo navegador: aparece **Baixar para Meus arquivos/Downloads**, o servidor
baixa em segundo plano (com progresso, cancelamento e limite de 3 ao mesmo tempo) e, quando termina, dá para **instalar como programa** direto da lista.

Limites, sem rodeios:

- **Sem JavaScript.** Sites feitos como aplicativo (muitos de hoje) aparecem vazios ou incompletos. Páginas de texto, Wikipédia, buscas (o início usa o
  DuckDuckGo sem JS), fóruns e páginas de download funcionam bem. Vídeo e áudio embutidos são removidos (o link continua).
- Formulários só do tipo GET (buscas). Nada de login, compras ou formulários que enviam dados.
- **Só sites da internet:** o servidor não abre endereços da rede da casa nem dele mesmo, para o navegador não virar uma porta para dentro da sua rede.
- Cada download vai para a pasta do próprio usuário e é registrado no log (usuário e site). Nada baixado é executado no servidor.
- Para desligar tudo isto: `"desk": {"noBrowser": true}`.

## Instalar Programas e Acessórios (DOS e Windows 95/98/ME)

Os programas rodam **no seu navegador**, dentro do **js-dos**, que traz as engines **DOSBox** e **DOSBox-X** em WebAssembly (já dentro do hub, em
`src/vendor/js-dos`, sem internet e sem instalar nada). Cada programa abre num iframe próprio (`emulator.html`), então fechar a janela encerra o emulador.

**Escolha da engine**, cada uma com seus limites:

| Engine | Quando usar | Limitações |
|---|---|---|
| **DOSBox-X** (padrão) | Programas DOS exigentes e **Windows 95/98/ME** | A mais pesada: baixa ~8 MB, usa mais CPU e memória, pode ficar lenta em PCs fracos. Windows 9x leva um bom tempo para iniciar |
| **js-dos (DOSBox)** | Jogos e programas DOS comuns | Leve e rápida, mas **não roda Windows 9x** e tem menos recursos de compatibilidade (alguns modos de vídeo e dispositivos avançados ficam de fora) |

(Na prática as duas são o js-dos: ele é o player e escolhe entre os dois motores. Windows 9x só existe no DOSBox-X.)

**Como instalar:**

1. Traga o programa: baixe pelo **Navegador** (vai para *Downloads*) ou envie do seu computador.
2. Abra **Instalar Programas e Acessórios → Instalar programa**, escolha o arquivo e o tipo (DOS ou Windows 95/98/ME).
3. Um **.zip** com os arquivos de um programa DOS: o instalador lista os `.exe/.com/.bat` e você escolhe o que abre ao iniciar; ele monta o pacote
   em *Meus arquivos/Programas*. Um **.jsdos** pronto é registrado como está.
4. O programa entra no menu Iniciar (seção *Meus programas*), no Painel de Controle e, se quiser, na área de trabalho. *Desinstalar* apaga a pasta instalada.

**Windows 95/98/ME:** a Microsoft não distribui esses sistemas, então **o Desktop não traz nenhum**. Use um pacote `.jsdos` com o Windows já instalado
e que você tenha licença para usar (por exemplo, um que você mesmo montou). Esse caminho só aceita `.jsdos`, não `.zip`. Ele foi construído de acordo com a
documentação do js-dos, mas **não foi testado com uma imagem real do Windows 9x** (não havia uma disponível no desenvolvimento): o fluxo DOS foi testado de ponta a ponta nas duas engines.

**Acessórios:** a aba *Acessórios do Desktop* mostra os aplicativos do próprio Desktop (Documentos, Calendário, Calculadora, Player...). Desmarcar apenas o
esconde do menu e dos ícones; nada é apagado e dá para marcar de novo.

## Painel de Controle

Reúne em seções, com busca: **Programas** (instalar, acessórios e os programas instalados, que abrem com um clique), **Sistema** (Meu Computador, arquivos, Terminal),
**Contas e notificações**, **Câmeras e contatos**, **Rede e Internet** e, só para o administrador, **Configurações do painel da casa**, que abre a mesma página
Config **aba por aba** numa janela (Servidor, Câmeras, Agendas e rotas, Painel, Livros, Menu, Integrações, Idioma, Compatibilidade, Ajuda).

## Calendário e avisos

Cada usuário cadastra as **próprias agendas iCal** (Google Agenda → *Configurações da agenda* → *Endereço secreto no formato iCal*; também
vale `webcal://`). O servidor guarda a URL (que é um segredo) e a devolve **mascarada**; baixa a agenda com cache de 5 minutos e, se a origem
cair, usa a última cópia boa. Só endereços da internet são aceitos: o servidor **não baixa** de endereços da rede interna ou dele mesmo.
Até 12 agendas por usuário. Opcionalmente o calendário mostra também as **agendas da casa** (as da tela inicial).

Os **avisos** aparecem dentro do Desktop do usuário enquanto ele estiver aberto: sino na barra com contador, aviso na tela, som e, em HTTPS,
avisos do navegador. Por padrão avisa **10 minutos antes** e **na hora** do compromisso, e de manhã (8h) os de dia inteiro. Tudo se ajusta em
*Calendário → Agendas e avisos* e fica salvo na conta (acompanha o usuário em qualquer aparelho). O mesmo aviso não se repete.

## LiteOffice (.docx e .odt)

O **LiteOffice** é a opção leve do Desktop: poucos recursos de formatação, mas roda inteiro no navegador (nada pesa no servidor) e é totalmente integrado ao Explorer e às pastas dos usuários. Abre e salva `.docx` (Word) e `.odt` (LibreOffice) nas pastas dos usuários (ou no Computador, para quem tem permissão).
Também abre ao clicar no arquivo no Explorer; *📘 Novo documento* cria um na pasta atual. *Salvar como…* converte entre os dois formatos.
Funciona sem biblioteca externa (o hub não precisa de internet) e exige um navegador com `DecompressionStream('deflate-raw')` (Chrome/Edge 103+, Firefox 113+, Safari 16.4+).

**Mantém:** parágrafos, títulos 1–3, negrito, itálico, sublinhado, tachado, fonte, tamanho, cor, alinhamento, listas (com níveis e numeração
que recomeça), tabelas (com células mescladas na horizontal), links e imagens PNG/JPEG/GIF (outros formatos viram PNG ao inserir).

**Não mantém:** cabeçalho e rodapé, notas, comentários, caixas de texto, gráficos, espaçamentos e estilos avançados. Ao abrir um
documento que tenha isso, o editor **avisa** e, ao salvar por cima do original, **pergunta antes**: use *Salvar como…* para ficar com
uma cópia. Documentos protegidos por senha não abrem. Colar de outro lugar vem **limpo** (só o que o editor entende).

> O `.docx` gerado foi validado com o `python-docx`. O `.odt` foi validado na estrutura e na releitura pelo próprio editor, mas não foi aberto no
> LibreOffice durante o desenvolvimento: se algum documento sair estranho, avise.

## Configuração (`hub.config.json`)

```json
"desk": {
  "shell": false,            // liga Terminal e arquivos do computador (padrão desligado)
  "shellAnyNetwork": false,  // aceita o Terminal por HTTP puro vindo da internet (não recomendado)
  "protectSettings": false,  // alterações de Config/câmeras exigem sessão de administrador do Desktop
  "maxUploadMB": 2048,       // tamanho máximo de cada envio
  "dir": "desk",             // onde ficam as pastas dos usuários (relativo ao hub.config.json)
  "noBrowser": false,        // true tira o Navegador e os downloads
  "disabled": false          // true desliga o Desktop inteiro (/api/desk/* some)
}
```

**`protectSettings`:** a página Config e a API de câmeras do painel **continuam abertas** como sempre foram (o painel não tem login). No Desktop, só
o administrador mexe nelas. Ligando `protectSettings`, as gravações de `/api/settings/*`, `/api/admin/*` e das gravações passam a exigir uma sessão
de administrador do Desktop no mesmo navegador, inclusive vindo da própria página Config, que então só salva depois de entrar no Desktop como admin.

## API (`/api/desk/*`)

Tudo exige sessão, menos `POST /login`. Escritas exigem `X-Desk: 1`. Erros vêm como `{"error": "..."}`.

| Rota | Quem | Função |
|---|---|---|
| `POST /login`, `POST /logout`, `GET /me`, `POST /password` | todos | Sessão e senha |
| `GET/POST /admin/users`, `PATCH /admin/users/{id}`, `POST /admin/users/{id}/password`, `DELETE /admin/users/{id}` | admin | Usuários e permissões |
| `GET/PUT /admin/cameras` | admin | Câmeras (mesma validação da Config; URL mascarada) |
| `GET /fs/list`, `GET /fs/read?mode=text\|view\|download`, `PUT /fs/file`, `POST /fs/mkdir`, `POST /fs/move`, `DELETE /fs` | todos (`space=home`); permitidos (`space=machine`) | Arquivos; `sudo=1` para root; leitura com `Range` |
| `GET /shell/status`, `POST /shell/unlock`, `POST /shell/sudo`, `POST /shell/lock`, `POST /shell/run` | permitidos | Terminal e desbloqueios |
| `GET /computer`, `GET /videos`, `GET /videos/file?name=` | todos | Meu Computador e biblioteca de vídeos |
| `GET /browse?url=`, `POST /downloads`, `GET /downloads`, `DELETE /downloads/{id}` | todos (some com `noBrowser`) | Navegador interno e downloads para Meus arquivos/Downloads |
| `GET/POST /calendars`, `PUT/DELETE /calendars/{id}`, `GET /calendars/feed`, `GET/PUT /prefs` | cada usuário, só os próprios | Agendas e preferências |

## Limitações

- Programas Windows 9x e o js-dos: veja acima o que foi e o que não foi testado. O emulador pede um PC razoável; em TV ou celular não é a proposta.
- A interface do Desktop está **só em português**. O painel de sempre segue traduzido (pt, en, es, zh).
- O sudo só existe no Linux do servidor. No Windows de desenvolvimento o Terminal usa o PowerShell e o Explorer mostra as unidades (`/C:/...`).
- Funciona em navegador de computador; não foi feito para TV nem celular.
- Os dados ficam no banco (`centraldiogo.db`: usuários, sessões, agendas, preferências) e em `desk/` (arquivos). Entram no mesmo backup do banco; o `install.sh` não mexe neles.

## Onde está o código

| Parte | Arquivos |
|---|---|
| Usuários, sessões, permissões, `protectSettings` | `server/desk.go` |
| Arquivos (pasta do usuário, computador, sudo) e leitura com `Range` | `server/desk_fs.go` |
| Terminal, desbloqueio e sudo | `server/desk_shell.go`, `desk_shell_unix.go`, `desk_shell_windows.go` |
| Meu Computador, vídeos, câmeras (admin) | `server/desk_misc.go`, `desk_computer_{linux,windows,other}.go` |
| Agendas por usuário e preferências | `server/desk_calendar.go` |
| Testes | `server/desk_test.go`, `server/desk_calendar_test.go` |
| Navegador interno e downloads | `server/desk_browser.go`, `src/js/desktop/browser.js` |
| Programas, emulador e Painel de Controle | `src/js/desktop/programs.js`, `panel.js`, `src/emulator.html`, `src/vendor/js-dos/` (GPL-2.0, sem alterações) |
| Interface | `src/desktop.html`, `src/css/desktop.css`, `src/js/desktop/*.js` |
| Conversão .docx/.odt e ZIP | `src/js/desktop/docfmt.js`, `zip.js` |
