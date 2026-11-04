"""Curated mainstream-hit selection for a player-supplied, authorized music library.

The client supplies ONLY identifiers from an editorial catalog and its own
file handles remain in the user's browser. No copyrighted audio is uploaded,
cached, or streamed by the S21. The S21 chooses songs and verifies guesses.

Deezer chart rank is a relative popularity metric, NOT a stream count.
Playlist decade is an editorial tag, not a verified original release year.
"""
from __future__ import annotations
import json
import random
import re
from pathlib import Path

CATALOG=Path.home()/"tune-rush-solo"/"staging"/"mainstream"/"catalog.json"
MIN_RANK=600000
ENTRY_ID=re.compile(r"^[0-9]{1,3}$")

class LibraryError(ValueError):
    pass

def load_catalog(path=None):
    source=Path(path) if path is not None else CATALOG
    try:
        with source.open(encoding="utf-8") as f:catalog=json.load(f)
    except (OSError,ValueError) as err:
        raise LibraryError("Curated mainstream catalog unavailable on S21") from err
    if (catalog.get("version")!=1 or catalog.get("provider")!="deezer"
        or len(catalog.get("tracks",[]))<100):
        raise LibraryError("Curated mainstream catalog is invalid")
    return {int(x["id"]):x for x in catalog["tracks"]
            if int(x.get("rank",0))>=MIN_RANK}

def select(entries, genres, decades, limit, *, catalog=None):
    if not isinstance(entries,list) or not 1<=len(entries)<=80:
        raise LibraryError("Choose up to 80 music files from your laptop.")
    if not isinstance(genres,list) or not genres:
        raise LibraryError("Choose at least one genre.")
    if not isinstance(decades,list):
        raise LibraryError("Invalid era.")
    if type(limit)!=int or limit not in (5,10,20):
        raise LibraryError("Choose 5, 10 or 20 songs.")
    source=load_catalog() if catalog is None else catalog
    pool={}
    for item in entries:
        if not isinstance(item,dict):continue
        fileid=str(item.get("fileId",""))
        if not ENTRY_ID.fullmatch(fileid):continue
        try:trackid=int(item.get("catalogId") or 0)
        except (TypeError,ValueError):continue
        official=source.get(trackid)
        if official is None:continue
        if not any(g in official["genres"] for g in genres):continue
        if decades and not any(d in official["decades"] for d in decades):continue
        # Never use a filename, title or artist supplied by the browser for
        # scoring. The trusted, curated catalog on the phone is authoritative.
        pool[trackid]={
            "id":"owned_"+fileid,
            "fileId":fileid,
            "title":str(official["title"])[:100],
            "artist":str(official["artist"])[:100],
            "duration":180,
            "rank":int(official["rank"]),
            "genres":official["genres"],
            "decades":official["decades"],
            "source":"owned-library",
            "deezerId":trackid,
        }
    candidates=sorted(pool.values(),key=lambda row:-row["rank"])
    if len(candidates)<limit:
        raise LibraryError(
            f"Found {len(candidates)} recognizable songs in your selected files "
            f"for this genre/era, but the game needs {limit}. "
            "Add more songs, select more genres or choose a shorter game."
        )
    return candidates

def select_next(pool, used, rng=random):
    # Weighted toward famous songs without always repeating the same records.
    available=[x for x in pool if x["id"] not in used]
    if not available:raise LibraryError("No unused songs remain.")
    weights=[max(1,x["rank"])**2 for x in available]
    return rng.choices(available,weights,k=1)[0]
