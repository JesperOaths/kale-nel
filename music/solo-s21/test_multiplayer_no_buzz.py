#!/usr/bin/env python3
"""All seven denominations: S21-owned no-buzz phone choices and safe handoff."""
import hashlib
import json
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0,str(Path(__file__).resolve().parent))
from multiplayer import MultiplayerEngine, GameError, CLUES, NO_BUZZ_GRACE_SECONDS

def token(who):
    return hashlib.sha256(("no-buzz-test-"+who).encode()).hexdigest()

def fail(fn, expected):
    try: fn()
    except GameError as err:
        assert str(err)==expected,(str(err),expected)
    else: raise AssertionError("Expected "+expected)

with TemporaryDirectory(prefix="tunerush-no-buzz-") as temp:
    engine=MultiplayerEngine(Path(temp)/"game.sqlite3")
    room="ABC234"; host=token("host");alice=token("alice");bob=token("bob")
    stranger=token("stranger")
    engine.call("create",room,host)
    engine.call("join",room,alice,{"name":"Alice"})
    engine.call("join",room,bob,{"name":"Bob"})
    engine.call("start",room,host,{"mode":"local","song":"Keep It Secret",
        "artist":"Sample Composer","fileIndex":1,"durationMs":85000,"cueMs":15000})

    def expire_clue():
        with engine.lock:
            state=engine.read(room)
            assert state["phase"]=="playing"
            duration=CLUES[state["step"]]/1000
            state["clueStartedAt"]=time.time() - duration - NO_BUZZ_GRACE_SECONDS - 1
            engine.db.execute("update rooms set data=? where code=?",
                (json.dumps(state,separators=(",",":")),room))

    def choice(guest, decision, step):
        return engine.call("clue_choice",room,guest,
            {"choice":decision,"expectedRound":1,"expectedStep":step})

    for step in range(len(CLUES)):
        started=engine.call("play",room,host)
        assert started["phase"]=="playing" and started["step"]==step
        assert started["pendingClue"] is None
        # An unauthorized poll cannot advance the no-buzz countdown.
        expire_clue()
        fail(lambda:engine.call("state",room,stranger),"unauthorized")
        assert engine.read(room)["phase"]=="playing"
        prompted=engine.call("state",room,alice)
        assert prompted["phase"]=="decision" and prompted["step"]==step
        assert prompted["title"] is None and prompted["artist"] is None
        assert prompted["audio"] is None and not prompted.get("clipAudio")
        assert engine.call("state",room,bob)["phase"]=="decision"
        assert engine.call("state",room,host)["phase"]=="decision"
        fail(lambda:choice(host,"replay",step),"clue_choice_closed")
        fail(lambda:choice(alice,"replay",step+1),"stale_clue")
        fail(lambda:engine.call("buzz",room,alice),"buzz_closed")
        # Alice may request a repeat, but does not receive the MP3 bytes.
        selected=choice(alice,"replay",step)
        assert selected["phase"]=="paused" and selected["pendingClue"]=="replay"
        fail(lambda:choice(bob,"next",step),"clue_choice_closed")
        fail(lambda:engine.call("buzz",room,bob),"buzz_closed")
        repeated=engine.call("play",room,host)
        assert repeated["phase"]=="playing" and repeated["step"]==step
        assert repeated["pendingClue"] is None
        expire_clue()
        assert engine.call("state",room,bob)["phase"]=="decision"
        if step < len(CLUES)-1:
            more=choice(bob,"next",step)
            assert more["phase"]=="paused" and more["pendingClue"]=="next"
            fail(lambda:choice(alice,"replay",step),"clue_choice_closed")
            # The NEXT loop's host play must move forward exactly one step.
        else:
            fail(lambda:choice(bob,"next",step),"invalid_clue_choice")
            revealed=choice(bob,"reveal",step)
            assert revealed["phase"]=="solved"
            assert revealed["title"]=="Keep It Secret"
            assert revealed["artist"]=="Sample Composer"
            assert engine.call("state",room,alice)["phase"]=="solved"
    assert all(p["score"]==16 and p["spent"]==4 for p in engine.read(room)["players"])
    # Once a player buzzes, a no-buzz popup must never override their turn.
    engine.call("next",room,host,{"mode":"local","song":"Another Mystery",
        "artist":"Sample Composer","fileIndex":2,"durationMs":85000,"cueMs":15000})
    engine.call("play",room,host)
    engine.call("buzz",room,alice)
    room_after=engine.read(room)
    room_after["clueStartedAt"]=time.time()-100
    engine.db.execute("update rooms set data=? where code=?",
                      (json.dumps(room_after,separators=(",",":")),room))
    assert engine.call("state",room,bob)["phase"]=="answering"
    fail(lambda:choice(bob,"next",0),"clue_choice_closed")
    engine.close()
    print("S21_NO_BUZZ_ALL_CLUE_DURATIONS_PASS",
        {"durationsMs":list(CLUES),"phoneFirstChoiceWins":True,
         "noGuestAudioOrAnswers":True,"replayDoesNotAdvance":True,
         "nextAdvancesOnce":True,"finalReveals":True,
         "buzzOverridesPrompt":True,"paidPlaybackDebitsVerified":True})
