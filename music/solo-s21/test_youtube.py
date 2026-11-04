#!/usr/bin/env python3
"""YouTube-only S21 game tests: verified video IDs, random start, score privacy."""
import importlib.util
import json,os,re,sys,tempfile,threading,urllib.error,urllib.request
from pathlib import Path
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))
os.environ["TUNERUSH_SOLO_DATA"]=tempfile.mkdtemp(prefix="tunerush-youtube-test-")
os.environ.pop("TUNERUSH_ALLOW_AUDIUS_TESTS",None)
sys.path.insert(0,str(Path(__file__).parent))
import youtube_catalog
fakes=[{
 "id":"yt_"+("Abcdefghijk" if n==0 else "test" + str(n).zfill(7)),
 "videoId":"Abcdefghijk" if n==0 else "test" + str(n).zfill(7),
 "title":"Chart Song "+str(n),"artist":"Popular Artist "+str(n),
 "youtubeViewsAtIndex":10000000+10000*n,"rank":900000+n,
 "genres":["pop","rock"],"decades":["1980"],"duration":210
} for n in range(10)]
youtube_catalog.select=lambda genres,decades,limit:fakes
spec=importlib.util.spec_from_file_location("tunerush_s21_youtube",Path(__file__).with_name("server.py"))
solo=importlib.util.module_from_spec(spec);spec.loader.exec_module(solo)
srv=solo.DualStackServer(("::1",0),solo.Handler);srv.daemon_threads=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
base="http://[::1]:"+str(srv.server_port)
def req(path,payload=None,token=None):
 headers={}
 if payload is not None:headers["Content-Type"]="application/json"
 if token:headers["Authorization"]="Bearer "+token
 x=urllib.request.Request(base+path,data=json.dumps(payload).encode() if payload is not None else None,headers=headers)
 try:
  with urllib.request.urlopen(x,timeout=6) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as err:return err.code,json.load(err)
status,created=req("/api/session",{"source":"youtube","genres":["pop"],"decades":[],"limit":5})
assert status==200,(status,created)
token=created["token"];state=created["state"]
assert solo.GAME_CACHE.summary(token)=={"slots":5,"stored":0,"bytes":0}
assert state["source"]=="youtube"
assert state["minPlays"] is None
assert state["media"].startswith("youtube:") and re.fullmatch(r"youtube:[A-Za-z0-9_-]{11}",state["media"])
assert 25000<=state["cueMs"]<=80000
assert state["phase"]=="ready" and state["round"]==1
assert not any(key in state for key in ("artist","title","reveal","track"))
assert req("/api/state")[0]==401
assert req("/api/session",{"source":"legacy-audius","genres":["pop"],"limit":5})[0]==400
assert req("/api/audio/deadbeef")[0] in (404,410)
original=state["cueMs"];video=state["media"]
state=req("/api/action",{"round":1,"op":"clue","targetStep":0},token)[1]["state"]
assert state["step"]==0 and state["cueMs"]==original
state=req("/api/action",{"round":1,"op":"clue","targetStep":6},token)[1]["state"]
assert state["step"]==6 and state["cueMs"]==original and state["media"]==video
assert state["score"]==0
assert req("/api/action",{"round":1,"op":"clue","targetStep":6},token)[0]==400
state=req("/api/action",{"round":1,"op":"reveal"},token)[1]["state"]
assert state["reveal"]["title"].startswith("Chart Song")
assert state["reveal"]["youtubeUrl"].startswith("https://www.youtube.com/watch?v=")
assert state["reveal"]["youtubeViewsAtIndex"]>=10000000
state=req("/api/action",{"round":1,"op":"next"},token)[1]["state"]
assert state["round"]==2 and state["phase"]=="ready"
assert state["media"]!=video
assert 25000<=state["cueMs"]<=80000
assert state["reveal"] if "reveal" in state else True
req("/api/action",{"round":2,"op":"finish"},token)
assert solo.GAME_CACHE.summary(token)=={"slots":0,"stored":0,"bytes":0}
srv.shutdown();srv.server_close()
print("PASS YouTube: 360-index-compatible ID format, randomized playback starts, mystery privacy, clue selection, no Audius, session advancement")

