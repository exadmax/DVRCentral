# Mapa de funcionalidades

Inventário de tudo que o sistema faz, de onde vem e onde está o código. Para o passo a passo de cada área, siga os links
para os outros documentos de `docs/`.

Legenda de **Precisa do hub**: ✅ só funciona com o hub no ar · ➖ funciona sem ele (com dados de exemplo ou direto nas APIs públicas).

## 1. Visão geral

```
 TV Samsung (platforms/tizen) ─┐
 APK Central (platforms/android)├─ WebView ──►  http://192.168.0.10/  ──►  Hub Go (server/)  ──►  SQLite, RTSP, Google, TomTom/Google Routes,
 Navegador / celular ──────────┘                                            serve src/ + /api/*       Steam, PSN, Xbox, RetroAchievements
 APK Cadastro Casa (cadastro-apk) ── HTTP/JSON ──► /api/estoque, /api/contatos
```

| Parte | Pasta | Tecnologia |
|---|---|---|
| Painel web (único para todas as telas) | `src/` | HTML + JS clássico (sem módulos ES, roda via `file://` na TV), CSS |
| Hub (servidor + API) | `server/` | Go 1.26, só biblioteca padrão + `modernc.org/sqlite`, `gortsplib`, `mediacommon` |
| Casca TV Samsung | `platforms/tizen/app/` | App web Tizen que abre o hub em tela cheia |
| Casca Android | `platforms/android/` | Java puro + WebView, sem Gradle |
| App de cadastro | `cadastro-apk/` | Java puro, sem WebView, ~45 KB |

## 2. Páginas e funcionalidades do painel

| Página | Arquivo | Atalho | Precisa do hub | O que faz |
|---|---|---|---|---|
| **Início** | `index.html` + `js/core/app.js` | — | ➖ | Painel passivo: relógio, selo de feriado, clima, agenda, trânsito, rodízio de câmeras, atalhos e rodapé |
| **Geladeira e Dispensa** | `estoque.html` + `js/pages/estoque.js` | Geladeira | ✅ | CRUD de itens com quantidade/peso, validade e local; filtros e busca |
| **Serviços** | `contatos.html` + `js/pages/contatos.js` | Serviços | ✅ | CRUD de profissionais (eletricista, encanador...); sincroniza com Google Planilhas |
| **Câmeras** | `camaras.html` + `js/pages/camaras.js` | Câmeras | ✅ | Imagem ao vivo de cada câmera e lista de gravações (assistir/baixar) |
| **Vídeos** | `videos.html` + `js/pages/videos.js` | Vídeos | ✅ | Lista a pasta de vídeos; tocar no navegador, abrir no VLC, copiar link |
| **Config** | `config.html` + `js/pages/config.js` | Config | ✅ | CPU/memória do servidor, botões de energia e configuração das gravações |
| Jogos (externo) | — | Jogos | ➖ | Abre o WebRCade (porta 8080) |
| Música (externo) | — | Música | ➖ | Abre o Navidrome (porta 4533) |

As páginas avulsas usam `js/pages/boot.js`, que lê `<body data-page="...">`, desenha o cabeçalho com botão de voltar, detecta o hub
(`/api/health`) e chama o `mount()` do módulo correspondente em `CD.pages`.

### 2.1 Tela inicial (Início)

