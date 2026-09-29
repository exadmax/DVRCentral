# Central Diogo — projeto Tizen (TV Samsung)

Este projeto **já está pronto**, não crie um projeto novo pelo assistente da extensão.
Ele é uma casca simples: abre `http://192.168.0.10/` (o hub da casa) em tela cheia na TV.

## Arquivos desta pasta (não apagar nem regenerar)
- `config.xml` — metadados do app Tizen (id, nome, permissões). Já configurado para TV.
- `index.html` — a tela que a TV mostra: conecta no hub, exibe o painel, mostra "Sem conexão…" se cair.
- `icon.png` — ícone do app (logo Omega Diogo).

Se a extensão pedir para "criar" ou "importar" um projeto, use **Open Folder** nesta pasta
(`platforms/tizen/app`) em vez do assistente "Create Project" — ele reconhece pelo `config.xml` já existente.

## Passo a passo

### 1. Ligar o modo desenvolvedor na TV
Na TV: **Apps → digite 12345 → Developer mode → ON** → informe o **IP deste computador** (Windows) → reinicie a TV
quando ela pedir.

### 2. Certificado Samsung (obrigatório para instalar na TV)
Na extensão Tizen do VS Code, procure **Certificate Manager** (ícone do Tizen na barra lateral, ou
`Ctrl+Shift+P` → digite "Tizen: Certificate").
- Crie um certificado **Samsung** (não o certificado Tizen genérico): pede login da sua conta Samsung
  e o **DUID** da TV.
- O DUID aparece na TV em **Configurações → Suporte → Sobre → Info de suporte de contato**,
  ou a própria extensão consegue puxá-lo se a TV estiver conectada (passo 3).

### 3. Conectar na TV
`Ctrl+Shift+P` → **Tizen: Connect Device** (ou o painel "Device Manager" da extensão) → informe o
**IP da TV** (Configurações → Geral → Rede → Status da rede, na própria TV).

### 4. Rodar / instalar
Com esta pasta aberta e a TV conectada:
- `Ctrl+Shift+P` → **Tizen: Build** (gera o pacote)
- `Ctrl+Shift+P` → **Tizen: Run** (instala e abre na TV)

Se algum desses comandos não aparecer com esse nome exato, abra a paleta de comandos e digite só
"Tizen" para ver a lista — os nomes variam um pouco entre versões da extensão.

### 5. Repetir para as outras TVs de casa
O mesmo projeto serve para todas. Só é preciso adicionar o **DUID de cada TV** ao certificado
(no Certificate Manager, opção de gerenciar dispositivos autorizados), ou gerar um certificado por TV.

## Se o endereço do hub mudar
Edite `HUBS` no topo do `<script>` de `index.html` (é a URL do servidor, hoje `http://192.168.0.10/`)
e `<tizen:allow-navigation>` em `config.xml` (troque o IP). Depois repita o passo 4.

## Problemas comuns
- **"Sem conexão com a Central Diogo" na TV**: confira se a TV está na mesma rede Wi-Fi/cabo do servidor
  e se `http://192.168.0.10/` abre num navegador normal.
- **Instalação falha / "certificado inválido"**: o certificado não tem o DUID desta TV — volte ao passo 2.
- **App não aparece na lista da TV**: o modo desenvolvedor pode ter sido desligado após reiniciar a TV —
  repita o passo 1.
