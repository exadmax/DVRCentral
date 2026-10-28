#!/usr/bin/env bash
# Gera dist/centraldiogo.tgz com tudo que o Linux precisa (roda no seu PC).
# Uso: ./package.sh [vX.Y.Z]   (com a versão, o pacote vira uma release: o install.sh grava essa versão em VERSION)
set -e
VER="${1#v}"
cd "$(dirname "$0")"
./build.sh >/dev/null
P=dist/pkg; rm -rf $P; mkdir -p $P
cp dist/hub-linux-* install.sh centraldiogo-hub.service $P/
# config de produção: porta 80 e painel em ./www (o arquivo de origem não é alterado).
# Por padrão parte do hub.config.example.json (versionado). O hub.config.json local tem URLs privadas das agendas: só use
# CONFIG=hub.config.json ./package.sh para um pacote pessoal, que NUNCA deve ser publicado em release.
CONFIG="${CONFIG:-hub.config.example.json}"
sed -e 's#"listen": *"[^"]*"#"listen": ":80"#' -e 's#"staticDir": *"[^"]*"#"staticDir": "./www"#' "$CONFIG" > $P/hub.config.json
[ -n "$VER" ] && echo "$VER" > $P/RELEASE
tar -C ../src -czf $P/www.tgz .
tar -C $P -czf dist/centraldiogo.tgz .
ls -lh dist/centraldiogo.tgz
