#!/usr/bin/env python3
"""Mainstream owner-library tests: no copyrighted media, no Audius network."""
import json
import importlib.util
import os
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))
os.environ["TUNERUSH_SOLO_DATA"]=tempfile.mkdtemp(prefix="tunerush-owned-test-")
os.environ.pop("TUNERUSH_ALLOW_AUDIUS_TESTS",None)
import owned_library

catalog={i:{
    "id":i,"title":f"Curated hit {i}","artist":f"Test Musician {i}",
    "genres":["pop","rock"] if i%2 else ["pop","dance"],
    "decades":["1980"] if i<=20 else ["2010"],
    "rank":800000+i*100,
    "duration":180,
} for i in range(1,101)}
owned_library.load_catalog=lambda:catalog
spec=importlib.util.spec_from_file_location("tunerush_owned_server",Path(__file__).with_name("server.py"))
solo=importlib.util.module_from_spec(spec)
spec.loader.exec_module(solo)
srv=solo.DualStackServer(("::1",0),solo.Handler)
srv.daemon_threads=True
thread=threading.Thread(target=srv.serve_forever,daemon=True)
thread.start()
base="http://[::1]:"+str(srv.server_port)
def request(path,payload=None,token=None):
 h={"Accept":"application/json"}
 if token:h["Authorization"]="Bearer "+token
 if payload is not None:h["Content-Type"]="application/json"
 req=urllib.request.Request(base+path,data=json.dumps(payload).encode() if payload is not None else None,
                            headers=h,method="POST" if payload is not None else "GET")
 try:
  with urllib.request.urlopen(req,timeout=5) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as err:return err.code,json.load(err)
files=[{"fileId":str(i),"catalogId":i} for i in range(1,25)]
assert request("/api/session",{"genres":["pop"],"limit":5})[0]==400,"No Audius fallback"
status,created=request("/api/session",{
    "source":"owned-library","library":files,"genres":["pop"],
    "decades":["1980"],"limit":5
})
assert status==200,(status,created)
token=created["token"]
s=created["state"]
assert s["source"]=="owned-library"
assert s["phase"]=="ready" and s["round"]==1
assert s["media"].startswith("owned:") and s["media"][6:] in {str(i) for i in range(1,25)}
assert s["cueMs"]==0
assert s["available"]==20
assert not any(x in s for x in ("title","artist","track","reveal"))
assert request("/api/state",token=token)[1]["state"]["source"]=="owned-library"
s=request("/api/action",{"op":"clue","round":1,"targetStep":4},token)[1]["state"]
assert s["step"]==4 and s["phase"]=="playing"
assert s["score"]==0
bad=request("/api/action",{"op":"answer","round":1,"title":"Definitely wrong"},token)[1]["state"]
assert bad["score"]==0
revealed=request("/api/action",{"op":"reveal","round":1},token)[1]["state"]
assert revealed["reveal"]["title"].startswith("Curated hit ")
assert revealed["reveal"]["rank"]>=800100
assert revealed["reveal"]["link"].startswith("https://www.deezer.com/track/")
next_state=request("/api/action",{"op":"next","round":1},token)[1]["state"]
assert next_state["round"]==2
assert next_state["media"].startswith("owned:")
assert next_state["media"]!=s["media"]
assert not next_state.get("reveal")
finished=request("/api/action",{"op":"finish","round":2},token)[1]["state"]
assert finished["phase"]=="finished"

# S21 validates catalog IDs; arbitrary web-client song names never become answers.
other=[{"fileId":"1","catalogId":1,"title":"The Fake Song","artist":"Unrelated"} for _ in range(5)]
code,obj=request("/api/session",{
    "source":"owned-library","library":other,"genres":["rock"],"decades":[],"limit":5
})
assert code==400 and "Found 1 recognizable" in obj["error"]
status,obj=request("/api/session",{
    "source":"owned-library","library":[{"fileId":"0","catalogId":999999}] * 5,
    "genres":["pop"],"limit":5
})
assert status==400
status,obj=request("/api/session",{
    "source":"owned-library","library":[{"fileId":"0","catalogId":1}] * 5,
    "genres":["metal"],"limit":5
})
assert status==400
status,obj=request("/api/session",{
    "source":"owned-library","library":[{"fileId":"0","catalogId":1}] * 5,
    "genres":["pop"],"limit":5
})
assert status==400
srv.shutdown();srv.server_close()
print("PASS mainstream owned-library: no Audius, authorized local clips, 20-song catalog, scoring, privacy and anti-spoofing")
