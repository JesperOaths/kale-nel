#!/usr/bin/env python3
"""Permanent, size-limited Tune Rush music library for authorized recordings.

Spotify/Spotydroid playlist data is metadata only; a Spotify playlist or paid
subscription does not grant rights to extract audio from Spotify/YouTube.
Recordings may enter this library only through explicitly authorized local
files. Library files are content-addressed and never deleted by game cleanup.
"""
from __future__ import annotations

import contextlib
import csv
import fcntl
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import stat
import time
import unicodedata
import urllib.parse
import zipfile
from pathlib import Path

from game_audio_cache import AUDIO_SUFFIXES, _is_audio_header

LIBRARY_BYTES=20*1024**3
MAX_FILE_BYTES=256*1024**2
RESERVED_FREE_BYTES=5*1024**3
DATA=Path(os.environ.get("TUNERUSH_SOLO_DATA",str(Path.home()/".tunerush-solo")))
LIBRARY_ROOT=DATA/"music-library-v1"
AUTHORIZED_ROOT=Path(os.environ.get(
    "TUNERUSH_AUTHORIZED_AUDIO_DIR",str(Path.home()/"tune-rush-solo"/"authorized-audio")))
_SPOTIFY_URI=re.compile(r"^spotify:track:[A-Za-z0-9]{22}$")
_ISRC=re.compile(r"^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$")
_SHA=re.compile(r"^[0-9a-f]{64}$")
_MAX_CSV_BYTES=16*1024*1024
_MAX_ROWS=20000


class LibraryError(ValueError):
    pass


def _normalize(value):
    s=unicodedata.normalize("NFKD",str(value or "").casefold())
    s="".join(ch for ch in s if not unicodedata.combining(ch))
    return " ".join(re.findall(r"[a-z0-9]+",s))


def _isrc(value):
    value=str(value or "").strip().upper()
    return value if _ISRC.fullmatch(value) else None


def _spotify(value):
    value=str(value or "").strip()
    if value.startswith("https://open.spotify.com/track/"):
        value="spotify:track:"+urllib.parse.urlsplit(value).path.split("/")[-1]
    return value if _SPOTIFY_URI.fullmatch(value) else None


