#!/usr/bin/env python3
"""Regression tests for permanent 20 GiB Tune Rush music library."""
import csv
import io
import json
import os
import tempfile
import wave
import zipfile
from pathlib import Path

import persistent_music_library as library

# The C720P test partition is small; production retains its 5 GiB reserve.
library.RESERVED_FREE_BYTES=16*1024*1024


def wave_audio(frames=250):
    f=io.BytesIO()
    with wave.open(f,"wb") as writer:
        writer.setnchannels(1);writer.setsampwidth(2);writer.setframerate(8000)
        writer.writeframes(b"\x00\x00"*frames)
    return f.getvalue()


with tempfile.TemporaryDirectory(prefix="tunerush-persistent-music-") as root:
    base=Path(root)
    authorized=base/"authorized"
    authorized.mkdir()
    track=authorized/"The Artist - The Song.wav"
    track.write_bytes(wave_audio())
    lib=library.PersistentMusicLibrary(base/"permanent",authorized)
    original=lib.stats()
    assert original["maxBytes"]==20*1024**3
    assert original["storedBytes"]==0 and original["permanent"] is True
    assert original["autoDelete"] is False
    catalog=base/"catalog.json"
    catalog.write_text(json.dumps({"tracks":[
        {"id":123,"title":"The Song","artist":"The Artist",
         "genres":["pop"],"decades":["2010"],"rank":800000},
        {"id":456,"title":"Second Song","artist":"Different Artist",
         "genres":["rock"],"decades":["1990"],"rank":700000},
    ]}))
    stats=lib.sync_curated(catalog)
    assert stats["catalogSongs"]==2 and stats["matchedCatalogSongs"]==0

    spotify_uri="spotify:track:"+"a"*22
    archive=base/"spotify_playlists.zip"
    with zipfile.ZipFile(archive,"w") as z:
        output=io.StringIO()
        writer=csv.DictWriter(output,fieldnames=[
            "Track URI","Track Name","Artist Name(s)","ISRC"])
        writer.writeheader()
        writer.writerow({"Track URI":spotify_uri,"Track Name":"The Song",
                         "Artist Name(s)":"The Artist","ISRC":"USAAA2600001"})
        z.writestr("Tune Rush Game Catalog.csv",output.getvalue())
    result=lib.import_spotydroid_zip(archive)
    assert result["spotifyPlaylists"]==1 and result["catalogSongs"]==2
    assert result["matchedCatalogSongs"]==0

    done=lib.import_authorized(track,title="The Song",artist="The Artist",
                               spotify_uri=spotify_uri,isrc="USAAA2600001")
    assert done["alreadyStored"] is False
    assert lib.stats()["matchedCatalogSongs"]==1
    assert lib.stats()["storedBytes"]==track.stat().st_size
    duplicate=lib.import_authorized(track,title="The Song",artist="The Artist")
    assert duplicate["alreadyStored"] is True
    assert lib.stats()["recordings"]==1
    assert lib.stats()["storedBytes"]==track.stat().st_size

    # A new session, process or restart must not remove the recording.
    second=library.PersistentMusicLibrary(base/"permanent",authorized)
    assert second.stats()["recordings"]==1
    assert second.stats()["matchedCatalogSongs"]==1
    assert len(list((base/"permanent"/"tracks").iterdir()))==1

    playlist_csv=base/"game_catalog.csv"
    export=second.export_catalog_csv(playlist_csv)
    assert export["rows"]==2
    with playlist_csv.open(newline="") as f:
        rows=list(csv.DictReader(f))
    assert rows[0]["catalog_id"]=="deezer:123"
    assert rows[0]["spotify_uri"]==spotify_uri
    assert rows[0]["audio_imported"]=="True"
    assert rows[1]["audio_imported"]=="False"
    assert rows[0]["spotify_search"].startswith("https://open.spotify.com/search/")
    missing=second.missing_catalog()
    assert len(missing)==1 and missing[0]["catalog_id"]=="deezer:456"

    # Protected external files and symlinks may not be copied.
    outsider=base/"not-authorized.wav";outsider.write_bytes(wave_audio())
    try:lib.import_authorized(outsider)
    except library.LibraryError:pass
    else:raise AssertionError("Unsafe file path was accepted.")
    (authorized/"symlink.wav").symlink_to(outsider)
    try:lib.import_authorized(authorized/"symlink.wav")
    except library.LibraryError:pass
    else:raise AssertionError("Symlink was accepted.")

    # Simulate full 20 GiB budget with no evictions.
    old=library.LIBRARY_BYTES
    library.LIBRARY_BYTES=lib.stats()["storedBytes"]+10
    second_file=authorized/"Other Artist - Other Song.wav"
    second_file.write_bytes(wave_audio(frames=500))
    try:lib.import_authorized(second_file)
    except library.LibraryError:pass
    else:raise AssertionError("Exceeded library budget without rejecting import.")
    finally:library.LIBRARY_BYTES=old
    assert lib.stats()["recordings"]==1

    # Every additional import remains, including after repeat catalog sync.
    lib.sync_curated(catalog)
    assert lib.stats()["recordings"]==1 and lib.stats()["matchedCatalogSongs"]==1

print("PASS persistent 20 GiB music library; no game deletion; SHA deduplication; secure imports; Spotydroid ZIP metadata; incremental catalog reconcile; playlist export")
