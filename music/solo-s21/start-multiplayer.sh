#!/data/data/com.termux/files/usr/bin/sh
set -eu
export HOME=/data/data/com.termux/files/home
export PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:/system/bin"
export TMPDIR="$PREFIX/tmp"
cd "$HOME/tune-rush-solo"
exec "$PREFIX/bin/python3" -u "$HOME/tune-rush-solo/multiplayer_service.py"
