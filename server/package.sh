#!/usr/bin/env bash
# Gera dist/centraldiogo.tgz com tudo que o Linux precisa (roda no seu PC).
set -e
cd "$(dirname "$0")"
./build.sh >/dev/null
P=dist/pkg; rm -rf $P; mkdir -p $P
cp dist/hub-linux-* install.sh centraldiogo-hub.service $P/
# config de produção: porta 80 e painel em ./www (o arquivo local de testes não é alterado)
sed -e 's#"listen": *"[^"]*"#"listen": ":80"#' -e 's#"staticDir": *"[^"]*"#"staticDir": "./www"#' hub.config.json > $P/hub.config.json
tar -C ../src -czf $P/www.tgz .
tar -C $P -czf dist/centraldiogo.tgz .
ls -lh dist/centraldiogo.tgz
