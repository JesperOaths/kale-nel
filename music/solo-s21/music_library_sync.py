#!/usr/bin/env python3
"""Incremental S21 music-library synchronization.

Only deliberately authorized local recordings and Spotydroid's metadata
exports are imported. The job does not run yt-dlp, NewPipe, Spotify DRM
tools or Spotydroid's YouTube Music extraction code.
"""
from __future__ import annotations
import csv
import hashlib
import json
import os
import time
from pathlib import Path

from persistent_music_library import (
    PersistentMusicLibrary, LibraryError
)
from game_audio_cache import AUDIO_SUFFIXES

SOURCE=Path(__file__).resolve().parent
CATALOG=SOURCE/"staging"/"mainstream"/"catalog.json"
INBOX=SOURCE/"staging"/"spotify-playlist-inbox"
WISHLIST=SOURCE/"staging"/"mainstream"/"tunerush-full-catalog.csv"
_MIN_AGE_SECONDS=20
_MAX_SCAN_FILES=3500
_MAX_IMPORT_PER_RUN=150


def _atomic_report(report,path):
    temp=path.with_name(path.name+".tmp")
    with temp.open("w",encoding="utf-8") as f:
        json.dump(report,f,indent=2,ensure_ascii=False)
        f.flush();os.fsync(f.fileno())
    temp.chmod(0o600)
    temp.replace(path)


def _metadata_for(path,root,lookup):
    record=lookup.get(path.relative_to(root).as_posix())
    if record is not None:
        return {k:str(record.get(k) or "") for k in
                ("title","artist","spotify_uri","isrc")}
    # Never guess a song's identity from ambiguous filenames.
    if " - " in path.stem:
        artist,title=path.stem.split(" - ",1)
        if artist.strip() and title.strip():
            return {"title":title.strip(),"artist":artist.strip(),
                    "spotify_uri":"","isrc":""}
    return None


def _read_manifest(root):
    manifest=root/"manifest.csv"
    if not manifest.exists():return {}
    if manifest.is_symlink() or manifest.stat().st_size>3*1024*1024:
        raise LibraryError("Unsafe or oversized audio import manifest.")
    with manifest.open("r",encoding="utf-8-sig",newline="") as f:
        result={}
        for index,row in enumerate(csv.DictReader(f)):
            if index>10000:raise LibraryError("Audio import manifest has too many rows.")
            name=str(row.get("filename") or "")
            if not name or name.startswith("/") or "\\" in name or ".." in Path(name).parts:
                raise LibraryError("Unsafe audio import manifest filename.")
            result[name]=row
        return result


def sync_once(lib=None,*,catalog_path=CATALOG,inbox_dir=INBOX,
              wishlist_path=WISHLIST,min_age_seconds=_MIN_AGE_SECONDS):
    lib=lib or PersistentMusicLibrary()
    authorized=Path(lib.authorized_root)
    authorized.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.chmod(authorized,0o700)
    inbox=Path(inbox_dir)
    inbox.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.chmod(inbox,0o700)
    errors=[];archives=0;imported=0;duplicates=0;skipped=0

    if Path(catalog_path).is_file():
        try:lib.sync_curated(catalog_path)
        except (OSError,ValueError,KeyError) as err:
            errors.append("catalog: "+str(err)[:150])

    # Import Spotify playlist titles, ISRCs and track URIs as metadata only.
    for archive in sorted(inbox.glob("*.zip"))[:12]:
        if archive.is_symlink() or not archive.is_file():
            skipped+=1;continue
        if time.time()-archive.stat().st_mtime<min_age_seconds:
            skipped+=1;continue
        stamp=archive.with_suffix(".processed-sha256")
        if archive.stat().st_size>16*1024*1024:
            errors.append("Spotify metadata archive exceeds 16 MiB.")
            continue
        digest=hashlib.sha256(archive.read_bytes()).hexdigest()
        if stamp.is_file() and stamp.read_text().strip()==digest:
            continue
        try:
            lib.import_spotydroid_zip(archive)
            stamp.write_text(digest)
            stamp.chmod(0o600)
            archives+=1
        except (OSError,ValueError) as err:
            errors.append("Spotify metadata ZIP: "+str(err)[:160])

    try:lookup=_read_manifest(authorized)
    except (OSError,ValueError) as err:
        lookup={}
        errors.append("audio manifest: "+str(err)[:150])

    candidates=0
    for path in authorized.rglob("*"):
        if candidates>=_MAX_SCAN_FILES:break
        if not path.is_file() or path.is_symlink() or path.suffix.lower() not in AUDIO_SUFFIXES:
            continue
        candidates+=1
        try:
            if time.time()-path.stat().st_mtime<min_age_seconds:
                skipped+=1;continue
            meta=_metadata_for(path,authorized,lookup)
            if not meta:
                skipped+=1;continue
            if imported+duplicates>=_MAX_IMPORT_PER_RUN:break
            result=lib.import_authorized(path,**meta)
            if result["alreadyStored"]:duplicates+=1
            else:imported+=1
        except (OSError,ValueError) as err:
            errors.append(path.name[:65]+": "+str(err)[:110])

    try:
        target=Path(wishlist_path)
        target.parent.mkdir(parents=True,exist_ok=True)
        lib.export_catalog_csv(target)
    except (OSError,ValueError) as err:errors.append("playlist export: "+str(err)[:120])
    report={"time":int(time.time()),"newAudioFiles":imported,
        "alreadyStored":duplicates,"newSpotifyMetadataArchives":archives,
        "skipped":skipped,"errors":errors[:30],
        "library":lib.stats(),
        "spotifyPlaylistCreated":False,
        "streamExtractionEnabled":False}
    _atomic_report(report,lib.root/"last-sync.json")
    return report


if __name__=="__main__":
    print(json.dumps(sync_once(),indent=2,ensure_ascii=False))
