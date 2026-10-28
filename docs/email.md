# E-mail do Diogows

Cliente de e-mail dentro do Diogows (`desktop.html`): várias contas por usuário, leitura, busca, organização e envio, com **IMAP/SMTP** e login por
**OAuth 2.0** para **Gmail** e **Microsoft/Outlook**. O servidor é só a **ponte**: guarda a credencial cifrada, fala com o provedor e entrega JSON ao
navegador. **Nenhuma mensagem é gravada no servidor.**

- [1. O que faz e o que não faz](#1-o-que-faz-e-o-que-não-faz)
- [2. Ligar uma conta](#2-ligar-uma-conta)
- [3. Configuração do servidor (`desk.mail`)](#3-configuração-do-servidor-deskmail)
- [4. Registrar o aplicativo OAuth (por usuário)](#4-registrar-o-aplicativo-oauth-por-usuário)
- [5. Usando o E-mail](#5-usando-o-e-mail)
- [6. Como funciona por dentro](#6-como-funciona-por-dentro)
- [7. Segurança](#7-segurança)
- [8. API](#8-api)
- [9. Problemas comuns](#9-problemas-comuns)
- [10. Limites e o que não foi verificado](#10-limites-e-o-que-não-foi-verificado)
- [11. Testes e código](#11-testes-e-código)

## 1. O que faz e o que não faz

| Faz | Não faz |
|---|---|
| Várias contas por usuário (até 6), cada uma só do dono | POP3, JMAP, Gmail API e Microsoft Graph (Gmail e Microsoft entram por IMAP/SMTP com token OAuth) |
| Pastas com contagem de não lidas, busca, paginação (40 por página) | Notificação em tempo real (IDLE): a lista atualiza ao clicar em ↻ ou a cada 2 minutos |
| Ler (HTML limpo ou texto), baixar anexos, imagens embutidas | Carregar imagens remotas sem você pedir |
| Escrever, responder, responder a todos, encaminhar, Cc/Cco, anexos (do aparelho ou de Meus arquivos, até ~20 MB) | Escrever em HTML (o editor é texto simples) |
| Estrela, lida/não lida, mover, excluir (vai para a lixeira) | Regras, filtros, rascunhos salvos, criar ou renomear pastas |
| Assinatura e nome no remetente (opcionais, do perfil do usuário) | Verificação de assinatura/criptografia (S/MIME, PGP) |

**Protocolos:** IMAP4rev1/rev2 e SMTP, **só com TLS** (implícito, portas 993/465) **ou STARTTLS** (143/587), TLS 1.2 ou mais novo. Texto puro é recusado.
Autenticação por senha (PLAIN ou LOGIN) ou **XOAUTH2** (token de acesso OAuth 2.0 com PKCE).

## 2. Ligar uma conta

*E-mail → ➕* abre **Ligar conta de e-mail** com três abas.

### 2.1 Outro (IMAP/SMTP, com senha)

Funciona com qualquer provedor. Informe e-mail, senha e os servidores. O Diogows **preenche os servidores** pelo domínio do e-mail para Gmail,
Outlook.com, Yahoo e iCloud, e **confere o login no IMAP e no SMTP** antes de guardar (um dado errado só daria uma caixa vazia sem explicação).

| Provedor | IMAP | SMTP | Senha |
|---|---|---|---|
| Gmail | `imap.gmail.com:993` TLS | `smtp.gmail.com:465` TLS | **senha de app** (exige verificação em duas etapas; myaccount.google.com/apppasswords) |
| Outlook.com / Hotmail | `outlook.office365.com:993` TLS | `smtp-mail.outlook.com:587` STARTTLS | a Microsoft vem exigindo OAuth; se a senha não funcionar, use a aba Microsoft |
| Yahoo | `imap.mail.yahoo.com:993` TLS | `smtp.mail.yahoo.com:465` TLS | senha de app |
| iCloud | `imap.mail.me.com:993` TLS | `smtp.mail.me.com:587` STARTTLS | senha específica de app (appleid.apple.com) |

Os servidores acima são os documentados pelos provedores na data desta escrita; confirme na ajuda do seu provedor se algo falhar.

### 2.2 Gmail e Microsoft por login (OAuth)

Você **não entrega a senha ao Diogows**: autoriza o acesso na página do Google/Microsoft e pode revogá-lo a qualquer momento na sua conta. Exige que **você**
registre o seu aplicativo OAuth, uma vez (seção 4): a aba pede o ID na primeira vez. Se preferir não, use a aba IMAP com senha de app.

Fluxo:

1. Digite o seu e-mail e clique em **Continuar**: abre a página de autorização do provedor.
2. Aceite o acesso. O provedor devolve para o endereço de retorno (seção 3):
   - **Retorno manual (padrão):** o navegador vai para `http://localhost:8765/?code=…` e mostra uma **página de erro**: é normal, porque nada escuta nesse endereço no seu aparelho.
     **Copie o endereço inteiro da barra** e cole no Diogows, depois clique em **Concluir**. Vale para qualquer instalação, sem domínio nem HTTPS.
   - **Retorno automático:** com `redirectURI` apontando para o próprio hub em HTTPS, a janela do provedor termina sozinha e o Diogows avisa.
3. O Diogows troca o código pelos tokens, **confere o login no IMAP/SMTP** e guarda só o *refresh token* (cifrado).

Cada tentativa de login vale **10 minutos** e **uma única vez**.

## 3. Configuração do servidor (`desk.mail`)

**O aplicativo OAuth não é configuração do servidor.** Ele é **de cada usuário** (seção 4): cada pessoa registra o seu e o guarda na própria conta do
Diogows, porque as contas de e-mail e os acessos são por usuário. O `hub.config.json` só tem os ajustes **gerais** do servidor, todos opcionais, dentro de `desk`
(depois: `sudo systemctl restart centraldiogo-hub`):

```json
"desk": {
  "mail": {
    "redirectURI": "",
    "allowPrivate": false,
    "disabled": false
  }
}
```

| Campo | Padrão | Para quê |
|---|---|---|
| `redirectURI` | `http://localhost:8765/` | Endereço de retorno do OAuth, igual para todos (é o endereço do hub). Para retorno automático: `https://seu-hub/api/desk/mail/oauth/callback` (cada usuário registra o mesmo no aplicativo dele) |
| `allowPrivate` | `false` | Permite servidores de e-mail **na rede da casa** (ex.: um Dovecot seu). Padrão: só endereços da internet |
| `disabled` | `false` | `true` tira o E-mail do Diogows (as rotas respondem 404) |

> Versões de rascunho aceitavam `google` e `microsoft` (com `clientId`/`clientSecret`) aqui. Elas **foram removidas**: se o seu `hub.config.json` ainda as tem, são ignoradas;
> cada usuário registra o aplicativo dele no Diogows.

## 4. Registrar o aplicativo OAuth (por usuário)

O Diogows não traz chaves de ninguém: **cada usuário registra o próprio aplicativo**, uma vez por provedor, e cola o ID no Diogows em **E-mail → ➕ → Gmail** ou
**Outlook / Microsoft**. O formulário **Meu aplicativo** guarda o *ID do cliente* e a *chave secreta* (e o *diretório* da Microsoft) **cifrados na conta dele**,
nunca os devolve pela API e permite trocar ou **remover** depois (⚙ *Meu aplicativo*). Um usuário não vê nem usa o aplicativo de outro. As telas dos provedores mudam
com frequência; os passos abaixo dão o caminho, e a documentação deles vale mais que este texto em caso de diferença.

### Google (Gmail)

1. Google Cloud Console → crie um projeto → **APIs e serviços → Tela de permissão OAuth** (tipo *Externo* para contas pessoais).
2. **Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo para computador (Desktop app)**. Cole o *ID do cliente* e a *chave secreta* em **Meu aplicativo**.
3. Escopo usado: `https://mail.google.com/` (acesso IMAP/SMTP). É um escopo **restrito**: enquanto o aplicativo está em modo de **teste**, o Google
   limita os usuários de teste (adicione o seu e-mail na tela de permissão) e **expira o acesso em 7 dias**; para uso contínuo é preciso publicar o
   aplicativo, e o Google pode pedir verificação.
4. Cliente do tipo *Desktop* aceita retorno em `http://localhost` com qualquer porta: o padrão `http://localhost:8765/` serve. Para retorno automático,
   use um cliente do tipo *Aplicativo da Web* com o endereço `https://…/api/desk/mail/oauth/callback` nos URIs de redirecionamento.

### Microsoft (Outlook, Microsoft 365)

1. Portal do Azure → **Microsoft Entra ID → Registros de aplicativo → Novo registro**. Tipos de conta: conforme o uso (*Contas em qualquer diretório e contas pessoais* cobre ambos).
2. **Autenticação → Adicionar plataforma → Aplicativos móveis e de desktop**, URI de redirecionamento `http://localhost` (qualquer porta vale). Para retorno automático, adicione também o `https://…/api/desk/mail/oauth/callback`.
3. **Permissões de API → Adicionar → APIs que minha organização usa → Office 365 Exchange Online → Permissões delegadas**: `IMAP.AccessAsUser.All` e `SMTP.Send`; mais `offline_access`. Em contas de trabalho pode ser preciso **consentimento do administrador**.
4. Cole o *ID do aplicativo (cliente)* em **Meu aplicativo**. A chave secreta só se o aplicativo foi registrado como cliente *confidencial* (para "cliente público/desktop" deixe vazio); o diretório (`tenant`) é `common` por padrão (`consumers`, `organizations` ou o id do diretório).
5. Em **Microsoft 365** de trabalho, o administrador precisa deixar **IMAP** e **SMTP autenticado (SMTP AUTH)** habilitados na caixa do usuário.

## 5. Usando o E-mail

Abra **E-mail** no menu Iniciar (*Comunicação*) ou pelo ícone da Área de Trabalho. A janela tem três painéis (em janelas estreitas, um por vez, com os botões ☰ e ‹ para voltar):

| Painel | O que tem |
|---|---|
| Esquerda | **✏️ Escrever**, seletor de conta (➕ liga outra, ✕ remove a conta do Diogows; os e-mails continuam no provedor) e as pastas com contagem de não lidas. Entrada, rascunhos, enviados, arquivo, spam e lixeira ganham nome e ícone em português |
| Meio | Busca (cabeçalho e texto, **Enter** para pesquisar), ↻ atualizar, lista (negrito = não lida, ★ estrela, 📎 anexo) e paginação |
| Direita | A mensagem: **↩ Responder**, **↩↩ Todos**, **➡ Encaminhar**, ★, 📭 marcar como não lida, **Mover…**, 🗑 excluir; cabeçalho, anexos para baixar e o corpo |

- Abrir uma mensagem a marca como **lida**. Excluir move para a **lixeira**; na própria lixeira (ou sem lixeira) apaga de vez, com confirmação.
- **Imagens remotas ficam bloqueadas** ("Imagens remotas bloqueadas (N)…"), porque carregá-las avisa o remetente que você leu. **Mostrar imagens** libera só nessa mensagem. As imagens embutidas na própria mensagem aparecem sempre.
- Em **Escrever**: *De* (conta), Para, **Cc/Cco**, assunto, corpo em texto simples, **📎 Do aparelho** e **📂 Meus arquivos** para anexar (os anexos somam até 20 MB). Fechar com texto escrito pergunta se quer descartar.
- **Assinatura e nome:** em *Minha conta → Perfil*, a opção **Usar meu nome nos e-mails** coloca `"Nome Sobrenome" <seu@email>` no remetente e acrescenta a assinatura (`-- ` e o texto do perfil, ou o nome completo) ao corpo, antes do texto citado nas respostas. A assinatura aparece na hora e você pode editá-la ou apagá-la naquela mensagem.
- Nas contas por IMAP/SMTP **de senha**, a mensagem enviada é copiada para a pasta *Enviados* do servidor. No Gmail e na Microsoft o próprio provedor já guarda o enviado.

## 6. Como funciona por dentro

```
 navegador (mail.js) ──JSON──► hub (desk_mail*.go) ──IMAP/SMTP em TLS──► provedor
                                  │
                                  ├─ banco: desk_mail_accounts (credencial cifrada) e desk_mail_apps (aplicativo OAuth de cada usuário)
                                  └─ desk/_mail.key (chave AES-GCM de 32 bytes)
```

- **Uma conexão por pedido:** cada ação abre o IMAP, faz o que precisa e fecha (com um relógio de 90 s que derruba conexões travadas). É simples e sem estado; o custo é um login por clique.
- **Credenciais:** `{"password": …}` ou `{"refresh_token": …}`, cifrados com **AES-GCM** (nonce aleatório por gravação). A chave fica em `desk/_mail.key` (criada na primeira
  conta, modo 0600). **Faça backup dessa chave junto com o banco**: sem ela as contas não se abrem e precisam ser ligadas de novo.
- **Tokens OAuth:** o *access token* fica só em memória (renovado com o refresh token um minuto antes de expirar). A Microsoft troca o refresh token a cada uso; o novo é gravado cifrado.
- **Mensagens:** lidas inteiras com `BODY.PEEK` (não marca como lida sozinho; o app marca ao abrir), limite de **40 MB**. Anexos são extraídos sob demanda.
- **Envio:** mensagem MIME montada no servidor (cabeçalhos codificados: nada digitado vira cabeçalho solto, nem `Bcc:` injetado), enviada por SMTP com `AUTH PLAIN`, `LOGIN` ou `XOAUTH2`.
- **Rede:** o servidor só conecta em **endereços públicos** (o mesmo bloqueio das agendas e do Navegador): endereços da rede da casa, do próprio servidor e de nuvem (metadados) são recusados, a menos que `allowPrivate` esteja ligado.

## 7. Segurança

| Cuidado | Como |
|---|---|
| Credenciais em repouso | Cifradas (AES-GCM) no banco; a API **nunca** devolve senha nem token |
| Isolamento entre usuários | Toda rota filtra pelo dono da conta; conta de outro dá **404** (testado) |
| Corpo HTML da mensagem | Limpeza no navegador (sem `script`, `iframe`, `form`, `meta refresh`, `base`, eventos `on…`, `javascript:`), exibido num **iframe com `sandbox`** (sem scripts nem acesso ao Diogows) e **política de conteúdo sem rede** (`default-src 'none'`; imagens só `data:`) |
| Imagens remotas | Bloqueadas até o clique; só então a política passa a aceitar `http(s)` para imagens |
| Imagens `cid:` | O Diogows as busca com o cookie e as embute como `data:` (o iframe com sandbox não envia o cookie) |
| Anexos | Sempre `Content-Disposition: attachment` e `application/octet-stream`, com `nosniff` e CSP restritiva; só PNG, JPEG, GIF e WebP podem ficar inline (para imagens do corpo). **SVG e HTML nunca** |
| Servidores internos | Recusados por padrão (anti-sonda de rede) |
| Aplicativo OAuth | Por usuário (`desk_mail_apps`), chave cifrada como as demais credenciais e nunca devolvida pela API; um usuário não alcança o de outro (testado) |
| OAuth | PKCE (S256), `state` aleatório de uso único e preso ao usuário, expira em 10 min; retorno automático sem sessão só entrega o endereço à API (o cookie é `SameSite=Strict`) |
| Escrita | Mesmas regras do Diogows: cabeçalho `X-Desk` e origem igual à do hub |
| Registro | Login, envio e remoção vão para o journal com usuário e conta, **sem senha nem conteúdo** |

Lembrete geral: em **HTTP puro** (o normal na rede de casa) o login do Diogows trafega sem criptografia entre o navegador e o hub; o trecho hub↔provedor é sempre TLS.
Veja também [SECURITY.md](../SECURITY.md).

## 8. API

Base `/api/desk/mail`. Tudo exige sessão; escritas exigem `X-Desk: 1`. Erros vêm como `{"error": "…"}`.

| Rota | Função |
|---|---|
| `GET /config` | O seu aplicativo OAuth por provedor (`apps.google`/`apps.microsoft`: `configured`, `client_id`, `tenant`, `has_secret`; **nunca a chave**), o endereço de retorno e se o retorno é automático |
| `PUT /oauth/app` `{provider, client_id, client_secret?, tenant?}` · `DELETE /oauth/app/{provider}` | Registra, troca ou remove o **seu** aplicativo OAuth (chave vazia mantém a guardada, se o ID for o mesmo) |
| `GET /accounts` · `POST /accounts` · `DELETE /accounts/{id}` | Listar (sem segredos), ligar com senha (confere IMAP e SMTP) e remover |
| `POST /oauth/start` `{provider, email}` | Devolve `{url, state, redirect}` para abrir a autorização |
| `POST /oauth/finish` `{state, redirect_url, label?}` | Conclui: aceita o endereço colado (ou só o código), troca por tokens e cria a conta |
| `GET /oauth/callback` | Retorno automático (página sem sessão que entrega o endereço ao `finish`) |
| `GET /accounts/{id}/folders` | Pastas com função (`inbox`, `sent`, `drafts`, `trash`, `junk`, `archive`, `all`), não lidas e total |
| `GET /accounts/{id}/messages?folder=&page=&q=` | Lista paginada (mais novas primeiro); `q` pesquisa cabeçalho e texto |
| `GET /accounts/{id}/message?folder=&uid=` | Mensagem lida (texto, HTML, anexos); marca como lida |
| `GET /accounts/{id}/attachment?folder=&uid=&idx=[&download=1]` | Anexo |
| `POST /accounts/{id}/action` `{folder, uids[], op, to?}` | `seen`, `unseen`, `flag`, `unflag`, `move`, `delete` (até 200 mensagens) |
| `POST /accounts/{id}/send` | `{to[], cc[], bcc[], subject, text, in_reply_to, references, attachments[{name,type,data(base64)}]}`; até 100 destinatários e ~30 MB de corpo |

## 9. Problemas comuns

| Mensagem ou sintoma | Causa e saída |
|---|---|
| *"o servidor IMAP recusou o login"* | Usuário/senha errados; no Gmail e no iCloud use **senha de app**; confira se o IMAP está ativado na conta |
| *"endereço não permitido: …"* | O servidor de e-mail está na rede da casa ou no próprio servidor: ligue `desk.mail.allowPrivate` |
| *"você ainda não registrou o seu aplicativo do Google/da Microsoft"* | Preencha **Meu aplicativo** na aba do provedor (seção 4), ou use a aba IMAP com senha de app |
| *"este login expirou ou não é seu"* | Passaram 10 minutos, o login já foi concluído, ou o `state` é de outra pessoa: comece de novo |
| *"não encontrei o código no endereço colado"* | Cole o endereço **inteiro** da barra (com `?code=…`), não só o domínio |
| *"o provedor não entregou acesso permanente"* | O Google só entrega o refresh token ao conceder de novo: revogue o acesso do aplicativo em myaccount.google.com/permissions e refaça |
| *"o acesso à conta foi revogado ou expirou"* | Remova a conta (✕) e ligue de novo. No Google em modo teste o acesso expira em 7 dias |
| *"credencial ilegível (a chave desk/_mail.key mudou?)"* | A chave foi apagada/trocada: restaure o backup dela ou religue as contas |
| Microsoft 365 recusa o SMTP | O administrador precisa habilitar **SMTP AUTH** na caixa e conceder o consentimento das permissões |
| Mensagem grande não abre | Mensagens acima de 40 MB não abrem aqui; baixe pelo provedor |
| Busca demora | A busca de texto é feita no servidor do provedor; em caixas grandes pode levar tempo |

## 10. Limites e o que não foi verificado

- **Verificado:** o fluxo completo IMAP/SMTP (ligar conta, pastas, lista, ler, anexos, buscar, marcar, mover, enviar com anexo, cópia em Enviados), o isolamento entre usuários, a cifra, o bloqueio de rede interna, a limpeza do HTML e o troca-de-código OAuth (contra um servidor de token de teste), tudo com um servidor IMAP em memória e um SMTP de teste, e a tela no navegador.
- **Não verificado:** o login OAuth **de verdade** com Google e Microsoft (depende do seu aplicativo registrado e das regras atuais deles), nem a conexão com servidores reais de Gmail/Outlook/Yahoo/iCloud.
- A biblioteca de IMAP (`github.com/emersion/go-imap/v2`) está em **versão beta** (`v2.0.0-beta.8`).
- Sem IDLE/push, sem sincronização offline, sem cache de mensagens: cada leitura vai ao provedor.
- Escrita só em texto simples; respostas citam o texto (ou o texto extraído do HTML) com `> `.

## 11. Testes e código

| Parte | Arquivos |
|---|---|
| Contas, cifra, rotas, rede | `server/desk_mail.go` |
| IMAP/SMTP, leitura, envio, ações | `server/desk_mail_proto.go` |
| OAuth 2.0 (PKCE, tokens, retorno) | `server/desk_mail_oauth.go` |
| Testes (servidor IMAP em memória + SMTP falso, ambos em TLS) | `server/desk_mail_test.go` |
| Tela e limpeza do HTML | `src/js/desktop/mail.js` |

```bash
cd server && go vet ./... && go test -run 'DeskMail|XOAuth2|Perfil' ./...
```

Dependências novas do hub: `github.com/emersion/go-imap/v2`, `go-message` e `go-sasl` (licença MIT; veja [licencas.md](licencas.md)).
