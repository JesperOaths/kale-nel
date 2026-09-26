#!/usr/bin/env python3
from __future__ import annotations
import html,json,os,secrets,sys,threading,time,urllib.parse
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

APP=Path("/opt/inbox-triage-agent")
sys.path.insert(0,str(APP))
from google_auth_oauthlib.flow import InstalledAppFlow
from triage_agent import SCOPES, gmail_service, load_config, token_path

STATE=Path("/home/jespern/c720p-home-hub/state")
ACCESS_FILE=STATE/"google-oauth-ui-access-token"
CLIENT=Path(os.environ.get("GOOGLE_CLIENT_SECRET",str(APP/"secrets/google_oauth_client.json")))
FLOWS={}
LOCK=threading.Lock()
TTL=20*60

def access_token():
    STATE.mkdir(parents=True,exist_ok=True)
    if ACCESS_FILE.exists():
        t=ACCESS_FILE.read_text().strip()
        if len(t)>=32:return t
    t=secrets.token_urlsafe(32)
    ACCESS_FILE.write_text(t+"\n")
    ACCESS_FILE.chmod(0o600)
    return t

ACCESS=access_token()

def accounts():
    try:return [str(x) for x in load_config().get("gmail_accounts",[]) if str(x).strip()]
    except Exception:return []

def project_id():
    try:
        d=json.loads(CLIENT.read_text())
        c=d.get("installed") or d.get("web") or {}
        return str(c.get("project_id") or "")
    except Exception:return ""

def create_flow(account):
    f=InstalledAppFlow.from_client_secrets_file(str(CLIENT),SCOPES)
    f.redirect_uri="http://localhost:8766/"
    url,state=f.authorization_url(access_type="offline",prompt="consent",login_hint=account,include_granted_scopes="false")
    with LOCK:FLOWS[state]={"account":account,"flow":f,"at":time.time()}
    return url,state

def prune():
    now=time.time()
    with LOCK:
        for state in list(FLOWS):
            if now-FLOWS[state]["at"]>TTL:FLOWS.pop(state,None)

def finish(state,redirect_url):
    prune()
    with LOCK:item=FLOWS.get(state)
    if not item:raise RuntimeError("Authorization session expired. Start authorization again.")
    flow=item["flow"];account=item["account"]
    flow.fetch_token(authorization_response=redirect_url)
    path=token_path(account)
    path.write_text(flow.credentials.to_json(),encoding="utf-8")
    try:path.chmod(0o600)
    except Exception:pass
    with LOCK:FLOWS.pop(state,None)
    gm=gmail_service(account)
    prof=gm.users().getProfile(userId="me").execute()
    actual=str(prof.get("emailAddress") or "")
    return account,actual

def page(message=""):
    accts=accounts()
    pid=project_id()
    audience="https://console.cloud.google.com/auth/audience"+(("?project="+urllib.parse.quote(pid)) if pid else "")
    rows="".join(f"""<section class="account"><h2>{html.escape(a)}</h2>
<button onclick="startAuth({json.dumps(a)})">1. Authorize this Gmail account</button>
<label>2. If Google redirects to a page that cannot open, paste the complete <code>http://localhost:8766/?code=…&state=…</code> address here:</label>
<textarea id="cb-{i}" placeholder="http://localhost:8766/?code=...&state=..."></textarea>
<button class="secondary" onclick="finishAuth({json.dumps(a)},{i})">Finish pasted authorization</button>
<div class="status" id="st-{i}"></div></section>""" for i,a in enumerate(accts))
    msg=f'<div class="msg">{html.escape(message)}</div>' if message else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>C720P Google OAuth Repair</title><style>
