"""Backend-only anonymous secondary-quality evidence consumption contract.

The authenticated Playback owner may integrate this module into the existing
private relay. It does NOT register a route or read original recordings.
Admission revalidates BOTH actual authoritative private source files on every
use; the emitted revision is invalidated when either source state changes.
V3 appearance never authorizes a person/identity decision.
"""
import hashlib
import json
from pathlib import Path
import re

import s9_evidence_quality_v1 as quality

SCHEMA="s9_anonymous_quality_consumption_v361"
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
# Both original provenance AND current quality priority are revocation sources.
MAX_SOURCE=(8000000,4000000,6000000)

class NotCurrent(ValueError):
    pass

class Unavailable(ValueError):
    pass

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(",",":"),
                      allow_nan=False).encode("utf-8")

def snapshot_state():
    """Read catalog, queue AND latest priority report; never media or identities."""
    snapshots=[]
    for path,limit in zip((quality.PRIORITY_CATALOG,quality.PRIORITY_QUEUE,
                           quality.REPORT),MAX_SOURCE):
        path=Path(path)
        if path.is_symlink() or not path.is_file():
            raise Unavailable("attestation_source_unavailable")
        size=path.stat().st_size
        if not 20<size<limit:
            raise Unavailable("attestation_source_bounds")
        raw=path.read_bytes()
        if len(raw)!=size:
            raise Unavailable("attestation_source_changed")
        snapshots.append(hashlib.sha256(raw).hexdigest())
    return tuple(snapshots)

def clip_binding_for_receipt(clip, evidence):
    """Capture only this clip's immutable and current authoritative evidence.

    The three global file hashes are separately checked before/after this
    read. Never make one clip's reusable evidence revision depend on unrelated
    recording admissions, queue completions or report refreshes.
    """
    docs = []
    for path, limit in zip((quality.PRIORITY_CATALOG, quality.PRIORITY_QUEUE,
                            quality.REPORT), MAX_SOURCE):
        path = Path(path)
        if path.is_symlink() or not path.is_file():
            raise Unavailable("attestation_source_unavailable")
        size = path.stat().st_size
        if not 20 < size < limit:
            raise Unavailable("attestation_source_bounds")
        raw = path.read_bytes()
        if len(raw) != size:
            raise Unavailable("attestation_source_changed")
        docs.append(json.loads(raw))
    catalog, queue, quality_report = docs
    catalog_row = catalog.get("records", {}).get(clip)
    priorities = quality_report.get("recordings")
    queued = queue.get("rows")
    if (not isinstance(catalog_row, dict) or
        not isinstance(priorities, list) or not isinstance(queued, list)):
        raise Unavailable("clip_provenance_not_current")
    priority_rows = [p for p in priorities
                     if isinstance(p, dict) and p.get("clip_no") == clip]
    matching_queue = [item for item in queued
        if isinstance(item, dict) and item.get("clip_no") == clip
        and item.get("source_sha256") == evidence["source_sha256"]
        and item.get("source_bytes") == evidence["source_bytes"]
        and item.get("media_revision") == evidence["source_revision"]
        and item.get("model_sha256") == evidence["model_sha256"]
        and item.get("required_analysis") == evidence["analysis_version"]
        and item.get("status") in ("processing", "completed")]
    if len(priority_rows) != 1 or len(matching_queue) != 1:
        raise Unavailable("clip_provenance_ambiguous")
    priority, task = priority_rows[0], matching_queue[0]
    manifest = catalog_row.get("manifest")
    if (not isinstance(manifest, dict) or
        manifest.get("sha256") != evidence["source_sha256"] or
        manifest.get("bytes") != evidence["source_bytes"] or
        catalog_row.get("bytes") != evidence["source_bytes"] or
        catalog_row.get("version") != evidence["source_revision"] or
        priority.get("targeted_rescan_priority") is not True or
        priority.get("native_face_pass_complete") is not True or
        task.get("priority_reason") != priority.get("extraction_status")):
        raise Unavailable("clip_provenance_not_current")
    # Hash private metadata only; never return its images, person data or paths.
    return {"source_catalog_row": catalog_row, "quality_priority_row": priority,
            "rescan_queue_row": task}


def v3_status(appearance):
    if appearance is None:
        return "unavailable"
    if not isinstance(appearance,dict):
        raise Unavailable("invalid_appearance_projection")
    # Provisional comparisons may be displayed separately but CANNOT be
    # promoted to person references or source-current evidence.
    if (appearance.get("ok") is not True or
        appearance.get("status")!="provisional_appearance_only_original_revision_unverified" or
        appearance.get("source_binding_status")!="crop_and_corpus_sha_valid_original_revision_unverified" or
        appearance.get("evidence_consumption_eligible") is not False or
        appearance.get("person_reference_eligible") is not False or
        appearance.get("verified_same_person") is not False or
        appearance.get("human_review_required") is not True or
        appearance.get("automatic_person_assignments")!=0):
        raise Unavailable("v3_appearance_not_safe_for_downstream_use")
    return "provisional_not_admitted"

