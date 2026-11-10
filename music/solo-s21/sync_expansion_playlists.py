#!/usr/bin/env python3
"""Idempotently create the five new Tune Rush expansion playlists in Spotify.

Only official Spotify metadata and track URIs are used. No music is downloaded
or copied, no existing Tune Rush playlist is edited, and no OAuth bearer token
is stored in source files or logs. Defaults to a complete offline preview.
"""
from __future__ import annotations
import argparse
import csv
import json
import os
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

from persistent_music_library import LIBRARY_ROOT
from spotify_playlist_builder import SpotifyApi

TRACKS = Path(__file__).with_name("tunerush-five-expansion-playlists.csv")
CATALOG = Path(__file__).with_name("tunerush-975-game-catalog.csv")
STATE = LIBRARY_ROOT / "spotify-five-expansions.json"
SPOTIFY_URI = re.compile(r"spotify:track:[A-Za-z0-9]{22}\Z")
UNWANTED = re.compile(r"\b(live|karaoke|tribute|instrumental|remix|cover version)\b", re.I)


def norm(value):
    value = unicodedata.normalize("NFKD", str(value or "").casefold())
    return "".join(c for c in value if not unicodedata.combining(c)
                   and (c.isalnum() or c.isspace())).strip()


def canonical(row):
    return norm(row["artist"]) + ":" + norm(row["title"])


def rows_from(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def validate(expansions=TRACKS, original=CATALOG):
    base = {canonical(s) for s in rows_from(original)}
    collections = defaultdict(list)
    seen = set()
    for row in rows_from(expansions):
        name = (row.get("playlist") or "").strip()
        if not name.startswith("Tune Rush — ") or len(name) > 120:
            raise ValueError("Invalid expansion playlist name")
        k = canonical(row)
        if not row.get("artist") or not row.get("title") or k in seen or k in base:
            raise ValueError("Duplicate or missing expansion title: " + str(k))
        if not re.fullmatch(r"19\d{2}|20\d{2}", row.get("year", "")):
            raise ValueError("Expansion year must be a four-digit release year")
        seen.add(k)
        collections[name].append(row)
    if len(collections) != 5 or any(len(songs) != 50 for songs in collections.values()):
        raise ValueError("Expected exactly five lists of 50 unique new songs")
    return dict(collections)


def resolve_spotify(api, artist, title):
    """Use an exact artist/title match; never substitute a cover or remix."""
    query = "track:" + title + " artist:" + artist
    data = api.call("GET", "/search", params={"q": query, "type": "track", "limit": 10})
    options = []
    for candidate in data.get("tracks", {}).get("items", []):
        uri = candidate.get("uri", "")
        if not SPOTIFY_URI.fullmatch(uri):
            continue
        if norm(candidate.get("name")) != norm(title):
            continue
        names = [norm(a.get("name")) for a in candidate.get("artists", [])]
        if norm(artist) not in names:
            continue
        title_lower = str(candidate.get("name") or "")
        album_name = str((candidate.get("album") or {}).get("name") or "")
        if UNWANTED.search(title_lower) or (UNWANTED.search(album_name)
                                             and not UNWANTED.search(title)):
            continue
        options.append((int(candidate.get("popularity") or 0), uri))
    options.sort(reverse=True)
    return options[0][1] if options else None


def owned_playlists(api, user_id):
    result = {}
    for offset in range(0, 1000, 50):
        page = api.call("GET", "/me/playlists",
                        params={"limit": 50, "offset": offset})
        for row in page.get("items", []):
            if (row and (row.get("owner") or {}).get("id") == user_id
                    and isinstance(row.get("name"), str)):
                result.setdefault(row["name"], row.get("id"))
        if not page.get("next"):
            break
    return result


def run(*, execute=False, token=None, catalog=CATALOG, expansions=TRACKS,
        state=STATE, max_search=250):
    groups = validate(expansions, catalog)
    result = {"dryRun": not execute, "playlists": {name: {
        "curated": len(rows), "created": False, "matched": 0,
        "added": 0, "unresolved": []} for name, rows in groups.items()}}
    if not execute:
        return result
    if not token:
        raise ValueError("An owner-authorized Spotify OAuth access token is required.")
    api = SpotifyApi(token)
    user = api.call("GET", "/me")
    user_id = user.get("id")
    if not user_id:
        raise ValueError("Could not authenticate the Spotify account.")
    existing = owned_playlists(api, user_id)
    dest = Path(state)
    previous = json.loads(dest.read_text()) if dest.is_file() else {}
    mapped = previous.get("matches", {})
    if not isinstance(mapped, dict):
        mapped = {}
    searched = 0
    for name, songs in groups.items():
        entry = result["playlists"][name]
        uris = []
        for song in songs:
            key = canonical(song)
            uri = mapped.get(key)
            if not SPOTIFY_URI.fullmatch(uri or "") and searched < max_search:
                searched += 1
                uri = resolve_spotify(api, song["artist"], song["title"])
                if uri:
                    mapped[key] = uri
            if uri and SPOTIFY_URI.fullmatch(uri):
                if uri not in uris:
                    uris.append(uri)
            else:
                entry["unresolved"].append({"artist": song["artist"],
                                            "title": song["title"]})
        entry["matched"] = len(uris)
        # Do not create empty Spotify playlists when metadata is unresolved.
        if not uris:
            continue
        playlist_id = existing.get(name)
        if not playlist_id or not re.fullmatch(r"[A-Za-z0-9]{22}", playlist_id):
            data = api.call("POST", "/me/playlists", {
                "name": name,
                "public": False,
                "description": "Tune Rush genre/decade expansion. Original catalog preserved; no audio downloads."})
            playlist_id = data.get("id")
            if not playlist_id or not re.fullmatch(r"[A-Za-z0-9]{22}", playlist_id):
                raise ValueError("Spotify returned an invalid playlist ID")
            existing[name] = playlist_id
            entry["created"] = True
        present = api.playlist_items(playlist_id)
        missing = [uri for uri in uris if uri not in present]
        for offset in range(0, len(missing), 100):
            part = missing[offset:offset+100]
            api.call("POST", "/playlists/" + playlist_id + "/items", {"uris": part})
            entry["added"] += len(part)
        entry["url"] = "https://open.spotify.com/playlist/" + playlist_id
    dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = dest.with_suffix(".tmp")
    temporary.write_text(json.dumps({"matches": mapped, "owner": user_id,
                                      "playlists": existing}, ensure_ascii=False))
    temporary.chmod(0o600)
    temporary.replace(dest)
    result["searches"] = searched
    result["matchedTotal"] = sum(s["matched"] for s in result["playlists"].values())
    result["addedTotal"] = sum(s["added"] for s in result["playlists"].values())
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--max-search", type=int, default=250)
    options = parser.parse_args()
    print(json.dumps(run(execute=options.execute,
                         token=os.environ.get("TUNERUSH_SPOTIFY_ACCESS_TOKEN"),
                         max_search=options.max_search), indent=2, ensure_ascii=False))
