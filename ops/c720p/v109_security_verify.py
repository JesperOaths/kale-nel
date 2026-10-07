import json, pathlib, subprocess, urllib.request, collections, time

def run(args, timeout=12):
    p=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
    return {"returncode":p.returncode,"stdout":p.stdout.strip(),"stderr":p.stderr.strip()}

out={"at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())}
out["thumb_active"]=run(["systemctl","--user","is-active","c720p-saved-thumbnailer-v106.service"])
out["thumb_show"]=run(["systemctl","--user","show","c720p-saved-thumbnailer-v106.service","-p","ActiveState","-p","SubState","-p","Result","-p","ExecMainStartTimestamp","-p","ExecMainExitTimestamp","--no-pager"])
out["thumb_timer"]=run(["systemctl","--user","list-timers","c720p-saved-thumbnailer-v106.timer","--no-pager"])
out["revalidator_active"]=run(["systemctl","--user","is-active","c720p-drive-person-revalidate.service"])
out["revalidator_show"]=run(["systemctl","--user","show","c720p-drive-person-revalidate.service","-p","ActiveState","-p","SubState","-p","Result","-p","ExecMainStartTimestamp","--no-pager"])
p=pathlib.Path("/opt/homeassistant/config/www/c720p-saved-thumbs/manifest.json")
d=json.loads(p.read_text()) if p.exists() else {}
items=d.get("items",{}) if isinstance(d,dict) else {}
out["manifest"]={
  "version":d.get("version") or d.get("manifest_version"),
  "items":len(items),
  "versions":dict(collections.Counter((v or {}).get("version","?") for v in items.values())),
  "methods":dict(collections.Counter((v or {}).get("thumbnail_method","?") for v in items.values())),
}
try:
    data=json.load(urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved?t="+str(time.time()),timeout=8))
    ev=data.get("events",[])
    out["saved_api"]={
      "ok":data.get("ok"),
      "events":len(ev),
      "person":dict(collections.Counter(str(e.get("person_status") or "unknown") for e in ev))
    }
except Exception as e:
    out["saved_api"]={"error":repr(e)}
out["disk"]=run(["df","-B1","/"])
out["unit_text"]={
  "thumb_service":pathlib.Path("/home/jespern/.config/systemd/user/c720p-saved-thumbnailer-v106.service").read_text(),
  "thumb_timer":pathlib.Path("/home/jespern/.config/systemd/user/c720p-saved-thumbnailer-v106.timer").read_text(),
  "revalidator_service":pathlib.Path("/home/jespern/.config/systemd/user/c720p-drive-person-revalidate.service").read_text(),
}
print(json.dumps(out,indent=2))
