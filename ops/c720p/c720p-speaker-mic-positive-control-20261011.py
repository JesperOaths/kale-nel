#!/usr/bin/env python3
"""Positive control: does the local C720P speaker reach its USB microphone?
Read-only diagnostics for acoustic wake path. Audio stays in RAM.
"""
import json, runpy, subprocess, time
from pathlib import Path
m=runpy.run_path("/tmp/s5-wake-acoustic-matrix-20261011.py",run_name="s5_matrix")
before=json.loads(Path("/home/jespern/c720p-home-hub/runtime/c720p_mic_telemetry.json").read_text())
assert before.get("ok")
assert time.time()-float(before.get("last_audio_epoch",0))<3
render=m["render"]
prof={"piper_voice":"en_US-lessac-medium","piper_language":"en_US","espeak_voice":None,"wpm":145,
      "tempo":0.94,"pitch":1.0,"pause":1.0,"volume":12}
voice,engine=render(prof,"Hey Google")
pcm=bytes(16000)+voice+bytes(8000)
def play():
    t=time.monotonic()
    p=subprocess.run(["paplay","--raw","--format=s16le","--rate=16000","--channels=1",
       "--volume=50000","--stream-name=C720P-positive-control-wake"],input=pcm,
       capture_output=True,timeout=20)
    return {"code":p.returncode,"elapsed_s":round(time.monotonic()-t,3),"audio_s":round(len(pcm)/32000,3)}
events,levels=m["monitor_mic"](before["source"],play)
print(json.dumps({"test":"local_C720P_speaker_to_USB_mic","voice_engine":engine,
                   "mic_audio_persisted":False,"playback":events,
                   "mic":levels,"s5_comparison_prior_12_15_rms_ratio":0.93}),flush=True)
