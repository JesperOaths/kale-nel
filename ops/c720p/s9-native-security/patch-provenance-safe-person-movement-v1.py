#!/usr/bin/env python3
"""Expose ACTUALLY measured, camera-image-only S9 motion in People & Faces.

Never populates true 3D body posture, real walking speed, footstep cadence,
or any cross-video identity; the source currently measures none of these.
Backup+rollback and tests accompany any live C720P archive restart.
"""
import ast
from pathlib import Path
import datetime,json,os,subprocess,tempfile,urllib.request,time
BASE=Path("/home/jespern/c720p-home-hub")
TARGET=BASE/"bin/s9_person_folders_v31.py"
SERVICE="c720p-drive-security-archive.service"
MARKER="S9_PROVENANCE_SAFE_2D_MOVEMENT_DISPLAY_V1"
ANCHOR='            "upper_clothing_colour": track.get("upper_clothing_colour")'
INSERT='''            # S9_PROVENANCE_SAFE_2D_MOVEMENT_DISPLAY_V1: measured image
            # geometry only, not physical walking speed or a gait signature.
            "apparent_image_speed_body_heights_per_s": finite(
                track.get("image_speed_body_heights_per_second"), 0, 20),
            "image_path_straightness": finite(track.get("image_path_straightness"), 0, 1),
            "apparent_speed_measurement_scope": "camera_image_2d_not_walking_speed",
'''
def write(p,data):
 fd,t=tempfile.mkstemp(prefix=".s9-track-",dir=p.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(t,0o644);os.replace(t,p)
 finally:
  if os.path.exists(t):os.unlink(t)
def run(*a):
 p=subprocess.run(a,capture_output=True,text=True,timeout=35)
 if p.returncode:raise RuntimeError(str(a)+":"+p.stderr[-300:])
def test_function(src):
 tree=ast.parse(src)
 node=next(x for x in tree.body if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef)) and x.name=="metrics")
 code=compile(ast.Module(body=[node],type_ignores=[]),"<isolated-camera-metrics>","exec")
 # Test only metrics; do not execute module-level network/service setup.
 from math import isfinite
 def finite(v,lo,hi):
  try:
   x=float(v)
   return x if isfinite(x) and lo<=x<=hi else None
  except (TypeError,ValueError):return None
 scope={"finite":finite,"POSTURES":{"standing","sitting","crouching","unknown"},
        "COLOURS":{"uncertain","black","white","gray","blue","green","brown","red"}}
 exec(code,scope)
 got=scope["metrics"]({"image_speed_body_heights_per_second":.14,
   "image_path_straightness":.83,"image_movement_direction":"image_left",
   "upper_clothing_colour":"blue"})
 assert got["apparent_image_speed_body_heights_per_s"]==.14
 assert got["image_path_straightness"]==.83
 assert got["normalized_speed"] is None
 assert got["posture"] is None and got["cadence_hz"] is None
 assert got["apparent_speed_measurement_scope"]=="camera_image_2d_not_walking_speed"
 return got
def live():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/person-folders",timeout=35) as r:
  d=json.load(r)
 obs=d.get("unassigned",[])
 return {"total":len(obs),
   "image_speed_values":sum(x.get("metrics",{}).get("apparent_image_speed_body_heights_per_s") is not None for x in obs),
   "straightness_values":sum(x.get("metrics",{}).get("image_path_straightness") is not None for x in obs),
   "unsupported_posture":sum(x.get("metrics",{}).get("posture") is not None for x in obs)}
def main():
 old=TARGET.read_bytes();src=old.decode()
 if MARKER in src:
  print("S9_FACE_MOTION_MAPPER_ALREADY_INSTALLED",live());return
 if src.count(ANCHOR)!=1:raise RuntimeError("unexpected_live_mapper_source")
 new=src.replace(ANCHOR,INSERT+ANCHOR,1)
 compile(new,str(TARGET),"exec")
 test_function(new)
 before=live()
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 backup=BASE/"backups/s9-provenance-safe-image-motion"/stamp
 backup.mkdir(parents=True,exist_ok=True)
 (backup/TARGET.name).write_bytes(old)
 try:
  write(TARGET,new.encode())
  run("systemctl","--user","restart",SERVICE)
  last=None
  for i in range(12):
   try:last=live();break
   except Exception:time.sleep(1)
  if last is None:raise RuntimeError("people_and_faces_api_not_healthy")
  if last["total"]!=before["total"] or last["unsupported_posture"]!=0:
   raise RuntimeError("unexpected_identity_or_posture_regression")
  print("S9_PERSON_FOLDERS_MEASURED_2D_MOTION_LIVE",json.dumps({
   "before":before,"after":last,"backup":str(backup),
   "does_not_infer_identity_posture_or_gait":True},sort_keys=True))
 except BaseException:
  write(TARGET,old)
  try:run("systemctl","--user","restart",SERVICE)
  except Exception:pass
  raise
if __name__=="__main__":main()