| Função | Descrição | Fonte de dados | Código |
|---|---|---|---|
| Relógio e data | Hora grande e data por extenso em pt-BR; redesenha a cada 30 s | relógio local | `core/app.js`, `core/util.js` |
| Selo de feriado | Feriado nacional/estadual/municipal (cor por tipo), "Fim de semana" ou "Dia útil" | BrasilAPI + `config/holidays-sp.js` | `widgets/holidays.js`, `services/holidaysApi.js` |
| Clima | Temperatura atual, previsão do dia, alerta "leve guarda-chuva", mín/máx de amanhã | Open-Meteo (sem chave) | `widgets/weather.js`, `services/weatherApi.js` |
| Agenda do dia | Eventos do casal por cor/pessoa, próximo evento com contagem regressiva, rolagem automática se longa; suporta recorrência iCal (RRULE, EXDATE, COUNT, `nº` dia da semana) | Google Calendar (iCal) via `/api/ics` | `widgets/agenda.js`, `services/calendar.js` |
| Trânsito | Tempo até o trabalho (Pessoa 2 automático na janela da manhã; Diogo sob demanda por 10 min via "Ver trânsito"), nível livre/moderado/congestionado, horário de saída, mini-mapa do trajeto | Google Routes via `/api/traffic` | `widgets/map.js`, `services/trafficApi.js` |
| Rodízio Clima ↔ Câmeras | O card do meio alterna Clima e cada câmera (60 s cada; `?rotate=15` acelera para teste). Para no modo noturno e com a aba escondida | `/api/cameras` | `widgets/cameras.js`, `services/cameraPlayer.js` |
| Atalhos | Rodapé com os links; o da Geladeira vira alerta | `settings.js` (`links`) | `widgets/links.js` |
| Alerta de validades | "1 vencido · 3 a vencer" / "Tudo em dia" no atalho Geladeira | `/api/estoque` | `widgets/expiring.js`, `core/stock.js` |
| Rodapé | "Atualizado às HH:MM · V1.0.x" e uso de CPU/memória do hub | `/api/health`, `/api/system` | `widgets/holidays.js` (`footer`, `sysText`) |
| Modo noturno | Das 23h às 5h (configurável): tela escura com clima e eventos de amanhã; botão para desligar até o fim da noite | relógio | `widgets/night.js`, `core/app.js` |
| Anti burn-in | Desloca o conteúdo ±4 px a cada 3 min | — | `core/app.js` (`shift`) |
| Escala TV/celular | Palco fixo 1920×1080 escalado para caber; coluna única se largura < 900 px ou retrato | — | `core/app.js` (`fit`) |
| Controle remoto | **OK** atualiza tudo; **Voltar** (tecla 10009) sai do app / fecha o iframe | — | `core/app.js` |
| Funcionamento offline | Sem internet usa o último clima em cache (`localStorage`) e marca como desatualizado | — | `core/app.js`, `core/util.js` |
| Sem configuração | Agenda e trânsito mostram dados de **exemplo** com a etiqueta "exemplo" | — | `services/calendar.js`, `services/trafficApi.js` |

Intervalos de atualização: clima a cada `refreshMinutes` (15), trânsito 5 min, agenda 5 min, feriados 6 h, estoque 5 min,
sistema 10 s, tela 30 s.

### 2.2 Geladeira e Dispensa
- Campos: nome, quantidade e/ou peso (kg), validade, local (`freezer`, `geladeira`, `dispensa`). Detalhes e regras em
  [estoque-contatos.md](estoque-contatos.md).
- Lista ordenada pela validade, filtro por local, busca por nome, formulário em janela (`core/ui.js`, sem `<dialog>` nativo).
- Cor da validade: vermelho (vencido), âmbar (até `estoque.soonDays` dias, padrão 3), verde.

### 2.3 Serviços
- Campos: nome, tipo de serviço, contato (vira link `tel:`/`mailto:`/site), indicação, serviço, obs.
- Filtros por tipo, busca em todos os campos, tipos já usados sugeridos no formulário.
- Sincronização opcional com uma aba do Google Planilhas (planilha é a fonte; edições locais são sobrescritas).

### 2.4 Câmeras
- Vídeo ao vivo (H.264, MSE, sem áudio), um bloco por câmera com o nome em cima. Para quando a aba fica em segundo plano.
- Aba **Gravações**: lista por dia com filtro por câmera, **Assistir** (player com barra de busca) e **Baixar**.
- Detalhes, configuração das câmeras Intelbras e limites em [cameras.md](cameras.md).

### 2.5 Vídeos
- Lista a pasta de vídeos do servidor (mais recentes primeiro), com tamanho, data e indicação de legenda.
- **Tocar aqui** (mp4/webm/mov/mkv, legenda `.srt`/`.vtt`), **Abrir no VLC** (intent no Android, `vlc-x-callback` no iOS, `.m3u` no PC), **Copiar link**, **Link direto**.
- Os arquivos são entregues pelo nginx em `:8080/videos/`; o hub só lista os nomes.

