#!/usr/bin/env python3
"""Read-only diagnostics for archived Drive and manual assignments via 8794/8795.

Print ONLY route statuses/counts/header validity, not filenames, tokens,
images, body content or identifiable video.
"""
import json
import re
import urllib.error
import urllib.request

BASE="http://127.0.0.1:"
def json_probe(port,path):
 try:
  with urllib.request.urlopen(BASE+str(port)+path,timeout=16) as response:
   body=response.read(4_500_001)
   if len(body)>4_500_000:return {"state":"too_large"}
   data=json.loads(body)
   result={"http":response.status,
     "ok":data.get("ok") is True,
     "archive_mode":str(data.get("archive_mode") or "")[:35]}
   for key in ("events","items"):
    if isinstance(data.get(key),list):result[key+"_count"]=len(data[key])
   for field in ("manual_links_only","automatic_identity_matching"):
    if field in data:result[field]=data[field]
   return result
 except urllib.error.HTTPError as error:
  return {"http":error.code}
 except (OSError,ValueError,TypeError,UnicodeError,OverflowError):
  return {"state":"unreachable_or_malformed"}

def range_probe(port,data):
 try:
  rows=data.get("events",[])
  record=next((e for e in rows if isinstance(e,dict) and
    re.fullmatch(r"[A-Za-z0-9._-]{1,180}[.]mp4",str(e.get("remote_name") or ""))
    and ".." not in str(e.get("remote_name"))),None)
  if record is None:return {"state":"no_verified_drive_original"}
  name=record["remote_name"]
  request=urllib.request.Request(
    BASE+str(port)+"/new/drive/saved/clip/"+name,
    headers={"Range":"bytes=0-1023","Accept":"video/mp4"})
  with urllib.request.urlopen(request,timeout=35) as response:
   sample=response.read(1025)
   return {"http":response.status,"sample_bytes":len(sample),
      "ranges":response.headers.get("Content-Range","").startswith("bytes 0-1023/"),
      "type_video":response.headers.get("Content-Type","").startswith("video/")}
 except urllib.error.HTTPError as error:
  return {"http":error.code}
 except (OSError,ValueError,TypeError):
  return {"state":"drive_byte_range_unreachable"}

def main():
 result={}
 for port in (8795,8794):
  for key,path in (("microSD","/new/api/saved"),
                   ("drive","/new/api/drive-saved"),
                   ("manual","/new/api/s9-manual-recording-links")):
   result[str(port)+"_"+key]=json_probe(port,path)
 drive={}
 try:
  with urllib.request.urlopen(BASE+"8795/new/api/drive-saved",timeout=16) as stream:
   raw=stream.read(4_500_001)
   if len(raw)<4_500_000:drive=json.loads(raw)
 except (urllib.error.URLError,ValueError,OSError,TypeError):
  pass
 for port in (8795,8794):
  result[str(port)+"_drive_range"]=range_probe(port,drive)
 print("S9_ARCHIVE_RELAY_DIAG "+json.dumps(result,sort_keys=True),flush=True)
if __name__=="__main__":main()
