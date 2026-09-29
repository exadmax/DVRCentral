> Guia detalhado (Tizen Studio **ou** extensão Tizen do VS Code) em [`app/SETUP.md`](app/SETUP.md). Abra a pasta `app/` diretamente — não crie um projeto novo, ele já existe.

# App Tizen (TV Samsung) — casca do painel

`app/` é um app web mínimo: abre `http://192.168.0.10/` (o hub) em tela cheia, testa a conexão a cada 10 s
(mostra "Sem conexão…" se o hub cair e volta sozinho), mantém a tela acesa e sai com a tecla Voltar.
O endereço fica em `app/index.html` (`HUBS`) e em `app/config.xml` (`allow-navigation`).

## Gerar o .wgt e instalar (Tizen Studio)
1. TV: Apps → digite **12345** → *Developer mode* **ON**, IP do PC = o IP deste computador → reinicie a TV.
2. Tizen Studio: *File → Import → Tizen → Tizen Project* e escolha a pasta `platforms/tizen/app`.
3. *Tools → Certificate Manager*: crie o certificado **Samsung** (login Samsung + DUID da TV) — sem ele a TV não instala.
4. Botão direito no projeto → *Build Signed Package* (gera o `.wgt`).
5. *Device Manager*: conecte na TV (IP dela) → *Run As → Tizen Web Application*. Ele fica na lista de apps.

Vale para todas as TVs de casa: o mesmo `.wgt`, com o DUID de cada uma no certificado.
