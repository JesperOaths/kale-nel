#!/usr/bin/env python3
"""Isolated S21 multiplayer game engine, not connected to production routing.

Every game decision (permissions, buzzer lock, answers, points, round phases)
is computed on the Samsung S21. The public site remains a UI and audio output.
SQLite on the phone persists metadata, never audio or downloaded recordings.
"""
from __future__ import annotations

from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from threading import RLock
from typing import Any
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import unicodedata
import uuid

import permanent_audio

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
GENRES = frozenset(("demo", "pop", "rock", "hiphop", "electronic",
                    "indie", "dutch", "disco", "rnb", "metal", "dance"))
DECADES = frozenset(("1960", "1970", "1980", "1990", "2000", "2010", "2020"))
CLUES = (500, 1500, 3000, 5000, 8000, 12000, 20000)
CODE_PATTERN = re.compile(r"^[A-HJ-NP-Z2-9]{6}$")
HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
PLAYER_PATTERN = re.compile(r"^[\w .-]{1,20}$", re.UNICODE)
TTL_SECONDS = 12 * 60 * 60
ROOM_LIMIT = 150
PLAYER_LIMIT = 24


class GameError(ValueError):
    pass


def valid_code(code: Any) -> str:
    if not isinstance(code, str) or not CODE_PATTERN.fullmatch(code.strip().upper()):
        raise GameError("invalid_code")
    return code.strip().upper()


def valid_hash(value: Any) -> str:
    if not isinstance(value, str) or not HASH_PATTERN.fullmatch(value):
        raise GameError("invalid_token")
    return value


