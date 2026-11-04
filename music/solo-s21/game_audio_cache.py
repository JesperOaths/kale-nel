#!/usr/bin/env python3
"""Bounded, disposable S21 game-audio cache.

Only operator-authorized local files or explicitly allowlisted HTTPS audio
origins may supply recordings. This never downloads/unwraps YouTube, TIDAL,
Spotify, Deezer, Apple Music or other protected service streams. No audio
is exposed in the public relay; this is the S21 storage/lifecycle layer.
"""
from __future__ import annotations
import contextlib
import fcntl
import hashlib
import ipaddress
import json
import os
import re
import shutil
import socket
import ssl
import stat
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_ROOT=Path(os.environ.get("TUNERUSH_SOLO_DATA",str(Path.home()/".tunerush-solo"))) / "game-audio-cache"
AUTH_AUDIO_ROOT=Path(os.environ.get("TUNERUSH_AUTHORIZED_AUDIO_DIR",
    str(Path.home()/"tune-rush-solo"/"authorized-audio")))
MAX_TRACKS=10
MAX_SONG_BYTES=128*1024*1024
MAX_SESSION_BYTES=1024*1024*1024
MAX_TOTAL_BYTES=1024*1024*1024
MIN_FREE_BYTES=3*1024*1024*1024
INACTIVITY_SECONDS=2*60*60
TOKEN_PATTERN=re.compile(r"^[0-9a-f]{64}$")
AUDIO_SUFFIXES={".mp3",".m4a",".wav",".flac",".ogg",".opus"}
DENIED_HOST_ENDINGS=(
    "youtube.com","youtube-nocookie.com","googlevideo.com","ytimg.com",
    "tidal.com","tidalhifi.com","spotify.com","scdn.co","deezer.com",
    "dzcdn.net","apple.com","mzstatic.com","soundcloud.com","audius.co"
)


class CacheError(ValueError):pass


def _safe_token(token):
    if not isinstance(token,str) or not TOKEN_PATTERN.fullmatch(token):
        raise CacheError("Invalid game cache session identifier.")
    return token


def _session_name(token):
    return hashlib.sha256(("TuneRush audio cache v1:"+_safe_token(token)).encode()).hexdigest()[:40]


def _fsync_json(path,data):
    tmp=path.with_name(path.name+".tmp")
    with open(tmp,"w",encoding="utf-8") as file:
        json.dump(data,file,ensure_ascii=False,separators=(",",":"))
        file.flush()
        os.fsync(file.fileno())
    os.chmod(tmp,0o600)
    os.replace(tmp,path)


def _is_audio_header(extension,first):
    if extension==".wav":return first[:4]==b"RIFF" and first[8:12]==b"WAVE"
    if extension==".flac":return first.startswith(b"fLaC")
    if extension in (".ogg",".opus"):return first.startswith(b"OggS")
    if extension==".m4a":return len(first)>=12 and first[4:8]==b"ftyp"
    if extension==".mp3":
        return first.startswith(b"ID3") or (len(first)>=2 and first[0]==0xff and (first[1]&0xe0)==0xe0)
    return False