class PersistentMusicLibrary:
    """Content-addressed MP3/audio storage, immutable by session lifecycle."""

    def __init__(self,root=LIBRARY_ROOT,authorized_root=AUTHORIZED_ROOT):
        self.root=Path(root)
        self.authorized_root=Path(authorized_root)
        if self.root.is_symlink():
            raise LibraryError("Library root may not be a symlink.")
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        os.chmod(self.root,0o700)
        self.tracks=self.root/"tracks"
        self.tracks.mkdir(exist_ok=True,mode=0o700)
        os.chmod(self.tracks,0o700)
        self.database=self.root/"library.sqlite3"
        self.lockfile=self.root/".library.lock"
        with self._locked():
            with self._db() as db:
                db.executescript("""
                CREATE TABLE IF NOT EXISTS recordings (
                  sha256 TEXT PRIMARY KEY,
                  filename TEXT UNIQUE NOT NULL,
                  bytes INTEGER NOT NULL CHECK(bytes > 0),
                  extension TEXT NOT NULL,
                  title TEXT NOT NULL DEFAULT '',
                  artist TEXT NOT NULL DEFAULT '',
                  isrc TEXT,
                  spotify_uri TEXT,
                  imported_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS recordings_isrc
                  ON recordings(isrc);
                CREATE INDEX IF NOT EXISTS recordings_spotify
                  ON recordings(spotify_uri);
                CREATE TABLE IF NOT EXISTS catalog (
                  catalog_id TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  artist TEXT NOT NULL,
                  genres_json TEXT NOT NULL,
                  decades_json TEXT NOT NULL,
                  rank INTEGER NOT NULL DEFAULT 0,
                  spotify_uri TEXT,
                  isrc TEXT,
                  sha256 TEXT,
                  FOREIGN KEY(sha256) REFERENCES recordings(sha256)
                );
                CREATE TABLE IF NOT EXISTS spotify_playlists (
                  playlist TEXT NOT NULL,
                  position INTEGER NOT NULL,
                  spotify_uri TEXT,
                  isrc TEXT,
                  title TEXT NOT NULL,
                  artist TEXT NOT NULL,
                  PRIMARY KEY(playlist,position)
                );
                """)

    @contextlib.contextmanager
    def _locked(self):
        with self.lockfile.open("a+b") as file:
            os.chmod(self.lockfile,0o600)
            fcntl.flock(file.fileno(),fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(file.fileno(),fcntl.LOCK_UN)

    @contextlib.contextmanager
    def _db(self):
        conn=sqlite3.connect(self.database,timeout=15)
        try:
            conn.row_factory=sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
            conn.commit()
        except:
            conn.rollback()
            raise
        finally:
            conn.close()

    @staticmethod
    def _validate_file(file_path,authorized_root):
        root=Path(authorized_root).resolve(strict=True)
        requested=Path(file_path)
        if requested.is_symlink():
            raise LibraryError("Symlinks are not accepted as audio sources.")
        source=requested.resolve(strict=True)
        if not source.is_relative_to(root):
            raise LibraryError("Only files in the authorized-audio folder may be imported.")
        info=source.stat()
        if not stat.S_ISREG(info.st_mode) or not 32<=info.st_size<=MAX_FILE_BYTES:
            raise LibraryError("Audio file size is invalid.")
        ext=source.suffix.lower()
        if ext not in AUDIO_SUFFIXES:
            raise LibraryError("Unsupported audio file extension.")
        with source.open("rb") as f:
            if not _is_audio_header(ext,f.read(32)):
                raise LibraryError("Audio header does not match the extension.")
        return source,ext,info.st_size

    def _used(self,db):
        return int(db.execute("SELECT COALESCE(SUM(bytes),0) FROM recordings").fetchone()[0])

    def import_authorized(self,path,*,title="",artist="",spotify_uri=None,isrc=None):
        """Copy once, address by SHA-256; never delete files on game completion."""
        source,ext,size=self._validate_file(path,self.authorized_root)
        spotify_uri=_spotify(spotify_uri)
        isrc=_isrc(isrc)
        tmp=None
        with self._locked():
            with self._db() as db:
                current=self._used(db)
                # Don't reject known duplicates just because the library is full.
                digest=hashlib.sha256()
                with source.open("rb") as stream:
                    for chunk in iter(lambda:stream.read(1024*1024),b""):
                        digest.update(chunk)
                sha=digest.hexdigest()
                existing=db.execute("SELECT * FROM recordings WHERE sha256=?",(sha,)).fetchone()
                if existing:
                    if not (self.tracks/existing["filename"]).is_file():
                        raise LibraryError("Existing library audio is missing; manual repair required.")
                    if (title or artist or spotify_uri or isrc):
                        db.execute("""UPDATE recordings SET
                            title=CASE WHEN ?<>'' THEN ? ELSE title END,
                            artist=CASE WHEN ?<>'' THEN ? ELSE artist END,
                            spotify_uri=COALESCE(?,spotify_uri),
                            isrc=COALESCE(?,isrc)
                            WHERE sha256=?""",
                            (title,title,artist,artist,spotify_uri,isrc,sha))
                        self._reconcile(db)
                    return {"sha256":sha,"bytes":existing["bytes"],"alreadyStored":True}
                if current+size>LIBRARY_BYTES:
                    raise LibraryError("The permanent 20 GiB music library is full; nothing was deleted.")
                if shutil.disk_usage(self.root).free<size+RESERVED_FREE_BYTES:
                    raise LibraryError("S21 free-storage reserve would be violated.")
                filename=sha+ext
                target=self.tracks/filename
                tmp=self.tracks/("."+sha+".part")
                try:
                    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                    with os.fdopen(fd,"wb") as destination,source.open("rb") as original:
                        for chunk in iter(lambda:original.read(1024*1024),b""):
                            destination.write(chunk)
                        destination.flush()
                        os.fsync(destination.fileno())
                    if tmp.stat().st_size!=size:
                        raise LibraryError("Copied file size changed during import.")
                    os.replace(tmp,target)
                    db.execute("""INSERT INTO recordings
                        (sha256,filename,bytes,extension,title,artist,isrc,spotify_uri,imported_at)
                        VALUES(?,?,?,?,?,?,?,?,?)""",
                        (sha,filename,size,ext,str(title or "")[:256],str(artist or "")[:256],
                         isrc,spotify_uri,int(time.time())))
                    self._reconcile(db)
                    return {"sha256":sha,"bytes":size,"alreadyStored":False}
                finally:
                    if tmp is not None:
                        tmp.unlink(missing_ok=True)

    def sync_curated(self,catalog_path):
        """Mirror all curated game songs without fetching or storing streams."""
        catalog=json.loads(Path(catalog_path).read_text(encoding="utf-8"))
        tracks=catalog.get("tracks",[])
        if not isinstance(tracks,list) or not tracks:
            raise LibraryError("Curated game catalog has no entries.")
        with self._locked():
            with self._db() as db:
                for t in tracks:
                    cid="deezer:"+str(int(t["id"]))
                    db.execute("""INSERT INTO catalog
                      (catalog_id,title,artist,genres_json,decades_json,rank)
                      VALUES(?,?,?,?,?,?)
                      ON CONFLICT(catalog_id) DO UPDATE SET
                        title=excluded.title,artist=excluded.artist,
                        genres_json=excluded.genres_json,
                        decades_json=excluded.decades_json,
                        rank=excluded.rank""",
                        (cid,str(t["title"]),str(t["artist"]),
                         json.dumps(t.get("genres",[])),json.dumps(t.get("decades",[])),
                         int(t.get("rank",0))))
                self._reconcile(db)
                return self._summary(db)

    def import_spotydroid_zip(self,archive_path):
        """Read Spotydroid's Spotify CSV export, not its YouTube downloader.

        CSV titles/artist/ISRC/URI are metadata only. Never modify existing
        recording bytes or fetch URLs mentioned by the archive.
        """
        path=Path(archive_path)
        if path.stat().st_size>_MAX_CSV_BYTES:
            raise LibraryError("Spotydroid playlist archive is unusually large.")
        batches=[]
        with zipfile.ZipFile(path,"r") as archive:
            candidates=[f for f in archive.infolist() if f.filename.lower().endswith(".csv")
                and not f.is_dir()]
            if len(candidates)>250:
                raise LibraryError("Too many playlists in Spotydroid archive.")
            for item in candidates:
                if item.file_size>_MAX_CSV_BYTES:
                    raise LibraryError("Spotydroid playlist CSV exceeds limit.")
                raw=archive.read(item)
                rows=csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
                playlist=Path(item.filename).stem[:150]
                data=[]
                for pos,row in enumerate(rows):
                    if pos>=_MAX_ROWS:
                        raise LibraryError("Spotify playlist has too many entries.")
                    title=str(row.get("Track Name") or "")[:256]
                    artist=str(row.get("Artist Name(s)") or "")[:256]
                    if not title or not artist:
                        continue
                    data.append((playlist,pos,_spotify(row.get("Track URI")),
                        _isrc(row.get("ISRC")),title,artist))
                batches.append((playlist,data))
        with self._locked():
            with self._db() as db:
                for playlist,rows in batches:
                    db.execute("DELETE FROM spotify_playlists WHERE playlist=?",(playlist,))
                    db.executemany("""INSERT INTO spotify_playlists
                        (playlist,position,spotify_uri,isrc,title,artist)
                        VALUES(?,?,?,?,?,?)""",rows)
                self._reconcile(db)
                result=self._summary(db)
                result["playlistsImported"]=len(batches)
                return result

    def _reconcile(self,db):
        """Match by ISRC/Spotify ID first; exact normalized title+artist second.

        Never choose among two candidate songs with ambiguous metadata.
        """
        recordings=db.execute("SELECT sha256,title,artist,isrc,spotify_uri FROM recordings").fetchall()
        candidates={}
        for r in recordings:
            keys=[]
            if r["spotify_uri"]:keys.append(("uri",r["spotify_uri"]))
            if r["isrc"]:keys.append(("isrc",r["isrc"]))
            if r["title"] and r["artist"]:
                keys.append(("name",_normalize(r["title"]),_normalize(r["artist"])))
            for k in keys:candidates.setdefault(k,set()).add(r["sha256"])
        rows=db.execute("SELECT * FROM spotify_playlists").fetchall()
        for row in rows:
            key=("uri",row["spotify_uri"]) if row["spotify_uri"] else (
                ("isrc",row["isrc"]) if row["isrc"] else
                ("name",_normalize(row["title"]),_normalize(row["artist"])))
            found=candidates.get(key,set())
            # Exact metadata match can attach ISRC/URI to an existing imported file,
            # without importing or downloading protected audio.
            if len(found)==1:
                sha=next(iter(found))
                db.execute("""UPDATE recordings
                    SET isrc=COALESCE(isrc,?),spotify_uri=COALESCE(spotify_uri,?)
                    WHERE sha256=?""",(row["isrc"],row["spotify_uri"],sha))
        by_name={}
        for row in db.execute("SELECT spotify_uri,isrc,title,artist FROM spotify_playlists"):
            k=(_normalize(row["title"]),_normalize(row["artist"]))
            by_name.setdefault(k,[]).append(row)
        for row in db.execute("SELECT catalog_id,title,artist,spotify_uri,isrc FROM catalog"):
            key=(_normalize(row["title"]),_normalize(row["artist"]))
            options=by_name.get(key,[])
            uri=options[0]["spotify_uri"] if len(options)==1 else row["spotify_uri"]
            isrc=options[0]["isrc"] if len(options)==1 else row["isrc"]
            matches=set()
            for rec in db.execute("SELECT sha256,title,artist,isrc,spotify_uri FROM recordings"):
                if uri and rec["spotify_uri"]==uri:matches.add(rec["sha256"])
                elif isrc and rec["isrc"]==isrc:matches.add(rec["sha256"])
                elif key==(_normalize(rec["title"]),_normalize(rec["artist"])):matches.add(rec["sha256"])
            newsha=next(iter(matches)) if len(matches)==1 else None
            db.execute("""UPDATE catalog SET spotify_uri=?,isrc=?,sha256=? WHERE catalog_id=?""",
                (uri,isrc,newsha,row["catalog_id"]))

    def _summary(self,db):
        files,bytes_used=db.execute(
            "SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM recordings").fetchone()
        curated,matched=db.execute(
            "SELECT COUNT(*),SUM(CASE WHEN sha256 IS NOT NULL THEN 1 ELSE 0 END) FROM catalog"
        ).fetchone()
        playlists=db.execute("SELECT COUNT(DISTINCT playlist) FROM spotify_playlists").fetchone()[0]
        return {"maxBytes":LIBRARY_BYTES,"storedBytes":int(bytes_used),
            "freeLibraryBytes":LIBRARY_BYTES-int(bytes_used),
            "recordings":int(files),"catalogSongs":int(curated),
            "matchedCatalogSongs":int(matched or 0),
            "spotifyPlaylists":int(playlists),
            "permanent":True,"autoDelete":False,
            "phoneFreeBytes":shutil.disk_usage(self.root).free}

    def stats(self):
        with self._locked():
            with self._db() as db:return self._summary(db)

    def export_catalog_csv(self,target):
        """Human-readable wishlist for constructing a Spotify playlist.

        Does not pretend Deezer IDs are Spotify IDs.
        """
        out=Path(target)
        with self._locked():
            with self._db() as db:
                rows=db.execute("""SELECT catalog_id,title,artist,genres_json,
                    decades_json,rank,spotify_uri,isrc,sha256
                    FROM catalog ORDER BY rank DESC,title""").fetchall()
                with out.open("w",newline="",encoding="utf-8") as f:
                    writer=csv.writer(f)
                    writer.writerow(("catalog_id","title","artist","genres","decades",
                         "rank","spotify_uri","isrc","audio_imported","spotify_search"))
                    for r in rows:
                        query=urllib.parse.quote(r["title"]+" "+r["artist"])
                        writer.writerow((r["catalog_id"],r["title"],r["artist"],
                            ",".join(json.loads(r["genres_json"])),
                            ",".join(json.loads(r["decades_json"])),
                            r["rank"],r["spotify_uri"] or "",r["isrc"] or "",
                            bool(r["sha256"]),
                            "https://open.spotify.com/search/"+query))
        return {"rows":len(rows),"path":str(out)}

    def missing_catalog(self,limit=25):
        with self._locked():
            with self._db() as db:
                rows=db.execute("""SELECT catalog_id,title,artist,spotify_uri,isrc
                    FROM catalog WHERE sha256 IS NULL
                    ORDER BY rank DESC LIMIT ?""",(max(0,min(int(limit),500)),)).fetchall()
                return [dict(x) for x in rows]


if __name__=="__main__":
    lib=PersistentMusicLibrary()
    print(json.dumps(lib.stats(),sort_keys=True))
