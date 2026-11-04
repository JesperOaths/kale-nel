#!/bin/sh
# Build the phone-only release archive. Avoid publishing index.html on GitHub Pages.
set -eu
root=$(CDPATH="" cd -- "$(dirname -- "$0")" && pwd)
output=${1:-"$root/tunerush-s21-solo-deploy.tar.gz"}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/web"
cp "$root/server.py" "$root/start-solo.sh" "$tmp/"
if [ -f "$root/README.md" ]; then cp "$root/README.md" "$tmp/README.txt"; else cp "$root/README.txt" "$tmp/README.txt"; fi
cp "$root/web/app.js" "$root/web/style.css" "$tmp/web/"
cp "$root/web/index.html.src" "$tmp/web/index.html"
chmod 700 "$tmp/start-solo.sh"
tar -czf "$output" -C "$tmp" server.py start-solo.sh README.txt web
printf "S21 solo deployment package: %s\n" "$output"

