#!/usr/bin/env python3
"""One-time private Gemini credential setup on the C720P; never prints the key."""
import asyncio, getpass, os, pathlib, subprocess, sys
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
    if not sys.stdin.isatty():
        print("Requires an interactive terminal for secure key entry.")
        return 2
    print("Get a Gemini API key from https://aistudio.google.com/api-keys")
    print("Paste the key here. Input is hidden; it is not sent to ChatGPT or GitHub.")
    key=getpass.getpass("Gemini API key: ").strip()
    if not (20 <= len(key) <= 512 and "\n" not in key and "\r" not in key):
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
