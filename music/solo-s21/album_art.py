"""Resolve public album-cover metadata only after a Tune Rush round is revealed.

The S21 remains authoritative; cover URLs are never included in mystery-track
responses. MP3 bytes and user media paths are not sent to a metadata service.
"""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
import json
import re
import sqlite3

_SPOTIFY = re.compile(r"spotify:track:([A-Za-z0-9]{22})\Z")
_DEEZER = re.compile(r"deezer:(\d{1,20})\Z")
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_ALLOWED_HOSTS = {"i.scdn.co", "image-cdn-fa.spotifycdn.com",
                  "image-cdn.spotifycdn.com", "cdn-images.dzcdn.net"}
_USER_AGENT = "TuneRushCoverMetadata/1.0"


def _safe_image(value):
    """Accept only HTTPS images hosted by known Spotify/Deezer image CDNs."""
    if not isinstance(value, str) or len(value) > 500:
        return None
    parts = urlsplit(value)
    return (value if parts.scheme == "https" and parts.hostname in _ALLOWED_HOSTS
            and not parts.username and not parts.password and not parts.port else None)


def _public_json(url):
    req = Request(url, headers={"Accept": "application/json",
                                "User-Agent": _USER_AGENT})
    with urlopen(req, timeout=5) as response:
        if response.status != 200:
            return {}
        return json.loads(response.read(50000))


def _deezer_id(sha, library_root):
    if not _SHA.fullmatch(str(sha or "")):
        return None
    try:
        with sqlite3.connect(Path(library_root) / "library.sqlite3") as db:
            row = db.execute("""SELECT catalog_id FROM catalog
                                 WHERE sha256=? AND catalog_id LIKE 'deezer:%'
                                 ORDER BY rank DESC LIMIT 1""", (sha,)).fetchone()
        if row:
            m = _DEEZER.fullmatch(row[0])
            return m.group(1) if m else None
    except (sqlite3.Error, OSError, TypeError):
        pass
    return None


@lru_cache(maxsize=2048)
def _resolve(spotify_uri, deezer_id):
    # Strict IDs: no user-controlled URL or redirect target is accepted.
    if (match := _SPOTIFY.fullmatch(spotify_uri or "")):
        try:
            url = "https://open.spotify.com/oembed?" + urlencode({
                "url": "https://open.spotify.com/track/" + match.group(1)})
            result = _public_json(url)
            image = _safe_image(result.get("thumbnail_url"))
            if image:
                return {"url": image, "source": "Spotify"}
        except (OSError, ValueError, TypeError, KeyError):
            pass
    if deezer_id and re.fullmatch(r"\d{1,20}", deezer_id):
        try:
            result = _public_json("https://api.deezer.com/track/" + deezer_id)
            album = result.get("album") or {}
            image = _safe_image(album.get("cover_big") or album.get("cover_medium"))
            if image:
                return {"url": image, "source": "Deezer"}
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            pass
    return None


def cover_for_revealed(track, library_root):
    """Return a verified album-cover URL, or None without invented artwork."""
    if not isinstance(track, dict):
        return None
    spotify_uri = track.get("spotifyUri") or track.get("spotify_uri") or ""
    deezer_id = _deezer_id(track.get("sha256"), library_root)
    return _resolve(spotify_uri, deezer_id)