def consume(document,current,clip,appearance=None):
    """Return (HTTP status, private JSON). Never return identity assignments.

    Caller MUST enforce its existing authenticated browser/relay boundary.
    A 410 indicates a previous result is now ineligible, not a person-negative
    observation. A 503 is unknown; neither response authorizes a decision.
    """
    if not isinstance(clip,str) or not CLIP.fullmatch(clip):
        return 400,{"ok":False,"schema_version":SCHEMA,"error":"invalid_clip"}
    if not isinstance(document,dict) or document.get("ok") is not True:
        return 503,{"ok":False,"schema_version":SCHEMA,"error":"qualified_reader_unavailable"}
    gap=document.get("original_gap_benchmark")
    if not isinstance(gap,dict) or not isinstance(current,dict):
        return 503,{"ok":False,"schema_version":SCHEMA,"error":"source_admission_unavailable"}
    try:
        appearance_state=v3_status(appearance)
        before=snapshot_state()
        admitted=quality.source_current_gap_report(gap,current)
        after=snapshot_state()
        if before!=after:
            raise Unavailable("source_revision_changed_during_consume")
        rows=gap.get("recordings")
        if (gap.get("source_binding_status")!="source_qualified_active_queue_only" or
            type(gap.get("source_bound_records_visible")) is not int or
            gap["source_bound_records_visible"]!=len(rows or []) or
            type(gap.get("source_bound_records_not_current")) is not int or
            gap["source_bound_records_not_current"]<0 or
            gap.get("identity_inference_performed") is not False or
            gap.get("original_recordings_modified") is not False):
            raise Unavailable("source_qualified_reader_claim_not_reproduced")
        if rows!=admitted["recordings"]:
            # Distinguish revoked source evidence from an untrustworthy reader.
            # Neither outcome is a negative claim about any person.
            if any(row.get("clip_no")==clip for row in rows) and not any(
                    row.get("clip_no")==clip for row in admitted["recordings"]):
                raise NotCurrent("source_revision_or_evidence_revoked")
            raise Unavailable("source_qualified_reader_claim_not_reproduced")
        selected=[row for row in rows if row.get("clip_no")==clip]
        if not selected:
            raise NotCurrent("source_revision_or_evidence_revoked")
        if len(selected)!=1:
            raise Unavailable("duplicate_source_evidence")
        row=selected[0]
        samples=row["samples"]
        duration=row.get("duration_ms")
        if (type(duration) is not int or not 3000<=duration<=300000 or
            len(samples)!=3 or
            any(type(sample.get("time_ms")) is not int or
                not 0<=sample["time_ms"]<duration or
                len(sample["face_candidates"])>32 for sample in samples) or
            len({sample["time_ms"] for sample in samples})!=3):
            raise Unavailable("invalid_original_sample_geometry_or_timing")
        hits=sum(len(s["face_candidates"]) for s in samples)
        if hits>96:
            raise Unavailable("unsupported_sample_volume")
        # Global hashes prevent races; the reusable revision is scoped to
        # this clip, so processing an unrelated clip cannot spuriously revoke
        # an unchanged human-review-quality observation.
        binding=clip_binding_for_receipt(clip,row)
        if snapshot_state()!=before:
            raise Unavailable("source_revision_changed_during_receipt")
        receipt=hashlib.sha256(canonical({
          "domain":SCHEMA,"per_clip_authoritative_binding":binding,
          "source_sha256":row["source_sha256"],
          "source_bytes":row["source_bytes"],
          "media_revision":row["source_revision"],
          "model_sha256":row["model_sha256"],
          "analysis_version":row["analysis_version"],
          "sample_evidence":samples})).hexdigest()
        return 200,{
          "ok":True,"schema_version":SCHEMA,
          "clip_no":clip,
          "evidence_revision_sha256":receipt,
          "evidence_revision_scope":"clip_current_catalog_priority_queue_and_samples_v367",
          "source_sha256":row["source_sha256"],
          "source_bytes":row["source_bytes"],
          "source_revision":row["source_revision"],
          "model_sha256":row["model_sha256"],
          "analysis_version":row["analysis_version"],
          "source_binding_status":"revalidated_original_and_queue_at_consumption",
          "eligibility":"anonymous_quality_manual_review_only",
          "sample_count":3,"sample_times_ms":[s["time_ms"] for s in samples],
          "sampled_face_candidate_count":hits,
          "observation":"unreviewed_detector_candidates_present" if hits
                  else "no_supported_face_in_three_sampled_frames",
          "appearance_v3":appearance_state,
          "appearance_evidence_eligible":False,
          "pose_gait_measured":False,
          "verified_same_person":False,
          "automatic_person_assignments":0,
          "human_review_required":True,
          "originals_modified":False,
          "review_decisions_modified":False}
    except NotCurrent:
        return 410,{"ok":False,"schema_version":SCHEMA,
                    "error":"source_revision_or_evidence_revoked",
                    "automatic_person_assignments":0}
    except (ValueError,TypeError,KeyError,OSError,OverflowError,IndexError):
        return 503,{"ok":False,"schema_version":SCHEMA,
                    "error":"source_admission_unavailable",
                    "automatic_person_assignments":0}
