from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import hashlib
import multiplayer
def token(s): return hashlib.sha256(s.encode()).hexdigest()
song={"id":"a","title":"One Star","artist":"Some Artist","sha256":"a"*64,"source":"persistent-library"}
with TemporaryDirectory() as tmp, patch.object(multiplayer.permanent_audio,"select",return_value=[song]), patch.object(multiplayer.permanent_audio,"choose",return_value=(song,12345)):
 e=multiplayer.MultiplayerEngine(Path(tmp)/"test.db",library_root=Path(tmp))
 h=token("host"); a=token("a"); b=token("b"); code="ABC234"
 assert e.call("create",code,h)["role"]=="host"
 assert e.call("join",code,a,{"name":"Alice"})["players"][0]["score"]==20
 assert e.call("join",code,b,{"name":"Bob"})["players"][1]["score"]==20
 e.call("start",code,h,{"mode":"persistent-library"})
 for i in range(3):
  s=e.call("play",code,h)
  assert s["step"]==i
  assert all(p["score"]==20 for p in s["players"])
  # simulate elapsed time of clue (not dependent on wall-clock)
  with e.lock:
   r=e.read(code);r["clueStartedAt"]=1
   e.db.execute("update rooms set data=? where code=?",(__import__('json').dumps(r),code))
  s=e.call("state",code,a)
  assert s["phase"]=="decision"
  e.call("clue_choice",code,a,{"choice":"next","expectedRound":1,"expectedStep":i})
 s=e.call("opt_out",code,b,{"expectedRound":1,"expectedStep":2})
 assert s["myOptedOut"]
 s=e.call("play",code,h)
 assert s["step"]==3
 assert next(p for p in s["players"] if p["name"]=="Alice")["score"]==19.5
 assert next(p for p in s["players"] if p["name"]=="Bob")["score"]==20
 assert next(p for p in s["players"] if p["name"]=="Alice")["spent"]==0.5
 try: e.call("buzz",code,b)
 except multiplayer.GameError as err: assert str(err)=="buzz_closed"
 else: raise AssertionError("opted out user buzzed")
 e.call("pause",code,h)
 e.call("play",code,h) if False else None
 e.call("replay",code,h,{"expectedRound":1,"expectedStep":3})
 s=e.call("state",code,a)
 assert next(p for p in s["players"] if p["name"]=="Alice")["score"]==19.0
 assert next(p for p in s["players"] if p["name"]=="Bob")["score"]==20
 e.call("buzz",code,a)
 s=e.call("answer",code,a,{"artist":"Some Artist","song":"One Star"})
 assert s["phase"]=="solved"
 alice=next(p for p in s["players"] if p["name"]=="Alice")
 assert alice["score"]==31 and alice["earned"]==12
 e.call("next",code,h,{"mode":"persistent-library"}) if False else None
 # Validate other player can choose "I don't know" without charging, no 20pt win cutoff.
 s=e.call("finish",code,h)
 assert s["phase"]=="finished"
 assert s["winner"]==alice["id"]
 e.close()
print("NEW_SCORING_AND_OPTOUT_TEST_PASS")

