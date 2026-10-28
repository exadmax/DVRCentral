# Licenças de terceiros

O Central Diogo é distribuído sob a **GNU GPL v3** ([LICENSE](../LICENSE)). Este documento lista os componentes de terceiros que vêm junto, a licença
de cada um e onde ficam. Os componentes **MIT** e os de domínio público são compatíveis com a GPL v3. Este texto é um inventário técnico, **não é
aconselhamento jurídico**: antes de redistribuir uma versão modificada, confira você mesmo os arquivos de licença dos pacotes.

Regra do projeto para componentes novos: **GPL ou MIT** (ou equivalente permissivo), sem alterar o código de terceiros além do estritamente necessário e sempre
registrando a mudança no próprio arquivo ou aqui.

## No navegador (painel e Diogows)

| Componente | Onde | Versão | Licença | Alterações |
|---|---|---|---|---|
| **JS Paint** (Isaiah Odhner) — https://github.com/1j01/jspaint | `src/vendor/jspaint/` | commit `53be67a` (09/04/2026) | **MIT** (`src/vendor/jspaint/LICENSE.txt`) | **Só no `index.html`**: CSP fechada (tudo do próprio servidor) e remoção de `pdf.js`, Tracky Mouse e `test-news.js`. Não foram copiados: `lib/pdf.js`, `lib/tracky-mouse`, `lib/firebase.js`, o SDK do Discord, `images/about`, `images/88x31`, `images/bubblegum` e idiomas além de en, pt, pt-br, es, fr, de, it |
| **Webamp** (Jordan Eldredge) — https://github.com/captbaritone/webamp | `src/vendor/webamp/webamp.bundle.min.js` | `2.3.1` (npm) | **MIT** (campo `license` do pacote) | Nenhuma (arquivo do pacote, como publicado) |
| **EmulatorJS** (núcleos do RetroArch em WebAssembly) — https://github.com/EmulatorJS/EmulatorJS | **não vem no pacote**: carregado de `cdn.emulatorjs.org`, ou de `src/vendor/emulatorjs/data/` se você copiar | estável (CDN) | **GPL-3.0**; cada núcleo tem a licença própria (Gambatte, mGBA, Genesis Plus GX, Snes9x, Stella etc.; alguns **só para uso não comercial**: confira antes de redistribuir uma cópia) | Nenhuma ([emuladores.md](emuladores.md)) |
| **js-dos** (DOSBox e DOSBox-X em WebAssembly) | `src/vendor/js-dos/` | — | **GPL-2.0** | Nenhuma ([desktop.md](desktop.md)) |
| **ZetaJS / ZetaOffice** (allotropia) | `src/vendor/zetajs/` | — | **MIT** (o LibreOffice em si é baixado do CDN do ZetaOffice ou de uma cópia local) | Nenhuma ([desktop.md](desktop.md)) |

### Bibliotecas que vêm dentro do JS Paint (`src/vendor/jspaint/lib/`)

Cada uma tem a licença do seu autor; o `LICENSE.txt` do JS Paint cobre o código do próprio JS Paint. O que foi conferido nos cabeçalhos dos arquivos:

| Biblioteca | Licença conferida no arquivo |
|---|---|
| jQuery 3.4.1 | MIT (cabeçalho do arquivo) |
| FileSaver.js | MIT (cabeçalho do arquivo) |
| bmp.js | MIT (cabeçalho do arquivo) |
| AnyPalette 0.6.0 | MIT (cabeçalho do arquivo) |
| ImageTracer 1.2.5 | Unlicense / domínio público (cabeçalho do arquivo) |
| libtess (SGI / Google) | Licença permissiva da SGI (*SGI Free Software License B*), com avisos de copyright no arquivo |
| pako, UPNG.js, UTIF.js, gif.js, font-detective, os-gui, 98.css | **Não conferi** os cabeçalhos aqui; veja o repositório de cada um e o `LICENSE.txt` do JS Paint (https://github.com/1j01/jspaint) |

**Skins do Webamp (`.wsz`):** são arquivos de terceiros com licenças próprias, e o Diogows **não traz nenhum**: cada usuário usa os que tiver direito de usar.

## No servidor (Go)

Todas as dependências do hub estão em `server/go.mod`. As acrescentadas para o E-mail:

| Módulo | Versão | Licença |
|---|---|---|
| `github.com/emersion/go-imap/v2` | `v2.0.0-beta.8` (**beta**) | MIT |
| `github.com/emersion/go-message` | `v0.18.2` | MIT |
| `github.com/emersion/go-sasl` | `v0.0.0-20241020182733-b788ff22d5a6` | MIT |

(`golang.org/x/net/html`, usado para ler o ícone dos sites, já era dependência do hub, licença BSD de 3 cláusulas.) Os binários são estáticos (`CGO_ENABLED=0`).

## Atualizar um componente

- **Webamp:** `npm pack webamp@<versão>` e copie `built/webamp.bundle.min.js` para `src/vendor/webamp/`. Atualize a versão aqui e em `src/vendor/webamp/README.md`.
- **JS Paint:** clone o repositório, copie de novo as mesmas pastas listadas acima e **refaça o ajuste do `index.html`** (a CSP e as remoções). Teste abrir e salvar no Paint do Diogows.
- **Bibliotecas Go:** `cd server && go get <módulo>@<versão> && go mod tidy && go vet ./... && go test ./...`.
- Em qualquer caso, atualize este arquivo e [novidades.md](novidades.md).

Os serviços de terceiros que o Diogows **abre ou conecta** (WhatsApp Web, Gmail, Outlook, Google, Microsoft, Telegram etc.) têm termos próprios; o projeto não é afiliado a nenhum deles.
