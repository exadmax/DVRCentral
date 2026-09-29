#!/usr/bin/env bash
# Roda NO Linux, com sudo:  sudo bash install.sh
# Instala o hub em /opt/centraldiogo, libera a porta 80 e ativa o serviço.
set -e
[ "$(id -u)" = 0 ] || { echo "rode com sudo: sudo bash install.sh"; exit 1; }
cd "$(dirname "$0")"
USER_RUN="${SUDO_USER:-root}"
D=/opt/centraldiogo

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
[ -f "$D/hub.config.json" ] && cp "$D/hub.config.json" "$D/hub.config.json.bak"
install -m 600 hub.config.json "$D/hub.config.json"
rm -rf "$D/www" && mkdir "$D/www" && tar -xzf www.tgz -C "$D/www"
chown -R "$USER_RUN" "$D"
sed "s/__USER__/$USER_RUN/" centraldiogo-hub.service > /etc/systemd/system/centraldiogo-hub.service

# firewall: libera a 80 se houver ufw/firewalld ativo
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp; echo ">> ufw: porta 80 liberada"
elif command -v firewall-cmd >/dev/null && systemctl is-active --quiet firewalld; then firewall-cmd --permanent --add-port=80/tcp && firewall-cmd --reload; echo ">> firewalld: porta 80 liberada"
else echo ">> sem firewall ativo detectado (ufw/firewalld); nada a liberar"; fi

systemctl daemon-reload
systemctl enable centraldiogo-hub
systemctl restart centraldiogo-hub
sleep 1.5
systemctl is-active centraldiogo-hub
curl -s localhost/api/health && echo && echo ">> pronto: http://$(hostname -I | awk '{print $1}')/"
