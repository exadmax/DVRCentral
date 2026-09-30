# Central Diogo (Omega Diogo)

Central de informações (Tizen + Android APK). Código web único em `src/`, empacotado por plataforma.

## Widgets
- **Agenda** do dia (Google Calendar; agenda do casal - decidir se pública ou via OAuth/iCal privado)
- **Clima** de hoje (Open-Meteo, sem chave)
- **Mapa + trânsito** (deslocamento até trabalho do Diogo e da Pessoa 2)
- **Feriados** (nacional / estadual / municipal)
- **Geladeira e Dispensa** (`estoque.html`, item do menu de atalhos): itens com quantidade e/ou kg, validade e local (freezer / geladeira / dispensa), CRUD em SQLite; a tela inicial avisa o que está vencendo — ver `docs/estoque-contatos.md`
- **Contatos** (`contatos.html`, item do menu de atalhos): profissionais e prestadores de serviço (eletricista, encanador...), CRUD em SQLite — ver `docs/estoque-contatos.md`

## Estrutura
- `src/` app web compartilhado (index.html, css, js/widgets, js/services)
- `src/config/` locais, endereços, chaves (`settings.example.json`)
- `platforms/tizen/` config.xml e build Tizen Studio (.wgt)
- `platforms/android/` projeto Capacitor (gera APK)
- `docs/` decisões e pesquisas de APIs
- `scripts/` build/empacotamento

## Rodar local
`python -m http.server 5173 --directory src` e abrir http://localhost:5173
(TV/web: palco 1920x1080 escalado; celular/retrato: coluna única; 23h-5h: modo noturno)

## Configurar
Crie `src/config/settings.js` (ignorado pelo git):
```js
window.CD_SETTINGS_LOCAL = {
  calendar: { sources: [{ who: 'diogo', url: 'https://calendar.google.com/...basic.ics' }, { who: 'pessoa2', url: '...' }] },
  traffic: { key: 'CHAVE_TOMTOM', home: { lat: -23.5, lon: -46.6 },
    diogoWork: { lat: 0, lon: 0, arriveBy: '09:00' }, pessoa2Work: { lat: 0, lon: 0, arriveBy: '09:00' } }
};
```
Sem calendário ou sem chave de trânsito, esses blocos mostram dados de EXEMPLO (etiqueta "exemplo").
Design de referência: `docs/design/` e `docs/spec-design.md`.

## Arquitetura (casa)
- **Hub** (`server/`, Go): roda no Linux "servidor" (porta 80). Serve o painel, guarda as URLs iCal e a chave do Google
  e expõe `/api/ics`, `/api/traffic` e `/api/games`. Também guarda o banco SQLite (`centraldiogo.db`) das páginas
  Geladeira e Dispensa e Contatos, via `/api/estoque` e `/api/contatos`. Compilar o hub exige Go 1.26+ (sem CGO).
  As duas páginas precisam do hub: rode localmente com `cd server && go run . -config hub.config.json`.
- **Painel** (`src/`): HTML/JS. Aberto pelo hub (navegador), pela **TV Samsung** (`platforms/tizen`) ou pelo **APK** (`platforms/android`).
- TV e APK são só cascas (WebView) que abrem `http://192.168.0.10/`; para mudar o painel basta reenviar o hub.

## Versão instalada
- O servidor guarda a versão no arquivo `VERSION` (`/opt/centraldiogo/VERSION`, ao lado do `hub.config.json`), no formato
  `MAIOR.MENOR.PATCH`, por exemplo `1.0.1`.
- Cada `sudo bash install.sh` **concluído** soma 1 ao terceiro número (`V1.0.1 -> V1.0.2`) e registra a linha em
  `install.log`. Instalação que falha no meio não muda a versão. Sem o arquivo, a primeira instalação vira `V1.0.1`.
  Para subir o primeiro ou o segundo número, edite o `VERSION` à mão (ex.: `1.1.0`); as instalações seguintes continuam
  somando no terceiro.
- Para conferir a versão instalada:
  - `bash install.sh --check` na pasta do pacote (sem sudo e sem alterar nada): mostra a instalada e a próxima;
  - `curl localhost/api/version` no servidor: `{"version":"1.0.1","installedAt":"..."}` (o `/api/health` também traz a versão);
  - rodapé do painel: "Atualizado às 21:30 · V1.0.1".
- Fora do servidor (`go run`, sem arquivo `VERSION`) o hub informa `dev`.
