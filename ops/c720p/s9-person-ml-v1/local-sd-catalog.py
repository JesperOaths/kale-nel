#!/usr/bin/env python3
"""S9 microSD security catalog. No Google Drive access or MP4 hub caching."""
import json,subprocess,os,re,datetime
from pathlib import Path
ADDR="192.168.178.250:5555"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9edge/files/SecurityClips"
ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
# Metadata only. Preview image bytes stay exclusively on S9+ microSD.
PRIVATE_FALLBACK=Path("/home/jespern/c720p-home-hub/state/s9-fallback-evidence.json")
RE_PREVIEW=re.compile(r"^preview_motion_([0-9]{13})[.]jpg$")
NAMES=re.compile(r"^rec_20[0-9]{2}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}\.mp4$")
def adb(*args):
 p=subprocess.run(["adb","-s",ADDR,*args],capture_output=True,timeout=32)
 if p.returncode:raise OSError("phone_adb_offline")
 return p.stdout
def main():
 state=subprocess.run(["adb","-s",ADDR,"get-state"],capture_output=True,timeout=6)
 if state.returncode or state.stdout.strip()!=b"device":
  subprocess.run(["adb","connect",ADDR],capture_output=True,timeout=12)
 names=adb("shell","ls","-1",SD).decode().splitlines()
 rows=[];problems=[]
 for name in sorted(names,reverse=True):
  if not NAMES.fullmatch(name):continue
  try:
   b=adb("exec-out","cat",SD+"/"+name+".verified.json")
   if len(b)>14000:raise ValueError("manifest too large")
   m=json.loads(b)
   size=int(m.get("bytes",0))
   if m.get("name")!=name or size<10000 or not re.fullmatch("[a-f0-9]{64}",str(m.get("sha256",""))):raise ValueError("manifest")
   actual=int(adb("shell","stat","-c","%s",SD+"/"+name).strip())
   if actual!=size:raise ValueError("partial file")
   thumb=None
   try:
    img=adb("exec-out","cat",SD+"/"+name+".thumb.jpg")
    if img[:3]==bytes([255,216,255]) and 4000<len(img)<2200000:
     dest=ROOT/"s9-phone-thumbs"/(name+".thumb.jpg")
     dest.parent.mkdir(parents=True,exist_ok=True)
     if not dest.is_file() or dest.read_bytes()!=img:
      part=dest.with_suffix(".jpg.tmp")
      part.write_bytes(img);os.replace(part,dest)
     thumb="s9-phone-thumbs/"+dest.name
   except Exception:pass
   group=m.get("content_group")
   if group not in ("one_person","multiple_people"):group="unreviewed"
   dt=datetime.datetime.strptime(name[4:-4],"%Y-%m-%d_%H-%M")
   rows.append({"name":name,"timestamp":dt.strftime("%Y-%m-%d %H:%M"),"size":size,
     "drive_verified":False,"sd_verified":True,"sd_only":True,
     "scene_category":group,"person_count":m.get("ai_person_count_at_trigger",0),
     "thumbnail":thumb})
  except Exception as e:problems.append(name+":"+type(e).__name__)
 # Include only native 4K recordings whose S9-generated SHA-256 evidence matches.
 native="/storage/9C33-6BBD/Android/data/nl.kalenel.s9nativefourk/files/Native4K"
 try:
  m=json.loads(adb("exec-out","cat",native+"/native4k-test-result.json"))
  name=str(m.get("file") or "")
  if m.get("status")!="VERIFIED_4K" or not re.fullmatch(r"native4k_[0-9]{13}[.]mp4",name):
   raise ValueError("native_4k_verification_missing")
  if int(m.get("width",0))!=3840 or int(m.get("height",0))!=2160 or int(m.get("duration_ms",0))<3000:
   raise ValueError("native_4k_metrics_invalid")
  size=int(m.get("bytes",0));sha=str(m.get("sha256") or "").lower()
  if not 100000<size<350000000 or not re.fullmatch(r"[0-9a-f]{64}",sha):
   raise ValueError("native_4k_hash_invalid")
  actual=int(adb("shell","stat","-c","%s",native+"/"+name).strip())
  if actual!=size:raise ValueError("native_4k_size_mismatch")
  digest=adb("shell","sha256sum",native+"/"+name).decode().split()[0].lower()
  if sha!=digest:raise ValueError("native_4k_sha256_mismatch")
  thumb=None
  try:
   img=adb("exec-out","cat",native+"/"+name+".thumb.jpg")
   if img[:3]==bytes([255,216,255]) and 4000<len(img)<2200000:
    dest=ROOT/"s9-phone-thumbs"/(name+".thumb.jpg")
    dest.parent.mkdir(parents=True,exist_ok=True)
    if not dest.is_file() or dest.read_bytes()!=img:
     part=dest.with_suffix(".jpg.tmp")
     part.write_bytes(img);os.replace(part,dest)
    thumb="s9-phone-thumbs/"+dest.name
  except Exception:pass
  stamp=datetime.datetime.fromtimestamp(int(name.split("_")[1].split(".")[0])/1000.0)
  rows.append({"name":name,"timestamp":stamp.strftime("%Y-%m-%d %H:%M"),"size":size,
    "drive_verified":False,"sd_verified":True,"sd_only":True,
    "scene_category":"unreviewed","person_count":0,"thumbnail":thumb,
    "resolution":"3840x2160","codec":"H.264","storage":"S9+ native 4K microSD"})
 except Exception as e:
  if type(e).__name__!="OSError":problems.append("native_4k:"+type(e).__name__)
 # Standalone Camera2 motion-triggered 4K recordings, independently classified on S9.
 native_security="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
 try:
  recorded=adb("shell","ls","-1",native_security).decode().splitlines()
  native_listing_ok=True
 except Exception:
  recorded=[]
  native_listing_ok=False
 for name in recorded:
  if not re.fullmatch(r"motion_[0-9]{13}[.]mp4",name):continue
  try:
   m=json.loads(adb("exec-out","cat",native_security+"/"+name+".verified.json"))
   size=int(m.get("bytes",0));digest=str(m.get("sha256","")).lower()
   if m.get("name")!=name or not re.fullmatch(r"[a-f0-9]{64}",digest) or not 100000<size<800000000:
    raise ValueError("security_manifest_invalid")
   if int(m.get("width",0))!=3840 or int(m.get("height",0))!=2160:
    raise ValueError("not_verified_2160p")
   actual=int(adb("shell","stat","-c","%s",native_security+"/"+name).strip())
   if size!=actual:raise ValueError("incomplete_sd_mp4")
   group=str(m.get("scene_category","motion_other"))
   if group not in ("one_person","multiple_people","motion_other"):
    group="unreviewed"
   thumb=None
   try:
    raw=adb("exec-out","cat",native_security+"/"+name+".thumb.jpg")
    if 4000<len(raw)<2200000 and raw[:3]==bytes([255,216,255]):
     dest=ROOT/"s9-phone-thumbs"/(name+".thumb.jpg")
     dest.parent.mkdir(parents=True,exist_ok=True)
     if not dest.is_file() or dest.read_bytes()!=raw:
      t=dest.with_suffix(".jpg.partial");t.write_bytes(raw);os.replace(t,dest)
     thumb="s9-phone-thumbs/"+dest.name
   except Exception:pass
   when=datetime.datetime.fromtimestamp(int(name.split("_")[1].split(".")[0])/1000.0)
   rows.append({"name":name,"timestamp":when.strftime("%Y-%m-%d %H:%M"),
     "size":size,"drive_verified":False,"sd_verified":True,"sd_only":True,
     "scene_category":group,"person_count":int(m.get("person_count",0)),
     "thumbnail":thumb,"resolution":"3840x2160","codec":"H.264",
     "content_categories":m.get("categories",[]),
     "storage":"S9 native 4K Security microSD"})
  except Exception as error:problems.append(name+":"+type(error).__name__)

 # Still-image evidence from a motion event when a full 4K clip was blocked.
 # Never call these frames "video" or infer that a person is present.
 # Do not mirror JPEG bytes to the hub: the secure media proxy reads microSD.
 if native_listing_ok:
  previews=[]
  for name in sorted(recorded,reverse=True):
   match=RE_PREVIEW.fullmatch(name)
   if not match:continue
   if len(previews)>=250:break
   try:
    stamp=int(match.group(1))
    sidecar=adb("exec-out","cat",native_security+"/"+name+".json")
    if not 30<len(sidecar)<4096:raise ValueError("preview_sidecar_size")
    m=json.loads(sidecar)
    if m.get("name")!=name or m.get("kind")!="preview_only_motion_evidence":
     raise ValueError("preview_manifest_kind")
    if m.get("archive")!="S9_microSD_only" or m.get("person_identity")!="not_evaluated":
     raise ValueError("preview_not_sd_only")
    if int(m.get("width",0))!=640 or int(m.get("height",0))!=480:
     raise ValueError("preview_dimensions")
    if abs(int(m.get("captured_at_ms",0))-stamp)>1500:
     raise ValueError("preview_timestamp")
    size=int(adb("shell","stat","-c","%s",native_security+"/"+name).strip())
    if not 3000<size<2500000:raise ValueError("preview_size")
    # Digest is calculated on the phone, avoiding a second permanent copy.
    checksum=adb("shell","sha256sum",native_security+"/"+name).decode().split()[0].lower()
    if not re.fullmatch(r"[0-9a-f]{64}",checksum):raise ValueError("preview_sha256")
    reason=str(m.get("reason") or "motion_event")
    if reason not in ("recording_budget_rejected","cooldown_motion",
                       "thermal_or_space_guard","recording_safety_guard"):
     reason="motion_event"
    when=datetime.datetime.fromtimestamp(stamp/1000)
    previews.append({"name":name,"kind":"preview_only_motion_evidence",
       "timestamp":when.strftime("%Y-%m-%d %H:%M:%S"),
       "captured_at_ms":stamp,"reason":reason,"size":size,"sha256":checksum,
       "sd_verified":True,"sd_only":True,"width":640,"height":480,
       "person_status":"not_evaluated","scene_category":"preview_only"})
   except Exception as e:
    problems.append("preview:"+name+":"+type(e).__name__)
  PRIVATE_FALLBACK.parent.mkdir(parents=True,exist_ok=True)
  preview_index={"archive_mode":"S9-microSD-only","kind":"fallback_previews",
                 "count":len(previews),"previews":previews}
  tmp=PRIVATE_FALLBACK.with_suffix(".json.tmp")
  tmp.write_text(json.dumps(preview_index,separators=(",",":"))+"\n")
  os.chmod(tmp,0o600)
  os.replace(tmp,PRIVATE_FALLBACK)
 out={"storage_policy":"local_microSD","phone_recordings":sorted(rows,key=lambda r:r["timestamp"]),
      "total_phone_files":len(rows),"archived_total":len(rows),"errors":problems}
 dest=ROOT/"s9-phone-events.json"
 part=dest.with_suffix(".json.tmp");part.write_text(json.dumps(out,indent=2)+"\n");os.replace(part,dest)
 print("LOCAL_SD_INDEXED",len(rows),"errors",problems[:4])
if __name__=="__main__":main()
