#!/usr/bin/env python3
"""Offline tests for the new S21-only multiplayer engine; production stays unchanged."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import importlib.util
import json
import threading
import time

source = Path(__file__).with_name("multiplayer.py")
spec = importlib.util.spec_from_file_location("s21_multi", source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assertions = 0

def check(condition, why="failed"):
    global assertions
    assert condition, why
    assertions += 1

def expect_error(call, code):
    try:
        call()
    except m.GameError as err:
        check(str(err) == code, str(err))
        return
    raise AssertionError("Expected error " + code)

def secret(label):
    return hashlib.sha256(label.encode()).hexdigest()

def song(title="Saturday Sky", artist="Little Lights", index=11, cue=18000):
    return {"mode": "local", "song": title, "artist": artist,
            "durationMs": 180000, "fileIndex": index, "cueMs": cue}

with TemporaryDirectory(prefix="s21-multi-test-") as tmp:
    db=Path(tmp)/"db"/"rooms.sqlite"
    e=m.MultiplayerEngine(db)
    HOST=secret("host-very-private")
    A=secret("alice-very-private")
    B=secret("bob-very-private")
    WRONG=secret("wrong-no-rights")
    code="ABCDEF"
    host=e.call("create",code,HOST)
    check(host["role"]=="host" and host["phase"]=="lobby")
    check(host["players"]==[] and host["round"]==0)
    check(host["audio"] is None)
    expect_error(lambda:e.call("create",code,secret("other")), "room_code_taken")
    expect_error(lambda:e.call("state",code,WRONG), "unauthorized")
    expect_error(lambda:e.call("state","IIIIII",HOST), "invalid_code")
    expect_error(lambda:e.call("settings",code,WRONG,{"genres":["rock"]}), "unauthorized")
    check(e.call("join",code,A,{"name":"Alice"})["role"]=="player")
    check(e.call("join",code,B,{"name":"Bob"})["role"]=="player")
    expect_error(lambda:e.call("join",code,secret("third"),{"name":"bob"}), "name_taken")
    expect_error(lambda:e.call("join",code,secret("bad-name"),{"name":"<script>"}), "invalid_name")
    check(len(e.call("state",code,HOST)["players"])==2)
    settings=e.call("settings",code,HOST,{"genres":["pop","rock","dance","disco","metal"],"decades":["1980","2020"]})
    check(settings["genres"]==["dance","disco","metal","pop","rock"])
    check(settings["decades"]==["1980","2020"])
    expect_error(lambda:e.call("start",code,A,song()), "host_only")
    expect_error(lambda:e.call("start",code,HOST,{**song(),"durationMs":20000}), "local_duration_invalid")
    started=e.call("start",code,HOST,song())
    check(started["phase"]=="paused" and started["round"]==1)
    check(started["audio"]=={"source":"local:11","cueMs":18000})
    check(started["title"] is None and started["artist"] is None)
    check(e.call("state",code,A)["audio"] is None)
    check(e.call("state",code,B)["title"] is None)
    expect_error(lambda:e.call("join",code,secret("late"),{"name":"Late"}), "game_already_started")
    expect_error(lambda:e.call("buzz",code,A), "buzz_closed")
    check(e.call("play",code,HOST)["step"]==0)
    check(e.call("replay",code,HOST,{"expectedRound":1,"expectedStep":0})["phase"]=="playing")
    expect_error(lambda:e.call("replay",code,HOST,{"expectedRound":2,"expectedStep":0}), "stale_clue")
    # Concurrent buzzer attempts: exactly one player can lock the microphone.
    barrier=threading.Barrier(2)
    def buzz(who):
        barrier.wait()
        try:
            return ("ok",e.call("buzz",code,who))
        except m.GameError as err:
            return ("error",str(err))
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(buzz,t) for t in (A,B)]
        answers=[f.result(timeout=5) for f in futures]
    check(sum(x[0]=="ok" for x in answers)==1, "exactly one buzzer lock")
    check(sum(x==("error","buzz_closed") for x in answers)==1)
    owner=A if answers[0][0]=="ok" else B
    other=B if owner==A else A
    active=e.call("state",code,owner)
    check(active["phase"]=="answering" and active["lockedPlayer"]==active["me"])
    check(active["answerExpiresAt"] is not None)
    expect_error(lambda:e.call("answer",code,other,{"song":"Saturday Sky"}), "not_your_turn")
    check(e.call("answer",code,owner,{"song":"Definitely incorrect"})["phase"]=="holding")
    check(e.call("state",code,owner)["players"][0]["score"]==0.0)
    expect_error(lambda:e.call("buzz",code,owner), "buzz_closed")
    locked=e.call("steal",code,other)
    check(locked["phase"]=="answering" and locked["stealTurn"])
    expect_error(lambda:e.call("answer",code,other,{"song":"Saturday Sky"}), "steal_requires_remaining_answers")
    right=e.call("answer",code,other,{"song":"Saturday Sky","artist":"Little Lights"})
    check(right["phase"]=="solved" and right["title"]=="Saturday Sky")
    check(right["artist"]=="Little Lights" and right["titleDone"] and right["artistDone"])
    scores={p["name"]:p["score"] for p in right["players"]}
    check(scores["Alice"]+scores["Bob"]==1.0)
    check(right["winner"] is None)
    expect_error(lambda:e.call("play",code,HOST), "not_ready_for_clip")
    next_round=e.call("next",code,HOST,song("Faraway Home","Some Artist",13))
    check(next_round["round"]==2 and next_round["phase"]=="paused")
    check(next_round["title"] is None and next_round["artist"] is None)
    check(next_round["audio"]=={"source":"local:13","cueMs":18000})
    check(e.call("skip",code,HOST)["phase"]=="solved")
    check(e.call("state",code,A)["title"]=="Faraway Home")
    check(e.call("next",code,HOST,song("Third Track","Another Artist",14))["round"]==3)
    e.close()
    # Reboot recovery: game state + credentials persist on the S21.
    e=m.MultiplayerEngine(db)
    restored=e.call("state",code,A)
    check(restored["phase"]=="paused" and restored["round"]==3)
    check(restored["title"] is None and restored["artist"] is None)
    check(restored["players"][0]["score"]==1.0)
    # Expired answer cannot be accepted, only explicitly marked as timed out.
    e.call("play",code,HOST)
    e.call("buzz",code,A)
    with e.lock:
        room=e.read(code)
        room["answerExpiresAt"]=time.time()-1
        e.db.execute("update rooms set data=? where code=?",(json.dumps(room),code))
    expect_error(lambda:e.call("answer",code,A,{"song":"Third Track"}), "answer_time_expired")
    check(e.call("expire",code,B)["phase"]=="holding")
    expect_error(lambda:e.call("steal",code,A), "already_tried_this_clip")
    check(e.call("skip",code,HOST)["phase"]=="solved")
    e.close()

# A fresh match can reach 20 points with only phone-scored decisions.
with TemporaryDirectory(prefix="s21-multi-win-") as tmp:
    e=m.MultiplayerEngine(Path(tmp)/"rooms.sqlite")
    code="DEFGH2"
    h=secret("host-winner")
    p=secret("player-winner")
    e.call("create",code,h)
    e.call("join",code,p,{"name":"Champion"})
    for i in range(1,21):
        if i==1:e.call("start",code,h,song(index=i))
        else:e.call("next",code,h,song(index=i))
        e.call("play",code,h)
        e.call("buzz",code,p)
        scored=e.call("answer",code,p,{"song":"Saturday Sky","artist":"Little Lights"})
        check(scored["players"][0]["score"]==float(i))
        if i!=20:check(scored["phase"]=="solved")
    check(scored["phase"]=="finished" and scored["winner"]==scored["me"])
    check(scored["title"]=="Saturday Sky" and scored["artist"]=="Little Lights")
    e.close()

print("PASS", assertions, "offline S21 multiplayer assertions: privacy, rooms, concurrent buzzes, stealing, deadlines, scores, 20-point win and reboot persistence")
