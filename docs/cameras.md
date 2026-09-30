# Câmeras ao vivo (`camaras.html`)

Página com a imagem ao vivo das câmeras de casa, cada uma com o nome em cima. Abre pelo atalho **Câmeras** do painel.

## Como funciona
- O **hub** (`server/cameras.go`) abre o RTSP da câmera, pega o vídeo **H.264** e o entrega ao navegador como MP4 fragmentado contínuo em
  `GET /api/cameras/{id}/stream`. Não recodifica (quase sem CPU) e **não precisa de ffmpeg**.
- A página (`src/js/pages/camaras.js`) toca com Media Source Extensions, sem plugin. Sem áudio (fica mudo).
- A conexão com a câmera só existe enquanto alguém assiste (fecha 15 s depois do último espectador) e é **compartilhada**: várias telas
  abertas usam uma sessão RTSP só por câmera. Com a aba em segundo plano, a página para o vídeo.
- `GET /api/cameras` lista `id` e `name`. A **URL com a senha fica só no `hub.config.json`** (no servidor); o navegador nunca a recebe.

## Rodízio na tela inicial
No painel principal, o **card do meio (Clima) alterna com as câmeras**: Clima → Garagem → Quintal → Sala de Estar → Clima..., **1 minuto cada**
(a ordem é a da lista `cameras` do hub). Etiquetas embaixo do vídeo mostram onde está o rodízio. O Clima continua no cabeçalho.
- Só roda com o hub no ar e se houver câmeras configuradas; sem hub (ou em navegador sem Media Source, como TVs antigas) fica só o Clima.
- Muda o tempo em `src/config/settings.js`: `cameras: { rotateSeconds: 60 }`. Para testar rápido: `index.html?rotate=15`.
- No modo noturno e com a aba escondida o vídeo para e a conexão com a câmera fecha. O vídeo fica num elemento próprio que sobrevive aos
  redesenhos do painel (a cada 30 s), então não reinicia (`src/js/widgets/cameras.js`; o player é `src/js/services/cameraPlayer.js`).

## Configurar (`hub.config.json`)
```json
"cameras": [
  {"id": "garagem", "name": "Garagem", "url": "rtsp://admin:SENHA@192.168.0.21:554/cam/realmonitor?channel=1&subtype=1"},
  {"id": "quintal", "name": "Quintal", "url": "rtsp://admin:SENHA@192.168.0.22:554/cam/realmonitor?channel=1&subtype=1"},
  {"id": "sala-de-estar", "name": "Sala de Estar", "url": "rtsp://192.168.0.23:554/live/mpeg4"}
]
```
A ordem da lista é a ordem na página. Caracteres especiais da senha vão codificados na URL (`@` = `%40`, `!` = `%21`).

## Câmeras Mibo Smart (Intelbras)
- **Use `subtype=1`** (substream): é H.264. O `subtype=0` das iM7 é **H.265**, que o hub não repassa ao navegador.
- Usuário `admin`; a senha é a que o app Mibo Smart definiu para a câmera (o RTSP só aceita a senha nova se ela foi trocada no app).
  Com login errado várias vezes seguidas a câmera bloqueia por alguns minutos (403).
- Alguns modelos (ex.: servidor "Hankvision") entregam H.264 em `rtsp://IP:554/live/mpeg4`, **sem senha**; só o substream principal
  (2304x1296) existe nesses, então consomem mais banda da rede.
- Reserve os IPs das câmeras no roteador (DHCP fixo), senão a integração quebra quando o IP muda.

## Limites
- Só H.264 (H.265 mostra o erro "não entrega H.264 neste endereço").
- Precisa do hub; aberto fora dele (ex.: só `python -m http.server`) a página avisa que está sem o hub.
- Navegadores sem Media Source (iPhone antigo) mostram um aviso em vez da imagem.
