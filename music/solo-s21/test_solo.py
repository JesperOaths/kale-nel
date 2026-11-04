#!/usr/bin/env python3
"""Offline regression suite: fake catalog, real HTTP service, no data/media changes."""
import importlib.util, json, os, tempfile, threading, urllib.error, urllib.request
from pathlib import Path
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))
os.environ["TUNERUSH_SOLO_DATA"]=tempfile.mkdtemp(prefix="solo-test-")
source=Path(__file__).with_name("server.py")
spec=importlib.util.spec_from_file_location("tunerush_solo",source)
solo=importlib.util.module_from_spec(spec)
spec.loader.exec_module(solo)
fixtures=[
 {"id":"4gBM54a","title":"Never Turn Back","artist":"J Miguel","duration":180,"plays":1000},
 {"id":"abc876","title":"Golden Lights","artist":"Late Nights","duration":190,"plays":400},
 {"id":"def562","title":"Sea And Stars","artist":"Starlight","duration":210,"plays":500},
 {"id":"ghi383","title":"Saturday Dance","artist":"Moon Birds","duration":200,"plays":700},
 {"id":"jkl127","title":"Wildflower","artist":"Indie Dreams","duration":175,"plays":900},
]
solo.discover=lambda g,d:fixtures
srv=solo.DualStackServer(("::1",0),solo.Handler);srv.daemon_threads=True
thread=threading.Thread(target=srv.serve_forever,daemon=True);thread.start()
base="http://[::1]:"+str(srv.server_port)
count=0
def request(path,method="GET",payload=None,token=None,origin=None):
 global count
 headers={"Accept":"application/json"}
 if token:headers["Authorization"]="Bearer "+token
 if origin:headers["Origin"]=origin
 if payload is not None:headers["Content-Type"]="application/json"
 body=json.dumps(payload).encode() if payload is not None else None
 req=urllib.request.Request(base+path,data=body,method=method,headers=headers)
 try:
  with urllib.request.urlopen(req,timeout=6) as res:
   status=res.status;obj=json.load(res)
 except urllib.error.HTTPError as e:
  status=e.code;obj=json.loads(e.read())
 count+=1;return status,obj

assert request("/api/health")[0]==200
assert request("/api/state")[0]==401
assert request("/api/session","POST",{"genres":["nonsense"]})[0]==400
# Every checkbox offered by the public Solo UI must work, including all nine.
all_genres=["pop","rock","dance","electronic","hiphop","indie","disco","rnb","metal"]
status,all_mix=request("/api/session","POST",{"genres":all_genres,"decades":[],"limit":5})
assert status==200,(status,all_mix)
assert all_mix["state"]["genres"]==all_genres
status,finished_mix=request("/api/action","POST",{"round":1,"op":"finish"},all_mix["token"])
assert status==200 and finished_mix["state"]["phase"]=="finished"
assert request("/api/session","POST",{"genres":all_genres+["pop"],"limit":5})[0]==400
assert request("/api/session","POST",{"genres":["pop"]},origin="http://evil.invalid")[0]==403
status,data=request("/api/session","POST",{"genres":["pop"],"decades":[],"limit":5})
assert status==200,(status,data)
token=data["token"];state=data["state"]
assert len(token)==64
assert state["phase"]=="ready" and state["step"]==-1
assert "reveal" not in state and "track" not in state
assert "/api/audio/" in state["media"] and state["cueMs"]>=0
assert request("/api/state",token="0"*64)[0]==401
assert request("/api/action","POST",{"round":1,"op":"answer"},token)[0]==400
assert request("/api/action","POST",{"round":0,"op":"clue"},token)[0]==400
s=request("/api/action","POST",{"round":1,"op":"clue"},token)[1]["state"]
assert s["phase"]=="playing" and s["step"]==0
assert request("/api/action","POST",{"round":1,"op":"clue"},token)[0]==400
# Wrong title should not go below zero.
s=request("/api/action","POST",{"round":1,"op":"answer","title":"Not the answer"},token)[1]["state"]
assert s["phase"]=="ready" and s["score"]==0 and s["last"]["title"]=="incorrect"
assert request("/api/action","POST",{"round":1,"op":"answer","title":"Again"},token)[0]==400
s=request("/api/action","POST",{"round":1,"op":"clue"},token)[1]["state"]
song=solo.SESSIONS[token]["track"]
s=request("/api/action","POST",{"round":1,"op":"answer","title":song["title"],"artist":song["artist"]},token)[1]["state"]
assert s["phase"]=="revealed" and s["score"]==1.0 and s["reveal"]["title"]==song["title"]
assert len(s["history"])==1
s=request("/api/action","POST",{"round":1,"op":"next"},token)[1]["state"]
assert s["phase"]=="ready" and s["round"]==2 and not any(k in s for k in ("reveal","track"))
assert solo.SESSIONS[token]["track"]["id"]!=song["id"]
s=request("/api/action","POST",{"round":2,"op":"reveal"},token)[1]["state"]
assert len(s["history"])==2
s=request("/api/action","POST",{"round":2,"op":"finish"},token)[1]["state"]
assert s["phase"]=="finished" and len(s["history"])==2
assert request("/api/action","POST",{"round":2,"op":"clue"},token)[0]==400
assert request("/api/audio/not-a-ticket")[0]==404
with tempfile.TemporaryDirectory() as _:pass
solo.SESSIONS.clear();solo.restore();assert token in solo.SESSIONS
assert solo.SESSIONS[token]["ticket"]!=state["media"].rsplit("/",1)[1]
# Completed sessions must not permanently occupy the four-session cap.
for i in range(5):
 status,out=request("/api/session","POST",{"genres":["pop"],"limit":5})
 assert status==200,(i,status,out)
 temp_token=out["token"]
 status,out=request("/api/action","POST",{"op":"finish","round":1},temp_token)
 assert status==200 and out["state"]["phase"]=="finished"
assert len(solo.SESSIONS)<=4
print("PASS",count,"HTTP assertions; persistence; mystery privacy; scoring; rotation; session eviction")
srv.shutdown()

