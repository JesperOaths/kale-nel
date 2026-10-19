"""Validated private client for the S9's metadata-only incremental SD catalog.

Originals, review decisions and inference stay outside this client. A missing
native endpoint permits the legacy reader; malformed/incomplete responses fail
closed so an unavailable phone cannot replace a populated hub index with zero.
"""
import fcntl
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

VERSION="s9_native_archive_catalog_v1"
BASE="http://127.0.0.1:18808"
CACHE=Path("/home/jespern/c720p-home-hub/state/s9-native-archive-client.json")
NAME=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
DIGEST=re.compile(r"[a-f0-9]{64}\Z")
MAX_BYTES=16*1024*1024
# Match the existing catalog's metadata-only boundary before any disk cache.
# In particular, native appearance vectors and cross-clip suggestions stay on
# the phone; no raw face embeddings/templates are transported into hub state.
METADATA_KEYS=set(('name bytes sha256 width height scene_category person_count categories '
 'person_confidence sampled_frame_count duration_ms person_frames_at_050 backend person_event_category '
 'capture_event_version capture_event_id capture_segment_index capture_segment_transition capture_previous_segment '
 'capture_segment_gap_from_previous_ms thumbnail_rank_version thumbnail_sharpness '
 'anonymous_tracking_version anonymous_track_scope anonymous_track_count anonymous_tracks '
 'face_review_version face_review_status face_review_sampled_frames face_candidates face_deep_review_version '
 'face_crop_geometry_version face_evidence_outcome face_model_state face_shadow_review_version '
 'face_shadow_model_trials face_shadow_model_succeeded face_shadow_model_failed face_shadow_matches_created '
 'face_shadow_vectors_persisted face_detector_raw_hits face_rejected_confidence_or_size '
 'face_rejected_low_confidence face_rejected_small_face face_manual_review_rescue_candidates '
 'face_rejected_looking_away_or_roll face_rejected_crop_geometry face_rejected_dark_or_blurry '
 'face_crop_padded_manual_count face_rejected_insufficient_native_eye_detail face_deep_detector_anchor_frames '
 'face_deep_person_roi_anchors face_deep_multiple_person_anchors face_deep_multiscale_refinement_passes '
 'face_deep_tiled_scene_samples face_deep_second_person_roi_samples').split())
FACE_KEYS=set(('match_status time_ms person_id candidate_name cosine_similarity snapshot snapshot_size_bytes '
 'snapshot_sha256 face_crop_requires_manual_review face_crop_padded_context_only').split())
TRACK_KEYS=set(('temporary_track_id id cross_recording_identity first_sample_ms last_sample_ms sample_count '
 'peak_detection_score upper_clothing_colour image_movement_direction image_speed_body_heights_per_second '
 'image_path_straightness image_detector_box_aspect_ratio').split())

def safe_metadata(manifest):
    result={k:v for k,v in manifest.items() if k in METADATA_KEYS}
    for key,allowed,maximum in [('face_candidates',FACE_KEYS,16),('anonymous_tracks',TRACK_KEYS,64)]:
        if key not in result:continue
        rows=result[key]
        result[key]=[{k:v for k,v in row.items() if k in allowed} for row in rows if isinstance(row,dict)] if isinstance(rows,list) and len(rows)<=maximum else []
    return result

class Unavailable(RuntimeError):pass

def _object(raw):
    value=json.loads(raw)
    if not isinstance(value,dict):raise ValueError("phone_catalog_not_object")
    return value

def _record(value):
    if not isinstance(value,dict):raise ValueError("phone_catalog_invalid_record")
    name=value.get("name");size=value.get("bytes");m=value.get("manifest")
    if not isinstance(name,str) or not NAME.fullmatch(name) or type(size) is not int or not 100000<size<800000000:
        raise ValueError("phone_catalog_invalid_file")
    if not isinstance(m,dict) or len(json.dumps(m).encode())>65536 or m.get("name")!=name or m.get("bytes")!=size:
        raise ValueError("phone_catalog_invalid_manifest")
    if m.get("width")!=3840 or m.get("height")!=2160 or not DIGEST.fullmatch(str(m.get("sha256",""))):
        raise ValueError("phone_catalog_not_verified_4k")
    if not DIGEST.fullmatch(str(value.get("version",""))) or type(value.get("thumbnail")) is not bool:
        raise ValueError("phone_catalog_invalid_version")
    thumb=value.get("thumbnail_version")
    if not isinstance(thumb,str) or not re.fullmatch(r"(?:[0-9]{4,7}:[0-9]{10,16})?",thumb):
        raise ValueError("phone_catalog_invalid_thumbnail")
    if value["thumbnail"]!=bool(thumb) or (thumb and not 4000<int(thumb.split(":")[0])<2200000):
        raise ValueError("phone_catalog_thumbnail_contract")
    return name,{k:value[k] for k in ('name','bytes','version','thumbnail','thumbnail_version')}|{'manifest':safe_metadata(m)}