body{{font-family:system-ui,sans-serif;background:#101418;color:#eef3f7;max-width:860px;margin:auto;padding:24px}}
.card,.account{{background:#182028;border:1px solid #2e3a45;border-radius:16px;padding:18px;margin:14px 0}}
button,a.btn{{display:inline-block;border:0;border-radius:10px;padding:11px 15px;background:#e9eef2;color:#111;font-weight:700;text-decoration:none;cursor:pointer}}
button.secondary{{background:#aebbc5;margin-top:10px}} textarea{{width:100%;min-height:92px;box-sizing:border-box;margin-top:9px;background:#0d1216;color:#fff;border:1px solid #46535e;border-radius:9px;padding:10px}}
code{{word-break:break-all}} .status{{margin-top:10px;color:#b7e0bc}} .bad{{color:#ffb5b5}} .msg{{padding:12px;background:#17351e;border-radius:10px}}
small{{color:#aeb9c2}} h1{{margin-bottom:6px}} p{{line-height:1.5}}
</style></head><body><h1>C720P Google OAuth Repair</h1><p>This repairs the Gmail authorization used by the local mail-to-Signal service. It requests only the scopes configured by that service.</p>{msg}
<div class="card"><h2>First: remove the 7-day expiry</h2><p>Open Google Auth Platform → Audience for this OAuth project. If Publishing status is <b>Testing</b>, choose <b>Publish app</b> and confirm <b>In production</b>. Then return here and authorize each account once.</p>
<a class="btn" href="{html.escape(audience)}" target="_blank" rel="noopener">Open Google Auth Platform → Audience</a>
<p><small>Project: {html.escape(pid or "read from the OAuth client")}</small></p></div>
{rows or '<div class="card bad">No Gmail accounts were found in the triage-agent configuration.</div>'}
<div class="card"><button onclick="verifyAll()">Verify all Gmail accounts</button><pre id="verify"></pre></div>
<script>
async function post(path,obj){{const r=await fetch(path,{{method:'POST',headers:{{'content-type':'application/json'}},body:JSON.stringify(obj)}});const d=await r.json();if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}}
async function startAuth(account){{try{{const d=await post('/api/start',{{account}});window.open(d.url,'_blank','noopener');}}catch(e){{alert(e.message)}}}}
async function finishAuth(account,i){{const el=document.getElementById('st-'+i);try{{el.className='status';el.textContent='Finishing…';const redirect_url=document.getElementById('cb-'+i).value.trim();const d=await post('/api/finish',{{account,redirect_url}});el.textContent='Authorized and verified: '+d.actual;}}catch(e){{el.className='status bad';el.textContent=e.message}}}}
async function verifyAll(){{const e=document.getElementById('verify');e.textContent='Checking…';try{{const d=await post('/api/verify',{{}});e.textContent=JSON.stringify(d,null,2)}}catch(x){{e.textContent=x.message}}}}
</script></body></html>"""

class H(BaseHTTPRequestHandler):
    server_version="C720PGmailOAuth/1.0"
    def log_message(self,*a):pass
    def authed(self):
        # The repair page is intended to be opened in Chromium on the C720P itself.
        # Loopback is trusted; non-loopback/LAN clients still need the random secret.
        if self.client_address and self.client_address[0] in ("127.0.0.1","::1"):
            return True
        cookie=self.headers.get("Cookie","")
        return any(x.strip()==("oauthui="+ACCESS) for x in cookie.split(";"))
    def send_html(self,code,body,headers=None):
        b=body.encode();self.send_response(code);self.send_header("Content-Type","text/html; charset=utf-8");self.send_header("Content-Length",str(len(b)));self.send_header("Cache-Control","no-store");self.send_header("X-Frame-Options","SAMEORIGIN");self.send_header("X-Content-Type-Options","nosniff")
        for k,v in (headers or {}).items():self.send_header(k,v)
        self.end_headers();self.wfile.write(b)
    def send_json(self,code,obj):
        b=json.dumps(obj).encode();self.send_response(code);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(b)));self.send_header("Cache-Control","no-store");self.end_headers();self.wfile.write(b)
    def do_GET(self):
        u=urllib.parse.urlsplit(self.path)
        if self.server.server_port==8766:
            q=urllib.parse.parse_qs(u.query);state=(q.get("state") or [""])[0]
            try:
                account,actual=finish(state,"http://localhost:8766/"+(("?"+u.query) if u.query else ""))
                self.send_html(200,f"<h1>Google authorization complete</h1><p>{html.escape(actual or account)} is connected. You can close this tab.</p>")
            except Exception as e:self.send_html(400,"<h1>Authorization failed</h1><pre>"+html.escape(str(e))+"</pre>")
            return
        q=urllib.parse.parse_qs(u.query)
        if (q.get("access") or [""])[0]==ACCESS:
            self.send_response(302);self.send_header("Location","/");self.send_header("Set-Cookie","oauthui="+ACCESS+"; HttpOnly; SameSite=Strict; Path=/");self.send_header("Cache-Control","no-store");self.end_headers();return
        if not self.authed():self.send_html(403,"<h1>Private C720P OAuth page</h1><p>Open this page from the private link created on the hub.</p>");return
        self.send_html(200,page())
    def body(self):
        n=int(self.headers.get("Content-Length","0"));return json.loads(self.rfile.read(n).decode()) if 0<n<65536 else {}
    def do_POST(self):
        if self.server.server_port!=8796 or not self.authed():self.send_json(403,{"error":"forbidden"});return
        try:
            b=self.body();path=urllib.parse.urlsplit(self.path).path
            if path=="/api/start":
                account=str(b.get("account") or "")
                if account not in accounts():raise RuntimeError("Unknown configured Gmail account")
                url,state=create_flow(account);self.send_json(200,{"ok":True,"url":url,"state":state});return
            if path=="/api/finish":
                account=str(b.get("account") or "");ru=str(b.get("redirect_url") or "").strip()
                q=urllib.parse.parse_qs(urllib.parse.urlsplit(ru).query);state=(q.get("state") or [""])[0]
                with LOCK:item=FLOWS.get(state)
                if not item or item["account"]!=account:raise RuntimeError("Authorization state does not match. Start authorization again.")
                _,actual=finish(state,ru);self.send_json(200,{"ok":True,"actual":actual});return
            if path=="/api/verify":
                out=[]
                for a in accounts():
                    try:
                        p=gmail_service(a).users().getProfile(userId="me").execute();out.append({"account":a,"ok":True,"actual":p.get("emailAddress")})
                    except Exception as e:out.append({"account":a,"ok":False,"error":str(e)[:240]})
                self.send_json(200,{"ok":all(x["ok"] for x in out),"accounts":out});return
            self.send_json(404,{"error":"not_found"})
        except Exception as e:self.send_json(400,{"error":str(e)[:500]})

def serve(port):
    ThreadingHTTPServer(("0.0.0.0",port),H).serve_forever()

if __name__=="__main__":
    os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT","1")
    threading.Thread(target=serve,args=(8766,),daemon=True).start()
    serve(8796)
