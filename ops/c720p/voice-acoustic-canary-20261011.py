#!/usr/bin/env python3
"""C720P voice acoustic canary. One harmless temperature query; no device changes.

Synthetic voice is played by the existing speaker at limited per-stream volume.
Captures only 8s of live mic PCM in RAM, never writes or prints raw audio.
Checks wake and satellite journal counters; captures TTS output mtime.
"""
import asyncio, datetime, json, os, pathlib, subprocess, threading, time
from wyoming.client import AsyncTcpClient
from wyoming.tts import Synthesize, SynthesizeVoice
from wyoming.audio import AudioStart, AudioChunk, AudioStop
from wyoming.asr import Transcribe, Transcript

BASE = pathlib.Path("/home/jespern/c720p-home-hub")
MIC = BASE / "runtime/c720p_mic_telemetry.json"
TTS = pathlib.Path("/tmp/c720p-last-tts.raw")
VOICE = SynthesizeVoice(name="en_US-lessac-medium", language="en_US")
VOLUME = "40000"  # per-stream 61%, does not change master volume

def mic_state():
    try:
        return json.loads(MIC.read_text())
    except Exception:
        return {}

async def speech(text):
    audio=bytearray(); rate=0; chans=0
    async with AsyncTcpClient("127.0.0.1", 10200) as c:
        await c.write_event(Synthesize(text=text, voice=VOICE).event())
        for _ in range(150):
            event = await asyncio.wait_for(c.read_event(), timeout=18)
            if event is None:
                break
            if event.type=="audio-start":
                a=AudioStart.from_event(event);rate=a.rate;chans=a.channels
            elif event.type=="audio-chunk":
                a=AudioChunk.from_event(event);audio.extend(a.audio)
            elif event.type=="audio-stop":
                break
    if rate != 22050 or chans != 1 or not 8000 < len(audio) < 900000:
        raise RuntimeError("unusable_tts_sample")
    return bytes(audio),rate

def cmd(args, timeout=12, input=None):
    return subprocess.run(args, input=input, capture_output=True, timeout=timeout)

def journal_events(unit, since):
    p=cmd(["journalctl", "--user", "-u", unit, "--since", since,
           "--no-pager", "--output=cat"],timeout=13)
    lines=p.stdout.decode(errors="replace").splitlines()
    if "openwakeword" in unit:
        return {"detected":sum("Detected hey_google" in x for x in lines),
                "vosk_accepted":sum("VOSK_WAKE_FALLBACK accepted" in x for x in lines),
                "vosk_rejected":sum("VOSK_WAKE_FALLBACK rejected" in x for x in lines),
                "vosk_checks":sum("VOSK_WAKE_CHECK n=" in x for x in lines)}
    return {"waiting":sum("Waiting for wake word" in x for x in lines),
            "connected":sum("Connected to server" in x for x in lines),
            "disconnected":sum("Disconnected from server" in x for x in lines)}


async def classify_audio(port, pcm):
    """Send RAM-only sample to an already-running local speech recognizer."""
    try:
        if len(pcm)<4000:
            return ""
        async with AsyncTcpClient("127.0.0.1", port) as c:
            await c.write_event(Transcribe(language="en").event())
            await c.write_event(AudioStart(rate=16000,width=2,channels=1).event())
            for off in range(0,len(pcm),12800):
                await c.write_event(AudioChunk(rate=16000,width=2,channels=1,
                                               audio=pcm[off:off+12800]).event())
            await c.write_event(AudioStop().event())
            for _ in range(8):
                event=await asyncio.wait_for(c.read_event(),timeout=8)
                if event is None:break
                if event.type=="transcript":
                    return (Transcript.from_event(event).text or "").strip().lower()
    except Exception:
        pass
    return ""

