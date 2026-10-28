# Atualizações dos componentes de terceiros

**Administração → Atualizações** (só o administrador) funciona como um pequeno *Windows Update* dos componentes de terceiros que vêm no Diogows: mostra a
versão **em uso** de cada um, a **mais nova** publicada e a situação. Outros guias: [licencas.md](licencas.md) · [aplicativos.md](aplicativos.md) · [novidades.md](novidades.md).

## O que é verificado

| Componente | Onde a versão nova é consultada | Atualizar |
|---|---|---|
| Webamp (Player de Música) | npm (`webamp`) | **Um clique** na tela (veja abaixo) |
| JS Paint (Paint) | GitHub (último *commit* de `1j01/jspaint`) | À mão: tem ajustes nossos no `index.html` |
| js-dos e emulators (programas DOS) | npm | À mão: os dois andam juntos |
| ZetaJS (LiteOffice Completo) | npm | À mão |
| EmulatorJS (Emuladores) | GitHub (última *release*) | Nada a fazer: o Diogows usa a estável do CDN. Só vale agir se você copiou uma versão local |
| go-imap, go-message, go-sasl (e-mail, no hub) | proxy.golang.org | À mão: exige recompilar e reinstalar o hub |

Para os componentes à mão, **Como atualizar** mostra o passo a passo. A versão **em uso** dos arquivos vem de `src/vendor/components.json` (vai no pacote do
Diogows); a das bibliotecas Go vem do próprio binário do hub. **Ao atualizar um componente à mão, atualize também o `components.json`** e [licencas.md](licencas.md).

## Quando a verificação roda

- **Botão 🔄 Verificar agora**, quando você quiser.
- **Automática**, a cada **7 dias** por padrão (a primeira, 2 minutos depois de o hub subir, se já passou o prazo). Muda com `desk.updates.checkDays` (negativo desliga; sobra o botão).
- O resultado fica guardado em `desk/_updates.json`. Ao entrar no Diogows, o **administrador** recebe um aviso se a última verificação achou algo novo (só lê o resultado, não consulta nada).

A consulta **só lê números de versão**, em **três endereços fixos** (`registry.npmjs.org`, `api.github.com` e `proxy.golang.org`); nada vem de página nem de usuário. Esses sites
veem o endereço de internet do servidor. Se isso não serve, desligue tudo com `"desk": {"updates": {"disabled": true}}` (a tela some e nada sai do servidor).
O GitHub limita consultas sem login (60 por hora): a verificação usa poucas.

## Atualizar o Webamp (um clique)

**Atualizar** faz, no hub: baixa o pacote do npm, **confere o hash sha512** que o próprio registro publica (se não bater, não instala), extrai só o arquivo
`built/webamp.bundle.min.js` e o guarda em `desk/_vendor/`. Esse arquivo **tem prioridade** sobre o do pacote e **sobrevive a uma nova instalação** (o `install.sh`
refaz a pasta `www`, não a `desk`). Reabra o Player de Música para usar a versão nova.

- **Voltar ao pacote** descarta o arquivo baixado e volta à versão que veio na instalação.
- Se uma instalação nova trouxer um Webamp **mais novo** que o baixado, o arquivo baixado deixa de valer sozinho.
- Teste depois: abrir o player, tocar uma faixa, trocar o skin. Uma versão nova pode mudar algo; por isso o botão de voltar.

## Segurança

- Só administrador (rotas `/api/desk/updates*`), com o cabeçalho `X-Desk` e a origem do hub como nas demais escritas.
- Download do npm só do prefixo `registry.npmjs.org/webamp/-/` (o endereço do pacote vem do registro e é conferido), até 40 MB, hash obrigatório (`sha512-…`).
- O arquivo novo é servido com `nosniff` e sem *cache*; o *rollback* é imediato.
- Cada verificação e cada atualização vão para o journal com o nome do administrador.

## API

| Rota (admin) | Função |
|---|---|
| `GET /api/desk/updates` | Lista com versão em uso, mais nova, situação (`atual`, `disponivel`, `informativo`, `erro`, `nao-verificado`), modo (`auto` ou `manual`) e como atualizar |
| `POST /api/desk/updates/check` | Consulta agora (devolve a lista; `409` se já há uma verificação em andamento) |
| `POST /api/desk/updates/webamp/apply` | Atualiza o Webamp (os outros respondem `400`) |
| `POST /api/desk/updates/webamp/revert` | Volta à versão do pacote |
| `GET /vendor/webamp/webamp.bundle.min.js` | O arquivo do Webamp: o baixado, se houver, senão o do pacote |

## Verificado e não verificado

- **Verificado:** testes automáticos (comparação de versões, as cinco fontes, hash errado, instalação, sobreposição mais velha que o pacote, voltar, falha de rede que mantém o último resultado, só administrador, desligado) e, no navegador com consultas **reais** ao npm, GitHub e proxy do Go: a lista, o botão de verificar e uma **atualização real do Webamp** (de 2.2.0 simulada para 2.3.1), com o player abrindo com o arquivo baixado e o *voltar ao pacote*.
- **Não verificado:** uma atualização de uma versão futura do Webamp (pode ter mudanças de API que o `music.js` não conheça), o aviso do administrador ao entrar quando há atualização de verdade (testei a lista, não o aviso) e a verificação automática semanal (depende do relógio).
- O Diogows **não atualiza sozinho** nada além do que você clicar, e não toca no próprio hub.

## Código

| Parte | Arquivo |
|---|---|
| Catálogo, consulta, instalação do Webamp, rotas | `server/desk_updates.go` (+ `desk_updates_test.go`) |
| Versões dos arquivos do pacote | `src/vendor/components.json` |
| Tela e aviso | `src/js/desktop/updates.js` |
