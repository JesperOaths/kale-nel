#!/usr/bin/env python3
"""S9 microSD security catalog. No Google Drive access or MP4 hub caching."""
import json,subprocess,os,re,datetime
from pathlib import Path
ADDR="192.168.178.250:5555"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9edge/files/SecurityClips"
ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
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
  stamp=datetime.datetime.fromtimestamp(int(name.split("_")[1].split(".")[0])/1000.0)
  rows.append({"name":name,"timestamp":stamp.strftime("%Y-%m-%d %H:%M"),"size":size,
    "drive_verified":False,"sd_verified":True,"sd_only":True,
    "scene_category":"unreviewed","person_count":0,"thumbnail":None,
    "resolution":"3840x2160","codec":"H.264","storage":"S9+ native 4K microSD"})
 except Exception as e:
  if type(e).__name__!="OSError":problems.append("native_4k:"+type(e).__name__)
 out={"storage_policy":"local_microSD","phone_recordings":sorted(rows,key=lambda r:r["timestamp"]),
      "total_phone_files":len(rows),"archived_total":len(rows),"errors":problems}
 dest=ROOT/"s9-phone-events.json"
 part=dest.with_suffix(".json.tmp");part.write_text(json.dumps(out,indent=2)+"\n");os.replace(part,dest)
 print("LOCAL_SD_INDEXED",len(rows),"errors",problems[:4])
if __name__=="__main__":main()
