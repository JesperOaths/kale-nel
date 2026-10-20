#!/usr/bin/env python3
"""Human-verified exact face-reference admission, revocation and proposal gate.

No model inference or automatic identity assignment. An anonymous V3 appearance
descriptor is NOT an approved identity reference. A recording-level V68 folder
link alone is NOT approval of an exact face crop. Distinct aligned, unpadded,
source-SHA-qualified face crops on >=2 different manually assigned recordings
are required before a named-person proposal can be shown.

The private registry is an append-only *logical* decision history: revoking a
reference never removes its original decision, crop, recording or person link.
The content-addressed active generation changes after each manual mutation and
stale offline proposal generations fail closed. A production source anchor for
rollback is not yet independently present; do not claim tamper-proof history.
"""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

ROOT=Path("/home/jespern/c720p-home-hub/state")
REGISTRY=ROOT/"s9-human-confirmed-face-references-v1.json"
AUDIT=ROOT/"s9-human-confirmed-face-references-v1.audit.jsonl"
LOCK=ROOT/"s9-human-confirmed-face-references-v1.lock"
CATALOG=ROOT/"s9-standalone-archive-catalog-v1.json"
VERSION=1
MAX_ENTRIES=2000
CLIP=re.compile(r"motion_[0-9]{13}\.mp4\Z")
HASH=re.compile(r"[0-9a-f]{64}\Z")
FOLDER=re.compile(r"[A-Za-z0-9_-]{1,100}\Z")
KEY_VERSION="s9_exact_face_reference_v315"
REQUIRED_FACE_MODEL="s9_onphone_36_samples_overlapping_tiles_v5"

class Invalid(Exception):pass
def require(value,reason):
    if not value:raise Invalid(reason)
def exact_sha(value):
    return isinstance(value,str) and HASH.fullmatch(value) is not None
def content_sha(payload):
    return hashlib.sha256(json.dumps(payload,sort_keys=True,
      separators=(",",":"),ensure_ascii=True).encode()).hexdigest()
def generation(decisions):
    active=sorted(e["id"] for e in decisions if e["status"]=="approved")
    # Pending, revoked, rejected and older versions cannot re-enter indexing.
    return content_sha(["s9_face_reference_generation_v315",active])
def initial():
    obj={"version":VERSION,"revision":0,"decisions":[],
        "active_generation":generation([]),"history_complete":True}
    return obj
def read_state():
    if REGISTRY.is_symlink():raise Invalid("reference_registry_symlink")
    if not REGISTRY.exists():return initial()
    st=REGISTRY.stat()
    require(st.st_size<2000000 and st.st_size>50 and st.st_mode&0o077==0,
            "reference_registry_permissions_or_size_invalid")
    try:d=json.loads(REGISTRY.read_text())
    except (OSError,ValueError):raise Invalid("reference_registry_unreadable") from None
    require(type(d) is dict and d.get("version")==VERSION
      and type(d.get("revision")) is int and 0<=d["revision"]<=100000
      and isinstance(d.get("decisions"),list)
      and len(d["decisions"])<=MAX_ENTRIES
      and d.get("history_complete") is True,
      "reference_registry_schema_invalid")
    active=set();ids=set()
    for row in d["decisions"]:
        require(isinstance(row,dict) and
           set(row)=={"id","clip","folder","face_sha256","original_sha256",
              "media_revision","model_sha256","status","confirmed_at",
              "revoked_at","revocation_reason"} and
           exact_sha(row.get("id")) and CLIP.fullmatch(str(row.get("clip","")))
           and FOLDER.fullmatch(str(row.get("folder","")))
           and all(exact_sha(row.get(k)) for k in
               ("face_sha256","original_sha256","media_revision","model_sha256")) and
           row.get("status") in ("approved","revoked") and row["id"] not in ids,
           "invalid_exact_face_reference")
        ids.add(row["id"])
        if row["status"]=="approved":active.add(row["id"])
        else:require(row.get("revoked_at") and
           row.get("revocation_reason")=="explicit_human_revocation",
           "invalid_revocation_audit")
    require(d.get("active_generation")==generation(d["decisions"]),
            "reference_index_generation_drift")
    return d