### 2.6 Config
- Medidores: CPU e memória do hub e da máquina (atualiza a cada 5 s).
- **Gravação das câmeras**: chave geral e, por câmera: liga/desliga, modo (contínuo ou só movimento), sensibilidade 1–5, guardar por N dias, limite em GB.
- **Liberar memória**: *Desligar o desktop* (display manager) e *Desativar a central* (para o hub). Exigem dois toques (botão arma por 5 s, o segundo confirma) e só funcionam no Linux com a regra do polkit instalada pelo `install.sh`.

## 3. API do hub

Todas as rotas respondem JSON (exceto vídeo/arquivos) com `Cache-Control: no-store` e CORS aberto (o hub só é acessível na rede de casa).

| Método e caminho | Função | Código |
|---|---|---|
| `GET /api/health` | `{ok, time, version}` — usado pelo painel para detectar o hub | `main.go` |
| `GET /api/version` | `{version, installedAt}` do arquivo `VERSION` (`dev` fora do servidor) | `main.go`, `version.go` |
| `GET /api/ics` | Texto iCal de cada agenda configurada (com cache e fallback "stale") | `calendars.go` |
| `GET /api/traffic[?diogo=1]` | Tempo de trajeto, nível, trajeto codificado; Diogo só com `?diogo=1` | `traffic.go` |
| `GET /api/games[?refresh=1]` | Conquistas/troféus Steam, PSN, Xbox, RetroAchievements (subsistema sem tela; ver [jogos.md](jogos.md)) | `games*.go` |
| `GET /api/games/xbox-login` · `POST` `{url}` | URL de login Microsoft · conclui a autorização do Xbox | `main.go`, `games_xbox.go` |
| `GET/POST /api/estoque` · `GET/PUT/DELETE /api/estoque/{id}` | CRUD de itens | `db.go`, `estoque.go` |
| `GET/POST /api/contatos` · `GET/PUT/DELETE /api/contatos/{id}` | CRUD de profissionais | `db.go`, `contatos.go` |
| `GET /api/cameras` | `[{id, name}]` (a URL RTSP com senha nunca sai do hub) | `cameras.go` |
| `GET /api/cameras/{id}/stream` | MP4 fragmentado contínuo (cabeçalho `X-Codec`) | `cameras.go` |
| `GET /api/recordings` | Lista dos arquivos de gravação | `recorder.go` |
| `GET /api/recordings/file/{nome}[?download=1]` | Arquivo MP4 com suporte a Range | `recorder.go` |
| `GET /api/recordings/settings` | Estado e configuração das gravações, por câmera | `recorder.go` |
| `PUT /api/recordings/settings` | Altera a configuração (exige `X-CD-Action: confirm`) | `recorder.go` |
| `GET /api/recordings/drive` | Estado da cópia diária para o Drive | `drive.go` |
| `POST /api/recordings/drive/run` | Copia para o Drive agora; corpo opcional `{"cameras":[ids]}` (exige `X-CD-Action: confirm`) | `drive.go` |
| `POST /api/recordings/drive/skip` | Marca como já enviadas as pendentes mais velhas que N dias (exige `X-CD-Action: confirm`) | `drive.go` |
| `GET /api/videos` | Lista da pasta de vídeos | `videos.go` |
| `GET /api/videos/sub?name=` | Legenda do vídeo em WebVTT (converte SRT) | `videos.go` |
| `GET /api/system` | CPU/memória da máquina e do hub, `control`, `desktop` | `sysinfo.go` |
| `POST /api/admin/desktop-off` | Para o display manager (exige `X-CD-Action: confirm`) | `power.go` |
| `POST /api/admin/hub-off` | Para o serviço do hub (exige `X-CD-Action: confirm`) | `power.go` |
| `/` | Arquivos estáticos do painel (`staticDir`), com `Cache-Control: no-cache` | `main.go` |

### Proteções de escrita
- `/api/estoque` e `/api/contatos`: exigem `Content-Type: application/json` e, se o navegador mandar `Origin`, ele precisa ser o do próprio hub ou estar em `allowedOrigins` (`db.go: checkWrite`).
- Gravações e botões de energia: exigem o cabeçalho `X-CD-Action: confirm`, que um formulário de outro site não consegue enviar sem preflight.
- Corpos de requisição limitados (64 KB); nomes de arquivo vindos da URL nunca viram caminho livre (validados por regex/lista).

