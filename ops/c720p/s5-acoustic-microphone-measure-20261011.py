#!/usr/bin/env python3
"""Measure S5-speaker audio reaching the C720P Trust microphone without persisting room audio."""
import asyncio, array, json, math, os, pathlib, subprocess, threading, time
from wyoming.client import AsyncTcpClient
from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioStart, AudioChunk, AudioStop

SERIAL="[fd00::1:7a4b:87ff:fe80:eee0]:5555"
REMOTE="/data/local/tmp/c720p_s5_voice_office"
TELE=pathlib.Path("/home/jespern/c720p-home-hub/runtime/c720p_mic_telemetry.json")
def cli(args,timeout=30):
    p=subprocess.run(args,capture_output=True,timeout=timeout,text=True)
    return {"rc":p.returncode,"out":p.stdout[-500:],"err":p.stderr[-250:]}
def rms(pcm):
    vals=array.array("h")
    vals.frombytes(pcm[:len(pcm)//2*2])
    if not vals:return 0.0
    return math.sqrt(sum(int(x)*int(x) for x in vals)/len(vals))
def peak(pcm):
    vals=array.array("h");vals.frombytes(pcm[:len(pcm)//2*2])
    if not vals:return 0
    return max(abs(int(v)) for v in vals)
async def vosk(pcm):
    try:
        async with AsyncTcpClient("127.0.0.1",10303) as c:
            await c.write_event(Transcribe(language="en").event())
            await c.write_event(AudioStart(rate=16000,width=2,channels=1).event())
            for off in range(0,len(pcm),12800):
                await c.write_event(AudioChunk(rate=16000,width=2,channels=1,audio=pcm[off:off+12800]).event())
            await c.write_event(AudioStop().event())
            for _ in range(12):
                evt=await asyncio.wait_for(c.read_event(),timeout=10)
                if evt is None:break
                if evt.type=="transcript":
                    t=(Transcript.from_event(evt).text or "").strip().lower()
                    return {"recognized_hey_google":t.startswith("hey google"),
                            "contains_hey_google":"hey google" in t,
                            "recognized_hey":t.startswith("hey"),
                            "result_characters":len(t)}
    except Exception as e:
        return {"error":type(e).__name__}
    return {"recognized_hey_google":False,"result_characters":0}

def main():
    m=json.loads(TELE.read_text())
    src=str(m.get("source",""))
    if not m.get("ok") or not src.startswith("alsa_input.usb-"):
        raise RuntimeError("unexpected_microphone_state")
    if time.time()-float(m.get("last_audio_epoch",0))>5:
        raise RuntimeError("stale_microphone_stream")
    if cli(["adb","-s",SERIAL,"get-state"])["out"].strip()!="device":
        raise RuntimeError("s5_adb_absent")
    rawfile=REMOTE+"_on_12.raw"
    if cli(["adb","-s",SERIAL,"shell","ls",rawfile])["rc"]!=0:
        raise RuntimeError("s5_pcm_from_previous_acoustic_test_absent")
    mic=subprocess.Popen(["parec","--device="+src,"--raw","--format=s16le","--rate=16000",
                           "--channels=1","--latency-msec=80"],
                          stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0)
    data=bytearray()
    running=[True]
    def capture():
        try:
            while running[0] and len(data)<500000:
                piece=os.read(mic.stdout.fileno(),4096)
                if not piece:break
                data.extend(piece[:max(0,500000-len(data))])
        except OSError:pass
    thread=threading.Thread(target=capture,daemon=True);thread.start()
    try:
        time.sleep(1.8)
        before=len(data)
        cli(["adb","-s",SERIAL,"shell","cmd","media_session","volume","--stream","3","--set","12"],12)
        start=time.monotonic()
        play=cli(["adb","-s",SERIAL,"shell",
             "CLASSPATH="+REMOTE+".jar app_process /system/bin com.bruis.s5audio.S5Play "+rawfile],45)
        end=time.monotonic()
        after_play=len(data)
        time.sleep(1.2)
    finally:
        running[0]=False
        mic.terminate()
        try:mic.wait(timeout=3)
        except subprocess.TimeoutExpired:mic.kill()
        thread.join(timeout=3)
        cli(["adb","-s",SERIAL,"shell","cmd","media_session","volume","--stream","3","--set","15"],12)
    # Capture only synthetic test speech in RAM and output aggregates, never PCM or room transcripts.
    baseline=bytes(data[:before])
    heard=bytes(data[before:after_play])
    following=bytes(data[after_play:])
    slice_wake=heard[:min(len(heard),int(2.0*32000))]
    recognition=asyncio.run(vosk(slice_wake))
    print(json.dumps({
       "test":"S5 acoustic signal at C720P Trust mic",
       "s5_playback":play,
       "phone_volume_tested":"12/15","phone_volume_restored":"15/15",
       "playback_wall_seconds":round(end-start,3),
       "captured_bytes":{"pre":len(baseline),"during":len(heard),"post":len(following)},
       "rms":{"pre":round(rms(baseline),1),"during":round(rms(heard),1),"post":round(rms(following),1)},
       "peak_during":peak(heard),
       "rms_ratio_during_vs_pre":round(rms(heard)/max(rms(baseline),1),2),
       "wake_recognition":recognition,
       "mic_telemetry_ok":bool(m.get("ok")),
       "recording_saved":False
    }),flush=True)
if __name__=="__main__":
    main()