def original_source(catalog,clip):
    require(isinstance(catalog,dict) and catalog.get("schema_version")==
            "s9_native_archive_catalog_v1","private_native_catalog_untrusted")
    meta=catalog.get("records",{}).get(clip)
    require(isinstance(meta,dict) and isinstance(meta.get("manifest"),dict),
            "native_source_not_indexed")
    manifest=meta["manifest"]
    require(manifest.get("name")==clip and manifest.get("width")==3840
      and manifest.get("height")==2160 and exact_sha(manifest.get("sha256"))
      and exact_sha(meta.get("version")) and type(meta.get("bytes")) is int
      and manifest.get("bytes")==meta["bytes"],
      "original_sha_or_revision_unverified")
    return manifest["sha256"],meta["version"]

def active_person(clip,folder,manual):
    require(isinstance(manual,dict),"manual_links_unavailable")
    row=manual.get("sd:"+clip)
    require(isinstance(row,dict) and row.get("review_status")=="assigned",
            "manual_identity_decision_not_final")
    options=row.get("folders")
    if not isinstance(options,list):
        options=[row.get("folder")]
    require(folder in options and
            all(isinstance(x,str) and FOLDER.fullmatch(x) for x in options),
            "person_not_in_manual_clip_assignment")
    # Multiple people remain valid but each exact face must be approved for
    # a SPECIFIC person. Never infer a face from a generic group assignment.
    return True

def source_crop(clip,face_digest,events):
    if not isinstance(events,list):raise Invalid("native_face_catalog_untrusted")
    event=next((x for x in events if isinstance(x,dict)
                and x.get("clip_no")==clip),None)
    require(event is not None and
       event.get("face_deep_review_version")==REQUIRED_FACE_MODEL,
       "native_face_pass_not_verified")
    for face in event.get("face_candidates",[]):
        if not isinstance(face,dict):continue
        if face.get("snapshot_sha256")!=face_digest:continue
        require(face.get("snapshot_on_s9") is not False and
            face.get("face_crop_requires_manual_review") is False and
            face.get("face_crop_padded_context_only") is False and
            (face.get("face_landmarks_aligned") is True or
             face.get("face_alignment_verified") is True) and
            type(face.get("snapshot_size")) is int and
            512<=face["snapshot_size"]<=2200000,
            "face_not_independently_aligned_and_quality_verified")
        return True
    raise Invalid("exact_face_crop_not_in_original_manifest")

def make_id(clip,folder,face_sha,original_sha,media_revision,model_sha):
    return content_sha([KEY_VERSION,"sd",clip,folder,face_sha,
                        original_sha,media_revision,model_sha])

def new_reference(body,manual,catalog,events,prior):
    require(set(body)=={"action","revision","human_confirmed","clip","folder",
           "face_sha256","model_sha256"} and body["action"]=="approve"
           and body.get("human_confirmed") is True and
           type(body.get("revision")) is int and body["revision"]==prior["revision"],
           "explicit_human_face_reference_approval_required")
    clip,folder,digest,model=(
        body.get("clip"),body.get("folder"),body.get("face_sha256"),body.get("model_sha256"))
    require(isinstance(clip,str) and CLIP.fullmatch(clip) and
      isinstance(folder,str) and FOLDER.fullmatch(folder) and
      exact_sha(digest) and exact_sha(model),
      "reference_identifiers_invalid")
    active_person(clip,folder,manual)
    source_sha,revision=original_source(catalog,clip)
    source_crop(clip,digest,events)
    ident=make_id(clip,folder,digest,source_sha,revision,model)
    require(not any(x["id"]==ident for x in prior["decisions"]),
           "prior_reference_or_revocation_must_not_reenroll")
    return {"id":ident,"clip":clip,"folder":folder,"face_sha256":digest,
       "original_sha256":source_sha,"media_revision":revision,
       "model_sha256":model,"status":"approved",
       "confirmed_at":dt.datetime.now(dt.timezone.utc).isoformat(),
       "revoked_at":None,"revocation_reason":None}

