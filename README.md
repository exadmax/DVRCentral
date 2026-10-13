# Central Diogo (Omega Diogo)

Painel de informações da casa: agenda, clima, trânsito, feriados, câmeras ao vivo, estoque da cozinha e lista de profissionais.
Roda em qualquer navegador (TV, celular, tablet ou computador), tudo a partir de um único código web em `src/`,
servido por um **hub** em Go que fica no servidor Linux da casa ("servidor").

## Sumário
- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Começando](#começando)
- [Configuração](#configuração)
- [Implantação no servidor](#implantação-no-servidor)
- [Versão instalada](#versão-instalada)
- [Testes](#testes)
- [Documentação](#documentação)

## Funcionalidades

| Área | O que faz | Página |
|---|---|---|
| **Agenda** | Eventos do dia do casal (Google Calendar via iCal), próximo evento com contagem regressiva | Início |
| **Clima** | Temperatura, previsão e aviso de guarda-chuva (Open-Meteo, sem chave) | Início |
| **Trânsito** | Tempo até o trabalho do Diogo e da Pessoa 2, horário de saída e mini-mapa | Início |
| **Feriados** | Selo nacional / estadual / municipal, ou "Fim de semana" / "Dia útil" | Início |
| **Câmeras** | Imagem ao vivo (RTSP H.264, sem ffmpeg); no Início alternam com o Clima a cada 1 min | `camaras.html` |
| **Gravações** | 1 arquivo MP4 por hora e por câmera, contínuo ou só com movimento, com retenção por dias e GB | Câmeras → Gravações |
| **Geladeira e Dispensa** | Itens com quantidade/peso, validade e local; avisa o que está vencendo | `estoque.html` |
| **Serviços** | Profissionais (eletricista, encanador...), com sincronização opcional com Google Planilhas | `contatos.html` |
| **Vídeos** | Lista a pasta de vídeos do servidor; toca no navegador ou abre no VLC | `videos.html` |
| **Config** | CPU/memória do servidor, configuração das gravações, desligar desktop/hub | `config.html` |
| **Modo noturno** | Das 23h às 5h: tela escura com clima e eventos de amanhã | Início |

O inventário completo, com fontes de dados, endpoints e arquivos de código, está em **[docs/funcionalidades.md](docs/funcionalidades.md)**.

## Arquitetura

```
TV / celular / PC ─►  navegador  ─►  http://192.168.0.10/  ─►  Hub Go (server/)
                                                                 ├─ serve o painel (src/)
                                                       ├─ /api/*  agenda, trânsito, estoque, serviços, câmeras, vídeos, sistema
                                                       ├─ SQLite  (centraldiogo.db)
                                                       └─ guarda as chaves e senhas (nunca vão para os aparelhos)
```

- **Hub** (`server/`, Go 1.26, sem CGO): roda no Linux na porta 80, só com biblioteca padrão mais SQLite em Go puro e RTSP.
  Pensado para máquinas de 2 GB (o serviço limita a 150 MB). Guarda as URLs iCal, a chave do Google Routes, as senhas das câmeras
  e resolve o CORS do Google.
- **Painel** (`src/`): HTML e JS clássicos (sem módulos ES, para funcionar também em navegadores de TV). Aberto pelo hub em qualquer navegador.
- Para abrir na **TV**, use o navegador dela em `http://192.168.0.10/` (e na Config ligue o *Modo compatibilidade* se as câmeras não carregarem). Para mudar o painel basta reenviar o hub.
- **Sem hub**, o painel ainda abre e mostra clima e feriados; agenda e trânsito aparecem com dados de **exemplo** (etiqueta "exemplo")
  e as páginas de estoque, serviços, câmeras, vídeos e config avisam que precisam do hub.
- O hub é aberto à rede de casa, **sem login**. Não exponha à internet.

## Estrutura do repositório

| Pasta | Conteúdo |
|---|---|
| `src/` | Painel web: `*.html`, `css/`, `js/{core,services,widgets,pages}`, `config/`, `assets/` |
| `server/` | Hub em Go, testes, `hub.config.example.json`, scripts de build/instalação e unidade systemd |
| `docs/` | Documentação por área e design de referência (`docs/design/`) |
| `scripts/` | Índice de build e empacotamento ([`scripts/README.md`](scripts/README.md)) |
| `.claude/` | Agente e skill do Claude Code para operar o servidor Debian |

## Começando

### Só o painel (dados de exemplo)
```bash
python -m http.server 5173 --directory src
```
Abra http://localhost:5173. TV/web usa um palco 1920×1080 escalado; celular ou retrato usa coluna única.
Esse modo não tem hub, então só vale para ver o layout.

### Com o hub (tudo funcionando)
Requer **Go 1.26+**.
```bash
cd server
cp hub.config.example.json hub.config.json   # edite com suas URLs, chaves e câmeras
go run . -config hub.config.json
```
Abra http://localhost:8080 (`staticDir` padrão é `../src`). O banco `centraldiogo.db` é criado ao lado do `hub.config.json`.

Para o painel em outra porta falar com o hub (ex.: `python -m http.server 5173`), acrescente
`"allowedOrigins": ["http://localhost:5173"]` ao `hub.config.json`, senão as gravações são recusadas.

## Configuração

### No hub: `server/hub.config.json` (ignorado pelo git)
Referência completa em `server/hub.config.example.json`.

| Campo | Para quê |
|---|---|
| `listen`, `staticDir` | Porta (`:80` em produção) e pasta do painel |
| `calendars[]` | URLs iCal secretas do Google Calendar (`who`, `label`, `color`, `url`) |
| `traffic` | Chave do Google Routes, endereço de casa e trajetos de cada pessoa por dia da semana |
| `cameras[]` | `id`, `name` e URL RTSP (com senha; **use `subtype=1`**, H.264) |
| `recordings.dir` | Pasta das gravações (padrão `/home/usuario/securityCam`) |
| `videos.dir` | Pasta de vídeos (padrão `/home/usuario/Videos`) |
| `profissionaisSheet` | CSV do Google Planilhas e intervalo de sincronização (vazio desliga) |
| `games` | Chaves de Steam, PSN, Xbox e RetroAchievements (subsistema sem tela) |
| `dbPath`, `allowedOrigins`, `forceIPv4` | Banco SQLite, origens extras para gravar, uso de IPv4 nas consultas externas |

Depois de editar: `sudo systemctl restart centraldiogo-hub`.

### No painel: `src/config/settings.js` (opcional, ignorado pelo git)
É mesclado sobre `settings.example.js`; coloque só o que mudar.
```js
window.CD_SETTINGS_LOCAL = {
  cameras: { rotateSeconds: 60 },                 // tempo de cada câmera no rodízio
  estoque: { soonDays: 3 },                       // "a vencer" = até N dias
  night: { from: 23, until: 5 }                   // modo noturno
};
```
Também define a cidade, os atalhos do rodapé (`links`) e a porta/pasta dos vídeos (`videos`).

## Implantação no servidor

No PC de desenvolvimento:
```bash
cd server
./package.sh        # gera dist/centraldiogo.tgz (4 binários Linux + painel + instalador)
```
No servidor Linux, após copiar e extrair o pacote:
```bash
sudo bash install.sh           # instala em /opt/centraldiogo, libera a porta 80 e ativa o serviço
bash install.sh --check        # só mostra a versão instalada e a próxima (sem sudo, sem alterar nada)
```
O `install.sh` **não toca no banco**: reinstalar preserva estoque e serviços. Ele também grava a regra do polkit que permite
à página Config parar o desktop e o hub. Comandos úteis: `systemctl status centraldiogo-hub`, `journalctl -u centraldiogo-hub -f`.

**Backup do banco** (modo WAL: não copie só o `.db` com o hub rodando):
```bash
sudo systemctl stop centraldiogo-hub
cp -a /opt/centraldiogo/centraldiogo.db* ~/backup-centraldiogo/
sudo systemctl start centraldiogo-hub
```

## Versão instalada
- O servidor guarda a versão no arquivo `VERSION` (`/opt/centraldiogo/VERSION`), formato `MAIOR.MENOR.PATCH`, por exemplo `1.0.1`.
- Cada `sudo bash install.sh` **concluído** soma 1 ao terceiro número e registra a linha em `install.log`. Instalação que falha no meio
  não muda a versão. Sem o arquivo, a primeira instalação vira `V1.0.1`. Para subir o primeiro ou o segundo número, edite o `VERSION` à mão.
- Para conferir: `bash install.sh --check`, `curl localhost/api/version` (o `/api/health` também traz a versão) ou o rodapé do painel
  ("Atualizado às 21:30 · V1.0.1").
- Fora do servidor (`go run`, sem `VERSION`) o hub informa `dev`.

## Testes
```bash
cd server && go test ./...
```
Cobrem CRUD e validação de estoque/serviços, proteção de origem, sincronização da planilha, câmeras e gravador (retenção, movimento),
vídeos e legendas, trânsito, versão e métricas do sistema. O painel não tem testes automatizados.

## Documentação

| Documento | Assunto |
|---|---|
| [docs/funcionalidades.md](docs/funcionalidades.md) | **Mapa de todas as funcionalidades**, API, rotinas e código |
| [docs/cameras.md](docs/cameras.md) | Câmeras ao vivo, rodízio, gravações, modelos Intelbras |
| [docs/estoque-contatos.md](docs/estoque-contatos.md) | Geladeira, Serviços, planilha, banco, API e segurança; página Vídeos |
| [docs/jogos.md](docs/jogos.md) | Subsistema de conquistas (sem tela) |
| [docs/spec-design.md](docs/spec-design.md) | Especificação visual (TV 1920×1080) |
| [docs/decisoes.md](docs/decisoes.md) | Decisões em aberto |
| `docs/design/` | Mockups HTML e guia de estilo |
