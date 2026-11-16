#!/usr/bin/env python3
"""Minimal S21 Tune Rush recovery: discover, verify and revive its own watchdog.

No video, audio, HTTP media, or other device is processed by the C720P.
"""
from __future__ import annotations
import ipaddress
import json
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import time

PHONE_MODEL="SM-G991B"
# The private, mode-0600 hub device proof is the sole source of the
# S21 hardware serial. Never commit it to the public source repository.
TRUSTED_PHONE=Path("/home/jespern/tunerush-internet-bridge/trusted-s21.json")


def expected_serial():
    data=json.loads(TRUSTED_PHONE.read_text())
    value=data.get("serial")
    if (data.get("model")!=PHONE_MODEL or not isinstance(value,str) or
        not 8<=len(value)<=40):
        raise RuntimeError("S21 private identity record missing or invalid")
    return value

GAME_PORTS=((8797,b"tunerush-s21-solo"),(8798,b"tunerush-s21-multiplayer"))
ADB="/usr/bin/adb"
TERMUX_PY="/data/data/com.termux/files/usr/bin/python3"

def run(args,timeout=12):
    return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                          text=True,timeout=timeout)

def discover():
    """Find only the owner's S21 IPv4 ADB-TLS mDNS announcement."""
    try:
        r=run(["/usr/bin/avahi-browse","-rtp","_adb-tls-connect._tcp"],timeout=12)
    except (OSError,subprocess.TimeoutExpired):
        return None
    for line in r.stdout.splitlines():
        cols=line.split(";")
        if (len(cols)<10 or cols[0]!="=" or cols[2]!="IPv4" or
            cols[4]!="_adb-tls-connect._tcp" or
            not cols[3].startswith("adb-"+expected_serial()+"-") or
            "name="+PHONE_MODEL not in ";".join(cols[9:])):
            continue
        try:
            address=ipaddress.IPv4Address(cols[7])
            port=int(cols[8])
        except (ValueError, IndexError):
            continue
        if (address not in ipaddress.IPv4Network("192.168.178.0/24") or
            not 1024<=port<=65535):
            continue
        return str(address),port
    return None

def healthy(ip):
    # Both existing Solo and cached multiplayer must respond. A stopped
    # multiplayer server must not be treated as a healthy S21 installation.
    for port, expected_service in GAME_PORTS:
        try:
            with socket.create_connection((ip,port),timeout=3) as client:
                client.settimeout(4)
                client.sendall(b"GET /api/health HTTP/1.0\r\nHost: S21\r\nConnection: close\r\n\r\n")
                data=bytearray()
                while len(data) < 8192:
                    chunk=client.recv(4096)
                    if not chunk:
                        break
                    data.extend(chunk)
                    if b"\r\n\r\n" in data and expected_service in data:
                        break
            if b"200 OK" not in data or expected_service not in data:
                return False
        except OSError:
            return False
    return True

def verified_adb(ip, port):
    serial=f"{ip}:{port}"
    result=run([ADB,"connect",serial],timeout=13)
    if result.returncode:
        raise RuntimeError("S21 wireless ADB not connected")
    for prop,expected in (("ro.product.model",PHONE_MODEL),
                          ("ro.serialno",expected_serial())):
        check=run([ADB,"-s",serial,"shell","getprop",prop],timeout=11)
        if check.returncode or check.stdout.strip()!=expected:
            raise RuntimeError("ADB peer identity not verified")
    return serial


