#!/usr/bin/env python3
"""Backed-up C720P fast Vosk path for the HA-supported "What time is it?" query.

Only changes one grammar sentence, its SQLite compiled database and one
router whitelist regex. Restart only the two Vosk STT containers. If validation
fails, restore byte-for-byte backups and restart both.
"""
from __future__ import annotations
import argparse,asyncio,datetime,json,os,pathlib,shutil,socket,sqlite3,subprocess,time
from wyoming.client import AsyncTcpClient
from wyoming.tts import Synthesize,SynthesizeVoice
from wyoming.asr import Transcribe,Transcript
from wyoming.audio import AudioStart,AudioChunk,AudioStop

ROOT=pathlib.Path("/opt/homeassistant/vosk-home-sentences")
YAML=ROOT/"en.yaml"
DB=ROOT/"en.db"
ROUTER=pathlib.Path("/opt/homeassistant/voice-router/router.py")
SENTENCES=("what is the time","tell me the time","what day is it")
ROUTER_ANCHOR="r'what time is it',"
CONTAINERS=("wyoming-vosk-fast","wyoming-stt-router")
BACKUPS=pathlib.Path("/home/jespern/c720p-home-hub/backups/voice-fast-intent")

def run(args,timeout=22):
    return subprocess.run(args,capture_output=True,text=True,timeout=timeout)

def port_ready(port):
    try:
        with socket.create_connection(("127.0.0.1",port),timeout=1):
            return True
    except OSError:
        return False

def await_ports():
    for _ in range(35):
        if all(port_ready(p) for p in (10300,10301)):
            return True
        time.sleep(1)
    return False

def new_db(original,tmp):
    shutil.copyfile(original,tmp)
    os.chmod(tmp,0o644)
    db=sqlite3.connect(str(tmp))
    try:
        db.execute("BEGIN IMMEDIATE")
        existing={r[0] for r in db.execute("SELECT word FROM words")}
        for sentence in SENTENCES:
            db.execute("INSERT INTO sentences(input_text,output_text) VALUES(?,?)",(sentence,sentence))
            for word in sentence.split():
                if word not in existing:
                    db.execute("INSERT INTO words(word) VALUES(?)",(word,))
                    existing.add(word)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

def atomic_bytes(path,data,mode):
    tmp=path.with_name(path.name+".voicefast-tmp")
    with open(tmp,"wb") as file:
        file.write(data)
        file.flush()
        os.fsync(file.fileno())
    os.chmod(tmp,mode)
    os.replace(tmp,path)

async def synth(text):
    audio=bytearray();rate=0;ch=0
    async with AsyncTcpClient("127.0.0.1",10200) as client:
        await client.write_event(
            Synthesize(text=text,
                       voice=SynthesizeVoice(name="en_US-lessac-medium",
                                             language="en_US")).event()
        )
        for _ in range(100):
            e=await asyncio.wait_for(client.read_event(),timeout=15)
            if e is None: break
            if e.type=="audio-start":
                v=AudioStart.from_event(e);rate=v.rate;ch=v.channels
            elif e.type=="audio-chunk":
                audio.extend(AudioChunk.from_event(e).audio)
            elif e.type=="audio-stop":break
    if not 6000<len(audio)<500000 or not rate:raise RuntimeError("no_synth_audio")
    p=subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-f","s16le",
                      "-ar",str(rate),"-ac",str(ch),"-i","pipe:0",
                      "-ar","16000","-ac","1","-f","s16le","pipe:1"],
                     input=bytes(audio),capture_output=True,timeout=16)
    if p.returncode:raise RuntimeError("resample_error")
    return p.stdout

async def recog(port,pcm):
    t=time.monotonic()
    async with AsyncTcpClient("127.0.0.1",port) as client:
        await client.write_event(Transcribe(language="en").event())
        await client.write_event(AudioStart(rate=16000,width=2,channels=1).event())
        for i in range(0,len(pcm),16000):
            await client.write_event(AudioChunk(rate=16000,width=2,channels=1,
                                                audio=pcm[i:i+16000]).event())
        await client.write_event(AudioStop().event())
        for _ in range(12):
            e=await asyncio.wait_for(client.read_event(),timeout=20)
            if e is None:break
            if e.type=="transcript":
                return Transcript.from_event(e).text.strip().lower(),round(time.monotonic()-t,3)
    return "",round(time.monotonic()-t,3)

