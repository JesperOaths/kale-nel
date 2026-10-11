#!/usr/bin/env python3
"""Timed three-step S5 speaker -> C720P wake-word and office-light test.

Uses the existing C720P Piper voice service to synthesize a wake phrase and
office-light command. Compiles a temporary AudioTrack runner and tests the three spoken commands at
reduced media volumes, with live HA light-state polling and stage metrics.
No phone APK installs, no microphone recordings, no persistent phone service,
no modifications to IR bridge or Home Assistant configuration.
"""
from __future__ import annotations
import asyncio, datetime, json, os, pathlib, shutil, subprocess, tempfile, time, zipfile
from wyoming.client import AsyncTcpClient
from wyoming.tts import Synthesize, SynthesizeVoice
from wyoming.audio import AudioStart, AudioChunk

SERIAL = "[fd00::1:7a4b:87ff:fe80:eee0]:5555"
MODEL = "SM-G900F"
JAR = pathlib.Path("/usr/lib/android-sdk/platforms/android-36/android.jar")
REMOTE_BASE = "/data/local/tmp/c720p_s5_voice_office"
JAVA = r'''package com.bruis.s5audio;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.AudioFormat;
import java.io.FileInputStream;
public class S5Play {
  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("raw_pcm_path_required");
    final int rate = 16000;
    int min = AudioTrack.getMinBufferSize(rate,
        AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
    if (min <= 0) throw new IllegalStateException("invalid_audio_buffer_" + min);
    AudioTrack track = new AudioTrack(AudioManager.STREAM_MUSIC, rate,
        AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT,
        Math.max(min * 4, 32768), AudioTrack.MODE_STREAM);
    if (track.getState() != AudioTrack.STATE_INITIALIZED)
        throw new IllegalStateException("audio_track_uninitialized");
    track.setVolume(1.0f);
    long frames = 0;
    track.play();
    try (FileInputStream f = new FileInputStream(args[0])) {
      byte[] buf = new byte[8192];
      int n;
      while ((n=f.read(buf)) >= 0) {
        int off = 0;
        while (off < n) {
          int written = track.write(buf, off, n-off);
          if (written <= 0)
            throw new IllegalStateException("audio_write_failed_" + written);
          off += written;
        }
        frames += n / 2;
      }
    }
    long stopAfter = android.os.SystemClock.uptimeMillis() + 3000 +
        (1000L * frames / rate);
    while (track.getPlaybackHeadPosition() + 1600 < frames &&
           android.os.SystemClock.uptimeMillis() < stopAfter) {
      Thread.sleep(50);
    }
    long played = track.getPlaybackHeadPosition();
    track.stop();
    track.release();
    System.out.println("S5_AUDIO_RESULT frames_total=" + frames +
        " frames_played=" + played + " rate=" + rate +
        " success=" + (played + 1600 >= frames));
    if (played + 1600 < frames) System.exit(3);
  }
}'''

def proc(args, timeout=45, **kwargs):
    p=subprocess.run(args, capture_output=True, timeout=timeout, **kwargs)
    if p.returncode:
        raise RuntimeError("command_failed:"+pathlib.Path(args[0]).name+
                           ":"+p.stderr.decode(errors="replace")[-400:])
    return p.stdout.decode(errors="replace").strip()

def adb(*args, timeout=45):
    return proc(["adb", "-s", SERIAL, *args], timeout=timeout)

async def synth(text, voice="en_US-lessac-medium", language="en_US"):
    audio=bytearray()
    rate=0
    channels=0
    async with AsyncTcpClient("127.0.0.1",10200) as c:
        await c.write_event(Synthesize(text=text, voice=SynthesizeVoice(
            name=voice,language=language)).event())
        for _ in range(100):
            e=await asyncio.wait_for(c.read_event(), timeout=22)
            if e is None: break
            if e.type=="audio-start":
                obj=AudioStart.from_event(e)
                rate=obj.rate
                channels=obj.channels
            elif e.type=="audio-chunk":
                audio.extend(AudioChunk.from_event(e).audio)
            elif e.type=="audio-stop":
                break
    if rate <= 0 or channels < 1 or not 10000 < len(audio) < 900000:
        raise RuntimeError("synthetic_audio_invalid")
    return bytes(audio),rate,channels

