#!/data/data/com.termux/files/usr/bin/bash
set -eu
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH="$PREFIX/bin:/system/bin"
export TMPDIR="$PREFIX/tmp"
exec "$PREFIX/bin/python" -u "$HOME/tune-rush-solo/watchdog.py" >> "$HOME/tune-rush-solo/watchdog-service.log" 2>&1
