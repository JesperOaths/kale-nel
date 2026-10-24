#!/usr/bin/env python3
"""Fail-closed eligibility and *fixture-only* reversible archive quarantine.

This is not an enrolled production retention worker. The existing S9
GardenArchiveTriage is the intended owner. Chat 2 must attest full-video
evidence; Chat 3 and native Save/Delete must share the same lifecycle lock
before this can be ported to the phone's real transactional backend.
"""
from __future__ import annotations
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time

NAME=re.compile(r"motion_[0-9]{13}\.mp4\Z")
REQUIRED_PROTECTION=(
    "saved","protected","human_person_assignment","group_filed",
    "evidence_retention","export_pending","active_review","pending_review",
    "unresolved_processing","credible_person_evidence","conflicting_analysis",
)
FIXTURE_MARKER=".isolated_fixture_only"

class Protected(Exception):
    pass

def check(state,source,evidence,protection,*,trusted_attestation,allowed_models):
    """No default negative is ever interpreted as verified empty."""
    if not isinstance(state,dict) or state.get("scope")!="S9_native_microSD":
        raise Protected("wrong_or_unknown_source_scope")
    name=state.get("name")
    if not isinstance(name,str) or not NAME.fullmatch(name):
        raise Protected("recording_identity_unrecognized")
    if not isinstance(source,dict) or not isinstance(evidence,dict) or not isinstance(protection,dict):
        raise Protected("missing_required_metadata")
    digest=source.get("sha256")
    rev=source.get("revision")
    length=source.get("duration_ms")
    if not isinstance(digest,str) or not re.fullmatch(r"[0-9a-f]{64}",digest):
        raise Protected("source_digest_not_verified")
    if not isinstance(rev,str) or not rev or type(length) is not int or length<1000:
        raise Protected("invalid_source_revision_or_duration")
    if source.get("name")!=name or source.get("scope")!=state["scope"]:
        raise Protected("source_record_identity_mismatch")
    if (source.get("fully_finalized") is not True or
        source.get("separate_preroll_tail_assets") is not False):
        raise Protected("media_finalization_or_companions_unresolved")
    if evidence.get("state")!="verified_empty":
        raise Protected("person_present_or_uncertain")
    if evidence.get("source_sha256")!=digest or evidence.get("source_revision")!=rev:
        raise Protected("analysis_source_revision_stale")
    if evidence.get("evidence_revision")!=state.get("evidence_revision"):
        raise Protected("evidence_revision_changed")
    if (not isinstance(allowed_models,(tuple,list,set,frozenset))
        or evidence.get("model_id") not in allowed_models):
        raise Protected("model_not_owner_approved")
    if not callable(trusted_attestation) or trusted_attestation(evidence,source) is not True:
        raise Protected("evidence_attestation_unverified")
    required_true=(
        "complete_video_decode","every_decoded_frame_evaluated",
        "preroll_and_tail_covered","no_processing_errors",
        "visibility_sufficient_everywhere","all_temporal_windows_resolved",
    )
    if any(evidence.get(k) is not True for k in required_true):
        raise Protected("full_coverage_or_visibility_unverified")
    if (evidence.get("any_confirmed_person") is not False or
        evidence.get("any_credible_person") is not False or
        evidence.get("any_possible_person") is not False):
        raise Protected("positive_or_credible_person_evidence")
    decoded=evidence.get("decoded_frame_count")
    analyzed=evidence.get("analyzed_frame_count")
    if type(decoded) is not int or decoded<1 or type(analyzed) is not int or analyzed!=decoded:
        raise Protected("frames_incomplete")
    windows=evidence.get("coverage_windows")
    if not isinstance(windows,list) or not windows:
        raise Protected("missing_temporal_coverage")
    cursor=0
    for w in windows:
        if not isinstance(w,dict) or type(w.get("start_ms")) is not int or type(w.get("end_ms")) is not int:
            raise Protected("malformed_coverage")
        if w["start_ms"]!=cursor or w["end_ms"]<=cursor or w["end_ms"]>length:
            raise Protected("coverage_gap_overlap_or_out_of_bounds")
        if w.get("person_absent_confidently") is not True:
            raise Protected("unresolved_window")
        cursor=w["end_ms"]
    if cursor!=length:
        raise Protected("tail_not_fully_covered")
    if any(protection.get(k) is not False for k in REQUIRED_PROTECTION):
        raise Protected("human_save_review_or_evidence_protection")
    return True

