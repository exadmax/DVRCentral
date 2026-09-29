# Geladeira e Dispensa + Contatos

Duas abas do painel (ao lado de **Início**), com cadastro completo (criar, ver, editar, excluir) guardado em um banco
**SQLite** no hub. Funcionam na TV, no celular/APK e no navegador: todos falam com o mesmo hub, então o que se cadastra
em um aparelho aparece nos outros.

## Aba Geladeira e Dispensa

| Campo | Regra |
|---|---|
| Nome | obrigatório (até 120 caracteres) |
| Quantidade e/ou peso (kg) | **pelo menos um** dos dois; aceita decimais; zero é válido |
| Validade | opcional (`AAAA-MM-DD`); sem validade o item vai para o fim da lista |
| Local | `freezer`, `geladeira` ou `dispensa` |

- A lista vem ordenada pela validade (o que vence primeiro no topo), com filtro por local e busca pelo nome.
- Cores da validade: **vermelho** = vencido, **âmbar** = vence em até `estoque.soonDays` dias (padrão 3, em
  `src/config/settings.js`), verde = dentro do prazo.
- Na tela **Início** aparece uma tile "Validade · N" na fileira de atalhos com os itens vencidos ou perto de vencer
  (ou "Validades — tudo em dia"). Tocar nela abre a aba. Só aparece quando o hub está ligado e há itens cadastrados.

## Aba Contatos

| Campo | Regra |
|---|---|
| Nome | obrigatório |
| Tipo de serviço | obrigatório (eletricista, encanador...); o campo sugere os tipos já usados |
| Telefone | obrigatório, com pelo menos 8 dígitos; no celular vira link para ligar |
| Endereço, Nota | opcionais |

Os tipos viram filtros (Eletricista, Encanador...) e a busca procura em todos os campos.

## Navegação

- **TV (controle):** setas/OK navegam; **Voltar** fecha a janela aberta ou volta ao Início antes de sair do app.
  Parada por 5 minutos numa aba, a TV volta sozinha ao Início (o modo noturno das 23h às 5h só vale no Início).
- **Celular/APK:** o botão Voltar volta ao Início; um endereço como `http://192.168.0.10/#contatos` abre direto na aba.
- À noite, tocar na tela "acorda" o painel por 5 minutos, para dar acesso às abas.

## Banco de dados

- Arquivo `centraldiogo.db` ao lado do `hub.config.json` (em produção: `/opt/centraldiogo/centraldiogo.db`), criado e
  atualizado sozinho na primeira execução. O caminho muda em `dbPath` no `hub.config.json`.
- O `install.sh` **não mexe** no banco: reinstalar o hub preserva os dados.
- Driver em Go puro (`modernc.org/sqlite`, sem CGO), então `server/build.sh` continua gerando os 4 binários Linux.
  Compilar exige Go 1.26 ou mais novo. O binário ficou uns 5 MB maior.
- Se o banco não abrir, o resto do hub (agenda, clima, jogos) segue no ar e as duas abas mostram o erro.
- **Backup** (o SQLite usa modo WAL, então não copie só o `.db` com o hub rodando):
  ```bash
  sudo systemctl stop centraldiogo-hub
  cp -a /opt/centraldiogo/centraldiogo.db* ~/backup-centraldiogo/
  sudo systemctl start centraldiogo-hub
  ```

## API (no hub)

`/api/estoque` e `/api/contatos`, JSON, mesmo padrão nos dois:

| Método | Caminho | Resposta |
|---|---|---|
| GET | `/api/estoque` | lista (`[]` quando vazio) |
| GET | `/api/estoque/{id}` | um registro, ou 404 |
| POST | `/api/estoque` | 201 com o registro criado |
| PUT | `/api/estoque/{id}` | 200 com o registro atualizado (substitui todos os campos) |
| DELETE | `/api/estoque/{id}` | 204 |

Erros vêm como `{"error": "mensagem"}` com 400 (dado inválido), 404, 415 ou 503 (banco indisponível).

Item: `{"nome", "quantidade", "pesoKg", "validade", "local"}`.
Contato: `{"nome", "tipoServico", "telefone", "endereco", "nota"}`.

```bash
curl -X POST http://192.168.0.10/api/contatos -H 'Content-Type: application/json' \
  -d '{"nome":"João","tipoServico":"Eletricista","telefone":"(11) 98888-7777"}'
```

### Segurança

O hub é aberto à rede de casa (sem login), como o resto do painel. As gravações têm uma proteção extra: exigem
`Content-Type: application/json` e, quando o navegador envia o cabeçalho `Origin`, ele precisa ser o próprio endereço do
hub. Assim uma página de outro site aberta no celular de alguém da casa não consegue alterar o estoque. `curl` e
scripts (sem `Origin`) passam. Para liberar outra origem, por exemplo o painel em desenvolvimento na porta 5173 falando
com o hub na 8080, use `"allowedOrigins": ["http://localhost:5173"]` no `hub.config.json`.
