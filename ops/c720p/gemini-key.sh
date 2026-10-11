#!/bin/sh
# Read Gemini key from SSH stdin; do not echo or store it in shell history.
exec /home/jespern/c720p-home-hub/.venv-gemini-live/bin/python /home/jespern/c720p-home-hub/bin/setup-c720p-gemini-live-key.py --stdin "$@"
