#!/bin/sh
# Produce a minimal phone installer: only new cached-multiplayer components.
# Does not bundle, delete, compress or modify any permanent MP3 recordings.
set -eu
here=$(CDPATH="" cd -- "$(dirname -- "$0")" && pwd)
out=${1:-"$here/tunerush-s21-multiplayer.tar.gz"}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
for p in multiplayer.py multiplayer_service.py start-multiplayer.sh watchdog.py relay-worker.py; do
  cp "$here/$p" "$tmp/$p"
done
mkdir -p "$tmp/multiplayer-web"
for p in index.html app.js style.css; do
  cp "$here/../multi/$p" "$tmp/multiplayer-web/$p"
done
chmod 700 "$tmp/start-multiplayer.sh"
(cd "$tmp" && sha256sum multiplayer.py multiplayer_service.py start-multiplayer.sh watchdog.py relay-worker.py multiplayer-web/index.html multiplayer-web/app.js multiplayer-web/style.css > MANIFEST.sha256)
tar -czf "$out" -C "$tmp" multiplayer.py multiplayer_service.py start-multiplayer.sh watchdog.py relay-worker.py multiplayer-web/index.html multiplayer-web/app.js multiplayer-web/style.css MANIFEST.sha256
echo "CREATED: $out"
sha256sum "$out"
