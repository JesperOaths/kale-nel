#!/usr/bin/env python3
"""End-to-end synthetic voice -> Gemini Live -> mocked HA tools -> voice audio; no physical actions."""
import asyncio, json, runpy, subprocess
from wyoming.client import AsyncTcpClient
from wyoming.tts import Synthesize,SynthesizeVoice
from wyoming.audio import AudioStart,AudioChunk

async def get_audio(phrase):
    raw=bytearray();rate=22050
    async with AsyncTcpClient('127.0.0.1',10200) as conn:
        await conn.write_event(Synthesize(text=phrase,voice=SynthesizeVoice(name='en_US-lessac-medium',language='en_US')).event())
        while True:
            e=await asyncio.wait_for(conn.read_event(),timeout=15)
            if not e or e.type=='audio-stop':break
            if e.type=='audio-start':rate=AudioStart.from_event(e).rate
            if e.type=='audio-chunk':raw.extend(AudioChunk.from_event(e).audio)
    p=subprocess.run(['ffmpeg','-v','error','-f','s16le','-ar',str(rate),'-ac','1','-i','pipe:0','-ar','16000','-ac','1','-f','s16le','pipe:1'],input=bytes(raw),capture_output=True,timeout=12)
    assert p.returncode==0
    return bytes(12000)+p.stdout+bytes(16000)

class HA:
    def __init__(self):self.invoked=[]
    async def office(self):
        self.invoked.append('get')
        return {'available':True,'state':'off'}
    async def set_office(self,state):
        self.invoked.append('set_'+state)
        return {'ok':True,'state':state,'simulation':True}

async def main():
    bridge=runpy.run_path('/tmp/c720p-gemini-live-v2-20261011.py',run_name='bridge_test')
    tests=[]
    for phrase in ('What is the state of the office light?', 'Please turn on the office light.'):
        ha=HA()
        try:
            pcm=await get_audio(phrase)
            reply,calls,elapsed=await bridge['cloud'](pcm,ha)
            tests.append({'kind':'read' if not tests else 'write_simulated',
             'cloud_tool_calls':calls,'invocations':ha.invoked,'response_audio_bytes':len(reply),
             'elapsed_s':elapsed,'sent_room_audio':False,'touched_real_lights':False})
        except Exception as e:
            tests.append({'kind':'read' if not tests else 'write_simulated','error':type(e).__name__})
    print(json.dumps({'tests':tests,'real_light_modified':False,'audio_saved':False}))
asyncio.run(main())
