#!/data/data/com.termux/files/usr/bin/bash
# All server work runs in S21's existing Termux/Python runtime.
set -euo pipefail
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH="$PREFIX/bin:/system/bin"
export TMPDIR="$PREFIX/tmp"
export TUNERUSH_SOLO_DATA="$HOME/.tunerush-solo"
export TUNERUSH_SOLO_PORT=8797
export TUNERUSH_SOLO_BIND="::"
mkdir -p "$TUNERUSH_SOLO_DATA" "$TMPDIR"
chmod 700 "$TUNERUSH_SOLO_DATA"
exec "$PREFIX/bin/python" "$HOME/tune-rush-solo/server.py"

