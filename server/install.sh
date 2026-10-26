#!/usr/bin/env bash
# Roda NO Linux, com sudo:  sudo bash install.sh
# Instala o hub em /opt/centraldiogo, libera a porta 80 e ativa o serviço.
# Cada instalação concluída soma 1 ao terceiro número da versão (arquivo VERSION: 1.0.1 -> 1.0.2).
# Só consultar a versão instalada, sem sudo e sem alterar nada:  bash install.sh --check
# Terminal e arquivos do computador no Desktop (opcional; veja SECURITY.md):
#   sudo bash install.sh --desk-shell        permite ao serviço usar sudo (sudoers NOPASSWD + NoNewPrivileges=false)
#   sudo bash install.sh --no-desk-shell     desfaz isso
set -e
cd "$(dirname "$0")"
D=/opt/centraldiogo

# Versão instalada = arquivo VERSION ("MAIOR.MENOR.PATCH"). Sem o arquivo ainda não há instalação versionada: parte de 1.0.0.
# Para subir o MAIOR ou o MENOR, edite o VERSION à mão (ex.: 1.1.0); as instalações seguintes continuam somando no terceiro.
OLD=1.0.0
[ -f "$D/VERSION" ] && OLD="$(tr -d '[:space:]' < "$D/VERSION")"
if ! echo "$OLD" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "!! $D/VERSION inválido: '$OLD' (esperado algo como 1.0.1). Corrija o arquivo e rode de novo."; exit 1
fi
NEW="${OLD%.*}.$((10#${OLD##*.} + 1))"

if [ "$1" = "--check" ]; then
  if [ -f "$D/VERSION" ]; then echo "versão instalada: V$OLD (desde $(date -r "$D/VERSION" '+%F %T'))"
  else echo "versão instalada: nenhuma registrada ainda"; fi
  echo "a próxima instalação será: V$NEW"
  exit 0
fi

[ "$(id -u)" = 0 ] || { echo "rode com sudo: sudo bash install.sh"; exit 1; }
USER_RUN="${SUDO_USER:-root}"
DESK_SHELL=""
for a in "$@"; do
  case "$a" in
    --desk-shell) DESK_SHELL=on;;
    --no-desk-shell) DESK_SHELL=off;;
  esac
done

case "$(uname -m)" in
  x86_64) A=amd64;; i?86) A=386;; aarch64|arm64) A=arm64;; armv6*|armv7*|arm) A=arm;;
  *) echo "arquitetura não suportada: $(uname -m)"; exit 1;;
esac
echo ">> arquitetura: $A"

# a porta 80 precisa estar livre (o nginx atual está na 8080)
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE '[:.]80$' && ! systemctl is-active --quiet centraldiogo-hub; then
  echo "!! Já existe algo escutando na porta 80:"; ss -ltnp | grep -E '[:.]80 ' || true; exit 1
fi

mkdir -p "$D/www"
install -m 755 "hub-linux-$A" "$D/hub"
# A configuração do servidor (hub.config.json e o hub.settings.json da página Config) é preservada: o pacote só instala a configuração
# na primeira instalação. Para trocar algo depois, use a página Config ou edite o arquivo no servidor.
if [ -f "$D/hub.config.json" ]; then
  cp "$D/hub.config.json" "$D/hub.config.json.bak"
  echo ">> hub.config.json existente mantido (cópia em hub.config.json.bak)"
else
  install -m 600 hub.config.json "$D/hub.config.json"
fi
rm -rf "$D/www" && mkdir "$D/www" && tar -xzf www.tgz -C "$D/www"
chown -R "$USER_RUN" "$D"
sed "s/__USER__/$USER_RUN/" centraldiogo-hub.service > /etc/systemd/system/centraldiogo-hub.service

# Desktop: sudo do usuário do serviço, para o Terminal e os arquivos do computador. É opt-in porque dá ao hub o poder de root:
# quem tiver a permissão no Desktop (e a senha de um administrador dele) passa a administrar a máquina. Só vale com "desk": {"shell": true}
# no hub.config.json. O sudo dentro de um serviço com NoNewPrivileges=true não funciona, por isso o drop-in abaixo.
DROPIN=/etc/systemd/system/centraldiogo-hub.service.d/desk-shell.conf
SUDOERS=/etc/sudoers.d/centraldiogo-desk
if [ "$DESK_SHELL" = on ]; then
  [ "$USER_RUN" = root ] && { echo "!! --desk-shell precisa do usuário normal (rode com sudo a partir dele, não como root direto)"; exit 1; }
  mkdir -p "$(dirname "$DROPIN")"
  printf '%s\n' '[Service]' 'NoNewPrivileges=false' > "$DROPIN"
  TMP="$(mktemp)"; echo "$USER_RUN ALL=(ALL) NOPASSWD: ALL" > "$TMP"
  visudo -cf "$TMP" >/dev/null || { rm -f "$TMP"; echo "!! sudoers inválido; nada foi alterado"; exit 1; }
  install -m 440 "$TMP" "$SUDOERS"; rm -f "$TMP"
  echo ">> sudo liberado para $USER_RUN (arquivos: $DROPIN e $SUDOERS)"
  echo ">> falta ligar no hub.config.json:  \"desk\": {\"shell\": true}   e depois: sudo systemctl restart centraldiogo-hub"
elif [ "$DESK_SHELL" = off ]; then
  rm -f "$DROPIN" "$SUDOERS"; rmdir "$(dirname "$DROPIN")" 2>/dev/null || true
  echo ">> sudo do Desktop desfeito"
fi

# firewall: libera a 80 se houver ufw/firewalld ativo
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp; echo ">> ufw: porta 80 liberada"
elif command -v firewall-cmd >/dev/null && systemctl is-active --quiet firewalld; then firewall-cmd --permanent --add-port=80/tcp && firewall-cmd --reload; echo ">> firewalld: porta 80 liberada"
else echo ">> sem firewall ativo detectado (ufw/firewalld); nada a liberar"; fi

systemctl daemon-reload
systemctl enable centraldiogo-hub
systemctl restart centraldiogo-hub
sleep 1.5
systemctl is-active centraldiogo-hub

# instalação concluída (o serviço subiu): registra a nova versão. O hub lê o arquivo, então /api/health já mostra a nova.
echo "$NEW" > "$D/VERSION.tmp" && mv "$D/VERSION.tmp" "$D/VERSION"
echo "$(date '+%F %T')  V$OLD -> V$NEW" >> "$D/install.log"
chown "$USER_RUN" "$D/VERSION" "$D/install.log"
echo ">> versão instalada: V$NEW (era V$OLD)"
curl -s localhost/api/health && echo && echo ">> pronto: http://$(hostname -I | awk '{print $1}')/"