def _cached(path):
    if not path.is_file() or path.stat().st_size>MAX_BYTES:return None
    try:
        value=_object(path.read_bytes())
        if value.get("schema_version")!=VERSION or not DIGEST.fullmatch(str(value.get("snapshot_id",""))):return None
        records=value.get("records")
        if not isinstance(records,dict) or len(records)>2000:return None
        if any(_record(v)!=(k,v) for k,v in records.items()):return None
        return value
    except (ValueError,TypeError,OSError):return None

def _read(args):
    url=BASE+"/archive/catalog?"+urllib.parse.urlencode(args)
    try:
        with urllib.request.urlopen(url,timeout=18) as response:
            data=response.read(2*1024*1024+1)
        if len(data)>2*1024*1024:raise ValueError("phone_catalog_page_too_large")
        return _object(data)
    except urllib.error.HTTPError as error:
        if error.code==409:raise BlockingIOError("phone_catalog_changed_during_paging") from error
        if error.code in (404,503):raise Unavailable("phone_catalog_endpoint_unavailable") from error
        raise
    except (urllib.error.URLError,TimeoutError) as error:
        raise Unavailable("phone_catalog_connection_unavailable") from error

STANDALONE_CATALOG=Path("/home/jespern/c720p-home-hub/state/s9-standalone-archive-catalog-v1.json")
STANDALONE_SUMMARY=Path("/home/jespern/c720p-home-hub/state/s9-standalone-archive-summary-v1.json")

def _fresh_standalone_catalog(catalog=STANDALONE_CATALOG,summary=STANDALONE_SUMMARY):
    """Fallback ONLY to an independently verified, very recent phone snapshot.

    The worker writes these after exact parity with both pre/post hub catalogs
    and 4K health checks. A stale, tampered or unavailable phone cannot become
    an empty archive merely because the Camera2 /archive endpoint is absent.
    """
    try:
        paths=[Path(catalog),Path(summary)]
        stamps=[p.stat() for p in paths]
        now=time.time()
        for p,st in zip(paths,stamps):
            if (p.is_symlink() or not p.is_file() or st.st_mode&0o077
                or st.st_size<50 or st.st_size>MAX_BYTES
                or not -120<=now-st.st_mtime<=300):
                return None
        snapshot=_cached(paths[0])
        if snapshot is None or not snapshot["records"]:return None
        details=_object(paths[1].read_bytes())
        if (details.get("catalog_snapshot_id")!=snapshot["snapshot_id"] or
            details.get("recordings")!=len(snapshot["records"]) or
            details.get("source")!="S9_native_microSD_sidecar_metadata" or
            details.get("timezone")!="Europe/Amsterdam" or
            details.get("operating_day_start_hour")!=6 or
            details.get("read_only") is not True or
            details.get("video_bytes_transferred_to_hub") is not False or
            details.get("camera_4k_healthy_before_and_after") is not True):
            return None
        return snapshot
    except (OSError,ValueError,TypeError,KeyError):
        return None

def load_catalog(cache=CACHE):
    cache=Path(cache);cache.parent.mkdir(parents=True,exist_ok=True)
    with cache.with_suffix(".lock").open("a+") as guard:
        fcntl.flock(guard,fcntl.LOCK_EX)
        old=_cached(cache)
        for attempt in range(2):
            try:return _load_pages(cache,old)
            except Unavailable:
                alternate=_fresh_standalone_catalog()
                if alternate is not None:return alternate
                raise
            except BlockingIOError:
                if attempt:raise Unavailable("phone_catalog_changing_defer")
        raise AssertionError("unreachable")

