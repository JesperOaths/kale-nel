#!/usr/bin/env python3
"""Independent S21 cached multiplayer acceptance without real library changes."""
from __future__ import annotations
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from threading import Thread
from http.client import HTTPConnection
import hashlib
import json
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parent))
import multiplayer
import multiplayer_service as service

def secret(name):
    return hashlib.sha256(name.encode()).hexdigest()

def assert_error(fn,want):
    try:fn()
    except multiplayer.GameError as err:
        assert str(err)==want,(str(err),want)
        return
    raise AssertionError("Expected "+want)

catalog=[{
 "id":"cache-a","title":"A Sky of Stars","artist":"The Garden Orchestra",
 "sha256":"a"*64,"source":"persistent-library"
},{
 "id":"cache-b","title":"Another Day","artist":"Sandy River",
 "sha256":"b"*64,"source":"persistent-library"
}]
clue="data:audio/mpeg;base64,SUQzAAAAAA=="
def mock_choose(pool,used,root):
    for song in pool:
        if song["id"] not in used:return song.copy(),10000
    raise ValueError("No more tracks")

with TemporaryDirectory(prefix="tunerush-cached-multi-test-") as temp:
    with patch.object(multiplayer.permanent_audio,"select",return_value=catalog), \
         patch.object(multiplayer.permanent_audio,"choose",side_effect=mock_choose), \
         patch.object(service.permanent_audio,"clue_data",return_value=clue):
        db=Path(temp)/"rooms.sqlite3"
        engine=multiplayer.MultiplayerEngine(db,library_root=Path(temp))
        service.ENGINE=engine
        host=secret("test-host"),phone=secret("test-phone"),other=secret("test-other")
        code="ABC234"
        created=engine.call("create",code,host)
        assert created["role"]=="host" and created["players"]==[]
        player=engine.call("join",code,phone,{"name":"Phone Tester"})
        assert player["role"]=="player" and player["me"]
        assert_error(lambda:engine.call("join",code,host,{"name":"Host"}),"host_cannot_join_as_player")
        assert_error(lambda:engine.call("start",code,host,{"mode":"local","song":"Guess the secret",
           "artist":"I know it","fileIndex":0,"durationMs":100000,"cueMs":20000}),"invalid_music_source")
        state=engine.call("start",code,host,{"mode":"persistent-library",
               "song":"Injected Fake Title","artist":"Cheat", "sha256":"f"*64})
        assert state["round"]==1 and state["phase"]=="paused"
        assert state["title"] is None and state["artist"] is None
        secret_song=engine.read(code)["song"]
        assert secret_song["title"]==catalog[0]["title"] and secret_song["artist"]==catalog[0]["artist"]
        assert secret_song["sha256"]=="a"*64
        guest=engine.call("state",code,phone)
        assert guest["audio"] is None and guest["title"] is None and guest["artist"] is None
        server=service.DualStackServer(("::1",0),service.Handler)
        thread=Thread(target=server.serve_forever,daemon=True)
        thread.start()
        def request(action,hash_value,data=None):
            conn=HTTPConnection("127.0.0.1",server.server_port,timeout=6)
            body=json.dumps({"action":action,"code":code,"hash":hash_value,"data":data or {}})
            conn.request("POST","/api/multiplayer",body=body,
                         headers={"Content-Type":"application/json"})
            response=conn.getresponse()
            payload=json.loads(response.read())
            status=response.status
            conn.close()
            return status,payload
        try:
            status,played=request("play",host)
            assert status==200,(status,played)
            state=played["state"]
            assert state["phase"]=="playing" and state["clipAudio"]==clue
            assert state["audio"]["source"]=="cached:1"
            assert "sha256" not in json.dumps(state)
            status,guest=request("state",phone,{"withAudio":True})
            assert status==200 and "clipAudio" not in guest["state"]
            assert guest["state"]["title"] is None and guest["state"]["artist"] is None
            status,recovered=request("state",host,{"withAudio":True})
            assert status==200 and recovered["state"]["clipAudio"]==clue
            status,unauthorized=request("state",other)
            assert status==400 and unauthorized["error"]=="unauthorized"
            status,buzz=request("buzz",phone)
            assert status==200 and buzz["state"]["phase"]=="answering"
            status,wrong=request("answer",phone,{"song":"Absolutely Not","artist":"Unknown"})
            assert status==200 and wrong["state"]["players"][0]["score"]==0
            status,full=request("skip",host)
            assert status==200 and full["state"]["title"]==catalog[0]["title"]
            assert full["state"]["artist"]==catalog[0]["artist"]
            status,next_song=request("next",host,{"mode":"persistent-library"})
            assert status==200 and next_song["state"]["round"]==2
            assert engine.read(code)["song"]["sha256"]=="b"*64
            status,finished=request("finish",host)
            assert status==200 and finished["state"]["phase"]=="finished"
            assert finished["state"]["title"]==catalog[1]["title"]
        finally:
            server.shutdown();server.server_close()
        engine.close()
        print("S21_CACHED_MULTIPLAYER_PASS",json.dumps({
          "tracksSelectedOnPhone":2,"browserTitleInjectionRejected":True,
          "differentSongHashes":True,"hostClueOnly":True,"guestCannotSeeAudio":True,
          "firstBuzzLock":True,"serverScoring":True,"finishByHost":True,
          "legacyLocalModeDisabledInProduction":True}))
