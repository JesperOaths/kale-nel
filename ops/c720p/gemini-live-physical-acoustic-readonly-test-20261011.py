#!/usr/bin/env python3
"""Harmless live C720P microphone -> speech detector -> Gemini -> HA status -> audio validation."""
import asyncio,json,pathlib,subprocess,time,runpy
BASE=pathlib.Path('/home/jespern/c720p-home-hub')
STATUS=BASE/'runtime/gemini_live_status.json'
from wyoming.client import AsyncTcpClient
from wyoming.tts import Synthesize,SynthesizeVoice
from wyoming.audio import AudioStart,AudioChunk

async def generate():
    pcm=bytearray();rate=22050
    async with AsyncTcpClient('127.0.0.1',10200) as c:
        await c.write_event(Synthesize(text='What is the state of the office light?',voice=SynthesizeVoice(name='en_US-lessac-medium',language='en_US')).event())
        while True:
            ev=await asyncio.wait_for(c.read_event(),timeout=15)
            if not ev or ev.type=='audio-stop':break
            if ev.type=='audio-start':rate=AudioStart.from_event(ev).rate
            if ev.type=='audio-chunk':pcm.extend(AudioChunk.from_event(ev).audio)
    return bytes(pcm),rate

def safe_status():
    try:
        d=json.loads(STATUS.read_text())
        return {k:d.get(k) for k in ('mode','at','tool_calls','last_cloud_seconds','cloud_seconds','error_type','cloud_enabled')}
    except Exception:return {}

async def main():
    pcm,rate=await generate()
    before=safe_status();seen=[]
    laststamp=before.get('at')
    proc=await asyncio.create_subprocess_exec('paplay','--raw','--format=s16le','--rate='+str(rate),'--channels=1',
       '--volume=42000','--stream-name=Gemini-Live-harmless-acoustic-check',
       stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
    job=asyncio.create_task(proc.communicate(input=bytes(int(rate*.4*2))+pcm+bytes(int(rate*.6*2))))
    start=time.monotonic()
    while time.monotonic()-start<34:
        v=safe_status();st=v.get('at')
        if st is not None and st!=laststamp:
            seen.append({k:v[k] for k in ('mode','tool_calls','error_type','last_cloud_seconds','cloud_seconds') if v.get(k) is not None})
            laststamp=st
        if v.get('mode')=='ready' and v.get('last_cloud_seconds') is not None and v.get('tool_calls',0)>0:break
        await asyncio.sleep(.23)
    await job
    after=safe_status()
    print(json.dumps({'test':'physical_speaker_to_trust_mic_to_live_bridge',
      'playback_exit':proc.returncode,'observed_modes':seen[:20],
      'cloud_tool_call_confirmed':any(x.get('tool_calls',0)>0 for x in seen),
      'final_status':after,'saved_room_audio':False,'command_was_read_only':True}))
asyncio.run(main())