def benchmark():
    results=[]
    for sentence in (*SENTENCES,"what time is it","turn on the bedroom lights"):
        pcm=asyncio.run(synth(sentence))
        direct=asyncio.run(recog(10301,pcm))
        router=asyncio.run(recog(10300,pcm))
        results.append({"sentence":sentence,"direct":direct,"router":router,
                        "pass":all(x[0]==sentence and x[1]<3 for x in (direct,router))})
    return {"tests":results,"pass":all(x["pass"] for x in results)}

def main():
    p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true")
    args=p.parse_args()
    report={"version":"voice-fast-time-variants-20261011","applied":False}
    original={x:x.read_bytes() for x in (YAML,DB,ROUTER)}
    yaml=original[YAML].decode("utf-8")
    router=original[ROUTER].decode("utf-8")
    if YAML.is_symlink() or DB.is_symlink() or ROUTER.is_symlink():
        raise RuntimeError("unsafe_symlink")
    db=sqlite3.connect("file:"+str(DB)+"?mode=ro",uri=True)
    has=[db.execute("select count(*) from sentences where input_text=?",(t,)).fetchone()[0] for t in SENTENCES]
    db.close()
    if any(has) or any(("  - "+t) in yaml for t in SENTENCES) or any(("r'"+t+"'") in router for t in SENTENCES):
        report["outcome"]="already_present_or_conflict_no_change";print(json.dumps(report));return 2
    if yaml.count("unknown_text: ''")!=1 or router.count(ROUTER_ANCHOR)!=1:
        raise RuntimeError("unexpected_grammar_source")
    if not all(port_ready(p) for p in (10200,10300,10301)):
        raise RuntimeError("speech_services_not_healthy")
    patched_yaml=yaml.replace("unknown_text: ''","".join("  - "+t+"\n" for t in SENTENCES)+"unknown_text: ''",1)
    patched_router=router.replace(ROUTER_ANCHOR,ROUTER_ANCHOR+"".join("\n      r'"+t+"'," for t in SENTENCES),1)
    report["preflight"]="passed"
    if not args.apply:
        report["outcome"]="dry_run_no_changes";print(json.dumps(report));return 0
    stamp=datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
    dest=BACKUPS/stamp
    dest.mkdir(parents=True,exist_ok=False)
    for path,data in original.items():
        b=dest/path.name
        b.write_bytes(data)
        os.chmod(b,0o600)
    report["backup"]=str(dest)
    try:
        atomic_bytes(YAML,patched_yaml.encode(),0o600)
        tmp=DB.with_name("en.db.voicefast-tmp")
        new_db(DB,tmp)
        os.replace(tmp,DB)
        atomic_bytes(ROUTER,patched_router.encode(),0o600)
        syntax=run(["python3","-m","py_compile",str(ROUTER)])
        if syntax.returncode:raise RuntimeError("router_python_syntax_failure")
        for name in CONTAINERS:
            r=run(["docker","restart",name],timeout=45)
            if r.returncode:raise RuntimeError("restart_failed_"+name)
        if not await_ports():raise RuntimeError("ports_not_ready")
        # Confirm the upgraded Vosk DB and the actual router work, not merely that
        # their sockets accept connections.
        report["recognition"]=benchmark()
        if not report["recognition"]["pass"]:
            raise RuntimeError("recognition_regression_or_speed")
        report["applied"]=True
        report["outcome"]="deployed_and_benchmarked"
        print(json.dumps(report))
        return 0
    except Exception as e:
        report["error"]=type(e).__name__+":"+str(e)[:120]
        for path,data in original.items():
            mode=0o644 if path==DB else 0o600
            atomic_bytes(path,data,mode)
        recovery=[]
        for name in CONTAINERS:
            r=run(["docker","restart",name],timeout=45)
            recovery.append({"container":name,"restarted":r.returncode==0})
        report["rollback"]=recovery
        report["port_recovery"]=await_ports()
        report["outcome"]="rolled_back"
        print(json.dumps(report))
        return 3

if __name__=="__main__":
    raise SystemExit(main())
