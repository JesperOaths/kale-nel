"""Authenticated read-only recovery evidence: auxiliary footage is NOT a 4K original.

Install this only inside the existing loopback-only 8795 Security handler behind
the authenticated outer 8794 relay. No public standalone server is created.
"""
import collections
import datetime as dt
import json
from pathlib import Path
import re
import time
import urllib.parse

REPORT=Path("/home/jespern/c720p-home-hub/state/s9-auxiliary-structural-probe-v1.json")
NAME=re.compile(r"motion_[0-9]{13}[.]mp4[.](?:preroll[.]mp4|complete[.]mp4)")
ALL_NAME=re.compile(r"motion_[0-9]{13}[.]mp4[.](?:preroll[.]mp4|complete[.]mp4|complete[.]partial[.]mp4)")
MAX_REPORT=900000
VERSION="s9_auxiliary_recovery_metadata_v1"

def read_recovery(source=REPORT):
    path=Path(source)
    st=path.stat()
    if (path.is_symlink() or not path.is_file() or
        st.st_mode&0o077 or not 300<st.st_size<MAX_REPORT):
        raise ValueError("untrusted_auxiliary_private_source")
    data=json.loads(path.read_bytes())
    if (data.get("schema_version")!="s9_auxiliary_structural_report_v1"
        or data.get("video_decoded") is not False
        or data.get("video_bytes_transferred_to_hub") is not False
        or data.get("originals_modified") is not False
        or data.get("manual_person_reviews_modified") is not False
        or data.get("structural_packets_are_not_full_decode_proof") is not True):
        raise ValueError("untrusted_auxiliary_report_contract")
    stamp=dt.datetime.fromisoformat(data["generated_at_utc"])
    if stamp.tzinfo is None or not -240<=time.time()-stamp.timestamp()<=7*86400:
        raise ValueError("auxiliary_report_unavailable_or_stale")
    total=data.get("total_unpaired")
    rows=data.get("rows")
    by_role=data.get("by_role")
    if (type(total) is not int or not 1<=total<=700 or
        not isinstance(rows,list) or len(rows)!=total or
        not isinstance(by_role,dict)):
        raise ValueError("invalid_auxiliary_row_count")
    prepared=[]
    seen=set()
    by_category=collections.Counter()
    status_counts=collections.defaultdict(collections.Counter)
    for r in rows:
        if not isinstance(r,dict):raise ValueError("invalid_auxiliary_row")
        n,role,status,size=(r.get(k) for k in ("name","role","status","bytes"))
        if (not isinstance(n,str) or not ALL_NAME.fullmatch(n) or n in seen or
            role not in ("preroll","complete","partial") or
            type(size) is not int or size<0 or size>32000000 or
            not isinstance(status,str) or status not in (
                "compressed_video_samples_read","size_outside_probe_limits",
                "no_video_track","no_video_samples","extractor_unavailable_or_incomplete",
                "untrusted_video_format","possibly_active_or_untrusted_mtime")):
            raise ValueError("invalid_auxiliary_path_or_status")
        expected="partial" if n.endswith(".complete.partial.mp4") else "complete" if n.endswith(".complete.mp4") else "preroll"
        if role!=expected:raise ValueError("auxiliary_role_mismatch")
        seen.add(n)
        by_category[role]+=1
        status_counts[role][status]+=1
        if status!="compressed_video_samples_read":continue
        if not NAME.fullmatch(n) or size<10000:raise ValueError("untrusted_playable_filename")
        mime,width,height,duration=(r.get(k) for k in ("mime","width","height","duration_us"))
        if (mime!="video/avc" or any(type(v) is not int or v<=0 for v in
            (width,height,duration)) or width>3840 or height>2160 or duration>3600*1000000):
            raise ValueError("invalid_structural_metadata")
        prepared.append({"name":n,"role":role,"bytes":size,
            "width":width,"height":height,"duration_s":round(duration/1000000,2),
            "status":"compressed_packets_only_not_full_frame_proof"})
    for role in ("preroll","complete","partial"):
        item=by_role.get(role)
        if (not isinstance(item,dict) or item.get("checked")!=by_category[role] or
            item.get("statuses")!=dict(status_counts[role])):
            raise ValueError("auxiliary_status_counts_disagree")
    if len(prepared)>400:raise ValueError("unbounded_recoverable")
    return {"ok":True,"schema_version":VERSION,"generated_at_utc":data["generated_at_utc"],
        "unpaired_auxiliary_files":total,"structural_candidates":len(prepared),
        "incomplete_or_other_files":total-len(prepared),
        "by_role":{role:{"checked":by_category[role],
            "with_readable_samples":status_counts[role]["compressed_video_samples_read"]}
            for role in ("preroll","complete","partial")},
        "files":prepared,"not_verified_original_recordings":True,
        "not_counted_in_archive_or_person_analytics":True,
        "no_human_identity_approval":True,
        "full_frame_decode_verified":False,"source":"S9_microSD_auxiliary_only"}

def install(H,playback):
    """Extend an existing 8795 loopback Security handler, never mount publicly."""
    previous=H.go
    def go(self):
        u=urllib.parse.urlsplit(self.path)
        p=u.path
        if p=="/new/api/s9-auxiliary-recovery":
            if self.command!="GET" or u.query:
                self.js(400,{"ok":False,"error":"aux_recovery_get_only"});return
            try:
                response=json.dumps(read_recovery(),sort_keys=True,separators=(",",":")).encode()
                self.send_response(200)
                self.send_header("Content-Type","application/json; charset=utf-8")
                self.send_header("Cache-Control","private,no-store")
                self.send_header("X-Content-Type-Options","nosniff")
                self.send_header("Content-Length",str(len(response)))
                self.end_headers()
                self.wfile.write(response)
            except (OSError,ValueError,TypeError,KeyError,OverflowError):
                self.js(503,{"ok":False,"error":"aux_recovery_metadata_unavailable"})
            return
        if p.startswith("/new/saved/recovery/clip/"):
            match=re.fullmatch(r"/new/saved/recovery/clip/(motion_[0-9]{13}[.]mp4[.](?:preroll[.]mp4|complete[.]mp4))",p)
            if not match or u.query or self.command not in ("GET","HEAD"):
                self.js(400,{"ok":False,"error":"invalid_aux_recovery_clip_route"});return
            try:
                name=match.group(1)
                data=read_recovery()
                item=next((x for x in data["files"] if x["name"]==name),None)
                if item is None:
                    self.js(404,{"ok":False,"error":"not_verified_recoverable_companion"});return
                return playback(self,name,{"size":item["bytes"]})
            except (OSError,ValueError,TypeError,KeyError,OverflowError):
                self.js(503,{"ok":False,"error":"aux_recovery_playback_unavailable"})
            return
        return previous(self)
    H.go=go
