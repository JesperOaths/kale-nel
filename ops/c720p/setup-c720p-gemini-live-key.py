#!/usr/bin/env python3
"""One-time private Gemini credential setup on the C720P; never prints the key."""
import argparse, asyncio, getpass, os, pathlib, subprocess, sys
from google import genai

CONFIG=pathlib.Path.home()/".config/c720p-gemini-live.env"
MODEL="gemini-3.8-live"

async def verify(key):
    client=genai.Client(api_key=key)
    try:
        # Provider handshake only; do not send any audio or Home Assistant data.
        async with client.aio.live.connect(model=MODEL,config={"response_modalities":["AUDIO"]}):
            pass
    finally:
        await client.aio.aclose()

def main():
    parser=argparse.ArgumentParser(description="Configure a Gemini key without displaying or logging it")
    parser.add_argument("--stdin", action="store_true", help="Read key from stdin (Windows clipboard over SSH)")
    parser.add_argument("--test-input", action="store_true", help="Validate stdin transport; no cloud connection or file changes")
    args=parser.parse_args()
    if args.test_input and not args.stdin:
        parser.error("--test-input requires --stdin")
    if args.stdin:
        # PowerShell Get-Clipboard -Raw pipes the clipboard to SSH stdin.
        # No pseudo-TTY, terminal paste, echoed key, command-line secret, or file.
        raw=sys.stdin.buffer.read(2049)
        if len(raw)>2048:
            print("Clipboard value is unexpectedly large; no changes made.")
            return 2
        try:
            key=raw.decode("utf-8").strip()
        except UnicodeDecodeError:
            print("Clipboard is not a valid UTF-8 key; no changes made.")
            return 2
    elif sys.stdin.isatty():
        key=getpass.getpass("Gemini API key (hidden): ").strip()
    else:
        print("Use --stdin when piping the Windows clipboard over SSH.")
        return 2
    if args.test_input:
        print("CLIPBOARD_TRANSPORT_PASS" if key=="TEST_CLIPBOARD_TRANSPORT_ONLY" else "CLIPBOARD_TRANSPORT_FAIL")
        return 0 if key=="TEST_CLIPBOARD_TRANSPORT_ONLY" else 2
    if not (20 <= len(key) <= 512 and "\n" not in key and "\r" not in key and "\0" not in key and "=" not in key):
        print("Key format invalid. No changes made.")
        return 2
    try:
        asyncio.run(verify(key))
    except Exception as e:
        print("Google Gemini Live authentication failed ("+type(e).__name__+"). No changes made.")
        return 3
    CONFIG.parent.mkdir(parents=True,exist_ok=True)
    flags=os.O_WRONLY|os.O_CREAT|os.O_TRUNC
    fd=os.open(str(CONFIG), flags, 0o600)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"w") as f:
            f.write("GEMINI_API_KEY="+key+"\nGEMINI_LIVE_MODEL="+MODEL+"\n")
            f.flush()
            os.fsync(f.fileno())
    finally:
        key=""
    p=subprocess.run(["systemctl","--user","enable","--now","c720p-gemini-live.service"],capture_output=True,text=True)
    if p.returncode:
        print("The key was saved privately but the service did not start.")
        return 4
    print("Gemini Live verified and service enabled. No audio was uploaded during setup.")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