def pcm_at_rate(raw,rate,channels,tempo):
    p=subprocess.run(["ffmpeg","-hide_banner","-loglevel","error",
       "-f","s16le","-ar",str(rate),"-ac",str(channels),"-i","pipe:0",
       "-af",f"atempo={tempo},volume=0.88","-ar","16000","-ac","1",
       "-f","s16le","pipe:1"],input=raw,capture_output=True,timeout=25)
    if p.returncode:raise RuntimeError("resample_failed")
    return p.stdout

def journal_summary(unit,since):
    p=subprocess.run(["journalctl","--user","-u",unit,
                      "--since",since,"--no-pager","--output=cat"],
                     capture_output=True,text=True,timeout=16)
    lines=p.stdout.splitlines()
    if "openwakeword" in unit:
        return {"wake_detected":sum("Detected hey_google" in x for x in lines),
                "vosk_fallback_accepted":sum("VOSK_WAKE_FALLBACK accepted" in x for x in lines),
                "vosk_checks":sum("VOSK_WAKE_CHECK n=" in x for x in lines)}
    return {"waiting_events":sum("Waiting for wake word" in x for x in lines),
            "connected_events":sum("Connected to server" in x for x in lines)}


import base64
import importlib.util
import socket
import urllib.request
import urllib.parse
import math
import re

