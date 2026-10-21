#!/usr/bin/env python3
"""Unwired Task9 phone-first three-frame coordinator (no direct executable entry).

The existing V304 work() process must own its queue lease and BOTH shared
locks. The coordinator neither schedules tasks nor writes queue/report/media.
Only after ALL three complete, source/model-qualified receipts does it return
a single candidate record for V304.publish() and V361.consumer_visible().
The caller supplies independently approved per-frame phone admission and probe.
"""
import hashlib
import json
import re
import time

SCHEMA="s9_original4k_phone_frame_probe_v370"
MODEL_SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
ANALYSIS="s9_original4k_independent_gap_benchmark_v1"
CLIP=re.compile(r"motion_[0-9]{13}\.mp4\Z")
HEX=re.compile(r"[a-f0-9]{64}\Z")
MIN_LEASE_REMAINING=40
MAX_WALL_SECONDS=195
MAX_PTS_ERROR_MS=500

class Deferred(Exception):
    """Environmental/unavailable phone result: never claim missing faces."""
class Revoked(Exception):
    """Source, model, priority or immutable original no longer current."""

def require(condition,why,exception=Deferred):
    if not condition:raise exception(why)

def sample_times(duration):
    require(type(duration) is int and 3000<=duration<=300000,
            "unsupported_source_duration")
    return [duration//6,duration//2,5*duration//6]

def source_tuple(row):
    require(isinstance(row,dict) and CLIP.fullmatch(str(row.get("clip_no","")))
            and row.get("source")=="s9_original_4k_microsd"
            and type(row.get("source_bytes")) is int
            and 100000<row["source_bytes"]<800000000
            and HEX.fullmatch(str(row.get("source_sha256","")))
            and HEX.fullmatch(str(row.get("media_revision","")))
            and row.get("model_sha256")==MODEL_SHA
            and row.get("required_analysis")==ANALYSIS
            and row.get("native_pass")=="s9_onphone_36_samples_overlapping_tiles_v5"
            and row.get("priority_reason")=="no_indexed_image",
            "untrusted_phone_original_request",Revoked)
    return tuple(row[k] for k in ("clip_no","source_sha256","source_bytes",
                                   "media_revision","model_sha256"))

def original_still_current(row,source_check):
    """Always source-check *within* the current V304 lock and lease scope."""
    approved=source_check(row)
    require(approved is True,"source_or_priority_revoked",Revoked)

def valid_receipt(raw,row,requested,duration):
    require(isinstance(raw,dict) and raw.get("schema")==SCHEMA
            and raw.get("source")=="s9_original_4k_microsd"
            and raw.get("clip_no")==row["clip_no"]
            and raw.get("source_sha256")==row["source_sha256"]
            and raw.get("source_bytes")==row["source_bytes"]
            and raw.get("source_revision")==row["media_revision"]
            and raw.get("model_sha256")==MODEL_SHA
            and type(raw.get("duration_ms")) is int
            and abs(raw["duration_ms"]-duration)<=250
            and raw.get("one_frame_only") is True
            and raw.get("host_attestation_required") is True
            and raw.get("eligible_to_publish") is False
            and raw.get("frame_requested_not_actual_pts") is False
            and raw.get("originals_modified") is False
            and raw.get("review_decisions_modified") is False
            and raw.get("automatic_person_assignments")==0,
            "phone_source_or_provenance_mismatch",Revoked)
    sample=raw.get("sample")
    require(isinstance(sample,dict)
            and sample.get("state")=="decoded"
            and sample.get("original_resolution")==[3840,2160]
            and sample.get("decoded_pts_verified") is True
            and sample.get("pts_source")=="mediacodec_output_buffer_info"
            and type(sample.get("time_ms")) is int
            and type(sample.get("requested_time_ms")) is int
            and sample["requested_time_ms"]==requested
            and 0<=sample["time_ms"]<duration
            and 0<=sample["time_ms"]-requested<=MAX_PTS_ERROR_MS
            and isinstance(sample.get("face_candidates"),list)
            and len(sample["face_candidates"])<=3,
            "actual_phone_decoded_timestamp_or_frame_unverified")
    for item in sample["face_candidates"]:
        require(isinstance(item,dict) and
                isinstance(item.get("native_face_box_xywh"),list) and
                len(item["native_face_box_xywh"])==4 and
                all(type(v) is int for v in item["native_face_box_xywh"]) and
                0<=item["native_face_box_xywh"][0]<3840 and
                0<=item["native_face_box_xywh"][1]<2160 and
                0<item["native_face_box_xywh"][2]<=3840 and
                0<item["native_face_box_xywh"][3]<=2160 and
                item["native_face_box_xywh"][0]+item["native_face_box_xywh"][2]<=3840 and
                item["native_face_box_xywh"][1]+item["native_face_box_xywh"][3]<=2160 and
                type(item.get("secondary_face_score")) in (int,float) and
                .9<=item["secondary_face_score"]<=1 and
                type(item.get("native_eye_span_px")) in (int,float) and
                8<=item["native_eye_span_px"]<=2160,
                "phone_native_face_geometry_unverified")
    return {"time_ms":sample["time_ms"],"state":"decoded",
            "original_resolution":[3840,2160],
            "face_candidates":sample["face_candidates"]}

def coordinate(row,duration,*,guard,source_check,probe,clock=time.monotonic,
               wall=time.time):
    """Return all-or-nothing record; never a partial report or lease mutation.

    guard(row) MUST check approved phone memory/SD/camera temperature/recorder
    and hub >=900MiB, root >=850MiB and BOTH cross-owner locks. Caller already
    HOLDS those locks and owns the sole V304 task/240s queue lease.
    probe(row,requested_ms,remaining_seconds) invokes a previously enrolled
    single-frame signed/pinned Android executable; no shell execution here.
    """
    source_tuple(row)
    require(row.get("status")=="processing" and
            type(row.get("lease_until")) is int and
            type(row.get("attempts")) is int and
            1<=row["attempts"]<=3,
            "phone_process_requires_current_queue_lease")
    started=clock()
    frames=[]
    for offset in sample_times(duration):
        remaining=row["lease_until"]-wall()-MIN_LEASE_REMAINING
        budget=MAX_WALL_SECONDS-(clock()-started)
        require(remaining>=1 and budget>=1,
                "phone_processing_lease_or_deadline_too_short")
        guard(row)
        original_still_current(row,source_check)
        try:
            raw=probe(row,offset,min(65,remaining,budget))
        except (OSError,TimeoutError,ConnectionError) as exc:
            raise Deferred("phone_frame_transport_interrupted") from None
        decoded=valid_receipt(raw,row,offset,duration)
        frames.append(decoded)
        guard(row)
        original_still_current(row,source_check)
        require(row["lease_until"]-wall()>MIN_LEASE_REMAINING,
                "phone_processing_lease_or_deadline_too_short")
    require(len(frames)==3 and
            len({s["time_ms"] for s in frames})==3 and
            frames[0]["time_ms"]<frames[1]["time_ms"]<frames[2]["time_ms"],
            "phone_three_independent_pts_not_verified")
    guard(row)
    original_still_current(row,source_check)
    require(clock()-started<=MAX_WALL_SECONDS and
            row["lease_until"]-wall()>MIN_LEASE_REMAINING,
            "phone_lease_expired_before_publication")
    return {"clip_no":row["clip_no"],"duration_ms":duration,
            "source_sha256":row["source_sha256"],
            "source_bytes":row["source_bytes"],
            "source_revision":row["media_revision"],
            "model_sha256":MODEL_SHA,
            "analysis_version":ANALYSIS,
            "samples":frames}