def _load_pages(cache,old):
    cursor=0;pin=None;mode=None;seen=set();changed=[];removed=[];total=None
    for page_number in range(51):
        args={"cursor":cursor,"limit":40}
        if old:args["since"]=old["snapshot_id"]
        if pin:args["snapshot"]=pin
        data=_read(args)
        identity=data.get("snapshot_id");current_mode=data.get("mode")
        if data.get("ok") is not True or data.get("schema_version")!=VERSION or not DIGEST.fullmatch(str(identity)):
            raise ValueError("phone_catalog_contract")
        if data.get("read_only") is not True or data.get("video_decode_performed") is not False or data.get("errors")!=[]:
            raise ValueError("phone_catalog_incomplete_or_untrusted")
        if data.get("cursor")!=cursor or type(data.get("cursor")) is not int or current_mode not in ("full","delta","unchanged"):
            raise ValueError("phone_catalog_page_contract")
        if mode is None:
            mode=current_mode;pin=identity;total=data.get("total_records");change_count=data.get("change_count")
            if type(total) is not int or not 0<=total<=2000 or type(change_count) is not int or not 0<=change_count<=2000:
                raise ValueError("phone_catalog_count")
            if mode!="full" and not old:raise ValueError("phone_catalog_missing_base")
            if mode=="unchanged" and identity!=old["snapshot_id"]:raise ValueError("phone_catalog_wrong_base")
        if pin!=identity or mode!=current_mode or total!=data.get("total_records") or change_count!=data.get("change_count"):
            raise ValueError("phone_catalog_mixed_snapshot")
        values=data.get("records");deleted=data.get("removed")
        if not isinstance(values,list) or len(values)>40 or not isinstance(deleted,list):raise ValueError("phone_catalog_page_size")
        if page_number and deleted:raise ValueError("phone_catalog_repeated_tombstones")
        for name in deleted:
            if not isinstance(name,str) or not NAME.fullmatch(name) or name in removed:raise ValueError("phone_catalog_bad_tombstone")
            removed.append(name)
        for record in values:
            name,record=_record(record)
            if name in seen:raise ValueError("phone_catalog_duplicate_record")
            seen.add(name);changed.append((name,record))
        following=data.get("next_cursor")
        if following is None:break
        if type(following) is not int or following!=cursor+len(values) or following<=cursor:
            raise ValueError("phone_catalog_bad_cursor")
        cursor=following
    else:raise ValueError("phone_catalog_too_many_pages")
    if len(changed)!=change_count:raise ValueError("phone_catalog_truncated_changes")
    if mode=="full" and removed:raise ValueError("phone_catalog_full_has_tombstones")
    if mode=="unchanged" and (changed or removed):raise ValueError("phone_catalog_unchanged_has_changes")
    records={} if mode=="full" else dict(old["records"])
    for name in removed:
        if name not in records:raise ValueError("phone_catalog_unknown_tombstone")
        del records[name]
    records.update(changed)
    if len(records)!=total:raise ValueError("phone_catalog_incomplete_snapshot")
    result={"schema_version":VERSION,"snapshot_id":pin,"records":records}
    if result!=old:
        raw=json.dumps(result,separators=(",",":"));
        if len(raw.encode())>MAX_BYTES:raise ValueError("phone_catalog_cache_too_large")
        tmp=cache.with_suffix(".partial");tmp.write_text(raw);os.chmod(tmp,0o600);os.replace(tmp,cache)
    return result

def read_asset(name):
    if not (re.fullmatch(r"motion_[0-9]{13}[.]mp4[.]thumb[.]jpg",name) or
            re.fullmatch(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg",name)):
        raise ValueError("phone_archive_invalid_asset")
    try:
        with urllib.request.urlopen(BASE+"/archive/asset/"+name,timeout=18) as response:
            data=response.read(2200001)
        if not 512<=len(data)<=2200000 or data[:3]!=b"\xff\xd8\xff":raise ValueError("phone_archive_invalid_jpeg")
        return data
    except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError) as error:
        raise Unavailable("phone_archive_asset_unavailable") from error

def valid_cached_thumbnail(destination,version=None):
    """Validate local JPEG integrity before trusting a cached version.

    Thumbnail checks are metadata-only and never touch the original SD video.
    """
    path=Path(destination)
    try:
        size=path.stat().st_size
        if not 4000<size<2200000:return False
        if isinstance(version,str) and re.fullmatch(r"[0-9]{4,7}:[0-9]{10,16}",version):
            if size!=int(version.split(":",1)[0]):return False
        with path.open("rb") as stream:
            if stream.read(3)!=b"\xff\xd8\xff":return False
            stream.seek(-2,os.SEEK_END)
            return stream.read(2)==b"\xff\xd9"
    except (OSError,ValueError):
        return False

def cache_thumbnail(entry,destination,previous_version,fallback_reader=None):
    """Keep verified thumbnails available on older Camera2 installations.

    Standalone catalogs do not add the native asset endpoint to the APK. The
    indexer can supply its existing bounded ADB JPEG reader when that route is
    unavailable. Both transports pass the same size/JPEG checks before writes.
    """
    destination=Path(destination)
    if not entry["thumbnail"]:return False,""
    wanted=entry["thumbnail_version"]
    old_ok=valid_cached_thumbnail(destination,previous_version)
    if old_ok and previous_version==wanted:return True,wanted
    try:
        name=entry["name"]
        if not isinstance(name,str) or not NAME.fullmatch(name):
            raise ValueError("phone_thumbnail_invalid_name")
        try:raw=read_asset(name+".thumb.jpg")
        except Unavailable:
            if fallback_reader is None:raise
            raw=fallback_reader(name+".thumb.jpg")
        if (len(raw)!=int(wanted.split(":")[0]) or raw[:3]!=b"\xff\xd8\xff"
            or raw[-2:]!=b"\xff\xd9"):
            raise Unavailable("phone_thumbnail_invalid_or_changed")
        destination.parent.mkdir(parents=True,exist_ok=True)
        if not old_ok or destination.read_bytes()!=raw:
            tmp=destination.with_suffix(".jpg.phone-tmp")
            try:
                tmp.write_bytes(raw)
                os.replace(tmp,destination)
            finally:
                if tmp.exists():tmp.unlink()
        return True,wanted
    except (RuntimeError,ValueError,OSError,subprocess.TimeoutExpired):
        return old_ok,(previous_version or "") if old_ok else ""
