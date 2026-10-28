# Aplicativos novos do Diogows

Guia dos aplicativos e recursos acrescentados ao Diogows (`desktop.html`) além do que está em [desktop.md](desktop.md). O **E-mail** tem guia próprio:
[email.md](email.md), e os **Emuladores** de consoles também: [emuladores.md](emuladores.md). Terceiros embutidos e licenças: [licencas.md](licencas.md). Resumo por versão: [novidades.md](novidades.md).

- [1. Programa Web](#1-programa-web)
- [2. Paint](#2-paint)
- [3. Player de Música](#3-player-de-música)
- [4. Jogos](#4-jogos)
- [5. Perfil do usuário](#5-perfil-do-usuário)
- [6. Menu Iniciar: categorias, mais usados e ícones](#6-menu-iniciar-categorias-mais-usados-e-ícones)
- [7. Mapa do código](#7-mapa-do-código)

## 1. Programa Web

Transforma qualquer endereço da web (ou um serviço da sua rede, como o WebRCade e o Navidrome) num **aplicativo do Diogows**, com ícone no menu Iniciar e,
se você quiser, na Área de Trabalho. É por usuário (fica em `Programas/programas.json`, na pasta do usuário), então o webRcade e o Navidrome de uma
máquina **não precisam vir no pacote** das outras instalações.

**Criar:** *Instalar Programas e Acessórios → ➕ Instalar programa → Onde instalar → Programa Web*.

| Campo | O que é |
|---|---|
| Atalhos prontos | WhatsApp Web, Telegram Web, Gmail e Outlook: preenchem endereço, nome, ícone e modo |
| Endereço | `https://…` ou `http://…`. `{host}` vira o endereço pelo qual você abriu o Diogows (`{host}:8080/jogos/`, `{host}:4533`); começando com `/` é do próprio servidor |
| Ícone | O **ícone do próprio site** (veja abaixo) ou um dos 16 emojis |
| Abrir em | Janela interna, janela própria do navegador ou outra aba (veja abaixo) |
| Categoria | Em qual grupo do menu Iniciar aparece (existente ou nova; seção 6) |
| Nome / atalho | Nome do item e se aparece na Área de Trabalho |

**Ícone do próprio site.** Ao terminar de digitar o endereço (ou clicar num atalho pronto), o Diogows pede ao servidor que procure o ícone da página
(`apple-touch-icon`, `<link rel="icon">`, até `/favicon.ico`). O navegador não pode ler ícones de outros sites; por isso é o **servidor** quem busca,
só em endereços da internet (como o Navegador interno). O ícone é reduzido para 64×64 PNG e guardado dentro do `programas.json`. Aparece como primeira
opção, já selecionado, com a mensagem *Usando o ícone do próprio site*; sem ícone aparece *O site não tem um ícone próprio…* e vale a escolha de emoji.

**Modos de abertura.**

| Modo | Quando usar | Observações |
|---|---|---|
| **Janela interna do Diogows** | Sites que aceitam ser exibidos dentro de outra página (seus serviços da rede, o WebRCade, o Navidrome) | Janela com ↻ recarregar, ⛶ tela cheia e ↗ abrir em outra aba. Se a página ficar em branco, o site proíbe a exibição interna (`X-Frame-Options`/`frame-ancestors`): use o ↗ ou outro modo |
| **Janela própria do navegador (compacta)** | Sites que **proíbem** a janela interna, como o **WhatsApp Web** | Abre uma janela só do site, sem abas nem barra de endereço, centralizada. O navegador pode pedir para liberar *pop-ups* na primeira vez |
| **Fora do app (outra aba)** | O comportamento de sempre dos atalhos do painel | — |

O modo pode ser trocado depois na lista de **Programas instalados** (coluna *Engine / abre em*).

> **WhatsApp Web não cabe numa janela interna.** O site responde com `Content-Security-Policy: frame-ancestors https://*.whatsapp.com`, que só permite ser
> exibido dentro dele mesmo, e o Diogows **não contorna** essa proteção (nem com proxy). Por isso o atalho pronto usa a *janela própria do navegador*. Você
> precisa entrar com o QR Code como em qualquer navegador; nada do WhatsApp passa pelo servidor.

**Limites e cuidados.** Só `http` e `https` são aceitos (`javascript:`, `data:` e `file:` são recusados). Numa página **https** do Diogows, um endereço
`http://` não pode ser embutido (o navegador bloqueia): ele abre sempre em outra aba. A janela interna não usa `sandbox`, então a página embutida roda com
os mesmos poderes de uma aba normal: **cadastre só endereços em que você confia**.

## 2. Paint

O **JS Paint** (https://github.com/1j01/jspaint, licença **MIT**) é um clone fiel do MS Paint em JavaScript. Fica em `src/vendor/jspaint/`, roda no navegador
e **não usa a internet**.

- **Menu Iniciar → Imagem, vídeo e música → Paint**, ou o ícone da Área de Trabalho. No **Explorer**, botão direito numa imagem → **Editar no Paint**.
- Ferramentas clássicas: lápis, pincéis, aerógrafo, borracha, balde, conta-gotas, lupa, linhas, curvas, retângulos, elipses, polígonos, texto, seleção livre e retangular, rotação, inversão, esticar/inclinar, atributos da imagem, paleta editável, **desfazer em árvore**, imagem transparente. Interface em **português** (o Diogows ajusta o idioma do Paint na primeira abertura; dá para trocar em *Extras → Idioma*).
- **Abrir/Salvar** usam os seus arquivos: *Arquivo → Abrir* escolhe uma imagem de **Meus arquivos**; *Salvar como* pergunta nome, **formato** (PNG, JPEG, GIF, BMP, WebP, TIFF…) e pasta (padrão `Imagens`, que o Diogows cria); *Salvar* grava no mesmo arquivo (e confirma antes de substituir um que já exista). Fechar a janela com alterações pergunta se quer salvar.
- *Arquivo → Definir como plano de fundo* grava a imagem em `Meus arquivos/Imagens/plano-de-fundo.png`; use-a em *Personalizar → Fundo da Área de Trabalho*.
- **Privacidade:** a política de conteúdo do Paint foi fechada (só o próprio servidor): sem Firebase/sessões multiusuário, YouTube, Google Fonts, Imgur nem imagens de outros sites.

O que **não** veio na cópia: leitura de PDF (`pdf.js`), controle por câmera (Tracky Mouse, que também abre o modo de olhar/rastreio de cabeça) e o tema *Bubblegum*
(as imagens dele pesavam ~7 MB; o tema aparece sem as bordas se escolhido). Só os idiomas en, pt, pt-br, es, fr, de e it estão incluídos.

## 3. Player de Música

O **Webamp** (um Winamp 2 em JavaScript, MIT, https://github.com/captbaritone/webamp) em `src/vendor/webamp/`, **solto sobre a área de trabalho**: o player, o equalizador e a lista são janelas do próprio Webamp, que se arrastam livremente como no Winamp (ficam acima das janelas do Diogows). Uma janelinha do Diogows, *Player de Música*, guarda os botões e dá o item na barra de tarefas: **minimizar** esconde o Webamp, **fechar** (ou o ✕ do player) o encerra e para a música. Os atalhos de teclado do Webamp ficam desligados, para não roubar teclas de outros aplicativos.

- Toca **mp3, m4a, ogg, wav e flac** (os tipos que o servidor entrega como áudio) da pasta **Meus arquivos/Músicas** e subpastas (até 3 níveis e 3000 faixas). A pasta é criada na primeira abertura.
- **⬆ Enviar músicas** manda arquivos do aparelho para `Músicas`; **📂 Da minha pasta** acrescenta uma faixa de qualquer lugar de Meus arquivos; **🎨 Skin** troca a aparência por um `.wsz` (a escolha fica na conta); **🔄 Recarregar pasta** lê de novo.
- Tem playlist, equalizador, janelas destacáveis, leitura de etiquetas ID3 (artista e título) e duração das faixas.
- Sem a nuvem, sem visualizador Milkdrop (o pacote `butterchurn` não foi incluído).
- As músicas são lidas por `Range`, então dá para pular dentro da faixa.

O app de **Vídeo** continua tocando áudio também; o Player de Música é o jeito "Winamp".

## 4. Jogos

Categoria **Jogos** do menu Iniciar. Rodam inteiros no navegador, sem servidor; nada é gravado além do melhor tempo do Campo Minado (no navegador do aparelho).

| Jogo | Resumo |
|---|---|
| **Campo Minado** | Iniciante 9×9 (10 minas), Intermediário 16×16 (40) e Especialista 30×16 (99). O **primeiro clique nunca é mina nem fica ao lado de uma**. Bandeira: botão direito, **toque longo** ou o botão 🚩. Clicar num número já aberto, com as bandeiras certas ao redor, abre os vizinhos. Cronômetro, contador de minas, carinha de reinício e **melhor tempo por nível** |
| **Paciência** (Klondike) | Comprar 1 ou 3 cartas; recicla o monte; vira sozinha a carta exposta; desfazer ilimitado; novo jogo |
| **FreeCell** | 4 células, 4 fundações, 8 colunas; move sequências respeitando o limite `(células livres + 1) × 2^(colunas vazias)`; **⚡ Auto** manda para as fundações tudo que já pode ir; desfazer |

**Cartas:** clique na carta (e nas de baixo dela) e depois no destino; **duplo clique** manda para a fundação. Funciona igual com toque.
Os baralhos são embaralhados no navegador (`Math.random`); não são as "partidas numeradas" do Windows.

## 5. Perfil do usuário

Em **Minha conta → Perfil (opcional)**:

| Campo | Regras |
|---|---|
| Nome e sobrenome | Até 40 caracteres cada, sem quebra de linha. Sem nome vale o **nome de usuário** |
| Foto | JPEG ou PNG; o navegador a corta em quadrado e reduz para 256×256 JPEG antes de enviar (o servidor aceita até 400 KB e 2048 px). Sem foto aparecem as **iniciais numa bolinha colorida** |
| Usar meu nome nos e-mails | Põe `"Nome Sobrenome" <email>` no remetente e a assinatura no fim das mensagens novas do [E-mail](email.md) |
| Assinatura | Até 500 caracteres e 8 linhas; vazia, vale o nome completo |

**Onde aparece:** no aplicativo **Mensagens** (lista de conversas com foto e nome, cabeçalho da conversa com o `@usuario` ao lado, e os avisos do sino), na **barra de tarefas** e no cabeçalho do menu Iniciar. As fotos são visíveis a qualquer usuário logado.

**Detalhes técnicos:** tabela `desk_profiles` (criada sozinha na primeira subida; some junto com o usuário); rotas `GET/PUT /api/desk/profile`, `PUT/DELETE /api/desk/profile/photo` e `GET /api/desk/avatar/{id}` (imagem inerte: `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, cache por versão). Só JPEG/PNG **decodificáveis** são aceitos: SVG e arquivos disfarçados são recusados. `GET /api/desk/me` passou a devolver o bloco `profile`.

## 6. Menu Iniciar: categorias, mais usados e ícones

### Categorias

Da mais usada à menos: **Arquivos e sistema**, **Comunicação** (E-mail, Mensagens, Calendário, Contatos), **Escritório**, **Internet**, **Imagem, vídeo e música**
(Imagens, Paint, Vídeo, Música, Câmeras), **Jogos**, as **suas categorias**, **Meus programas (DOS, Windows e web)**, **Painel e serviços da casa** e **Administração e conta**.
Só aparecem as categorias que têm itens. Por padrão ficam abertas *Arquivos e sistema*, *Comunicação* e *Escritório*; o estado de abre/fecha fica na conta.

- **⭐ Mais usados** (no topo): itens abertos **3 vezes ou mais** pelo menu, no máximo 5. A contagem fica nas preferências (guarda os 60 mais abertos).
- **Expandir tudo / Recolher tudo**: abre ou fecha todas as categorias de uma vez.
- **Busca:** acha pelo nome do item **ou da categoria** e mostra, ao lado de cada resultado, a categoria a que pertence.

### Categoria de tudo que se instala

Ao instalar um **programa DOS**, um **sistema virtual (Windows)** ou um **Programa Web**, o formulário traz **Categoria no menu Iniciar**: escolha uma das existentes
(inclusive *Internet*, *Jogos*…) ou **➕ Nova categoria…** (nome de até 30 caracteres e um emoji). Depois dá para **trocar a categoria** na lista de instalados.
Você pode ter até **12 categorias criadas**; categorias vazias não aparecem no menu; criar uma com nome já existente reaproveita a que existe. Ficam nas preferências da conta, então
acompanham o usuário em qualquer aparelho. (O limite das preferências é 32 KB.)

### Ícones

Um item do menu pode ter **emoji** ou **imagem PNG** (o ícone próprio de um Programa Web). O Diogows só aceita imagens em `data:image/png;base64,…` (até ~45 KB); qualquer outro valor cai
no emoji. A imagem aparece no menu Iniciar, na Área de Trabalho, no menu de contexto, no Painel de Controle e na lista de instalados.

## 7. Mapa do código

| Parte | Arquivos |
|---|---|
| Programa Web (formulário, modos, atalhos, ícone do site, categorias) | `src/js/desktop/programs.js` |
| Busca do ícone no servidor | `server/desk_webicon.go` (+ `desk_webicon_test.go`) |
| Paint | `src/js/desktop/paint.js`, `src/vendor/jspaint/` (MIT, `index.html` ajustado) |
| Player de Música | `src/js/desktop/music.js`, `src/vendor/webamp/`, `src/css/desktop.css` (seção *Player de Música*) |
| Jogos | `src/js/desktop/games.js` |
| Emuladores | `src/js/desktop/emulators.js`, `src/emu.html` ([emuladores.md](emuladores.md)) |
| Perfil | `server/desk_profile.go` (+ `desk_profile_test.go`), `src/js/desktop/admin.js` (Minha conta), `messages.js`, `core.js` (`DK.avatar`, `DK.displayName`) |
| Menu Iniciar e ícones | `src/js/desktop/boot.js` (categorias, mais usados), `core.js` (`DK.iconNode`), `shell.js`, `panel.js` |
| Estilos | `src/css/desktop.css` (seções *Jogos*, *E-mail*, *Perfil*, *Menu Iniciar*) |
