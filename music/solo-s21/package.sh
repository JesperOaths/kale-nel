#!/bin/sh
# Build the phone-only release archive. Avoid publishing index.html on GitHub Pages.
set -eu
root=$(CDPATH="" cd -- "$(dirname -- "$0")" && pwd)
output=${1:-"$root/tunerush-s21-solo-deploy.tar.gz"}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/web"
cp "$root/start-solo.sh" "$tmp/"
set --
for module in server game_rules game_audio_cache persistent_music_library music_library_sync permanent_audio owned_library youtube_catalog multiplayer watchdog relay-worker import_downloads; do
  cp "$root/$module.py" "$tmp/"
  set -- "$@" "$module.py"
done
cp "$root/youtube-verified-ids.json" "$tmp/"
if [ -f "$root/README.md" ]; then cp "$root/README.md" "$tmp/README.txt"; else cp "$root/README.txt" "$tmp/README.txt"; fi
cp "$root/web/app.js" "$root/web/style.css" "$tmp/web/"
cp "$root/web/index.html.src" "$tmp/web/index.html"
chmod 700 "$tmp/start-solo.sh"
tar -czf "$output" -C "$tmp" "$@" youtube-verified-ids.json start-solo.sh README.txt web
printf "S21 solo deployment package: %s\n" "$output"