def restore(ip,port,serial):
    """Safely start native Termux only if it is not already running.

    Never start a Termux service under Android run-as; it cannot provide
    the native production network context. Do not interrupt an app in use.
    """
    proc=run([ADB,"-s",serial,"shell","ps","-A","-o","ARGS"],timeout=10)
    if "tune-rush-solo/watchdog.py" in proc.stdout:
        print("S21 watchdog running; allow S21 services to finish starting")
        return
    trust=run([ADB,"-s",serial,"shell","dumpsys","trust"],timeout=9)
    window=run([ADB,"-s",serial,"shell","dumpsys","window"],timeout=9)
    power=run([ADB,"-s",serial,"shell","dumpsys","power"],timeout=9)
    active=next((line for line in window.stdout.splitlines() if "mCurrentFocus=" in line),"")
    # Avoid typing into an unrelated app, a locked phone, or a blank display.
    allowed=("com.termux/", "com.sec.android.app.launcher/")
    if ("deviceLocked=0" not in trust.stdout or
        "mWakefulness=Awake" not in power.stdout or
        not any(item in active for item in allowed)):
        print("S21 restart deferred: locked, asleep or another app in use")
        return
    launched=run([ADB,"-s",serial,"shell","am","start","-n",
                  "com.termux/.app.TermuxActivity"],timeout=9)
    if launched.returncode:
        raise RuntimeError("native Termux launch failed")
    time.sleep(2)
    focus=run([ADB,"-s",serial,"shell","dumpsys","window"],timeout=8)
    if "com.termux/com.termux.app.TermuxActivity" not in focus.stdout:
        raise RuntimeError("refusing to type into non-Termux window")
    command="/data/data/com.termux/files/home/tune-rush-solo/start-watchdog.sh"
    typing=run([ADB,"-s",serial,"shell","input","text",command],timeout=9)
    entering=run([ADB,"-s",serial,"shell","input","keyevent","KEYCODE_ENTER"],timeout=9)
    if typing.returncode or entering.returncode:
        raise RuntimeError("native Termux watchdog input failed")
    print("S21 native Termux watchdog start requested")

def sync_gateway(ip, port):
    """Switch only the guarded Tune Rush gateway after verifying S21 identity."""
    import os
    import urllib.request
    from pathlib import Path
    root=Path("/home/jespern/tunerush-internet-bridge")
    proof=root/"trusted-s21.json"
    conf=Path.home()/".config/systemd/user/tunerush-multiplayer-internet-bridge.service.d/10-s21-upstream.conf"
    wanted=json.dumps({"ip":ip,"model":PHONE_MODEL,"serial":expected_serial(),
                       "adb_port":port},sort_keys=True)+"\n"
    wanted_conf=("[Service]\nEnvironment=\"TUNERUSH_S21_MULTIPLAYER_UPSTREAM="
                 "http://"+ip+":8798\"\n")
    before=proof.read_bytes() if proof.exists() else None
    old_conf=conf.read_bytes() if conf.exists() else None
    if before==wanted.encode() and old_conf==wanted_conf.encode():
        return
    # Only alter these two files; make an atomic transition and rollback.
    def atomic_write(path, payload):
        path.parent.mkdir(parents=True,exist_ok=True)
        temp=path.with_suffix(path.suffix+".pending")
        with temp.open("wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        temp.chmod(0o600)
        os.replace(temp,path)
    try:
        atomic_write(proof,wanted.encode())
        atomic_write(conf,wanted_conf.encode())
        reload=run(["/usr/bin/systemctl","--user","daemon-reload"],timeout=8)
        restart=run(["/usr/bin/systemctl","--user","restart",
                     "tunerush-multiplayer-internet-bridge.service"],timeout=12)
        if reload.returncode or restart.returncode:
            raise RuntimeError("restricted gateway restart failed")
        time.sleep(1)
        request=urllib.request.Request("http://127.0.0.1:8806/api/health",
                                       headers={"Host":"jesper-hub.tail87c632.ts.net"})
        with urllib.request.urlopen(request,timeout=5) as resp:
            info=json.load(resp)
            if resp.status!=200 or info.get("service")!="tunerush-s21-multiplayer":
                raise RuntimeError("restricted gateway health mismatch")
    except Exception:
        for path,original in ((proof,before),(conf,old_conf)):
            if original is None: path.unlink(missing_ok=True)
            else: atomic_write(path,original)
        run(["/usr/bin/systemctl","--user","daemon-reload"],timeout=8)
        run(["/usr/bin/systemctl","--user","restart",
             "tunerush-multiplayer-internet-bridge.service"],timeout=12)
        raise
    print("S21 VERIFIED_IP_GATEWAY_SYNCED",ip)


def main():
    found=discover()
    if not found:
        print("S21 wireless ADB not advertised; existing services unchanged")
        return 0
    ip,port=found
    serial=verified_adb(ip,port)
    if healthy(ip):
        sync_gateway(ip,port)
        print("S21 Solo and cached multiplayer healthy at",ip)
        return 0
    restore(ip,port,serial)
    for _ in range(3):
        time.sleep(3)
        if healthy(ip):
            sync_gateway(ip,port)
            print("S21 Solo and cached multiplayer recovered at",ip)
            return 0
    print("S21 discovered and verified but games still starting; retry scheduled")
    return 0

if __name__=="__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(type(error).__name__+": "+str(error)[:200],file=sys.stderr)
        raise SystemExit(1)
