#!/usr/bin/env python3
"""One-shot S5 loudspeaker -> C720P acoustic Home Assistant test.

Uses the existing C720P Piper voice service to synthesize a wake phrase and
office-light command. Compiles a temporary AudioTrack Java runner, transfers
PCM and dex to the Galaxy S5 over verified ADB, and plays at phone media max.
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

async def synth(text):
    audio=bytearray()
    rate=0
    channels=0
    async with AsyncTcpClient("127.0.0.1",10200) as c:
        await c.write_event(Synthesize(text=text, voice=SynthesizeVoice(
            name="en_US-lessac-medium",language="en_US")).event())
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

def main():
    report={"test":"S5-speaker-to-C720P-office-lights","serial":SERIAL}
    assert JAR.is_file(), "Android platform SDK unavailable"
    assert adb("get-state")=="device","S5 ADB disconnected"
    assert adb("shell","getprop","ro.product.model")==MODEL,"unexpected phone"
    adb("shell","cmd","media_session","volume","--stream","3","--set","15")
    report["media_volume_target"]="15/15"
    wake=asyncio.run(synth("Hey Google"))
    office=asyncio.run(synth("turn off the office lights"))
    w=pcm_at_rate(*wake,0.86)
    o=pcm_at_rate(*office,0.94)
    zero=lambda sec:bytes(int(sec*32000))
    pcm=zero(0.8)+w+zero(2.0)+o+zero(1.25)
    report["audio_length_seconds"]=round(len(pcm)/32000,2)
    report["wake_phrase"]="Hey Google"
    report["office_command"]="turn off the office lights"
    with tempfile.TemporaryDirectory(prefix="s5-sound-") as d:
        base=pathlib.Path(d)
        source=base/"S5Play.java"
        source.write_text(JAVA,encoding="utf-8")
        cls=base/"classes"
        cls.mkdir()
        proc(["javac","-source","8","-target","8",
              "-bootclasspath",str(JAR),"-d",str(cls),str(source)])
        dex=base/"dex"
        dex.mkdir()
        proc(["d8","--lib",str(JAR),"--min-api","23","--output",str(dex),
              str(cls/"com/bruis/s5audio/S5Play.class")])
        jar=base/"s5voice.jar"
        with zipfile.ZipFile(jar,"w") as f:
            f.write(dex/"classes.dex","classes.dex")
        sample=base/"phrase.raw"
        sample.write_bytes(pcm)
        adb("push",str(jar),REMOTE_BASE+".jar",timeout=35)
        adb("push",str(sample),REMOTE_BASE+".raw",timeout=35)
        start=datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
        tic=time.monotonic()
        result=adb("shell","sh","-c",
          "CLASSPATH="+REMOTE_BASE+".jar app_process /system/bin "+
          "com.bruis.s5audio.S5Play "+REMOTE_BASE+".raw",timeout=65)
        report["s5_playback"]=result[-1300:]
        report["s5_play_seconds"]=round(time.monotonic()-tic,2)
        report["s5_audio_reported_success"]="success=true" in result
        time.sleep(6)
        report["c720p_wake"]=journal_summary(
            "c720p-openwakeword-v53e.service",start)
        report["c720p_satellite"]=journal_summary(
            "c720p-wyoming-satellite.service",start)
        # Preserve a reusable sound transport in local /tmp for a subsequent
        # safe retry. No microphone recording or personally identifying audio.
    print(json.dumps(report,indent=2))
    return 0 if report.get("s5_audio_reported_success") else 3
if __name__=="__main__":
    raise SystemExit(main())
