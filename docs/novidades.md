# Novidades do Diogows (rascunho das notas da próxima versão)

Resumo de tudo que foi acrescentado depois da `v1.0.0-rc.2`, no formato das notas de release de [versionamento.md](versionamento.md)
(*Novidades*, *Correções*, *Atenção ao atualizar*). Pela política de versionamento isto é uma versão **MENOR** (apps novos, nada quebra): sugestão **`v1.1.0`**.
Este arquivo é um rascunho: a tag e as notas oficiais saem da `main`, como descrito lá.

Guias: [email.md](email.md) · [aplicativos.md](aplicativos.md) · [desktop.md](desktop.md) · [licencas.md](licencas.md) · [SECURITY.md](../SECURITY.md).

## Novidades

### Aplicativos

| Novo | O que é | Guia |
|---|---|---|
| **E-mail** | Cliente de e-mail com várias contas por usuário, IMAP/SMTP (TLS ou STARTTLS), login **OAuth 2.0** para **Gmail** e **Microsoft/Outlook** (com o aplicativo OAuth de cada usuário), leitura segura de HTML, anexos, escrever/responder/encaminhar | [email.md](email.md) |
| **Paint** | O **JS Paint** (MIT), um clone do MS Paint, abrindo e salvando em Meus arquivos; *Editar no Paint* no Explorer | [aplicativos.md §2](aplicativos.md#2-paint) |
| **Player de Música** | O **Webamp** (MIT, estilo Winamp) tocando a pasta *Meus arquivos/Músicas*, com envio de músicas e skins `.wsz` | [aplicativos.md §3](aplicativos.md#3-player-de-música) |
| **Jogos** | Campo Minado, Paciência (Klondike) e FreeCell | [aplicativos.md §4](aplicativos.md#4-jogos) |
| **Emuladores** | Mega Drive, Master System, Super Nintendo, Game Boy, Game Boy Color, Game Boy Advance e Atari 2600 com o **EmulatorJS** (GPL-3.0, carregado do CDN ou de cópia local). ROMs suas, em `Meus arquivos/Jogos/Emuladores/<Sistema>` | [emuladores.md](emuladores.md) |
| **Programa Web** | Qualquer endereço vira um app do Diogows, com **ícone do próprio site**, três modos de abertura e atalhos prontos (WhatsApp Web, Telegram Web, Gmail, Outlook) | [aplicativos.md §1](aplicativos.md#1-programa-web) |

### Recursos

- **Perfil do usuário** (Minha conta): nome, sobrenome, **foto** e **assinatura de e-mail**, todos opcionais. Foto e nome aparecem em **Mensagens** e na barra de tarefas; sem nome vale o usuário.
- **Menu Iniciar reorganizado**: categorias por uso, **Mais usados**, *Expandir/Recolher tudo*, busca que também acha pela categoria e mostra a categoria de cada resultado.
- **Categorias suas**: ao instalar um programa DOS, sistema virtual ou Programa Web, escolha a categoria do menu ou **crie uma nova**; dá para trocar depois.
- **Ícones em imagem**: itens do menu podem ter um PNG (o ícone do site) em vez de emoji, em todos os lugares onde o ícone aparece.
- **Janela própria do navegador** como modo de abertura de Programa Web, para sites que não aceitam ficar dentro de uma janela (WhatsApp Web).

### Rotas novas (`/api/desk/*`)

`mail/*` (config, contas, OAuth, pastas, mensagens, anexos, ações, envio), `profile`, `profile/photo`, `avatar/{id}` e `webicon?url=`. Detalhes em [desktop.md](desktop.md#api-apidesk) e [email.md §8](email.md#8-api).
`GET /api/desk/me` e `POST /api/desk/login` passaram a trazer o bloco `profile`.

## Correções e ajustes

- O Programa Web, quando o site não tem ícone próprio, cai no emoji escolhido; endereços `http` dentro de um Diogows em `https` abrem em outra aba (o navegador bloqueia a janela interna).
- O Explorer abre `.mp3`, `.m4a`, `.ogg`, `.wav` e `.flac` no Player de Vídeo como antes; o Player de Música é uma opção a mais, não uma troca.

## Atenção ao atualizar

| Item | O que fazer |
|---|---|
| **Banco** | Três tabelas novas, `desk_mail_accounts`, `desk_mail_apps` e `desk_profiles`, criadas **sozinhas** na primeira subida (`CREATE TABLE IF NOT EXISTS`). Nada é alterado nas tabelas existentes. Remover um usuário apaga as linhas dele nas duas |
| **Arquivo novo: `desk/_mail.key`** | Criado ao ligar a primeira conta de e-mail (32 bytes, modo 0600). **Inclua no backup** junto com o banco; sem ela as contas de e-mail precisam ser ligadas de novo. O `install.sh` não toca na pasta `desk/` |
| **Configuração** | Nova seção opcional `desk.mail` no `hub.config.json` (`redirectURI`, `allowPrivate`, `disabled`). **O aplicativo OAuth do Google/Microsoft não é do servidor: cada usuário registra o dele** em E-mail → ➕ (*Meu aplicativo*). **Sem nada disso, tudo continua funcionando**: o e-mail por senha (IMAP/SMTP) já vale. O `install.sh` preserva o seu `hub.config.json` |
| **Rede** | O e-mail só conecta em servidores da internet. Um servidor de e-mail na rede da casa exige `"allowPrivate": true` |
| **Menu Iniciar** | A ordem e os nomes das categorias mudaram (por exemplo *Internet e comunicação* virou *Comunicação* e *Internet*, e *Imagens, vídeo e câmeras* virou *Imagem, vídeo e música*). O estado aberto/fechado que o usuário já tinha é mantido; categorias novas seguem o padrão |
| **Internet** | O app Emuladores carrega o EmulatorJS de `cdn.emulatorjs.org` quando não há cópia em `vendor/emulatorjs/data/`; os demais apps não precisam de internet |
| **Pacote** | O pacote cresce (~+9 MB de painel: JS Paint ~7 MB e Webamp ~1 MB). O binário do hub ganhou as bibliotecas de IMAP (Go puro; os 4 binários Linux e o do Windows continuam estáticos) |
| **`/api/desk/me`** | Passou a incluir `profile`. Clientes que ignoram campos extras não são afetados |

### Dependências novas

| Onde | Componente | Versão | Licença |
|---|---|---|---|
| Hub (Go) | `github.com/emersion/go-imap/v2` | `v2.0.0-beta.8` (beta) | MIT |
| Hub (Go) | `github.com/emersion/go-message` | `v0.18.2` | MIT |
| Hub (Go) | `github.com/emersion/go-sasl` | `v0.0.0-20241020182733-b788ff22d5a6` | MIT |
| Painel | Webamp (`src/vendor/webamp/`) | `2.3.1` | MIT |
| Painel | JS Paint (`src/vendor/jspaint/`) | commit `53be67a` (09/04/2026) | MIT |

Lista completa e observações em [licencas.md](licencas.md).

## Verificação feita

- `go vet ./...` e `go test ./...` (incluindo os testes novos de e-mail, perfil e ícone do site) passam.
- O E-mail foi exercitado de ponta a ponta contra um servidor IMAP em memória e um SMTP de teste, ambos em TLS, e na tela, no navegador.
- Perfil (nome, foto, assinatura), Programa Web (ícone do site, categoria nova), Paint (abrir e salvar em Meus arquivos), Player de Música (lista e durações), Jogos e o menu Iniciar foram conferidos no navegador.

**Não verificado:** login OAuth real com Google e Microsoft; contas reais de Gmail/Outlook/Yahoo/iCloud; o som do Webamp (só a lista e as durações); o modo *janela própria* com o WhatsApp Web de verdade; toque longo em celular; a tela de vitória dos jogos.
