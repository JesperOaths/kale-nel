#!/usr/bin/env python3
"""Independent S21 cached-music multiplayer service; no changes to Solo port 8797.

Only the S21 sees track identifiers, audio files and scoring truth. The C720P
may forward authenticated commands and bounded base64 MP3 clues, but does not
select songs, compute scores or store recordings.
"""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import hmac
import ipaddress
import json
import os
import re
import socket
import sqlite3
from urllib.parse import urlsplit

from multiplayer import MultiplayerEngine, GameError, CLUES
import permanent_audio
from persistent_music_library import LIBRARY_ROOT

HOME=Path("/data/data/com.termux/files/home")
DATA=Path(os.environ.get("TUNERUSH_MULTIPLAYER_DATA",
                         str(HOME/".tunerush-multiplayer")))
LIBRARY=Path(os.environ.get("TUNERUSH_PERMANENT_LIBRARY",str(LIBRARY_ROOT)))
WEB=Path(os.environ.get("TUNERUSH_MULTIPLAYER_WEB",str(HOME/"tune-rush-solo"/"multiplayer-web")))
WEB_FILES={"/":"index.html","/index.html":"index.html","/app.js":"app.js","/style.css":"style.css"}
WEB_TYPES={"index.html":"text/html; charset=utf-8","app.js":"application/javascript; charset=utf-8","style.css":"text/css; charset=utf-8"}
BIND=os.environ.get("TUNERUSH_MULTIPLAYER_BIND","::")
PORT=int(os.environ.get("TUNERUSH_MULTIPLAYER_PORT","8798"))
MAX_REQUEST=4096
CODE=re.compile(r"^[A-HJ-NP-Z2-9]{6}$")
CREDENTIAL=re.compile(r"^[a-f0-9]{64}$")
ENGINE=None
LIBRARY_STATUS={}

class Handler(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.0"
    server_version="TuneRushS21Multi/1.0"
    def log_message(self,*_):pass # Credentials, guesses and music never enter logs.

    def permitted(self):
        try:
            peer=ipaddress.ip_address(self.client_address[0].split("%",1)[0])
            if isinstance(peer,ipaddress.IPv6Address) and peer.ipv4_mapped:
                peer=peer.ipv4_mapped
            if peer.is_loopback:return True
            if isinstance(peer,ipaddress.IPv4Address):return peer.is_private
            if peer.is_link_local or peer.is_private:return True
            local=ipaddress.ip_address(self.connection.getsockname()[0])
            # IPv6 public addresses only within the same local /64 as the phone.
            return peer.version==6 and local.version==6 and (int(peer)>>64)==(int(local)>>64)
        except (ValueError,TypeError,OSError):return False

    def send_json(self,code,payload):
        raw=json.dumps(payload,separators=(",",":"),ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(raw)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Access-Control-Allow-Origin","null")
        self.end_headers()
        if self.command!="HEAD":self.wfile.write(raw)

    def serve_web_file(self,name):
        # Exact allowlist: no user-supplied paths and never serve library MP3s,
        # database files, host credentials, or other Termux home content.
        filename=WEB/name
        try:
            if not filename.is_file() or filename.is_symlink():raise FileNotFoundError
            blob=filename.read_bytes()
            if len(blob)>240000:raise ValueError("Unreasonably large web asset")
        except (OSError,ValueError):
            return self.send_json(404,{"error":"multiplayer_web_asset_unavailable"})
        self.send_response(200)
        self.send_header("Content-Type",WEB_TYPES[name])
        self.send_header("Content-Length",str(len(blob)))
        self.send_header("Cache-Control","no-cache, no-store, must-revalidate")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("X-Frame-Options","SAMEORIGIN")
        self.send_header("Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; " +
            "connect-src 'self'; img-src 'self' data:; media-src 'self' data:; " +
            "frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'")
        self.end_headers()
        self.wfile.write(blob)

    def do_GET(self):
        if not self.permitted():return self.send_json(403,{"error":"local_network_only"})
        path=urlsplit(self.path).path
        if path=="/api/health":
            return self.send_json(200,{"service":"tunerush-s21-multiplayer",
                "ready":bool(LIBRARY_STATUS.get("playableCachedSongs",0)),
                "source":"persistent-library","version":1,
                "cachedSongs":LIBRARY_STATUS.get("playableCachedSongs",0),
                "missingSongs":LIBRARY_STATUS.get("missingCachedSongs",0)})
        if path in WEB_FILES:return self.serve_web_file(WEB_FILES[path])
        return self.send_json(404,{"error":"not_found"})

    def do_POST(self):
        if not self.permitted():return self.send_json(403,{"error":"local_network_only"})
        if urlsplit(self.path).path!="/api/multiplayer":
            return self.send_json(404,{"error":"not_found"})
        try:
            size=int(self.headers.get("Content-Length","0"))
            if not 1<=size<=MAX_REQUEST:raise GameError("invalid_request_size")
            request=json.loads(self.rfile.read(size))
            if not isinstance(request,dict):raise GameError("invalid_request")
            action,code,hash_value=request.get("action"),request.get("code"),request.get("hash")
            data=request.get("data") or {}
            if not isinstance(data,dict) or not isinstance(code,str) or not CODE.fullmatch(code):
                raise GameError("invalid_request")
            if not isinstance(hash_value,str) or not CREDENTIAL.fullmatch(hash_value):
                raise GameError("invalid_credential")
            state=ENGINE.call(action,code,hash_value,data)
            # Only a host actively requesting its current clue may see MP3 bytes.
            # All other state/guest responses contain no music and never reveal
            # titles or artist names before an answer is verified by the engine.
            if (state.get("role")=="host" and state.get("phase")=="playing" and
                (action in ("play","replay") or
                 (action=="state" and data.get("withAudio") is True))):
                room=ENGINE.read(code)
                song=room.get("song") or {}
                if room.get("mode")!="persistent-library" or not song.get("sha256"):
                    raise GameError("cached_track_unavailable")
                duration=CLUES[room["step"]]
                state["clipAudio"]=permanent_audio.clue_data(
                    song,song["cueMs"],duration,LIBRARY)
                if len(state["clipAudio"])>1_400_000:
                    state.pop("clipAudio",None)
                    raise GameError("audio_fragment_too_large")
            return self.send_json(200,{"state":state})
        except GameError as error:
            return self.send_json(400,{"error":str(error)[:110]})
        except (ValueError,TypeError,KeyError):
            return self.send_json(400,{"error":"invalid_game_request"})
        except (OSError,sqlite3.Error) as error:
            return self.send_json(503,{"error":"phone_music_temporarily_unavailable"})

class DualStackServer(ThreadingHTTPServer):
    address_family=socket.AF_INET6
    daemon_threads=True
    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,0)
        super().server_bind()

def serve():
    global ENGINE,LIBRARY_STATUS
    # "ready" must mean real cached songs exist, not just an open TCP port.
    LIBRARY_STATUS=permanent_audio.availability(LIBRARY)
    if LIBRARY_STATUS.get("playableCachedSongs",0)<1:
        raise SystemExit("No playable cached S21 tracks. Keep Solo running and repair imports.")
    DATA.mkdir(parents=True,exist_ok=True,mode=0o700)
    ENGINE=MultiplayerEngine(DATA/"rooms.sqlite3",library_root=LIBRARY)
    httpd=DualStackServer((BIND,PORT),Handler)
    print("S21 cached multiplayer available on %s; Solo 8797 unchanged" % PORT,flush=True)
    try:httpd.serve_forever()
    finally:
        httpd.server_close()
        ENGINE.close()

if __name__=="__main__":
    serve()
