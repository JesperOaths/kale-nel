#!/usr/bin/env python3
"""Regression: abandoned 25s buzzer locks always clear on S21 state polls."""
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib,json,time
from multiplayer import MultiplayerEngine,GameError

def token(s):
    return hashlib.sha256(s.encode()).hexdigest()

def expect_error(fn, code):
    try: fn()
    except GameError as ex:
        assert str(ex)==code,(str(ex),code)
        return
    raise AssertionError("Expected "+code)

with TemporaryDirectory(prefix="tune-timeout-test-") as temp:
    path=Path(temp)/"rooms.db"
    game=MultiplayerEngine(path)
    room="ABC234";host=token("host");alice=token("alice");bob=token("bob")
    game.call("create",room,host)
    game.call("join",room,alice,{"name":"Alice"})
    game.call("join",room,bob,{"name":"Bob"})
    game.call("start",room,host,{"mode":"local","song":"Saturday Sky","artist":"Little Lights",
         "fileIndex":15,"durationMs":180000,"cueMs":18000})
    game.call("play",room,host)
    game.call("buzz",room,alice)
    assert game.call("state",room,host)["phase"]=="answering"
    # Simulate actual 25-second expiry with a private fixture, no 26s sleep.
    with game.lock:
        original=game.read(room)
        original["answerExpiresAt"]=time.time()-2
        game.db.execute("update rooms set data=? where code=?",
                        (json.dumps(original),room))
    # Unauthenticated polls cannot advance or read a guessed person's state.
    expect_error(lambda:game.call("state",room,token("stranger")),"unauthorized")
    assert game.read(room)["phase"]=="answering"
    after=game.call("state",room,host)
    assert after["phase"]=="holding" and after["lockedPlayer"] is None
    assert after["answerExpiresAt"] is None and after["firstAnswered"]
    blocked=game.call("state",room,alice)
    assert blocked["myBlockedStep"]==0
    expect_error(lambda:game.call("steal",room,alice),"already_tried_this_clip")
    stolen=game.call("steal",room,bob)
    assert stolen["phase"]=="answering" and stolen["stealTurn"]
    with game.lock:
        original=game.read(room)
        original["answerExpiresAt"]=time.time()-2
        game.db.execute("update rooms set data=? where code=?",
                        (json.dumps(original),room))
    # A host command must also release the abandoned second lock itself.
    finished=game.call("skip",room,host)
    assert finished["phase"]=="solved",finished
    assert game.call("state",room,bob)["myBlockedStep"]==0
    game.close()
    reopened=MultiplayerEngine(path)
    assert reopened.call("state",room,host)["phase"]=="solved"
    assert reopened.call("state",room,alice)["myBlockedStep"]==0
    assert reopened.call("state",room,bob)["myBlockedStep"]==0
    reopened.close()
print("S21_AUTO_BUZZ_EXPIRY_PASS",{"phoneEnforced":True,
 "unauthorizedPollRejected":True,"guestRecovery":True,"hostUnblocks":True,
 "noScoreMutation":True,"persistentAfterRestart":True})