def sha_file(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def atomic_json(path,data):
    path=Path(path)
    fd,tmp=tempfile.mkstemp(prefix=".retention-intent-",dir=path.parent)
    try:
        with os.fdopen(fd,"w") as f:
            os.fchmod(f.fileno(),0o600)
            json.dump(data,f,sort_keys=True,indent=2)
            f.write("\n");f.flush();os.fsync(f.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def fixture_quarantine(root,name,read_state,*,trusted_attestation,
                       allowed_models,shared_lock_contract,precommit_hook=None):
    """No real camera paths: must explicitly be an isolated test root.

    The lifecycle lock is insufficient unless actual Save, review, writer and
    person assignment use THE SAME lock. Do not enable a timer with this.
    """
    root=Path(root).resolve(strict=True)
    if not (root/FIXTURE_MARKER).is_file():
        raise Protected("fixture_marker_required_no_production_operations")
    if shared_lock_contract is not True:
        raise Protected("save_delete_shared_lock_not_integrated")
    if not NAME.fullmatch(name):
        raise Protected("invalid_name")
    live=root/"Security4K"/name
    qdir=root/"private-quarantine"
    qdir.mkdir(mode=0o700,exist_ok=True)
    os.chmod(qdir,0o700)
    if os.stat(live.parent).st_dev != os.stat(qdir).st_dev:
        raise Protected("quarantine_must_use_same_filesystem")
    lock=root/".archive-lifecycle.lock"
    with lock.open("a+") as l:
        fcntl.flock(l,fcntl.LOCK_EX)
        state,source,evidence,protection=read_state()
        check(state,source,evidence,protection,
              trusted_attestation=trusted_attestation,allowed_models=allowed_models)
        if not live.is_file() or live.is_symlink():
            raise Protected("original_missing_or_unsafe")
        if sha_file(live)!=source["sha256"]:
            raise Protected("original_bytes_changed")
        if precommit_hook:
            precommit_hook()  # synthetic tests only
        state,source,evidence,protection=read_state()
        check(state,source,evidence,protection,
              trusted_attestation=trusted_attestation,allowed_models=allowed_models)
        if sha_file(live)!=source["sha256"]:
            raise Protected("original_changed_at_commit")
        target=qdir/name
        journal=qdir/(name+".quarantine.json")
        if target.exists() or journal.exists():
            raise Protected("existing_quarantine_or_journal")
        ticket={"schema":"s9_empty_clip_fixture_quarantine_v1",
                "source_scope":"S9_native_microSD",
                "name":name,"digest":source["sha256"],
                "source_revision":source["revision"],
                "evidence_revision":evidence["evidence_revision"],
                "original":str(live),"quarantine":str(target),
                "state":"intent","at_unix_seconds":time.time(),
                "permanently_deleted":False}
        atomic_json(journal,ticket)  # crash intent before renaming
        os.replace(live,target)  # single same-filesystem atomic move
        ticket["state"]="quarantined"
        atomic_json(journal,ticket)
        fcntl.flock(l,fcntl.LOCK_UN)
        return ticket

def fixture_restore(root,name):
    root=Path(root).resolve(strict=True)
    if not (root/FIXTURE_MARKER).is_file() or not NAME.fullmatch(name):
        raise Protected("restore_fixture_only")
    qdir=root/"private-quarantine"
    live=root/"Security4K"/name
    journal=qdir/(name+".quarantine.json")
    with (root/".archive-lifecycle.lock").open("a+") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        ticket=json.loads(journal.read_text())
        if (ticket.get("name")!=name or ticket.get("quarantine")!=str(qdir/name)
            or ticket.get("original")!=str(live) or ticket.get("permanently_deleted") is not False):
            raise Protected("restore_ticket_invalid")
        target=qdir/name
        if target.is_file() and not live.exists():
            if sha_file(target)!=ticket.get("digest"):
                raise Protected("quarantine_bytes_corrupt")
            os.replace(target,live)
        elif not live.is_file() or target.exists() or sha_file(live)!=ticket.get("digest"):
            raise Protected("ambiguous_restore_state")
        ticket["state"]="restored"
        atomic_json(journal,ticket)
        return ticket
