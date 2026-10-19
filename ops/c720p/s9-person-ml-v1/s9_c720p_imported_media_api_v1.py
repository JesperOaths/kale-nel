"""Private playback of *verified* C720P recordings offloaded to S9+ microSD.

Mounted inside existing authenticated C720P Security 8794->loopback 8795 relay.
No standalone listener, original archive count changes or person assignments.
"""
import json
from pathlib import Path
import re
import subprocess
import urllib.parse

REPORT=Path("/home/jespern/c720p-home-hub/state/c720p-s9-imported-v2.json")
SD_ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/C720PMigrated"
SERIAL="192.168.178.250:5555"
SCHEMA="c720p_s9_verified_import_v2"
NAME=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4")
MAX_RECORDS=5000
MAX_BYTES=900*1024**2

def read_manifest(source=None):
    path=Path(source or REPORT)
    if path.is_symlink() or not path.is_file():
        raise ValueError("no_private_migration_report")
    stat=path.stat()
    if stat.st_mode&0o077 or not 30<stat.st_size<2000000:
        raise ValueError("untrusted_private_migration_report")
    doc=json.loads(path.read_bytes())
    if doc.get("schema_version")!=SCHEMA or not isinstance(doc.get("records"),dict):
        raise ValueError("untrusted_migration_report_schema")
    records=doc["records"]
    if len(records)>MAX_RECORDS:raise ValueError("unbounded_import_inventory")
    output={}
    for name,item in records.items():
        if (not isinstance(name,str) or not NAME.fullmatch(name) or ".." in name or
            not isinstance(item,dict) or item.get("sd_path")!=SD_ROOT+"/"+name or
            not re.fullmatch(r"[0-9a-f]{64}",str(item.get("sha256",""))) or
            type(item.get("bytes")) is not int or not 10000<=item["bytes"]<=MAX_BYTES or
            type(item.get("indexed")) is not bool):
            raise ValueError("import_record_untrusted")
        output[name]={"size":item["bytes"],"indexed":item["indexed"]}
    return output

def stat_same_size(name,size):
    p=subprocess.run(["adb","-s",SERIAL,"shell","stat","-c","%s",SD_ROOT+"/"+name],
                     capture_output=True,text=True,timeout=12)
    return p.returncode==0 and p.stdout.strip()==str(size)

def install(H,play_sd):
    previous=H.go
    def go(self):
        url=urllib.parse.urlsplit(self.path)
        route=url.path
        if route=="/new/api/c720p-migrated-clips":
            if self.command!="GET" or url.query:
                self.js(400,{"ok":False,"error":"get_only"});return
            try:
                rows=read_manifest()
            except (OSError,ValueError,TypeError,KeyError):
                self.js(503,{"ok":False,"error":"migration_manifest_unavailable"});return
            response={"ok":True,"schema_version":SCHEMA,
                      "not_s9_original_recordings":True,
                      "not_person_assignments":True,
                      "source":"c720p_offloaded_to_s9_microSD",
                      "total_imported":len(rows),
                      "total_bytes":sum(x["size"] for x in rows.values()),
                      "files":[{"name":n,"bytes":x["size"],"indexed":x["indexed"]}
                               for n,x in sorted(rows.items())]}
            body=json.dumps(response,separators=(",",":"),sort_keys=True).encode()
            self.send_response(200)
            self.send_header("Content-Type","application/json; charset=utf-8")
            self.send_header("Cache-Control","private,no-store")
            self.send_header("X-Content-Type-Options","nosniff")
            self.send_header("Content-Length",str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if route.startswith("/new/saved/c720p-migrated/clip/"):
            match=re.fullmatch(r"/new/saved/c720p-migrated/clip/([A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4)",route)
            if (not match or url.query or self.command not in ("GET","HEAD") or
                ".." in route):
                self.js(400,{"ok":False,"error":"invalid_migration_clip_route"});return
            name=match.group(1)
            try:rows=read_manifest()
            except (OSError,ValueError,TypeError,KeyError):
                self.js(503,{"ok":False,"error":"import_proof_unavailable"});return
            item=rows.get(name)
            if item is None:
                self.js(404,{"ok":False,"error":"clip_not_in_verified_import"});return
            if not stat_same_size(name,item["size"]):
                self.js(503,{"ok":False,"error":"phone_import_size_disagrees"});return
            return play_sd(self,name,item,root_override=SD_ROOT)
        return previous(self)
    H.go=go
