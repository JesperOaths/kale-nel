#!/data/data/com.termux/files/usr/bin/sh
# Install as ~/.termux/boot/90-tunerush after installing the matching
# Termux:Boot add-on. Do not acquire a permanent wakelock.
export HOME=/data/data/com.termux/files/home
export PATH=/data/data/com.termux/files/usr/bin:/system/bin
nohup "$HOME/tune-rush-solo/start-watchdog.sh" >/dev/null 2>&1 </dev/null &
