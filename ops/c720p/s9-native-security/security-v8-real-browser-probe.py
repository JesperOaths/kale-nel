#!/usr/bin/env python3
"""Real authenticated kiosk-Chromium V8 Security smoke test using local CDP.
Opens a BACKGROUND tab and always closes it; never disturbs kiosk home.
No video playback, camera motion, archive mutations or login changes.
"""
import base64,json,os,socket,struct,time,urllib.request
PORT=9222
class Socket:
 def __init__(self,url):
  host,route=url.split("://",1)[1].split("/",1)
  self.sock=socket.create_connection(("127.0.0.1",PORT),timeout=7)
  self.sock.settimeout(13)
  key=base64.b64encode(os.urandom(16)).decode()
  req=(f"GET /{route} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"+
   f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode()
  self.sock.sendall(req);header=b""
  while b"\r\n\r\n" not in header:header+=self.sock.recv(1024)
  if b"HTTP/1.1 101" not in header:raise RuntimeError("cdp_ws_refused")
  self.id=0
 def _get(self,n):
  b=b""
  while len(b)<n:
   part=self.sock.recv(n-len(b))
   if not part:raise RuntimeError("cdp_ws_closed")
   b+=part
  return b
 def call(self,method,params=None):
  self.id+=1
  data=json.dumps({"id":self.id,"method":method,"params":params or {}}).encode()
  count=len(data);mask=os.urandom(4)
  head=bytes([0x81,0x80|count]) if count<126 else bytes([0x81,0xfe])+struct.pack("!H",count)
  self.sock.sendall(head+mask+bytes(v^mask[i%4] for i,v in enumerate(data)))
  for i in range(450):
   a,b=self._get(2);n=b&127
   if n==126:n=struct.unpack("!H",self._get(2))[0]
   if n==127:n=struct.unpack("!Q",self._get(8))[0]
   mask=self._get(4) if b&128 else None
   raw=self._get(n)
   if mask:raw=bytes(v^mask[k%4] for k,v in enumerate(raw))
   if (a&15) in (8,9,10):continue
   payload=json.loads(raw)
   if payload.get("id")==self.id:
    if "error" in payload:raise RuntimeError(str(payload["error"])[:300])
    return payload.get("result",{})
  raise RuntimeError("no_cdp_result")
 def close(self):self.sock.close()
def get(path):
 with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/{path}",timeout=6) as r:return json.load(r)
def main():
 ws=get("json/version")["webSocketDebuggerUrl"]
 browser=Socket(ws)
 target=None
 try:
  d=browser.call("Target.createTarget",{"url":"http://localhost:8123/local/c720p-surveillance.html","background":True})
  target=d["targetId"]
  page=None
  for i in range(40):
   tab=next((x for x in get("json/list") if x.get("id")==target),None)
   if tab and tab.get("webSocketDebuggerUrl"):page=Socket(tab["webSocketDebuggerUrl"]);break
   time.sleep(.25)
  if page is None:raise RuntimeError("background_security_tab_missing")
  try:
   report=None
   expr=r"""(()=>{
    const nav=document.getElementById('s9v5-nav');
    const today=document.getElementById('s9SavedFolderFrame');
    const evid=document.getElementById('s9v8-evidence');
    const face=document.getElementById('s9FacesGalleryFrame');
    return {url:location.href,title:document.title,viewReady:!!nav,
      navLabels:nav?[...nav.querySelectorAll('button')].map(x=>x.textContent.trim().replace(/\s+/g,' ')):[],
      evidencePane:!!evid,facePane:!!face,
      todayDataset:today?.dataset.src||null,
      todaySource:today?.getAttribute('src')||null,
      todayIncludesMode:!!(today?.dataset.src||'').includes('mode=today'),
      archiveSource:document.getElementById('cameraSavedFrame')?.dataset.src||null,
      trackerSource:document.getElementById('s9v7-tracks-frame')?.dataset.src||null
     };
   })()"""
   for i in range(18):
    d=page.call("Runtime.evaluate",{"expression":expr,"returnByValue":True})
    report=d.get("result",{}).get("value")
    if report and report.get("viewReady") and report.get("evidencePane"):break
    time.sleep(.6)
   assert report is not None
   print("S9_REAL_KIOSK_SECURITY_V8",json.dumps(report,sort_keys=True),flush=True)
   if not report.get("evidencePane") or not report.get("todayIncludesMode"):
    raise RuntimeError("v8_navigation_not_visible")
  finally:page.close()
 finally:
  if target:browser.call("Target.closeTarget",{"targetId":target})
  browser.close()
if __name__=="__main__":main()
