# Central Diogo (Omega Diogo)

Central de informações (Tizen + Android APK). Código web único em `src/`, empacotado por plataforma.

## Widgets
- **Agenda** do dia (Google Calendar; agenda do casal - decidir se pública ou via OAuth/iCal privado)
- **Clima** de hoje (Open-Meteo, sem chave)
- **Mapa + trânsito** (deslocamento até trabalho do Diogo e da Pessoa 2)
- **Feriados** (nacional / estadual / municipal)
- **Conquistas** (`jogos.html`): dashboard de jogos, conquistas e troféus da PSN, Xbox, Steam e RetroAchievements — ver `docs/jogos.md`

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
  e expõe `/api/ics`, `/api/traffic` e `/api/games`.
- **Painel** (`src/`): HTML/JS. Aberto pelo hub (navegador), pela **TV Samsung** (`platforms/tizen`) ou pelo **APK** (`platforms/android`).
- TV e APK são só cascas (WebView) que abrem `http://192.168.0.10/`; para mudar o painel basta reenviar o hub.
