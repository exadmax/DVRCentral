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

## Gravações (1 arquivo por hora)
O hub grava o mesmo vídeo H.264 que já repassa ao navegador (sem recodificar, sem ffmpeg) em `server/recorder.go`:
- Arquivos `NOME_DA_CAMERA_AAAAMMDDHH.mp4` (ex.: `Sala_de_Estar_2026100114.mp4`), 1 por câmera por hora, na pasta
  **`/home/usuario/securityCam`** (campo `"recordings": {"dir": "..."}` do `hub.config.json`; o hub cria a pasta). O arquivo novo começa
  no primeiro quadro-chave depois da virada da hora. Se o hub reiniciar na mesma hora, o arquivo seguinte leva `_2`, `_3`...
- **Tudo se configura na página Config**, por câmera (grava em `recordings.state.json`, ao lado do `hub.config.json`). A chave geral
  **Gravar as câmeras** vem **desligada**. Para cada câmera:
  - liga/desliga;
  - **Modo**: *Contínuo* (grava o tempo todo) ou *Só com movimento*;
  - **Sensibilidade** 1–5 (só no modo movimento);
  - **Guardar por** N dias (padrão 7; 1 a 365);
  - **Limite de espaço** em GB (0 = sem limite): passou disso, o hub apaga as gravações mais antigas **daquela câmera**.
  A página mostra por câmera o estado (gravando, aguardando movimento, erro) e os arquivos/GB em uso.
- **Modo movimento** (`server/motion.go`): não decodifica o vídeo. Compara o tamanho de cada quadro P com a média recente da câmera
  (parado = quadros minúsculos; movimento = quadros grandes) e dispara com 3 de 8 quadros acima do limite. Grava o grupo de quadros
  desde o quadro-chave anterior ao movimento (alguns segundos de pré-roll) e continua 15 s depois do último movimento. Hora sem movimento
  não cria arquivo; o arquivo da hora contém só os trechos com movimento, um depois do outro. Custo: uns poucos números por câmera.
  Luz ligando/desligando, TV e sombras podem disparar; baixe a sensibilidade se gravar demais.
- **Retenção**: a cada 10 min (e ao mudar a configuração) o hub apaga as gravações vencidas e aplica o limite de GB. Só mexe em
  arquivos com o nome acima; nunca em outros arquivos da pasta.
- Ligada, a gravação mantém a conexão com a câmera aberta 24 h (mesmo sem ninguém assistindo) e compartilha a sessão com a imagem ao vivo.
- Em **Câmeras → Gravações** a lista (por dia, com filtro por câmera) tem **Assistir** (player do navegador, com barra para pular) e **Baixar**.
  API: `GET /api/recordings`, `GET /api/recordings/file/{nome}` (com Range), `GET|PUT /api/recordings/settings`.
- A qualidade é a do endereço RTSP da câmera (`subtype=1` = substream, baixa resolução). Ver o espaço: ~0,3–1 GB/dia por câmera no substream.

## Limites
- Só H.264 (H.265 mostra o erro "não entrega H.264 neste endereço").
- Precisa do hub; aberto fora dele (ex.: só `python -m http.server`) a página avisa que está sem o hub.
- Navegadores sem Media Source (iPhone antigo) mostram um aviso em vez da imagem.