def cdp_connection():
    p="/tmp/c720p-cdp-ws-helper.py"
    spec=importlib.util.spec_from_file_location("cdp_ws",p)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    with urllib.request.urlopen("http://127.0.0.1:9222/json/list",timeout=5) as r:
        tabs=json.load(r)
    page=next(t for t in tabs if t.get("type")=="page" and "localhost:8123" in t.get("url",""))
    uri=urllib.parse.urlsplit(page["webSocketDebuggerUrl"])
    conn=socket.create_connection(("127.0.0.1",uri.port),timeout=12)
    conn.settimeout(12)
    key=base64.b64encode(os.urandom(16)).decode()
    conn.sendall(("GET "+uri.path+" HTTP/1.1\r\nHost: 127.0.0.1:"+str(uri.port)+"\r\n"
                  +"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: "+key
                  +"\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    f=conn.makefile("rb")
    if b"101" not in f.readline(4096):
        raise RuntimeError("cdp_websocket_upgrade_failed")
    while f.readline(4096) not in (b"\r\n",b"\n",b""):
        pass
    ws=mod.WS.__new__(mod.WS)
    ws.sock=conn
    ws.file=f
    ws.seq=0
    return ws

class LiveHA:
    def __init__(self):
        self.ws=cdp_connection()
        self.n=0
    def state(self):
        self.n+=1
        rid=self.n
        js="""(()=>{const h=document.querySelector('home-assistant')?.hass;
        if(!h)return {error:"hass_missing"};
        const ids=['light.plafond_office','light.c720p_v41_office_lights','light.c720p_ui_office_lights'];
        return {lights:Object.fromEntries(ids.map(id=>[id,{state:h.states[id]?.state||'absent', changed:h.states[id]?.last_changed||null}])),
        satellite:h.states['assist_satellite.c720p_room']?.state||null,
        walltime:new Date().toISOString()};})()"""
        self.ws.send({"id":rid,"method":"Runtime.evaluate",
                      "params":{"expression":js,"returnByValue":True}})
        for _ in range(50):
            evt=self.ws.recv()
            if evt.get("id")==rid:
                if "exceptionDetails" in evt.get("result",{}):
                    raise RuntimeError("ha_js_evaluation_error")
                return evt.get("result",{}).get("result",{}).get("value",{})
        raise RuntimeError("ha_cdp_timeout")
    def close(self):
        try:self.ws.sock.close()
        finally:self.ws.file.close()

def synth_alternative(text, profile):
    executable=shutil.which("espeak-ng") or shutil.which("espeak")
    if executable and profile.get("espeak_voice"):
        p=subprocess.run([executable,"--stdout","-v",profile["espeak_voice"],
                          "-s",str(profile["wpm"]),text],capture_output=True,timeout=24)
        if p.returncode==0 and len(p.stdout)>3000:
            f=subprocess.run(["ffmpeg","-hide_banner","-loglevel","error",
                 "-i","pipe:0","-ar","16000","-ac","1",
                 "-f","s16le","pipe:1"],input=p.stdout,capture_output=True,timeout=20)
            if f.returncode==0 and len(f.stdout)>3000:
                return f.stdout, "espeak_"+profile["espeak_voice"]
    voice=profile.get("piper_voice","en_US-lessac-medium")
    language=profile.get("piper_language","en_US")
    try:
        r,rate,channels=asyncio.run(synth(text,voice,language))
        return pcm_at_rate(r,rate,channels,1.0), "piper_"+voice
    except Exception:
        # A deployed Piper instance may only advertise one model, despite
        # having multiple on disk. Fall back without falsely claiming it used
        # another trained voice.
        r,rate,channels=asyncio.run(synth(text))
        return pcm_at_rate(r,rate,channels,1.0), "piper_lessac_fallback"

def alter_pcm(raw,profile):
    # Slightly alter speaking pace and vocal pitch without grotesque timbre.
    # Playback volume is controlled with Android stream volume, not audio clipping.
    pitch=profile["pitch"]
    tempo=profile["tempo"]
    p=subprocess.run(["ffmpeg","-hide_banner","-loglevel","error",
        "-f","s16le","-ar","16000","-ac","1","-i","pipe:0",
        "-af",f"asetrate=16000*{pitch},aresample=16000,atempo={tempo},volume=0.86",
        "-f","s16le","-ar","16000","-ac","1","pipe:1"],
        input=raw,capture_output=True,timeout=25)
    if p.returncode or not p.stdout:raise RuntimeError("filter_failed")
    return p.stdout

def build_runner(base):
    source=base/"S5Play.java"
    source.write_text(JAVA,encoding="utf-8")
    cls=base/"classes"
    dex=base/"dex"
    cls.mkdir(); dex.mkdir()
    proc(["javac","-source","8","-target","8",
          "-bootclasspath",str(JAR),"-d",str(cls),str(source)],timeout=45)
    proc(["d8","--lib",str(JAR),"--min-api","23","--output",str(dex),
          str(cls/"com/bruis/s5audio/S5Play.class")],timeout=45)
    jar=base/"s5voice.jar"
    with zipfile.ZipFile(jar,"w") as f:f.write(dex/"classes.dex","classes.dex")
    adb("push",str(jar),REMOTE_BASE+".jar",timeout=40)

def wake_log_since(start):
    p=subprocess.run(["journalctl","--user","-u","c720p-openwakeword-v53e.service",
        "--since",start,"--no-pager","-o","cat"],capture_output=True,text=True,timeout=15)
    rows=p.stdout.splitlines()
    return {"vosk_check_count":sum("VOSK_WAKE_CHECK" in x for x in rows),
            "wake_detection_log_count":sum("detected" in x.lower() and ("hey_google" in x.lower() or "wake" in x.lower()) for x in rows),
            "wake_fallback_log_count":sum("VOSK_WAKE_FALLBACK accepted" in x for x in rows),
            "speech_activity_log_count":sum("speech" in x.lower() for x in rows)}

PROFILES=[
    {"text":"Hey Google turn on the office lights",
     "wake":"Hey Google","command":"turn on the office lights","volume":12,
     "espeak_voice":None,"piper_voice":"en_US-lessac-medium","piper_language":"en_US","wpm":154,"pitch":1.00,"tempo":0.97,"pause":1.10,"label":"piper_natural"},
    {"text":"Hey Google turn the office lights off",
     "wake":"Hey Google","command":"turn the office lights off","volume":11,
     "espeak_voice":None,"piper_voice":"en_GB-southern_english_female-low","piper_language":"en_GB","wpm":147,"pitch":1.01,"tempo":0.98,"pause":1.15,"label":"alternate_female"},
    {"text":"Hey Google turn the office lights on",
     "wake":"Hey Google","command":"turn the office lights on","volume":10,
     "espeak_voice":None,"piper_voice":"en_US-lessac-medium","piper_language":"en_US","wpm":158,"pitch":0.96,"tempo":1.02,"pause":1.00,"label":"alternate_male"},
]

def play_one(prof,base,ha,expected):
    start_utc=datetime.datetime.now().astimezone()
    before=ha.state()
    wake,source_a=synth_alternative(prof["wake"],prof)
    command,source_b=synth_alternative(prof["command"],prof)
    wake=alter_pcm(wake,prof)
    command=alter_pcm(command,prof)
    zero=lambda sec:bytes(round(sec*32000))
    sound=zero(0.4)+wake+zero(prof["pause"])+command+zero(0.9)
    total_seconds=len(sound)/32000
    sample=base/("voice_"+expected+"_"+str(prof["volume"])+".raw")
    sample.write_bytes(sound)
    remote=REMOTE_BASE+"_"+expected+"_"+str(prof["volume"])+".raw"
    adb("push",str(sample),remote,timeout=45)
    adb("shell","cmd","media_session","volume","--stream","3","--set",str(prof["volume"]),timeout=12)
    t0=time.monotonic()
    # Do not use the HA API to flip lights. Only acoustic speaker input is sent.
    player=subprocess.Popen(["adb","-s",SERIAL,"shell",
         "CLASSPATH="+REMOTE_BASE+".jar app_process /system/bin com.bruis.s5audio.S5Play "+remote],
         stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    checks=0
    changed_at=None
    last=before
    original=before.get("lights",{}).get("light.plafond_office",{}).get("state")
    while time.monotonic()-t0<total_seconds+12:
        try:
            last=ha.state()
            checks+=1
        except Exception as e:
            last={"error":type(e).__name__}
        s=last.get("lights",{}).get("light.plafond_office",{}).get("state")
        if changed_at is None and s==expected and original!=expected:
            changed_at=time.monotonic()-t0
        if player.poll() is not None and time.monotonic()-t0>total_seconds+7:
            break
        time.sleep(0.55)
    if player.poll() is None:
        player.terminate()
        try:player.wait(timeout=5)
        except subprocess.TimeoutExpired:player.kill()
    out,err=player.communicate(timeout=10)
    after=ha.state()
    wake_log=wake_log_since(start_utc.strftime("%Y-%m-%d %H:%M:%S"))
    parsed=re.search(r"frames_total=(\d+) frames_played=(\d+) rate=(\d+) success=(\w+)",out)
    return {
       "requested":prof["text"],"desired_light_state":expected,
       "profile":prof["label"],"actual_voice_source":source_b,
       "volume_out_of_15":prof["volume"],"wake_to_command_gap_s":prof["pause"],
       "audio_duration_s":round(total_seconds,3),
       "wake_audio_duration_s":round(len(wake)/32000,3),
       "command_audio_start_after_launch_s":round(0.4+len(wake)/32000+prof["pause"],3),
       "command_audio_duration_s":round(len(command)/32000,3),
       "before":before.get("lights",{}).get("light.plafond_office"),
       "after":after.get("lights",{}).get("light.plafond_office"),
       "playback_exit_code":player.returncode,
       "android_playback":parsed.group(0) if parsed else out[-350:],
       "state_transition_observed":changed_at is not None,
       "state_change_seconds_after_launch":round(changed_at,3) if changed_at is not None else None,
       "full_observation_duration_s":round(time.monotonic()-t0,3),
       "poll_count":checks,"wake":wake_log,"satellite_final_state":after.get("satellite"),
       "errors":err[-350:] if err else None
    }

def main():
    assert JAR.is_file()
    assert adb("get-state")=="device"
    assert adb("shell","getprop","ro.product.model")==MODEL
    result={"kind":"3-step S5 acoustic wake test: ON OFF ON",
           "no_direct_light_service_calls":True,
           "started_at":datetime.datetime.now().astimezone().isoformat(),
           "tests":[]}
    ha=LiveHA()
    try:
        with tempfile.TemporaryDirectory(prefix="s5-acoustic-sequence-") as temp:
            build_runner(pathlib.Path(temp))
            for prof,wanted in zip(PROFILES,["on","off","on"]):
                try:
                    step=play_one(prof,pathlib.Path(temp),ha,wanted)
                except Exception as ex:
                    step={"requested":prof["text"],"error":type(ex).__name__+":"+str(ex)[:150]}
                result["tests"].append(step)
                print("STEP_RESULT "+json.dumps(step),flush=True)
                # Short break for reset/re-arm and user's requested waiting.
                time.sleep(3)
    finally:
        # Restore user-requested 15/15 baseline.
        try:adb("shell","cmd","media_session","volume","--stream","3","--set","15",timeout=12)
        except Exception:pass
        try:result["final_ha"]=ha.state()
        except Exception:pass
        ha.close()
        result["ended_at"]=datetime.datetime.now().astimezone().isoformat()
    print("FINAL_REPORT "+json.dumps(result),flush=True)
    return 0
if __name__=="__main__":
    raise SystemExit(main())