## 4. Rotinas em segundo plano do hub

| Rotina | Frequência | O que faz | Código |
|---|---|---|---|
| Atualização de jogos | ao iniciar e a cada `games.cacheMinutes` (360) | Consulta as 4 plataformas e grava cache/tokens em `games.state.json` | `games.go: loop/refresh` |
| Sincronização da planilha | ao iniciar e a cada `profissionaisSheet.minutes` (5) | Baixa o CSV, cria/atualiza/apaga profissionais; não altera nada se a planilha falhar ou vier vazia | `sheet.go: sheetLoop` |
| Amostragem do sistema | 3 s | Lê CPU/memória (Linux `/proc`, Windows API); consulta o desktop a cada 4ª amostra | `sysinfo.go: loop` |
| Varredura das gravações | 10 min e a cada mudança de configuração | Apaga gravações vencidas e aplica o limite de GB (só arquivos com o padrão de nome) | `recorder.go: sweep` |
| Sessão RTSP das câmeras | sob demanda | Abre a câmera quando há espectador ou gravação; fecha 15 s após o último; reconecta em 4 s se cair | `cameras.go: run/session` |
| Detecção de movimento | por quadro | Compara o tamanho do quadro P com a média; dispara com 3 de 8 quadros acima do limite; pré-roll até o quadro-chave e 15 s de cauda | `motion.go` |
| Rotação de arquivo | virada da hora | Fecha o MP4 e abre o seguinte no primeiro quadro-chave | `recorder.go: rotateLocked` |
| Cópia para o Google Drive | diária às 3:00 (`driveSync.hour`); confere a cada minuto | Envia as gravações novas (das câmeras com o envio ligado na página Config) com rclone para `CameraSeguranca/AAAA-MM-DD/CAMERA/`; divide arquivos acima de `maxFileMB`; apaga do Drive o que passou da retenção da câmera (a da página Config); até 3 tentativas se falhar (1 h e 4 h depois), até 1:00 do dia seguinte | `drive.go: start/run` |

## 5. Mapa do código

### 5.1 Hub (`server/`)

| Arquivo | Responsabilidade |
|---|---|
| `main.go` | Config (`hub.config.json`), rotas, CORS, servidor de arquivos, flag `-xbox-login` |
| `db.go` | Abertura do SQLite, migrações versionadas (`PRAGMA user_version`), CRUD genérico `crud`, `checkWrite` |
| `estoque.go` / `contatos.go` | Validação (`clean`) e SQL de itens e profissionais |
| `sheet.go` | Parser do CSV (cabeçalhos tolerantes), sincronização `syncContatos`, laço `sheetLoop` |
| `calendars.go` | Baixa as URLs iCal com cache, devolve a última boa se o Google falhar |
| `traffic.go` | Google Routes: janelas de consulta, cache, nível de trânsito, polilinha decodificada e amostrada |
| `cameras.go` | Sessão RTSP compartilhada, MP4 fragmentado, cache do último GOP, `stream` HTTP |
| `recorder.go` | Gerente de gravações (`recMgr`), gravador por câmera, retenção, API de configuração e arquivos |
| `drive.go` | Cópia diária das gravações para o Google Drive (rclone), divisão de MP4 grande em partes, estado em `drive.state.json` |
| `motion.go` | Detector de movimento por tamanho de quadro |
| `videos.go` | Listagem de vídeos e conversão SRT → VTT |
| `sysinfo.go` + `_linux/_windows/_other.go` | Amostragem de CPU/memória por plataforma |
| `power.go` | Parar desktop/hub via `systemctl` (polkit) |
| `games.go`, `games_psn.go`, `games_xbox.go`, `games_steam.go`, `games_retro.go` | Agregador de conquistas e um cliente por plataforma |
| `version.go` | Lê o arquivo `VERSION` |
| `install.sh`, `build.sh`, `package.sh`, `centraldiogo-hub.service` | Compilar (4 arquiteturas Linux), empacotar e instalar como serviço |

