#!/usr/bin/env python3
"""S5-to-C720P office-light acoustic matrix. No direct HA light operations.
Four controlled S5 voice/volume attempts with concurrent in-memory Trust mic
energy measurement, wake log counters, stage timings and HA state polling.
"""
from __future__ import annotations
import array, asyncio, datetime, json, math, os, pathlib, runpy, subprocess, threading, time
base=runpy.run_path("/tmp/s5-office-acoustic-three-step-20261011.py",run_name="s5_primitives")
serial=base["SERIAL"]
remote=base["REMOTE_BASE"]
mic_telemetry=pathlib.Path("/home/jespern/c720p-home-hub/runtime/c720p_mic_telemetry.json")

def shell(args,timeout=20):
    p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    return {"rc":p.returncode,"out":p.stdout.strip()[-500:],"error_type":"none" if p.returncode==0 else "command_nonzero"}
def stat(pcm):
    v=array.array("h")
    v.frombytes(pcm[:len(pcm)//2*2])
    if not v:return (0.,0)
    return (round(math.sqrt(sum(int(x)*int(x) for x in v)/len(v)),1),max(abs(int(x)) for x in v))
def monitor_mic(source,play_callback):
    mic=subprocess.Popen(["parec","--device="+source,"--raw","--format=s16le",
                          "--rate=16000","--channels=1","--latency-msec=80"],
                         stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0)
    data=bytearray()
    flag=[True]
    def read():
        try:
            while flag[0] and len(data)<700000:
                chunk=os.read(mic.stdout.fileno(),4096)
                if not chunk:break
                data.extend(chunk[:max(0,700000-len(data))])
        except OSError:pass
    t=threading.Thread(target=read,daemon=True);t.start()
    try:
        time.sleep(1.1)
        pre=len(data)
        events=play_callback()
        heard=len(data)
        time.sleep(0.75)
    finally:
        flag[0]=False
        mic.terminate()
        try:mic.wait(timeout=2)
        except subprocess.TimeoutExpired:mic.kill()
        t.join(timeout=2)
    signal=bytes(data[pre:heard])
    before=bytes(data[:pre])
    after=bytes(data[heard:])
    a,b=stat(before),stat(signal)
    results={"samples":{"baseline_bytes":len(before),"playback_bytes":len(signal),"after_bytes":len(after)},
       "rms_pre":a[0],"rms_playing":b[0],"rms_post":stat(after)[0],
       "peak_playing":b[1],"rms_ratio":round(b[0]/max(a[0],1),2)}
    del signal,before,after,data
    return events,results

def clean_logs(since):
    out={}
    for key,unit in [
        ("wake","c720p-openwakeword-v53e.service"),
        ("satellite","c720p-wyoming-satellite.service"),
        ("mic","c720p-voice-mic-stream-v53e.service")]:
        p=subprocess.run(["journalctl","--user","-u",unit,"--since",since,
                          "-o","cat","--no-pager"],capture_output=True,text=True,timeout=14)
        lines=p.stdout.splitlines()
        out[key]={"lines":len(lines)}
        if key=="wake":
            out[key].update({"vosk_checks":sum("VOSK_WAKE_CHECK" in s for s in lines),
                 "detections":sum("Detected hey_google" in s for s in lines),
                 "fallback_accepted":sum("VOSK_WAKE_FALLBACK accepted" in s for s in lines)})
        if key=="satellite":
            out[key].update({"wake_events":sum("wake" in s.lower() and "detected" in s.lower() for s in lines),
                 "disconnects":sum("Disconnected from server" in s for s in lines),
                 "connects":sum("Connected to server" in s for s in lines)})
    return out
def one(ha,sound,vol,wanted,accent,index):
    state0=ha.state()
    original=state0.get("lights",{}).get("light.plafond_office",{}).get("state")
    assert original in ("off","on"),"real_office_light_unavailable"
    assert wanted!=original,"non_opposing_command_not_allowed"
    info=json.loads(mic_telemetry.read_text())
    assert info.get("ok") and time.time()-float(info.get("last_audio_epoch",0))<3,"mic_not_fresh"
    source=info.get("source")
    assert source and source.startswith("alsa_input.usb-"),"mic_source_not_usb"
    filename=f"{remote}_matrix_{index}.raw"
    temp=pathlib.Path(f"/tmp/s5_wake_matrix_{index}.raw")
    temp.write_bytes(sound)
    push=shell(["adb","-s",serial,"push",str(temp),filename],timeout=30)
    if push["rc"]!=0:raise RuntimeError("sample_push_failed")
    temp.unlink(missing_ok=True)
    setvol=shell(["adb","-s",serial,"shell","cmd","media_session","volume",
                  "--stream","3","--set",str(vol)])
    assert setvol["rc"]==0,"could_not_set_s5_volume"
    started=datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
    def play_and_observe():
        at=time.monotonic()
        p=subprocess.Popen(["adb","-s",serial,"shell",
          "CLASSPATH="+remote+".jar app_process /system/bin com.bruis.s5audio.S5Play "+filename],
          stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        first_wake=None;first_change=None;polls=0
        duration=len(sound)/32000
        while time.monotonic()-at<duration+8.5:
            polls+=1
            try:
                s=ha.state()
                light=s.get("lights",{}).get("light.plafond_office",{}).get("state")
                if light==wanted and first_change is None:first_change=round(time.monotonic()-at,3)
            except Exception:pass
            if p.poll() is not None and time.monotonic()-at>duration+3:break
            time.sleep(0.35)
        if p.poll() is None:
            p.terminate()
            try:p.wait(timeout=3)
            except subprocess.TimeoutExpired:p.kill()
        stdout,stderr=p.communicate(timeout=10)
        return {"playback_code":p.returncode,"playback_report":stdout[-185:],
                "audio_play_seconds":round(duration,2),
                "observed_seconds":round(time.monotonic()-at,2),
                "light_response_seconds":first_change,"polls":polls}
    events,acoustics=monitor_mic(source,play_and_observe)
    endstate=ha.state()
    s=endstate.get("lights",{}).get("light.plafond_office",{}).get("state")
    logs=clean_logs(started)
    return {"attempt":index,"accent":accent,"s5_volume":vol,"target":wanted,
      "before":original,"after":s,"state_change_observed":s==wanted,
      "events":events,"acoustics":acoustics,"logs":logs,
      "satellite_state":endstate.get("satellite")}

def render(profile,phrase):
    p=dict(profile)
    pcm,actual=base["synth_alternative"](phrase,p)
    pcm=base["alter_pcm"](pcm,p)
    return pcm,actual

def raise_speech_level(raw):
    # Normalize the generated *voice waveform* before transfer. A limiter cap
    # prevents clipping, and does not modify C720P microphone gain or thresholds.
    vals=array.array("h")
    vals.frombytes(raw[:len(raw)//2*2])
    if not vals:return (raw,1.0)
    peak=max(abs(int(x)) for x in vals)
    power=math.sqrt(sum(int(v)*int(v) for v in vals)/len(vals))
    gain=min(4.0, 29000.0/max(peak,1), 4800.0/max(power,1))
    boosted=array.array("h",(max(-29000,min(29000,int(round(v*gain)))) for v in vals))
    return boosted.tobytes(),round(gain,2)

def main():
    ha=base["LiveHA"]()
    tests=[]
    try:
        state=ha.state()
        initial=state["lights"]["light.plafond_office"]["state"]
        if initial not in ("on","off"):raise RuntimeError("light_not_accessible")
        target="on" if initial=="off" else "off"
        verb="turn on the office lights" if target=="on" else "turn off the office lights"
        profiles=[
          {"label":"US female boosted slow-wake","piper_voice":"en_US-lessac-medium","piper_language":"en_US","espeak_voice":None,"wpm":150,"tempo":0.94,"pitch":1.0,"pause":1.4,"volume":15},
          {"label":"UK female boosted slow-wake","piper_voice":"en_GB-southern_english_female-low","piper_language":"en_GB","espeak_voice":None,"wpm":146,"tempo":0.92,"pitch":1.0,"pause":1.4,"volume":15},
          {"label":"US lower-volume boosted","piper_voice":"en_US-lessac-medium","piper_language":"en_US","espeak_voice":None,"wpm":152,"tempo":0.96,"pitch":1.0,"pause":1.25,"volume":12}
        ]
        for i,p in enumerate(profiles,1):
            current=ha.state()["lights"]["light.plafond_office"]["state"]
            if current==target:
                tests.append({"attempt":i,"skipped":"target_already_reached"})
                break
            if current not in ("on","off"):break
            command="turn on the office lights" if current=="off" else "turn off the office lights"
            wanted="on" if current=="off" else "off"
            wake_prof=dict(p);wake_prof["tempo"]=0.79
            wake,wv=render(wake_prof,"Hey Google")
            action,av=render(p,command)
            wake,wake_gain=raise_speech_level(wake)
            action,command_gain=raise_speech_level(action)
            silence=lambda seconds:bytes(round(seconds*32000))
            sound=silence(.85)+wake+silence(p["pause"])+action+silence(.85)
            result=one(ha,sound,p["volume"],wanted,p["label"],i)
            result.update({"voice_source":av,"wake_source":wv,
                           "command_audio_onset_s":round(.85+len(wake)/32000+p["pause"],3),
                           "wake_seconds":round(len(wake)/32000,2),
                           "wake_pcm_gain":wake_gain,"command_pcm_gain":command_gain,
                           "command_audio_duration_s":round(len(action)/32000,3)})
            tests.append(result)
            print("LIVE_STEP "+json.dumps(result),flush=True)
            time.sleep(2)
        final=ha.state()
        print("LIVE_MATRIX "+json.dumps({"initial_light_state":initial,
            "target":"opposite_of_initial",
            "attempts":tests,
            "final_office":final.get("lights",{}).get("light.plafond_office"),
            "satellite":final.get("satellite"),
            "test_made_no_direct_light_calls":True,
            "microphone_recordings_persisted":False,
            "finished":datetime.datetime.now().astimezone().isoformat()}),flush=True)
    finally:
        shell(["adb","-s",serial,"shell","cmd","media_session","volume","--stream","3","--set","15"],timeout=12)
        ha.close()
if __name__=="__main__":
    main()