def main():
    before=mic_state()
    if not before.get("ok") or time.time()-float(before.get("last_audio_epoch",0))>3:
        raise RuntimeError("mic_not_healthy")
    wake,rate=asyncio.run(speech("Hey Google"))
    question,r2=asyncio.run(speech("What is the temperature in the living room?"))
    if rate!=r2:raise RuntimeError("tts_sample_rate_mismatch")
    before_tts=TTS.stat().st_mtime if TTS.exists() else 0
    # Capture microphone exclusively into memory. Do not save user-room audio.
    source=before.get("source")
    if not source or not str(source).startswith("alsa_input.usb-"):
        raise RuntimeError("unexpected_mic_source")
    capture=subprocess.Popen(["parec","--device="+source,"--raw","--format=s16le",
                              "--rate=16000","--channels=1","--latency-msec=80"],
                              stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0)
    buf=bytearray(); capture_done=[False]; snapshots=[]
    def read_pcm():
        try:
            while not capture_done[0] and len(buf)<500000:
                data=os.read(capture.stdout.fileno(),4096)
                if not data:break
                buf.extend(data[:max(0,500000-len(buf))])
        except OSError:pass
    def monitor():
        while not capture_done[0]:
            snapshots.append(float(mic_state().get("raw_rms") or 0))
            time.sleep(0.16)
    thread=threading.Thread(target=read_pcm,daemon=True);thread.start()
    thread2=threading.Thread(target=monitor,daemon=True);thread2.start()
    start=datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
    timings=[]; raised=None
    try:
        # Speaker input gets a lead-in, separate wake and command, and clear gap.
        for index,(sound,lead,tail) in enumerate(((wake,.55,.15),(question,.05,.25))):
            if index==1: time.sleep(.95)
            pcm=bytes(int(lead*rate*2))+sound+bytes(int(tail*rate*2))
            tick=time.monotonic()
            p=cmd(["paplay","--raw","--format=s16le","--rate="+str(rate),
                   "--channels=1","--volume="+VOLUME,
                   "--stream-name=C720P-harmless-voice-canary"],input=pcm,timeout=22)
            timings.append({"stage":"wake" if index==0 else "question",
                            "playback_rc":p.returncode,
                            "duration_s":round(time.monotonic()-tick,2),
                            "pcm_seconds":round(len(pcm)/(rate*2),2)})
            if p.returncode: raise RuntimeError("playback_error")
        time.sleep(2)
    except Exception as e: raised=type(e).__name__
    finally:
        capture_done[0]=True
        try:capture.terminate();capture.wait(timeout=2)
        except Exception:capture.kill()
        thread.join(timeout=2);thread2.join(timeout=1)
    # The ephemeral microphone capture is not included in logs or persisted.
    mic_bytes=len(buf)
    # Classify only expected synthetic speech, and never output recognized
    # free-form room text or store PCM. Compare exact expected commands.
    wake_end_s=timings[0]["duration_s"] if timings else 0
    query_start_s=wake_end_s+0.95
    wake_pcm=bytes(buf[:int((wake_end_s+0.15)*32000)])
    query_pcm=bytes(buf[int(max(0,query_start_s-0.05)*32000):])
    wake_heard=asyncio.run(classify_audio(10303,wake_pcm))
    query_heard=asyncio.run(classify_audio(10301,query_pcm))
    acoustic_recognition={
        "vosk_wake_exact":wake_heard.startswith("hey google"),
        "vosk_wake_characters":len(wake_heard),
        "vosk_home_temperature_exact":(
            "temperature in the living room" in query_heard
        ),
        "vosk_home_characters":len(query_heard),
    }
    del wake_pcm,query_pcm,buf,wake_heard,query_heard
    updated=False
    for _ in range(22):
        if TTS.is_file() and TTS.stat().st_mtime>before_tts+0.2:
            updated=True
            break
        time.sleep(1)
    after=mic_state()
    print(json.dumps({
        "version":"c720p-acoustic-canary-20261011",
        "test_type":"two_utterance_wake_then_temperature_question",
        "sample_contents_saved":False,
        "microphone_pcm_bytes_observed":mic_bytes,
        "acoustic_recognition":acoustic_recognition,
        "mic_peak_rms":round(max(snapshots,default=0),1),
        "mic_before_rms":before.get("raw_rms"),
        "mic_after_recent":time.time()-float(after.get("last_audio_epoch",0))<2,
        "wake_journal":journal_events("c720p-openwakeword-v53e.service",start),
        "satellite_journal":journal_events("c720p-wyoming-satellite.service",start),
        "spoken_response_generated":updated,
        "response_bytes":TTS.stat().st_size if updated else 0,
        "playback":timings,"test_error":raised}),flush=True)
    return 0 if not raised else 3

if __name__=="__main__":
    raise SystemExit(main())
