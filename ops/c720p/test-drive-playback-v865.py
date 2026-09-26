#!/usr/bin/env python3
import json,pathlib,time,urllib.request
B=pathlib.Path("/home/jespern/c720p-home-hub")
idx=json.loads((B/"state/drive-security-archive.json").read_text())
cache=B/"drive-playback-cache"/"new"
rows=sorted([x for x in idx.get("items",[]) if x.get("camera")=="new" and x.get("state")=="verified"],key=lambda x:str(x.get("timestamp","")))
row=next((x for x in rows if x.get("remote_name") and not (cache/str(x["remote_name"])).exists()),None)
if not row:raise SystemExit("no_uncached_verified_clip")
name=str(row["remote_name"])
url="http://127.0.0.1:8795/new/clip/"+urllib.parse.quote(name)
req=urllib.request.Request(url,headers={"Range":"bytes=0-1048575"})
t=time.time()
with urllib.request.urlopen(req,timeout=25) as r:
    data=r.read()
    print(json.dumps({"name":name,"status":r.status,"content_range":r.headers.get("Content-Range"),"accept_ranges":r.headers.get("Accept-Ranges"),"bytes":len(data),"elapsed_seconds":round(time.time()-t,3)}))
if len(data)!=1048576:raise SystemExit("wrong_range_size")
if r.status!=206:raise SystemExit("wrong_status")