def write_atomic(path,obj):
    raw=json.dumps(obj,separators=(",",":"),sort_keys=True).encode()
    require(len(raw)<2000000,"reference_state_limit")
    fd,temp=tempfile.mkstemp(prefix=".face-reference-v315-",dir=path.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"wb") as f:
            f.write(raw);f.flush();os.fsync(f.fileno())
        os.replace(temp,path)
        directory=os.open(path.parent,os.O_DIRECTORY|os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def mutate(body,manual,catalog,events):
    require(isinstance(body,dict) and body.get("action") in ("approve","revoke"),
            "manual_reference_action_required")
    require(not REGISTRY.is_symlink() and not LOCK.is_symlink() and
        not AUDIT.is_symlink(),"private_reference_state_unsafe")
    ROOT.mkdir(parents=True,exist_ok=True)
    with LOCK.open("a+") as mutex:
        os.chmod(LOCK,0o600)
        fcntl.flock(mutex,fcntl.LOCK_EX)
        prior=read_state()
        require(type(body.get("revision")) is int
                and body["revision"]==prior["revision"],
                "reference_revision_conflict")
        if body["action"]=="approve":
            row=new_reference(body,manual,catalog,events,prior)
            prior["decisions"].append(row);event="exact_face_human_approved"
        else:
            require(set(body)=={"action","revision","id","human_confirmed"} and
              body.get("human_confirmed") is True and exact_sha(body.get("id")),
              "explicit_human_reference_revocation_required")
            row=next((x for x in prior["decisions"] if
                      x["id"]==body["id"] and x["status"]=="approved"),None)
            require(row is not None,"reference_missing_or_already_revoked")
            row["status"]="revoked"
            row["revoked_at"]=dt.datetime.now(dt.timezone.utc).isoformat()
            row["revocation_reason"]="explicit_human_revocation"
            event="exact_face_reference_revoked"
        prior["revision"]+=1
        prior["active_generation"]=generation(prior["decisions"])
        # Append audit BEFORE publishing state; failure is fail closed.
        receipt={"at":dt.datetime.now(dt.timezone.utc).isoformat(),
                 "revision":prior["revision"],"event":event,
                 "reference_id":row["id"],
                 "active_generation":prior["active_generation"]}
        fd=os.open(AUDIT,os.O_CREAT|os.O_APPEND|os.O_WRONLY|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,"a") as f:
            f.write(json.dumps(receipt,sort_keys=True)+"\n")
            f.flush();os.fsync(f.fileno())
        write_atomic(REGISTRY,prior)
        return {"revision":prior["revision"],
            "active_generation":prior["active_generation"],"event":event}

def valid_active(registry,manual,catalog,events):
    """Independently revalidate active eligibility at consumption time.

    A manual return-to-inbox, reject, person move, retracted face-quality
    metadata or changed original digest immediately excludes stale references
    even when the private registry or old phone index retains the crop.
    """
    by_id={}
    for item in registry["decisions"]:
        if item["status"]!="approved":continue
        try:
            active_person(item["clip"],item["folder"],manual)
            sha,revision=original_source(catalog,item["clip"])
            require(sha==item["original_sha256"] and revision==item["media_revision"],
                    "source_revision_changed_after_manual_confirmation")
            source_crop(item["clip"],item["face_sha256"],events)
            by_id[item["id"]]=item
        except Invalid:pass
    return by_id

def verify_proposal(proposal,registry,active):
    """Exact index-generation binding, two source-distinct approved references."""
    if not isinstance(proposal,dict):return False
    refs=proposal.get("reference_ids")
    if (not isinstance(refs,list) or not 2<=len(refs)<=12
        or len(refs)!=len(set(map(str,refs)))
        or proposal.get("reference_index_generation")!=
           registry["active_generation"]):return False
    folder=proposal.get("folder")
    model=proposal.get("model_sha256")
    selected=[]
    for token in refs:
        if not isinstance(token,str) or token not in active:return False
        row=active[token]
        if row["folder"]!=folder or row["model_sha256"]!=model:return False
        selected.append(row)
    return len({x["clip"] for x in selected})>=2

def counts(registry,active):
    total=sum(x["status"]=="approved" for x in registry["decisions"])
    revoked=sum(x["status"]=="revoked" for x in registry["decisions"])
    distinct_persons=len({x["folder"] for x in active.values()})
    eligible_persons=sum(len({x["clip"] for x in active.values()
                             if x["folder"]==folder})>=2
        for folder in {x["folder"] for x in active.values()})
    return {"revision":registry["revision"],
            "active_index_generation":registry["active_generation"],
            "approved_reference_records":total,
            "revoked_reference_records":revoked,
            "currently_source_qualified_references":len(active),
            "currently_source_qualified_people":distinct_persons,
            "people_with_two_distinct_qualified_references":eligible_persons,
            "human_approval_required":True,
            "camera_or_originals_modified":False}
