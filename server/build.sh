#!/usr/bin/env bash
# Compila o hub para Linux (binário estático, sem dependências). Uso: ./build.sh
set -e
cd "$(dirname "$0")"
mkdir -p dist
for t in amd64 386 arm64 arm; do
  GOOS=linux GOARCH=$t CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "dist/hub-linux-$t" .
done
ls -lh dist
