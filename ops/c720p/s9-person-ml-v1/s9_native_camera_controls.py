"""Restricted Camera2 control relay for existing authenticated S9 Security UI.

No direct browser -> ADB/native-loopback connectivity; the existing signed
C720P relay is the only route exposed to the Security page.
"""
import json
import re
import urllib.request
import urllib.error
from urllib.parse import urlsplit
URL="http://127.0.0.1:18808"
PATH_GET="/new/camera-controls"
PATH_POST="/new/camera-control"
VALUES={"zoom":re.compile(r"(?:1(?:[.]0|[.]25|[.]5)?|2(?:[.]0)?|3(?:[.]0)?|4(?:[.]0)?)\Z"),
        "exposure_ev":re.compile(r"-?[0-3]\Z"),
        "torch":re.compile(r"(?:on|off)\Z"),
        "focus":re.compile(r"(?:auto|continuous)\Z"),
        "recording_rotation":re.compile(r"(?:auto|0|90|180|270)\Z")}
ORIGIN=re.compile(r"(?:(?:https://(?:www[.])?kalenel[.]nl)|(?:http://(?:localhost|127[.]0[.]0[.]1|homeassistant[.]local|192[.]168[.]178[.][0-9]{1,3}):8123))\Z")

def local(path,body=None):
 headers={"Accept":"application/json"}
 if body is not None:headers["Content-Type"]="application/json"
 req=urllib.request.Request(URL+path,headers=headers,data=body,method="GET" if body is None else "POST")
 try:
  with urllib.request.urlopen(req,timeout=6) as reply:
   if reply.status!=200:raise RuntimeError("native_control_not_200")
   blob=reply.read(10000)
   return 200,json.loads(blob)
 except urllib.error.HTTPError as error:
  if error.code==409:
   return 409,{"ok":False,"error":"native_camera_busy_or_option_not_supported"}
  raise

def install(H):
 prior=H.go
 post=H.do_POST
 def go(self):
  if urlsplit(self.path).path==PATH_GET:
   try:
    status,d=local("/controls")
    if not isinstance(d.get("controls"),dict):raise ValueError("invalid_native_controls_shape")
    options={}
    for key,info in d["controls"].items():
     if key not in VALUES or not isinstance(info,dict):continue
     vals=info.get("available")
     if not isinstance(vals,list) or len(vals)>16:continue
     allowed=[str(v) for v in vals if VALUES[key].fullmatch(str(v))]
     current=str(info.get("value",""))
     if current in allowed:
      options[key]={"value":current,"available":allowed}
    self.js(200,{"ok":bool(d.get("ok")),"camera":"new","source":"S9_Camera2_native",
       "can_change_while_recording":False,"mode":d.get("mode"),"controls":options})
   except Exception:
    self.js(503,{"ok":False,"error":"native_camera_controls_unavailable"})
   return
  return prior(self)
 def do_POST(self):
  if urlsplit(self.path).path!=PATH_POST:return post(self)
  if self.headers.get("X-S9-Camera-Control-Intent")!="explicit-user-selection-v1":
   self.js(403,{"ok":False,"error":"explicit_selection_required"});return
  origin=self.headers.get("Origin","").strip()
  if origin and not ORIGIN.fullmatch(origin):
   self.js(403,{"ok":False,"error":"untrusted_origin"});return
  if "application/json" not in self.headers.get("Content-Type","").lower():
   self.js(415,{"ok":False,"error":"json_required"});return
  try:
   size=int(self.headers.get("Content-Length","0"))
   if not 2<=size<=256:raise ValueError("invalid_body_length")
   data=json.loads(self.rfile.read(size))
   if not isinstance(data,dict) or set(data)!={"key","value"}:
    raise ValueError("invalid_request_fields")
   key,value=data["key"],data["value"]
   if not isinstance(key,str) or not isinstance(value,str):
    raise ValueError("invalid_value_type")
   if key not in VALUES or not VALUES[key].fullmatch(value):
    raise ValueError("unsupported_option")
  except (ValueError,TypeError,KeyError,UnicodeError):
   self.js(400,{"ok":False,"error":"invalid_control_option"});return
  try:
   status,reply=local("/control",json.dumps({"key":key,"value":value},separators=(",",":")).encode("ascii"))
   self.js(status,{"ok":bool(reply.get("ok")),"key":key,"value":reply.get("value"),
                   "error":reply.get("error"),"source":"S9_Camera2_native"})
  except Exception:
   self.js(503,{"ok":False,"error":"camera_control_transport_unavailable"})
 H.go=go
 H.do_POST=do_POST
