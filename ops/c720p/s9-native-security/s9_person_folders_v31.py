"""Private, reversible person-folder references for verified S9+ recordings.

The phone owns face inference. This module never reads media or embeddings. A
folder is a reviewed collection of clip/track references; sampled posture,
motion and clothing can suggest a review but cannot establish an identity.
Only human-confirmed observations become matching anchors. Tentative matches
never update profiles, so one bad suggestion cannot propagate through history.
"""
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import threading
from urllib.parse import urlsplit

VERSION = "s9_person_folders_v31"
BASE = Path("/home/jespern/c720p-home-hub")
STORE = BASE / "state/s9-person-folders-v31.json"
AUDIT = BASE / "state/s9-person-folders-v31-audit.jsonl"
LOCK = threading.RLock()
CLIP = re.compile(r"motion_[0-9]{13}[.]mp4\Z")
KEY = re.compile(r"(motion_[0-9]{13}[.]mp4):track:([1-9]|[1-5][0-9]|6[0-4])\Z")
PROFILE = re.compile(r"PER-[0-9]{4,6}\Z")
ALIAS = re.compile(r"(?:unknown_[0-9]{5}|known_candidate_[A-Za-z0-9_.-]{1,56})\Z")
EPOCH = re.compile(r"[a-f0-9]{12,64}\Z")
CROP = re.compile(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg\Z")
COLOURS = {"black", "white", "gray", "red", "orange", "yellow", "green", "blue",
           "purple_or_pink", "brown", "uncertain"}
POSTURES = {"upright", "leaning", "crouched", "seated", "lying", "bending", "unknown",
            "projected_upright", "projected_leaning", "projected_bent_knees", "projected_horizontal"}
ORIGINS = {"http://" + host + ":8123" for host in
           ("192.168.178.141", "jesper-hub", "jesper-hub.local", "localhost", "127.0.0.1")}
_source_rows = lambda: {}


def finite(value, lower, upper):
    return (round(float(value), 4) if type(value) in (int, float) and
            math.isfinite(value) and lower <= value <= upper else None)


def display_name(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not 1 <= len(value) <= 56 or any(not c.isprintable() or c in "<>" for c in value):
        return None
    return value


def initial_registry():
    return {"version": VERSION, "next_id": 1, "profiles": {}, "links": {}, "rejections": {}}


def registry():
    """Fail closed on corrupt persisted state instead of overwriting reviewed links."""
    if not STORE.exists():
        return initial_registry()
    try:
        if STORE.stat().st_size > 16000000:
            return None
        data = json.loads(STORE.read_text(encoding="utf-8"))
        if (not isinstance(data, dict) or data.get("version") != VERSION or
                type(data.get("next_id")) is not int or not 1 <= data["next_id"] <= 1000000):
            return None
        if any(not isinstance(data.get(k), dict) for k in ("profiles", "links", "rejections")):
            return None
        if len(data["profiles"]) > 10000 or len(data["links"]) > 100000 or len(data["rejections"]) > 100000:
            return None
        for pid, profile in data["profiles"].items():
            if not PROFILE.fullmatch(pid) or not isinstance(profile, dict) or not display_name(profile.get("name")):
                return None
        for key, link in data["links"].items():
            if (not KEY.fullmatch(key) or not isinstance(link, dict) or
                    link.get("profile_id") not in data["profiles"] or
                    not isinstance(link.get("signature"), str) or
                    not re.fullmatch(r"[a-f0-9]{64}", link["signature"])):
                return None
        for key, rejections in data["rejections"].items():
            if (not KEY.fullmatch(key) or not isinstance(rejections, list) or len(rejections) > 10000 or
                    any(pid not in data["profiles"] for pid in rejections)):
                return None
        return data
    except (OSError, ValueError, TypeError):
        return None


def atomic_save(data):
    STORE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as out:
        json.dump(data, out, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
        out.write("\n")
        out.flush()
        os.fsync(out.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, STORE)


def audit_line(entry):
    AUDIT.parent.mkdir(parents=True, exist_ok=True)
    with AUDIT.open("a", encoding="utf-8") as out:
        out.write(json.dumps(entry, separators=(",", ":"), sort_keys=True, ensure_ascii=False) + "\n")
        out.flush()
        os.fsync(out.fileno())
    os.chmod(AUDIT, 0o600)


def metrics(track):
    """Whitelisted summaries only; an absent measurement stays unknown."""
    pose = track.get("pose_metrics")
    if not isinstance(pose, dict):
        pose = track
    label = pose.get("posture_label", pose.get("body_posture_label", pose.get("posture")))
    posture = label if label in POSTURES else None
    confidence = finite(pose.get("mean_confidence", pose.get("posture_confidence")), 0, 1)
    observations = pose.get("torso_samples", pose.get("pose_observations", pose.get("pose_sample_count")))
    if type(observations) is not int or not 0 <= observations <= 512:
        observations = None
    speed = finite(pose.get("apparent_speed_body_heights_per_second", pose.get("movement_speed_body_lengths_per_second",
                            pose.get("normalized_movement_speed"))), 0, 20)
    cadence = finite(pose.get("gait_cadence_hz", pose.get("cadence_hz")), .2, 5)
    cadence_status = pose.get("gait_cadence_status", track.get("gait_cadence_status"))
    if pose.get("version") == "projected_pose_motion_v1":
        if pose.get("posture_availability") != "available":
            posture = None
        cadence = finite(pose.get("cadence_steps_per_minute"), 12, 300)
        cadence = cadence / 60 if cadence is not None else None
        cadence_status = ("measured_dense_pose_sequence" if pose.get("gait_availability") ==
                          "available_projected_ankle_cycle" else "unknown")
    if cadence_status not in ("measured_dense_pose_sequence", "dense_pose_sequence_measured"):
        cadence = None
    return {"posture": posture if confidence is not None and confidence >= .5 else None,
            "posture_confidence": confidence, "pose_observations": observations,
            "normalized_speed": speed, "cadence_hz": cadence,
            "cadence_status": "measured_dense_pose_sequence" if cadence is not None else "unknown",
            "upper_clothing_colour": track.get("upper_clothing_colour")
            if track.get("upper_clothing_colour") in COLOURS else "uncertain",
            "image_movement_direction": track.get("image_movement_direction")
            if track.get("image_movement_direction") in
            {"image_left", "image_right", "image_up", "image_down", "diagonal", "stationary_or_uncertain"}
            else None}


def observations(source=None):
    """Read only the already verified catalog; never infer a clip-wide person ID."""
    result = {}
    try:
        rows = _source_rows() if source is None else source
    except (OSError, ValueError, TypeError):
        return result
    if not isinstance(rows, dict):
        return result
    for name, row in rows.items():
        if not isinstance(name, str) or not CLIP.fullmatch(name) or not isinstance(row, dict) or row.get("sd_verified") is not True:
            continue
        duration = row.get("duration_ms")
        tracks = row.get("anonymous_tracks")
        if (type(duration) is not int or not 0 < duration <= 120000 or
                row.get("anonymous_tracking_status") != "sampled_tracks_available" or
                not isinstance(tracks, list) or len(tracks) > 64):
            continue
        valid = []
        seen = set()
        for track in tracks:
            if not isinstance(track, dict):
                continue
            idx = track.get("temporary_track_id")
            first, last = track.get("first_sample_ms"), track.get("last_sample_ms")
            samples, peak = track.get("sample_count"), track.get("peak_detection_score")
            if (type(idx) is not int or not 1 <= idx <= 64 or idx in seen or track.get("id") != f"Person {idx}" or
                    type(first) is not int or type(last) is not int or not 0 <= first <= last <= duration + 100 or
                    type(samples) is not int or not 1 <= samples <= 512 or finite(peak, .5, 1) is None):
                continue
            seen.add(idx)
            signature = hashlib.sha256(json.dumps([name, idx, first, last, samples], separators=(",", ":")).encode()).hexdigest()
            valid.append({"observation_key": f"{name}:track:{idx}", "clip_no": name,
                          "track_id": idx, "track_label": track["id"], "first_sample_ms": first,
                          "last_sample_ms": last, "sample_count": samples, "peak_detection_score": finite(peak, .5, 1),
                          "duration_ms": duration, "timestamp": row.get("timestamp"), "signature": signature,
                          "metrics": metrics(track), "face_evidence": [],
                          "recorded_at_ms": int(name[7:20]),
                          "appearance_vector": track.get("appearance_vector", row.get("appearance_vector") if len(tracks) == 1 else None)})
        faces = row.get("face_candidates")
        if isinstance(faces, list) and len(faces) <= 8:
            for face in faces:
                if not isinstance(face, dict):
                    continue
                ms = face.get("time_ms")
                if type(ms) is not int or not 0 <= ms <= duration:
                    continue
                track_id = face.get("temporary_track_id")
                candidates = [t for t in valid if t["first_sample_ms"] - 250 <= ms <= t["last_sample_ms"] + 250]
                if type(track_id) is int:
                    candidates = [t for t in candidates if t["track_id"] == track_id]
                # A group frame must have an explicit face-to-track association.
                if len(candidates) != 1:
                    continue
                snapshot = face.get("snapshot_name")
                if not (isinstance(snapshot, str) and CROP.fullmatch(snapshot) and
                        snapshot.startswith(name[:-4] + "__") and face.get("snapshot_on_s9") is True):
                    snapshot = None
                alias = face.get("person_id")
                status = face.get("match_status")
                similarity = finite(face.get("cosine_similarity"), -1, 1)
                support = (row.get("face_review_status") == "review_complete_unverified_matches" and
                           isinstance(alias, str) and ALIAS.fullmatch(alias) and
                           (status == "new_anonymous_candidate" or
                            status == "anonymous_similarity_unverified" and similarity is not None and similarity >= .88 or
                            status == "reference_similarity_unverified" and similarity is not None and similarity >= .84))
                epoch = face.get("face_gallery_epoch", row.get("face_gallery_epoch"))
                candidates[0]["face_evidence"].append({"person_id": alias if support else None,
                                                       "match_status": status if support else "crop_only_no_identity_match",
                                                       "time_ms": ms, "cosine_similarity": similarity if support else None,
                                                       "snapshot_name": snapshot, "snapshot_on_s9": snapshot is not None,
                                                       "face_gallery_epoch": epoch if isinstance(epoch, str) and EPOCH.fullmatch(epoch) else None})
        for track in valid:
            result[track["observation_key"]] = track
    return result


def aliases(observation):
    return {(f["person_id"], f["face_gallery_epoch"]) for f in observation["face_evidence"] if f["person_id"]}


def overlaps(first, second):
    return (first["clip_no"] == second["clip_no"] and first["track_id"] != second["track_id"] and
            max(first["first_sample_ms"], second["first_sample_ms"]) <= min(first["last_sample_ms"], second["last_sample_ms"]))


def compare(first, second):
    """Independent evidence, never a probability of being the same person."""
    if first["observation_key"] == second["observation_key"] or overlaps(first, second):
        return None
    common = {pair for pair in aliases(first) & aliases(second) if pair[1] is not None}
    face = bool(common)
    reasons = []
    if face:
        reasons.append({"metric": "face", "reason": "same_on_phone_face_alias",
                        "gallery_epoch_known": all(epoch is not None for _, epoch in common),
                        "strength": "face_supported_unverified"})
    a, b = first["metrics"], second["metrics"]
    recent = abs(first["recorded_at_ms"] - second["recorded_at_ms"]) <= 12 * 3600000
    weak = 0
    if recent and a["upper_clothing_colour"] != "uncertain" and a["upper_clothing_colour"] == b["upper_clothing_colour"]:
        weak += 1
        reasons.append({"metric": "clothing", "reason": "same_upper_clothing_colour_within_12h", "strength": "weak"})
    # Reuse the existing histogram comparison; do not expose its raw vectors.
    if recent and first.get("appearance_vector") is not None and second.get("appearance_vector") is not None:
        try:
            import s9_appearance_review
            score = s9_appearance_review.compare(first["appearance_vector"], second["appearance_vector"])
        except (ImportError, TypeError, ValueError):
            score = None
        if score is not None and score >= .955:
            reasons.append({"metric": "outfit", "reason": "similar_clothing_histogram_within_12h", "strength": "weak"})
            weak = max(weak, 1)  # colour and histogram are the same evidence family
    pose_ready = (a["pose_observations"] is not None and b["pose_observations"] is not None and
                  a["pose_observations"] >= 3 and b["pose_observations"] >= 3)
    if (recent and pose_ready and a["posture"] not in (None, "unknown") and a["posture"] == b["posture"] and
            min(a["posture_confidence"] or 0, b["posture_confidence"] or 0) >= .65):
        weak += 1
        reasons.append({"metric": "posture", "reason": "similar_measured_posture", "strength": "weak"})
    if (recent and pose_ready and a["normalized_speed"] is not None and b["normalized_speed"] is not None and
            min(a["normalized_speed"], b["normalized_speed"]) >= .05 and
            abs(a["normalized_speed"] - b["normalized_speed"]) <= max(.12, .25 * max(a["normalized_speed"], b["normalized_speed"]))):
        weak += 1
        reasons.append({"metric": "movement", "reason": "similar_measured_normalized_speed", "strength": "weak"})
    if (pose_ready and a["cadence_hz"] is not None and b["cadence_hz"] is not None and
            abs(a["cadence_hz"] - b["cadence_hz"]) <= .15):
        weak += 1
        reasons.append({"metric": "cadence", "reason": "similar_dense_sequence_cadence", "strength": "weak"})
    if not face and weak < 2:
        return None
    return {"strength": "face_supported_unverified" if face else "appearance_motion_review_only",
            "evidence": reasons, "rank": (10 if face else 0) + min(weak, 4),
            "human_review_required": True, "confirmed_identity": False}


def public_observation(obs, data):
    link = data["links"].get(obs["observation_key"])
    active = bool(link and link["signature"] == obs["signature"])
    return {k: obs[k] for k in ("observation_key", "clip_no", "track_id", "track_label", "first_sample_ms",
                                "last_sample_ms", "sample_count", "peak_detection_score", "duration_ms", "timestamp",
                                "metrics", "face_evidence")} | {
        "profile_id": link["profile_id"] if link else None,
        "association_status": "human_confirmed" if active else "source_changed_needs_review" if link else "unreviewed",
        "identity_verified_by_model": False}


def report(source=None):
    with LOCK:
        data = registry()
        if data is None:
            return {"ok": False, "error": "person_registry_invalid_requires_recovery", "version": VERSION}
        obs = observations(source)
        anchors = {}
        for key, link in data["links"].items():
            if key in obs and link["signature"] == obs[key]["signature"]:
                anchors.setdefault(link["profile_id"], []).append(obs[key])
        profiles = []
        for pid, profile in data["profiles"].items():
            keys = [key for key, link in data["links"].items() if link["profile_id"] == pid]
            present = [public_observation(obs[key], data) for key in keys if key in obs]
            present.sort(key=lambda x: x["clip_no"], reverse=True)
            profiles.append({"profile_id": pid, "name": profile["name"], "created_at": profile.get("created_at"),
                             "observations": present, "recording_count": len({o["clip_no"] for o in present}),
                             "confirmed_appearance_count": len(anchors.get(pid, [])),
                             "unavailable_reference_count": sum(key not in obs for key in keys),
                             "needs_review_count": sum(o["association_status"] != "human_confirmed" for o in present),
                             "association_method": "human_reviewed_references"})
        suggestions = []
        for key, current in obs.items():
            if key in data["links"] and data["links"][key]["signature"] == current["signature"]:
                continue
            possible = []
            for pid, confirmed in anchors.items():
                if pid in data["rejections"].get(key, []) or any(overlaps(current, other) for other in confirmed):
                    continue
                evidence = [(compare(current, other), other) for other in confirmed]
                evidence = [(c, o) for c, o in evidence if c]
                if not evidence:
                    continue
                best, anchor = max(evidence, key=lambda pair: pair[0]["rank"])
                possible.append({"profile_id": pid, "profile_name": data["profiles"][pid]["name"],
                                 "anchor_observation_key": anchor["observation_key"], **best})
            possible.sort(key=lambda row: (-row["rank"], row["profile_id"]))
            ambiguous = len(possible) > 1 and possible[0]["rank"] - possible[1]["rank"] < 2
            for candidate in possible[:3]:
                candidate.pop("rank")
                candidate["ambiguous"] = ambiguous
                suggestions.append({"observation_key": key, **candidate})
        # Alias folders are provisional. No automatic mutation or transitive clustering.
        buckets = {}
        for key, current in obs.items():
            if key in data["links"] and data["links"][key]["signature"] == current["signature"]:
                continue
            face_aliases = aliases(current)
            if len(face_aliases) != 1:
                continue
            alias, epoch = next(iter(face_aliases))
            # Older aliases without an index epoch cannot join recordings.
            token = (alias, epoch, None if epoch is not None else key)
            buckets.setdefault(token, []).append(current)
        candidates = []
        for (alias, epoch, recording_scope), entries in buckets.items():
            collisions = any(overlaps(a, b) for i, a in enumerate(entries) for b in entries[i + 1:])
            candidates.append({"candidate_id": "CAND-" + hashlib.sha256((alias + "\0" + str(epoch) + "\0" + str(recording_scope)).encode()).hexdigest()[:12],
                               "face_alias": alias, "face_gallery_epoch_known": epoch is not None,
                               "association_status": "ambiguous_face_alias" if collisions else "face_supported_unverified",
                               "human_review_required": True, "confirmed_identity": False,
                               "observations": [public_observation(o, data) for o in entries],
                               "recording_count": len({o["clip_no"] for o in entries})})
        linked = {k for k, link in data["links"].items() if k in obs and link["signature"] == obs[k]["signature"]}
        return {"ok": True, "version": VERSION, "scope": "verified_s9_microSD_recordings",
                "media_unchanged": True, "automatic_identity": "review_suggestions_only",
                "legacy_visitor_review_route": "/new/api/drive-person-review",
                "profiles": sorted(profiles, key=lambda p: p["profile_id"]),
                "candidates": sorted(candidates, key=lambda p: p["candidate_id"]),
                "suggestions": suggestions,
                "unassigned": [public_observation(o, data) for k, o in obs.items() if k not in linked],
                "summary": {"profiles": len(profiles), "recorded_appearances": len(obs),
                            "confirmed_appearances": len(linked), "unassigned_appearances": len(obs) - len(linked),
                            "face_supported_candidates": len(candidates), "review_suggestions": len(suggestions)}}


def review(action, observation_key, profile_id, name, human_confirmed):
    if action not in ("create", "link", "unlink", "reject", "rename"):
        return 400, {"ok": False, "error": "invalid_action"}
    if action != "rename" and (not isinstance(observation_key, str) or not KEY.fullmatch(observation_key)):
        return 400, {"ok": False, "error": "invalid_observation_key"}
    if action == "rename" and observation_key is not None:
        return 400, {"ok": False, "error": "unexpected_observation_key"}
    if action in ("link", "reject", "rename"):
        if not isinstance(profile_id, str) or not PROFILE.fullmatch(profile_id):
            return 400, {"ok": False, "error": "invalid_profile_id"}
    elif profile_id is not None:
        return 400, {"ok": False, "error": "unexpected_profile_id"}
    if action in ("create", "rename"):
        name = display_name(name)
        if name is None:
            return 400, {"ok": False, "error": "invalid_display_name"}
    elif name is not None:
        return 400, {"ok": False, "error": "unexpected_name"}
    if human_confirmed is not True:
        return 400, {"ok": False, "error": "explicit_human_review_required"}
    with LOCK:
        before = registry()
        if before is None:
            return 503, {"ok": False, "error": "person_registry_invalid_requires_recovery"}
        current = observations()
        if action != "rename" and observation_key not in current:
            return 404, {"ok": False, "error": "verified_track_not_found"}
        if profile_id is not None and profile_id not in before["profiles"]:
            return 404, {"ok": False, "error": "profile_not_found"}
        data = json.loads(json.dumps(before))
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        old = data["links"].get(observation_key)
        if action in ("create", "link"):
            if action == "create":
                next_id = data["next_id"]
                if next_id > 999999 or len(data["profiles"]) >= 10000:
                    return 503, {"ok": False, "error": "profile_registry_full"}
                profile_id = f"PER-{next_id:04d}"
                data["next_id"] += 1
                data["profiles"][profile_id] = {"name": name, "created_at": now}
            else:
                for key, link in data["links"].items():
                    if (key != observation_key and link["profile_id"] == profile_id and key in current and
                            link["signature"] == current[key]["signature"] and overlaps(current[observation_key], current[key])):
                        return 409, {"ok": False, "error": "overlapping_tracks_cannot_share_person_folder"}
            data["links"][observation_key] = {"profile_id": profile_id, "signature": current[observation_key]["signature"],
                                              "confirmed_at": now}
            rejected = data["rejections"].get(observation_key, [])
            if profile_id in rejected:
                rejected.remove(profile_id)
        elif action == "rename":
            data["profiles"][profile_id]["name"] = name
            data["profiles"][profile_id]["updated_at"] = now
        elif action == "unlink":
            data["links"].pop(observation_key, None)
        else:
            rejected = data["rejections"].setdefault(observation_key, [])
            if profile_id not in rejected:
                rejected.append(profile_id)
            if old and old["profile_id"] == profile_id:
                data["links"].pop(observation_key, None)
        if len(data["links"]) > 100000 or len(data["rejections"]) > 100000:
            return 503, {"ok": False, "error": "person_registry_full"}
        try:
            atomic_save(data)
            audit_line({"utc": now, "action": action, "observation_key": observation_key,
                        "previous_profile_id": old["profile_id"] if old else None,
                        "profile_id": profile_id, "human_confirmed": True})
        except OSError:
            try:
                atomic_save(before)
            except OSError:
                pass
            return 503, {"ok": False, "error": "person_registry_write_failed"}
        return 200, {"ok": True, "version": VERSION, "observation_key": observation_key,
                     "profile_id": data["links"].get(observation_key, {}).get("profile_id") if action != "rename" else profile_id,
                     "media_unchanged": True}


def install(handler_class, source_rows):
    """Install behind the existing authenticated relay, with no public new route."""
    global _source_rows
    _source_rows = source_rows
    old_get, old_post = handler_class.go, handler_class.do_POST
    route, write_route = "/new/api/person-folders", "/new/api/person-folders/review"

    def get(self):
        if urlsplit(self.path).path == route:
            data = report()
            self.js(200 if data["ok"] else 503, data)
            return
        return old_get(self)

    def post(self):
        if urlsplit(self.path).path != write_route:
            return old_post(self)
        if self.headers.get("X-S9-Person-Folder-Intent") != "explicit-review-v31":
            self.js(403, {"ok": False, "error": "explicit_intent_required"})
            return
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            self.js(415, {"ok": False, "error": "json_content_type_required"})
            return
        origin = self.headers.get("Origin", "").strip()
        if origin and origin not in ORIGINS:
            self.js(403, {"ok": False, "error": "cross_origin_write_disallowed"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 2 <= length <= 1200:
                raise ValueError("size")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or set(body) != {"action", "observation_key", "profile_id", "name", "human_confirmed"}:
                raise ValueError("shape")
        except (ValueError, TypeError, UnicodeError):
            self.js(400, {"ok": False, "error": "invalid_request_json"})
            return
        self.js(*review(**body))

    handler_class.go, handler_class.do_POST = get, post