def when(instant: float) -> str:
    return datetime.fromtimestamp(instant, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def clean(value: Any, limit: int = 100) -> str:
    return str(value or "").strip()[:limit]


def norm(text: Any) -> str:
    s = unicodedata.normalize("NFKD", str(text).casefold())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(re.findall(r"[a-z0-9]+", s))


def close_match(guess: str, expected: str) -> bool:
    a, b = norm(guess), norm(expected)
    if not a or not b:
        return False
    if a == b:
        return True
    if a.startswith("the ") and a[4:] == b:
        return True
    if b.startswith("the ") and b[4:] == a:
        return True
    if min(len(a), len(b)) < 5:
        return False
    return SequenceMatcher(None, a, b).ratio() >= 0.90


def visible(room: dict, credential: str) -> dict:
    host = hmac.compare_digest(room["hostHash"], credential)
    participant = None if host else next(
        (p for p in room["players"] if hmac.compare_digest(p["hash"], credential)), None)
    if not host and participant is None:
        raise GameError("unauthorized")
    phase = room["phase"]
    show_title = room["titleDone"] or phase in ("solved", "finished")
    show_artist = room["artistDone"] or phase in ("solved", "finished")
    song = room.get("song") or {}
    rank = sorted(room["players"], key=lambda p: (-p["score"], p["joinedAt"]))
    return {
        "code": room["code"], "role": "host" if host else "player",
        "me": None if host else participant["id"],
        "myBlockedStep": None if host else participant["blockedStep"],
        "players": [{"id": p["id"], "name": p["name"], "score": p["score"]} for p in rank],
        "phase": phase, "mode": room["mode"], "genres": room["genres"],
        "decades": room["decades"], "round": room["round"], "step": room["step"],
        "firstAnswered": room["firstAnswered"], "stealTurn": room["stealTurn"],
        "clipMs": CLUES[room["step"]] if 0 <= room["step"] <= 6 else 0,
        "lockedPlayer": room["lockedPlayer"], "answerExpiresAt": room["answerExpiresAt"],
        "titleDone": room["titleDone"], "artistDone": room["artistDone"],
        "title": song.get("title") if show_title else None,
        "artist": song.get("artist") if show_artist else None,
        "audio": ({"source": "cached:" + str(room["round"]), "cueMs": song["cueMs"]}
                  if host and song and room["mode"] == "persistent-library" else
                  {"source": "local:" + str(song["fileIndex"]), "cueMs": song["cueMs"]}
                  if host and song and room["mode"] == "local" else None),
        "winner": room["winner"], "expiresAt": when(room["expires"]),
    }


class MultiplayerEngine:
    def __init__(self, path: str | Path, library_root: str | Path | None = None):
        self.library_root = Path(library_root) if library_root is not None else None
        self.path = Path(path).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = RLock()
        self.db = sqlite3.connect(self.path, timeout=5, isolation_level=None, check_same_thread=False)
        self.db.execute("pragma journal_mode=WAL")
        self.db.execute("pragma busy_timeout=5000")
        self.db.execute("""create table if not exists rooms (
            code text primary key,
            expires real not null,
            data text not null
        )""")
        self.db.execute("create index if not exists rooms_expiry on rooms(expires)")
        if os.name == "posix":
            os.chmod(self.path, 0o600)

    def close(self) -> None:
        with self.lock:
            self.db.close()

    def read(self, code: str) -> dict:
        found = self.db.execute("select data from rooms where code=?", (code,)).fetchone()
        if not found:
            raise GameError("room_not_found")
        room = json.loads(found[0])
        if room["expires"] <= time.time():
            raise GameError("room_expired")
        return room

    def call(self, action: str, code: str, credential: str, data: dict | None = None) -> dict:
        if not isinstance(action, str):
            raise GameError("unknown_action")
        code = valid_code(code)
        credential = valid_hash(credential)
        if data is None:
            data = {}
        if not isinstance(data, dict) or len(json.dumps(data)) > 12000:
            raise GameError("invalid_data")
        with self.lock:
            if action == "state":
                return visible(self.read(code), credential)
            self.db.execute("begin immediate")
            try:
                if action == "create":
                    result = self._create(code, credential)
                    self.db.execute("commit")
                    return result
                room = self.read(code)
                result = self._mutate(room, action, credential, data)
                self.db.execute("update rooms set expires=?, data=? where code=?",
                                (room["expires"], json.dumps(room, separators=(",", ":")), code))
                self.db.execute("commit")
                return result
            except Exception:
                self.db.execute("rollback")
                raise

    def _create(self, code: str, credential: str) -> dict:
        now = time.time()
        self.db.execute("delete from rooms where expires < ?", (now,))
        if self.db.execute("select count(*) from rooms").fetchone()[0] >= ROOM_LIMIT:
            raise GameError("room_capacity_reached")
        room = {
            "code": code, "hostHash": credential, "players": [],
            "created": now, "expires": now + TTL_SECONDS, "phase": "lobby",
            "mode": "local", "genres": ["pop", "rock"], "decades": [],
            "round": 0, "step": -1, "firstAnswered": False, "stealTurn": False,
            "lockedPlayer": None, "answerExpiresAt": None,
            "titleDone": False, "artistDone": False, "song": None,
            "winner": None, "usedMusicIds": [],
        }
        try:
            self.db.execute("insert into rooms(code,expires,data) values(?,?,?)",
                            (code, room["expires"], json.dumps(room, separators=(",", ":"))))
        except sqlite3.IntegrityError as err:
            raise GameError("room_code_taken") from err
        return visible(room, credential)

    def _mutate(self, room: dict, action: str, credential: str, data: dict) -> dict:
        host = hmac.compare_digest(room["hostHash"], credential)
        player = None if host else next(
            (p for p in room["players"] if hmac.compare_digest(p["hash"], credential)), None)
        if player is None and not host and action != "join":
            raise GameError("unauthorized")
        phase = room["phase"]
        if action == "join":
            if host:
                raise GameError("host_cannot_join_as_player")
            if phase != "lobby":
                raise GameError("game_already_started")
            name = clean(data.get("name"), 20)
            if not name or not PLAYER_PATTERN.fullmatch(name):
                raise GameError("invalid_name")
            if len(room["players"]) >= PLAYER_LIMIT:
                raise GameError("room_full")
            if any(p["name"].casefold() == name.casefold() for p in room["players"]):
                raise GameError("name_taken")
            room["players"].append({
                "id": str(uuid.uuid4()), "name": name, "hash": credential,
                "score": 0.0, "blockedStep": -99, "joinedAt": time.time(),
            })
        elif action == "settings":
            if not host or phase != "lobby":
                raise GameError("host_lobby_only")
            genres = data.get("genres")
            decades = data.get("decades") or []
            if not isinstance(genres, list) or not genres:
                raise GameError("select_a_genre")
            if not isinstance(decades, list) or len(decades) > 7:
                raise GameError("invalid_decades")
            room["genres"] = sorted({g for g in genres if isinstance(g, str) and g in GENRES})
            room["decades"] = sorted({d for d in decades if isinstance(d, str) and d in DECADES})
            if not room["genres"]:
                raise GameError("select_a_genre")
        elif action in ("start", "next"):
            if not host:
                raise GameError("host_only")
            if action == "start" and phase != "lobby":
                raise GameError("not_in_lobby")
            if action == "next" and phase != "solved":
                raise GameError("round_not_solved")
            if action == "start" and not room["players"]:
                raise GameError("no_players")
            source = clean(data.get("mode"), 24)
            if source == "persistent-library":
                if self.library_root is None:
                    raise GameError("cached_library_unavailable")
                if room["round"] >= 40:
                    raise GameError("round_limit_reached")
                # Selection, names, cue points and hashes are ALL determined by
                # the S21. A browser must never submit the secret answer.
                try:
                    pool = permanent_audio.select(room["genres"], room["decades"], 1, self.library_root)
                    selection, cue = permanent_audio.choose(
                        pool, room.get("usedMusicIds", []), self.library_root)
                except (ValueError, OSError, sqlite3.Error) as exc:
                    raise GameError("cached_tracks_unavailable") from exc
                if selection["id"] in room.get("usedMusicIds", []):
                    raise GameError("cached_track_repeated")
                song = {"title": selection["title"], "artist": selection["artist"],
                        "sha256": selection["sha256"], "id": selection["id"], "cueMs": cue}
                room.setdefault("usedMusicIds", []).append(selection["id"])
            elif source == "local" and self.library_root is None:
                # Legacy offline tests only. Production never accepts answer
                # metadata, file indices, or clue timing from the browser.
                title, artist = clean(data.get("song")), clean(data.get("artist"))
                index, duration, cue = data.get("fileIndex"), data.get("durationMs"), data.get("cueMs")
                if not title or not artist:
                    raise GameError("local_song_metadata_missing")
                if type(index) is not int or not 0 <= index <= 99999999:
                    raise GameError("local_file_index_invalid")
                if type(duration) is not int or not 30000 <= duration <= 7200000:
                    raise GameError("local_duration_invalid")
                if type(cue) is not int or not 0 <= cue <= duration - 21000:
                    raise GameError("local_cue_invalid")
                song = {"title": title, "artist": artist, "fileIndex": index,
                        "durationMs": duration, "cueMs": cue}
            else:
                raise GameError("invalid_music_source")
            room.update({
                "mode": source, "song": song, "round": room["round"] + 1,
                "phase": "paused", "step": -1,
                "lockedPlayer": None, "answerExpiresAt": None,
                "firstAnswered": False, "stealTurn": False,
                "titleDone": False, "artistDone": False,
            })
            for p in room["players"]:
                p["blockedStep"] = -99
        elif action == "random_cue":
            raise GameError("cue_not_available")
        elif action == "play":
            if not host or phase != "paused" or room["lockedPlayer"] is not None:
                raise GameError("not_ready_for_clip")
            if room["step"] >= 6:
                raise GameError("all_hints_used")
            room["step"] += 1
            room.update(phase="playing", firstAnswered=False, stealTurn=False)
        elif action == "replay":
            if not host or phase not in ("paused", "playing") or room["lockedPlayer"] is not None or room["firstAnswered"] or not 0 <= room["step"] <= 6:
                raise GameError("replay_unavailable")
            if data.get("expectedRound") != room["round"] or data.get("expectedStep") != room["step"]:
                raise GameError("stale_clue")
            room["phase"] = "playing"
        elif action == "pause":
            if not host:
                raise GameError("host_only")
            if phase == "playing":
                room["phase"] = "paused"
        elif action == "resume":
            if not host or phase != "holding" or room["step"] >= 6:
                raise GameError("resume_unavailable")
            room["phase"] = "paused"
        elif action == "buzz":
            if host or phase not in ("playing", "paused") or room["step"] < 0 or room["firstAnswered"]:
                raise GameError("buzz_closed")
            if player["blockedStep"] == room["step"]:
                raise GameError("already_tried_this_clip")
            room.update(phase="answering", lockedPlayer=player["id"],
                        answerExpiresAt=time.time() + 25, stealTurn=False)
        elif action == "steal":
            if host or phase != "holding" or not room["firstAnswered"]:
                raise GameError("steal_closed")
            if player["blockedStep"] == room["step"]:
                raise GameError("already_tried_this_clip")
            room.update(phase="answering", lockedPlayer=player["id"],
                        answerExpiresAt=time.time() + 25, stealTurn=True)
        elif action == "expire":
            if phase != "answering" or room["answerExpiresAt"] is None or time.time() < room["answerExpiresAt"]:
                raise GameError("answer_still_open")
            for p in room["players"]:
                if p["id"] == room["lockedPlayer"]:
                    p["blockedStep"] = room["step"]
            room.update(phase="holding", lockedPlayer=None, firstAnswered=True,
                        stealTurn=False, answerExpiresAt=None)
        elif action == "forfeit":
            if host or phase != "answering" or room["lockedPlayer"] != player["id"]:
                raise GameError("not_your_turn")
            player["blockedStep"] = room["step"]
            room.update(phase="holding", lockedPlayer=None, firstAnswered=True,
                        stealTurn=False, answerExpiresAt=None)
        elif action == "answer":
            if (room["answerExpiresAt"] is not None and
                time.time() > room["answerExpiresAt"]):
                raise GameError("answer_time_expired")
            if host or phase != "answering" or room["lockedPlayer"] != player["id"]:
                raise GameError("not_your_turn")
            title, artist = clean(data.get("song")), clean(data.get("artist"))
            done_title, done_artist = room["titleDone"], room["artistDone"]
            if room["stealTurn"] and ((not done_title and not title) or
                                      (not done_artist and not artist)):
                raise GameError("steal_requires_remaining_answers")
            delta = 0.0
            for field, guess, done in (("title", title, done_title),
                                       ("artist", artist, done_artist)):
                if guess and not done:
                    correct = close_match(guess, room["song"][field])
                    delta += 0.5 if correct else (-1 if room["stealTurn"] else -0.5)
                    if correct:
                        room["titleDone" if field == "title" else "artistDone"] = True
            player["score"] = round(max(0, player["score"] + delta), 1)
            player["blockedStep"] = room["step"]
            winner = player["score"] >= 20
            room.update(
                lockedPlayer=None, answerExpiresAt=None,
                firstAnswered=True, stealTurn=False,
                phase=("finished" if winner else "solved"
                       if room["titleDone"] and room["artistDone"] else "holding"),
                winner=player["id"] if winner else room["winner"],
            )
        elif action == "skip":
            if not host or phase not in ("paused", "playing", "holding"):
                raise GameError("skip_unavailable")
            room.update(phase="solved", titleDone=True, artistDone=True,
                        lockedPlayer=None, answerExpiresAt=None)
        elif action == "finish":
            if not host or phase == "lobby":
                raise GameError("host_only")
            best = max((p["score"] for p in room["players"]),default=0)
            winners = [p for p in room["players"] if p["score"] == best]
            room.update(phase="finished", titleDone=True, artistDone=True,
                        winner=winners[0]["id"] if len(winners)==1 else None,
                        lockedPlayer=None, answerExpiresAt=None)
        else:
            raise GameError("unknown_action")
        return visible(room, credential)


def hash_capability(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


if __name__ == "__main__":
    home = Path(os.environ.get("HOME", "/data/data/com.termux/files/home"))
    engine = MultiplayerEngine(home / ".tunerush-multiplayer" / "rooms.sqlite3")
    print("S21 multiplayer engine available for local tests; no public routing enabled.")
    engine.close()