### 5.2 Painel (`src/`)

| Camada | Arquivos | Exporta |
|---|---|---|
| Núcleo | `core/util.js`, `core/icons.js`, `core/ui.js`, `core/stock.js`, `core/app.js` | `CD.util`, `CD.icons`, `CD.ui` (modal/campos), `CD.stock` (regras de validade), `CD.state` + laço principal |
| Serviços | `services/weatherApi.js`, `holidaysApi.js`, `trafficApi.js`, `calendar.js`, `hubApi.js`, `cameraPlayer.js` | `CD.weatherApi`, `CD.holidaysApi`, `CD.trafficApi`, `CD.calendar`, `CD.hubApi`, `CD.cameraPlayer` |
| Widgets (Início) | `widgets/agenda.js`, `weather.js`, `map.js`, `holidays.js` (selo + rodapé), `expiring.js`, `links.js`, `cameras.js`, `night.js` | `CD.widgets.*` |
| Páginas | `pages/boot.js`, `estoque.js`, `contatos.js`, `camaras.js`, `videos.js`, `config.js` | `CD.pages.*` (cada uma com `label`, `sub`, `icon`, `mount`) |
| Configuração | `config/settings.example.js` (padrões), `config/settings.js` (local, ignorado pelo git), `config/holidays-sp.js` | `CD_SETTINGS`, `CD_SETTINGS_LOCAL`, `CD_LOCAL_HOLIDAYS` |
| Estilo | `css/main.css`, `css/pages.css` | — |

`hubApi.js` é o único ponto que fala com o hub nas páginas: `estoque`, `contatos` (CRUD), `cameras`, `recordings`, `videos`, `system`, `power`.
Erros viram `Error` com a mensagem do servidor; há timeout de 12 s.

### 5.3 Plataformas e ferramentas

| Item | Função |
|---|---|
| `platforms/tizen/app/` | Casca da TV: abre o hub em tela cheia, testa a conexão a cada 10 s, mantém a tela acesa, sai com Voltar |
| `platforms/android/` | Casca Android (WebView) em `central-diogo.apk`; `build.sh [URL]` |
| `cadastro-apk/` | App nativo "Cadastro Casa": abas Geladeira/Serviços, busca, criar/editar/excluir; engrenagem para o endereço do hub |
| `.claude/agents/operador-infra-servidor.md` | Agente do Claude Code para operar o servidor via SSH |
| `.claude/skills/debian/` | Skill de administração Debian |

## 6. Configuração

| Arquivo | Onde | O que guarda |
|---|---|---|
| `hub.config.json` | servidor (`/opt/centraldiogo/`) | Porta, pasta do painel, agendas iCal, trânsito, câmeras (RTSP com senha), chaves de jogos, planilha, pastas de vídeos/gravações, `dbPath`, `allowedOrigins`. **Nunca versionar** (está no `.gitignore`) |
| `hub.config.example.json` | repositório | Modelo para copiar |
| `settings.js` | `src/config/` | Local, cidade, atalhos, `cameras.rotateSeconds`, `estoque.soonDays`, `videos`, modo noturno, `hub.url` (TV/APK) |
| `VERSION` | servidor | `MAIOR.MENOR.PATCH`; o `install.sh` soma 1 ao último número |
| `centraldiogo.db` | servidor | SQLite (WAL) com `itens` e `contatos`; o `install.sh` não mexe |
| `recordings.state.json` | servidor | Configuração das gravações por câmera |
| `drive.state.json` | servidor | Gravações já copiadas para o Drive e resultado da última rodada |
| `games.state.json` | servidor | Cache e tokens dos jogos (permissão 600) |

## 7. Testes

34 testes em Go (`cd server && go test ./...`): estoque/contatos/CRUD e proteção de origem (`store_test.go`), planilha (`sheet_test.go`),
câmeras (`cameras_test.go`), gravador, retenção e movimento (`recorder_test.go`), vídeos e legendas (`videos_test.go`), trânsito
(`traffic_test.go`), versão (`version_test.go`), sistema (`sysinfo_test.go`) e jogos (`games_test.go`). O painel não tem testes automatizados.
