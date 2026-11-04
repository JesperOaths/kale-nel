#!/usr/bin/env python3
"""Regression for incremental Spotydroid metadata and persistent audio imports."""
import csv
import io
import json
import os
import tempfile
import time
import wave
import zipfile
from pathlib import Path

import music_library_sync as worker
import persistent_music_library as library

library.RESERVED_FREE_BYTES=16*1024*1024


def wav():
    buffer=io.BytesIO()
    with wave.open(buffer,"wb") as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(8000)
        f.writeframes(b"\x00\x00"*128)
    return buffer.getvalue()


with tempfile.TemporaryDirectory(prefix="tunerush-library-sync-") as tmp:
    root=Path(tmp)
    authorized=root/"authorized"
    authorized.mkdir()
    inbox=root/"spotify"
    inbox.mkdir()
    db=library.PersistentMusicLibrary(root/"permanent",authorized)
    catalog=root/"catalog.json"
    catalog.write_text(json.dumps({"tracks":[
        {"id":345,"title":"First Hit","artist":"First Artist","genres":["pop"],
         "decades":["2010"],"rank":900000},
        {"id":567,"title":"Second Hit","artist":"Second Artist","genres":["rock"],
         "decades":["1980"],"rank":800000}
    ]}))
    uri="spotify:track:"+"z"*22
    buffer=io.StringIO()
    fields=["Track URI","Track Name","Artist Name(s)","ISRC"]
    writer=csv.DictWriter(buffer,fieldnames=fields)
    writer.writeheader()
    writer.writerow({"Track URI":uri,"Track Name":"First Hit",
                     "Artist Name(s)":"First Artist","ISRC":"USAAA2600001"})
    archive=inbox/"playlists.zip"
    with zipfile.ZipFile(archive,"w") as z:
        z.writestr("Tune Rush.csv",buffer.getvalue())
    audio=authorized/"First Artist - First Hit.wav"
    audio.write_bytes(wav())
    os.utime(audio,(time.time()-60,)*2)
    os.utime(archive,(time.time()-60,)*2)
    wishlist=root/"wishlist.csv"
    result=worker.sync_once(db,catalog_path=catalog,inbox_dir=inbox,
                            wishlist_path=wishlist,min_age_seconds=0)
    assert result["newAudioFiles"]==1,result
    assert result["newSpotifyMetadataArchives"]==1,result
    assert result["library"]["recordings"]==1
    assert result["library"]["matchedCatalogSongs"]==1
    assert wishlist.exists()
    assert (db.root/"last-sync.json").exists()
    follow=worker.sync_once(db,catalog_path=catalog,inbox_dir=inbox,
                            wishlist_path=wishlist,min_age_seconds=0)
    assert follow["newAudioFiles"]==0 and follow["alreadyStored"]==1
    assert follow["newSpotifyMetadataArchives"]==0
    assert follow["library"]["recordings"]==1

    # Adding a new authorized song is incremental and permanent.
    second=authorized/"Second Artist - Second Hit.wav"
    second.write_bytes(wav()+b"\x01\x02")
    os.utime(second,(time.time()-60,)*2)
    third=worker.sync_once(db,catalog_path=catalog,inbox_dir=inbox,
                           wishlist_path=wishlist,min_age_seconds=0)
    assert third["newAudioFiles"]==1,third
    assert third["library"]["matchedCatalogSongs"]==2
    assert third["library"]["recordings"]==2
    assert third["library"]["permanent"] is True
    reloaded=library.PersistentMusicLibrary(root/"permanent",authorized)
    assert reloaded.stats()["recordings"]==2
    assert not hasattr(reloaded,"delete")
    assert reloaded.stats()["maxBytes"]==20*1024**3

print("PASS incremental permanent audio sync, Spotydroid metadata import, 20GiB cap, restart persistence and zero automatic deletions")
