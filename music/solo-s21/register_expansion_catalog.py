#!/usr/bin/env python3
"""Register 150 expansion tracks as metadata on the S21 without touching MP3s.

Entries become selectable only if a distinct, owner-supplied recording has
been imported and exactly reconciled to the title/artist or Spotify track URI.
Existing 975 catalog rows, audio files and reference data are never removed.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

from persistent_music_library import PersistentMusicLibrary
from sync_expansion_playlists import TRACKS, STATE, validate, canonical

GENRE_MAP = {
    "rock": ["rock"], "punk": ["rock"], "metal": ["metal"],
    "pop": ["pop"], "indie": ["indie"], "ska": ["rock"],
    "rnb": ["rnb"], "soul": ["rnb"], "jazz": ["rnb"], "funk": ["disco", "rnb"],
    "country": ["pop"], "disco": ["disco"], "hiphop": ["hiphop"],
    "electronic": ["electronic"], "house": ["dance", "electronic"],
    "dance": ["dance"], "drumandbass": ["dance", "electronic"],
    "world": ["pop"], "latin": ["pop"], "afrobeat": ["disco", "rnb"],
    "afrobeats": ["pop", "rnb"], "amapiano": ["dance"],
}


def register(library=None, *, csv_file=TRACKS, state_file=STATE):
    lib = library or PersistentMusicLibrary()
    playlists = validate(csv_file)
    state = Path(state_file)
    matches = json.loads(state.read_text()).get("matches", {}) if state.is_file() else {}
    if not isinstance(matches, dict):
        matches = {}
    count = 0
    with lib._locked():
        with lib._db() as db:
            for position, (playlist, rows) in enumerate(playlists.items()):
                for rank, row in enumerate(rows):
                    unique = canonical(row)
                    catalog_id = "tunerush-extra:" + hashlib.sha256(unique.encode()).hexdigest()[:24]
                    decade = str(int(row["year"]) // 10 * 10)
                    genres = GENRE_MAP.get(row["genre"], ["pop"])
                    uri = matches.get(unique)
                    if not isinstance(uri, str) or not uri.startswith("spotify:track:") or len(uri) != 36:
                        uri = None
                    db.execute("""INSERT INTO catalog
                        (catalog_id,title,artist,genres_json,decades_json,rank,spotify_uri)
                        VALUES(?,?,?,?,?,?,?)
                        ON CONFLICT(catalog_id) DO UPDATE SET
                        title=excluded.title,artist=excluded.artist,
                        genres_json=excluded.genres_json,decades_json=excluded.decades_json,
                        rank=excluded.rank,
                        spotify_uri=COALESCE(excluded.spotify_uri,catalog.spotify_uri)""",
                        (catalog_id, row["title"], row["artist"],
                         json.dumps(genres), json.dumps([decade]),
                         5000-position*50-rank, uri))
                    count += 1
            lib._reconcile(db)
            matched = db.execute("""SELECT COUNT(*) FROM catalog
                       WHERE catalog_id LIKE 'tunerush-extra:%'
                         AND sha256 IS NOT NULL""").fetchone()[0]
    return {"expansionMetadataRows": count, "playableImportedMatches": matched,
            "originalCatalogPreserved": True, "audioModified": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--register", action="store_true",
                        help="Upsert expansion metadata after inspecting the dry-run plan")
    options = parser.parse_args()
    if options.register:
        print(json.dumps(register(), indent=2))
    else:
        print(json.dumps({"dryRun": True,
                          "count": sum(map(len, validate().values())),
                          "requiresImportedAudio": True}, indent=2))
