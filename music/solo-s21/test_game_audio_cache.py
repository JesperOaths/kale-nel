#!/usr/bin/env python3
"""Offline + S21-native cache tests: 10 slots, boundaries and deletion."""
import io
import json
import os
import struct
import tempfile
import time
import wave
from pathlib import Path

import game_audio_cache as c

# Test environments may use a small /tmp partition; production keeps a 2 GiB reserve.
c.MIN_FREE_BYTES=16*1024*1024

def tone_data(sample_count=400):
    buf=io.BytesIO()
    with wave.open(buf,"wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(8000)
        writer.writeframes(b"\x00\x00"*sample_count)
    return buf.getvalue()

with tempfile.TemporaryDirectory(prefix="tunerush-temp-audio-test-") as tmp:
    base=Path(tmp)
    authorized=base/"authorized"
    authorized.mkdir(mode=0o700)
    source=authorized/"sample.wav"
    source.write_bytes(tone_data())
    token="a"*64
    cache=c.GameAudioCache(base/"cache",authorized)
    summary=cache.reserve(token,slots=10,source="licensed-audio")
    assert summary=={"slots":10,"stored":0,"bytes":0}
    stats=cache.stats()
    assert stats["sessions"]==1 and stats["maxBytes"]==300*1024*1024
    assert stats["maxTracksPerGame"]==10 and stats["inactivitySeconds"]==7200
    assert (base/"cache").stat().st_mode & 0o777==0o700

    for i in range(10):
        stored=cache.stage_local(token,i,source)
        assert stored["bytes"]==source.stat().st_size
        assert len(stored["sha256"])==64
        assert Path(stored["name"]).suffix==".wav"
    info=cache.summary(token)
    assert info["stored"]==10 and info["bytes"]==10*source.stat().st_size
    try:cache.stage_local(token,10,source)
    except c.CacheError:pass
    else:raise AssertionError("Track 11 unexpectedly accepted")
    try:cache.stage_local("wrong",0,source)
    except c.CacheError:pass
    else:raise AssertionError("Invalid session unexpectedly accepted")
    try:cache.stage_https(token,0,"https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    except c.CacheError:pass
    else:raise AssertionError("YouTube download was not blocked")
    try:cache.stage_https(token,0,"https://tidal.com/browse/track/1.mp3")
    except c.CacheError:pass
    else:raise AssertionError("TIDAL download was not blocked")
    try:cache.stage_https(token,0,"https://unapproved.example.com/song.mp3")
    except c.CacheError:pass
    else:raise AssertionError("Unapproved domain was not blocked")
    other=base/"outside.wav"
    other.write_bytes(tone_data())
    try:cache.stage_local(token,0,other)
    except c.CacheError:pass
    else:raise AssertionError("Local-file path escape was accepted")
    unsafe=authorized/"link.wav"
    unsafe.symlink_to(other)
    try:cache.stage_local(token,0,unsafe)
    except c.CacheError:pass
    else:raise AssertionError("Symlink was accepted")

    assert cache.touch(token)
    old_limit=c.MAX_SONG_BYTES
    c.MAX_SONG_BYTES=8192
    bigger=authorized/"too-big.wav"
    bigger.write_bytes(tone_data(8192))
    try:cache.stage_local(token,0,bigger)
    except c.CacheError:pass
    else:raise AssertionError("Oversized recording was accepted")
    finally:c.MAX_SONG_BYTES=old_limit
    assert cache.summary(token)["stored"]==10
    assert not list(cache._session_dir(token).glob("*.part"))
    assert cache.delete(token)
    assert cache.summary(token)=={"slots":0,"stored":0,"bytes":0}
    assert cache.stats()["sessions"]==0

    # A second game is isolated and starts without any old songs.
    second="b"*64
    cache.reserve(second,slots=10,source="owned-library")
    assert cache.summary(second)["stored"]==0
    assert not cache.delete(token)
    cache.stage_local(second,0,source)
    manifest_path=cache._session_dir(second)/"manifest.json"
    manifest=json.loads(manifest_path.read_text())
    manifest["updated"]=time.time()-c.INACTIVITY_SECONDS-10
    c._fsync_json(manifest_path,manifest)
    assert cache.sweep()==1
    assert cache.stats()["sessions"]==0
    assert not any((base/"cache").glob("*.wav"))
    assert not any((base/"cache").glob("*/*.wav"))

    # Even metadata-only YouTube reservations must not store audio.
    third="c"*64
    cache.reserve(third,slots=10,source="youtube")
    assert cache.summary(third)["stored"]==0
    assert cache.delete(third)
    assert cache.stats()["usedBytes"]==0

print("PASS: 10 slots, 300MB global budget, file validation, source restrictions, no symlinks, cleanup on finish and inactivity, empty cache per new game")
