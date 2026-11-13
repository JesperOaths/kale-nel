#!/usr/bin/env python3
"""Network boundary tests for the isolated Tune Rush internet gateway."""
import importlib.util
import json
import secrets
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

here=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("game_gateway",here/"hub_multiplayer_gateway.py")
g=importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
class FakeS21(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        body=(b'<html>Tune Rush</html>' if self.path in ('/','/index.html') else
              b'let ready = true;' if self.path=='/app.js' else
              b'body{color:white}' if self.path=='/style.css' else
              b'{"service":"tunerush-s21-multiplayer","ready":true}')
        self.send_response(200);self.send_header("Content-Length",str(len(body)));self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        assert self.path=="/api/multiplayer"
        length=int(self.headers["Content-Length"])
        body=json.loads(self.rfile.read(length))
        role="player" if body["action"]=="join" else "host"
        state={"role":role,"phase":"lobby","code":body["code"]}
        if body["action"]=="join" and body["data"].get("inject_leak"):
            state["clipAudio"]="data:audio/mpeg;base64,YWJj"
        content=json.dumps({"state":state}).encode()
        self.send_response(200);self.send_header("Content-Length",str(len(content)))
        self.end_headers();self.wfile.write(content)

def test():
    fake=ThreadingHTTPServer(("127.0.0.1",0),FakeS21)
    fake.daemon_threads=True
    threading.Thread(target=fake.serve_forever,daemon=True).start()
    old=g.UPSTREAM;g.UPSTREAM="http://127.0.0.1:"+str(fake.server_address[1])
    proxy=ThreadingHTTPServer(("127.0.0.1",0),g.Handler)
    proxy.daemon_threads=True
    threading.Thread(target=proxy.serve_forever,daemon=True).start()
    base="http://127.0.0.1:"+str(proxy.server_address[1])
    def fetch(path,post=None,origin="https://game.trycloudflare.com"):
        headers={"Host":"game.trycloudflare.com"}
        if post is not None:
            headers["Origin"]=origin
            headers["Content-Type"]="application/json"
        req=urllib.request.Request(base+path,data=(json.dumps(post).encode() if post is not None else None),
                                   headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=5) as r:return r.status,r.read()
        except urllib.error.HTTPError as e:return e.code,e.read()
    try:
        assert fetch("/")[0]==200
        assert fetch("/index.html?room=ABC234")[0]==200
        assert fetch("/app.js?v=20261113online5g1")[0]==200
        assert fetch("/style.css?v=latest")[0]==200
        for path in ("/etc/passwd","/api/music-library/health","/api/action",
                     "/app.js?upstream=http://evil","/style.css?bad=1"):
            assert fetch(path)[0]==404,path
        code="ABC234";hash=secrets.token_hex(32)
        valid={"action":"create","code":code,"hash":hash,"data":{}}
        status,body=fetch("/api/multiplayer",valid)
        assert status==200 and json.loads(body)["state"]["role"]=="host",(status,body)
        assert fetch("/api/multiplayer",valid,origin="https://wrong.example")[0]==403
        invalid={**valid,"hash":"NOT_A_TOKEN"}
        assert fetch("/api/multiplayer",invalid)[0]==400
        leak={**valid,"action":"join","data":{"inject_leak":True}}
        status,body=fetch("/api/multiplayer",leak)
        assert status==502 and b"invalid_upstream_response" in body
        assert g.remote_host_allowed("game.trycloudflare.com")
        assert not g.remote_host_allowed("evil.example.com")
        print("S21_INTERNET_MULTIPLAYER_GATEWAY_PASS",{
         "allowlistedAssets":True,"queryCacheKeys":True,"privateRoutesBlocked":True,
         "crossOriginRejected":True,"invalidCredentialsRejected":True,
         "guestAudioLeakBlocked":True})
    finally:
        proxy.shutdown();proxy.server_close();fake.shutdown();fake.server_close()
        g.UPSTREAM=old
if __name__=="__main__":test()
