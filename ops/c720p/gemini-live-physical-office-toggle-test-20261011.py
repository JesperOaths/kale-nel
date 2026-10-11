#!/usr/bin/env python3
"""Production voice-to-light test; restore the initial light state even if a voice command fails."""
import asyncio,json,pathlib,runpy,time
from wyoming.client import AsyncTcpClient
from wyoming.tts import Synthesize,SynthesizeVoice
from wyoming.audio import AudioStart,AudioChunk
BASE=pathlib.Path('/home/jespern/c720p-home-hub')
HA=runpy.run_path(str(BASE/'bin/c720p-gemini-live.py'),run_name='inspection')['KioskHA']
STATUS=BASE/'runtime/gemini_live_status.json'
def status():
 try:
  d=json.loads(STATUS.read_text())
  return {k:d.get(k) for k in ('at','mode','tool_calls','last_cloud_seconds')}
 except:return {}
async def say(phrase):
 raw=bytearray();rate=22050
 async with AsyncTcpClient('127.0.0.1',10200) as conn:
  await conn.write_event(Synthesize(text=phrase,voice=SynthesizeVoice(name='en_US-lessac-medium',language='en_US')).event())
  while True:
   ev=await asyncio.wait_for(conn.read_event(),timeout=13)
   if ev is None or ev.type=='audio-stop':break
   if ev.type=='audio-start':rate=AudioStart.from_event(ev).rate
   if ev.type=='audio-chunk':raw.extend(AudioChunk.from_event(ev).audio)
 proc=await asyncio.create_subprocess_exec('paplay','--raw','--format=s16le','--rate='+str(rate),'--channels=1','--volume=42000','--stream-name=Gemini-safe-office-toggle',stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
 await proc.communicate(input=bytes(int(rate*.5*2))+raw+bytes(int(rate*.6*2)))
 return proc.returncode
async def attempt(ha,target):
 previous=status().get('at',0);rc=await say('Please turn '+target+' the office ceiling light.')
 modes=[];end=time.monotonic()+24
 while time.monotonic()<end:
  v=status()
  if v.get('at',0)>previous and v.get('mode') not in modes:modes.append(v['mode'])
  lamp=(await ha.office()).get('state')
  if lamp==target and v.get('mode')=='ready' and v.get('tool_calls',0)>0 and v.get('at',0)>previous:
   return {'state':target,'via_voice':True,'playback_rc':rc,'cloud_s':v.get('last_cloud_seconds'),'stages':modes}
  await asyncio.sleep(.6)
 return {'state':target,'via_voice':False,'playback_rc':rc,'stages':modes}
async def main():
 ha=HA();initial=(await ha.office()).get('state')
 if initial not in ('on','off'):print(json.dumps({'error':'unavailable_initial_state'}));return
 opposite='off' if initial=='on' else 'on'
 runs=[]
 try:
  runs.append(await attempt(ha,opposite))
  await asyncio.sleep(1)
  runs.append(await attempt(ha,initial))
 finally:
  final=(await ha.office()).get('state')
  restored_by='voice' if final==initial else 'local_recovery'
  if final!=initial:await ha.set_office(initial)
  final=(await ha.office()).get('state')
 print(json.dumps({'initial':initial,'trials':runs,'restore':restored_by,'final':final,'restored':final==initial,'audio_saved':False}))
asyncio.run(main())
