#!/usr/bin/env python3
"""Read-only static health check for camera-owned light automations.

This is NOT a physical motion walk test; no camera images, HA API calls or
light commands are performed. Validate the deployed on-disk YAML ownership
guards and 5/10 minute timeout contracts before any offload release.
"""
import argparse
import json
from pathlib import Path

AUTOMATIONS=Path("/opt/homeassistant/config/automations.yaml")
BLOCKS=(
 ("living","- id: c720p_frontcam_motion_living_lamp_v1",
  "# END C720P_FRONTCAM_MOTION_LIVING_LAMP_V1",
  "input_boolean.c720p_living_camera_owned",'duration: "00:10:00"'),
 ("bedroom","- id: c720p_s3_bedroom_spots_v1",
  "# END C720P_S3_BEDROOM_SPOTS_V1",
  "input_boolean.c720p_s3_bedroom_camera_owned",'duration: "00:05:00"')
)

def segment(source,start,end):
    if source.count(start)!=1 or source.count(end)!=1:
        raise ValueError("camera_automation_markers_missing_or_duplicated")
    i=source.index(start);j=source.index(end,i)
    if i>=j:raise ValueError("camera_automation_reversed_markers")
    return source[i:j+len(end)]

def audit(source):
    checks={}
    for label,start,end,guard,duration in BLOCKS:
        block=segment(source,start,end)
        counts={"duration_count":block.count(duration),
                "manual_ownership_mentions":block.count(guard),
                "automation_blocks":source.count(start)}
        if counts["duration_count"]!=2:
            raise ValueError(label+"_timer_duration_not_expected")
        if counts["manual_ownership_mentions"]<1:
            raise ValueError(label+"_manual_ownership_missing")
        other='duration: "00:05:00"' if label=="living" else 'duration: "00:10:00"'
        if other in block:
            raise ValueError(label+"_unexpected_old_or_cross_room_timeout")
        checks[label]=counts
    return {"ok":True,"schema_version":"camera_light_static_contract_v1",
            "living_room_timeout_seconds":600,
            "bedroom_timeout_seconds":300,
            "manual_ownership_guard_names_present":True,
            "checks":checks,"static_config_only":True,
            "physical_walk_test_completed":False,
            "light_state_changed":False,"camera_frames_read":False}

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config",type=Path,default=AUTOMATIONS)
    args=ap.parse_args()
    result=audit(args.config.read_text())
    print("C720P_CAMERA_LIGHT_STATIC_AUDIT "+json.dumps(result,sort_keys=True),flush=True)

if __name__=="__main__":
    main()