class GameAudioCache:
    def __init__(self,root=DEFAULT_ROOT,authorized_audio_root=AUTH_AUDIO_ROOT):
        self.root=Path(root)
        self.authorized_audio_root=Path(authorized_audio_root)
        self.root.mkdir(mode=0o700,parents=True,exist_ok=True)
        if self.root.is_symlink():raise CacheError("Cache directory cannot be a symbolic link.")
        os.chmod(self.root,0o700)
        self._mutex=threading.RLock()
        self._lockfile=self.root/".cache.lock"

    @contextlib.contextmanager
    def exclusive(self):
        with self._mutex:
            with self._lockfile.open("a+b") as lock:
                os.chmod(self._lockfile,0o600)
                fcntl.flock(lock.fileno(),fcntl.LOCK_EX)
                try:yield
                finally:fcntl.flock(lock.fileno(),fcntl.LOCK_UN)

    def _session_dir(self,token):
        path=self.root/_session_name(token)
        if path.is_symlink():raise CacheError("Unsafe game cache directory.")
        return path

    def _manifest(self,path):
        try:
            data=json.loads((path/"manifest.json").read_text(encoding="utf-8"))
            if data.get("version")!=1 or not isinstance(data.get("files"),dict):
                raise CacheError("Invalid game cache metadata.")
            return data
        except (OSError,ValueError) as error:
            raise CacheError("Game cache metadata is unavailable.") from error

    def _disk_free(self):
        return shutil.disk_usage(self.root).free

    def _used_bytes(self):
        total=0
        for entry in self.root.iterdir():
            if not entry.is_dir() or entry.is_symlink():continue
            for f in entry.iterdir():
                if (f.is_file() and not f.is_symlink() and
                    f.name.startswith("song-") and f.suffix.lower() in AUDIO_SUFFIXES):
                    total+=f.stat().st_size
        return total

    def reserve(self,token,slots=10,source="youtube"):
        """Reserve ten-or-fewer logical slots. Never claim audio was downloaded."""
        if type(slots)!=int or not 1<=slots<=MAX_TRACKS:raise CacheError("Only 1–10 cache slots are allowed.")
        if source not in ("youtube","owned-library","licensed-audio"):
            raise CacheError("Unrecognized audio source.")
        with self.exclusive():
            path=self._session_dir(token)
            if path.exists():
                manifest=self._manifest(path)
                manifest["updated"]=time.time()
            else:
                path.mkdir(mode=0o700)
                manifest={"version":1,"created":time.time(),"updated":time.time(),
                    "maxSlots":slots,"source":source,"files":{}}
            _fsync_json(path/"manifest.json",manifest)
            return self.summary(token)

    def summary(self,token):
        path=self._session_dir(token)
        if not path.is_dir():return {"slots":0,"stored":0,"bytes":0}
        m=self._manifest(path)
        return {"slots":m["maxSlots"],"stored":len(m["files"]),
                "bytes":sum(v["bytes"] for v in m["files"].values())}

    def touch(self,token):
        with self.exclusive():
            path=self._session_dir(token)
            if not path.is_dir():return False
            m=self._manifest(path);m["updated"]=time.time()
            _fsync_json(path/"manifest.json",m)
            return True

    def _stage(self,token,index,stream,extension):
        if type(index)!=int or not 0<=index<MAX_TRACKS:
            raise CacheError("Track cache index must be between 0 and 9.")
        if extension not in AUDIO_SUFFIXES:
            raise CacheError("This recording format is not supported.")
        path=self._session_dir(token)
        with self.exclusive():
            if not path.is_dir():raise CacheError("Game cache is not reserved.")
            m=self._manifest(path)
            if index>=m["maxSlots"]:raise CacheError("Track index exceeds reserved slots.")
            if str(index) not in m["files"] and len(m["files"])>=m["maxSlots"]:
                raise CacheError("All ten game-song slots are full.")
            existing=m["files"].get(str(index))
            prior_bytes=existing["bytes"] if existing else 0
            current_bytes=sum(f["bytes"] for f in m["files"].values())
            total_bytes=self._used_bytes()
            if self._disk_free()<MIN_FREE_BYTES+MAX_SONG_BYTES:
                raise CacheError("Phone storage is too full to cache more audio.")
            tmp=path/(".song-%02d.part"%index)
            digest=hashlib.sha256();written=0;header=b""
            try:
                fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                with os.fdopen(fd,"wb") as output:
                    while True:
                        chunk=stream.read(65536)
                        if not chunk:break
                        if not isinstance(chunk,bytes):raise CacheError("Invalid audio source stream.")
                        if not header:header=chunk[:24]
                        written+=len(chunk)
                        if (written>MAX_SONG_BYTES or
                            current_bytes-prior_bytes+written>MAX_SESSION_BYTES or
                            total_bytes-prior_bytes+written>MAX_TOTAL_BYTES):
                            raise CacheError("Game audio cache limit exceeded.")
                        output.write(chunk);digest.update(chunk)
                    output.flush();os.fsync(output.fileno())
                if written<32 or not _is_audio_header(extension,header):
                    raise CacheError("File is not recognizable as the declared audio format.")
                name="song-%02d%s"%(index,extension)
                target=path/name
                os.replace(tmp,target)
                if existing and existing["name"]!=name:
                    (path/existing["name"]).unlink(missing_ok=True)
                m["files"][str(index)]={"name":name,"bytes":written,
                   "sha256":digest.hexdigest()}
                m["updated"]=time.time()
                _fsync_json(path/"manifest.json",m)
                return dict(m["files"][str(index)])
            finally:
                tmp.unlink(missing_ok=True)

    def stage_local(self,token,index,file_path):
        """Copy ONLY from the operator's authorized local song directory."""
        allowed=self.authorized_audio_root.resolve(strict=True)
        source=Path(file_path)
        if source.is_symlink():raise CacheError("Audio symlinks are not allowed.")
        resolved=source.resolve(strict=True)
        if not resolved.is_relative_to(allowed):
            raise CacheError("Audio must be inside the owner's authorized song folder.")
        info=resolved.stat()
        if not stat.S_ISREG(info.st_mode) or not 32<=info.st_size<=MAX_SONG_BYTES:
            raise CacheError("Not a supported audio recording size.")
        with resolved.open("rb") as stream:
            return self._stage(token,index,stream,resolved.suffix.lower())

    def stage_https(self,token,index,url):
        """HTTPS download only when the operator approved the provider host."""
        allowed={x.strip().casefold() for x in os.environ.get(
            "TUNERUSH_LICENSED_AUDIO_HOSTS","").split(",") if x.strip()}
        parsed=urllib.parse.urlsplit(url)
        host=(parsed.hostname or "").casefold()
        if (parsed.scheme!="https" or parsed.username or parsed.password or
            parsed.port not in (None,443) or not host or host not in allowed or
            host.endswith(DENIED_HOST_ENDINGS) or
            not re.fullmatch(r"[a-z0-9.-]+",host)):
            raise CacheError("Download requires an explicitly approved HTTPS audio host.")
        # Refuse local/link-local/private hosts even if they were accidentally
        # included in the operator's allowlist. No redirect to other hosts.
        for ipinfo in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM):
            addr=ipaddress.ip_address(ipinfo[4][0])
            if not addr.is_global:raise CacheError("Private-network audio URL refused.")
        extension=Path(parsed.path).suffix.lower()
        if extension not in AUDIO_SUFFIXES:
            raise CacheError("Authorized recording URL needs an audio filename extension.")
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):
                raise CacheError("Audio download redirects are not accepted.")
        client=urllib.request.build_opener(
            NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        request=urllib.request.Request(url,headers={
            "User-Agent":"TuneRushAuthorizedAudioCache/1.0",
            "Accept":"audio/*"})
        with client.open(request,timeout=15) as response:
            if response.status!=200:raise CacheError("Authorized audio download was not successful.")
            content_type=response.headers.get("Content-Type","").split(";")[0].lower()
            if not (content_type.startswith("audio/") or content_type=="application/ogg"):
                raise CacheError("Authorized source did not return an audio file.")
            declared=response.headers.get("Content-Length","")
            if declared.isdecimal() and int(declared)>MAX_SONG_BYTES:
                raise CacheError("Authorized track exceeds cache size limit.")
            return self._stage(token,index,response,extension)

    def delete(self,token):
        with self.exclusive():
            path=self._session_dir(token)
            if not path.is_dir():return False
            # Only hashed names inside the private cache root, never other apps.
            if path.is_symlink():raise CacheError("Unsafe cache deletion target.")
            shutil.rmtree(path)
            return True

    def sweep(self):
        """Delete abandoned caches and orphaned staging files."""
        count=0
        with self.exclusive():
            for path in self.root.iterdir():
                if not path.is_dir() or path.is_symlink() or not re.fullmatch(
                    "[0-9a-f]{40}",path.name):
                    continue
                try:
                    m=self._manifest(path)
                    expired=time.time()-float(m["updated"])>INACTIVITY_SECONDS
                except (CacheError,ValueError,TypeError,KeyError):
                    expired=True
                if expired:
                    shutil.rmtree(path);count+=1
                else:
                    for temp in path.glob("*.part"):
                        if temp.is_file() and not temp.is_symlink() and time.time()-temp.stat().st_mtime>180:
                            temp.unlink(missing_ok=True)
        return count

    def stats(self):
        with self.exclusive():
            folders=[x for x in self.root.iterdir() if x.is_dir()
                     and not x.is_symlink() and re.fullmatch("[0-9a-f]{40}",x.name)]
            return {"sessions":len(folders),"usedBytes":self._used_bytes(),
                    "maxBytes":MAX_TOTAL_BYTES,"maxTracksPerGame":MAX_TRACKS,
                    "inactivitySeconds":INACTIVITY_SECONDS,
                    "freeBytes":self._disk_free()}


if __name__=="__main__":
    cache=GameAudioCache()
    print(json.dumps({"expiredRemoved":cache.sweep(),**cache.stats()},sort_keys=True))
