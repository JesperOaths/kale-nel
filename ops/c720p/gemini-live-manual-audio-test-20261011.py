#!/usr/bin/env python3
"""Synthetic-speech test of Gemini Live audio using manual endpointing. No room microphone capture."""
import asyncio, os, json, subprocess, runpy, time
from google import genai
from google.genai import types

async def main():
 canary=runpy.run_path('/tmp/c720p-voice-acoustic-canary-20261011.py',run_name='synthetic')
 raw,rate=await canary['speech']('Please say ready.')
 p=subprocess.run(['ffmpeg','-v','error','-f','s16le','-ar',str(rate),'-ac','1','-i','pipe:0','-ar','16000','-ac','1','-f','s16le','pipe:1'],input=raw,capture_output=True,timeout=12)
 assert p.returncode==0
 pcm=bytes(12000)+p.stdout+bytes(22000)
 result={'input_seconds':round(len(pcm)/32000,2),'cloud_audio_bytes':0,'turn_complete':False,'events':0,'error_type':None,'room_audio_uploaded':False}
 client=genai.Client()
 try:
  async with client.aio.live.connect(model=os.getenv('GEMINI_LIVE_MODEL','gemini-3.8-live'),config={
   'response_modalities':['AUDIO'],'realtime_input_config':{'automatic_activity_detection':{'disabled':True}}
  }) as session:
   await session.send_realtime_input(activity_start=types.ActivityStart())
   for i in range(0,len(pcm),3200):
    await session.send_realtime_input(audio=types.Blob(data=pcm[i:i+3200],mime_type='audio/pcm;rate=16000'))
    await asyncio.sleep(.10)
   await session.send_realtime_input(activity_end=types.ActivityEnd())
   async with asyncio.timeout(25):
    async for event in session.receive():
     result['events']+=1
     c=event.server_content
     if c and c.model_turn:
      for part in c.model_turn.parts or []:
       if part.inline_data and part.inline_data.data:result['cloud_audio_bytes']+=len(part.inline_data.data)
     if c and c.turn_complete:result['turn_complete']=True;break
 except Exception as e:result['error_type']=type(e).__name__
 finally:await client.aio.aclose()
 print(json.dumps(result))

asyncio.run(main())
