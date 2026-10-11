#!/usr/bin/env python3
"""Permanently reclaim S9+ space from QUARANTINED, twice-model-negative clips.

Never touches the live Security4K directory, unreviewed footage, or clips with
even weak person evidence. A negative model classification is not proof that
no person was present. Requires explicit --apply; always writes an audit log.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import time

PHONE='192.168.178.250:5555'
BASE='/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files'
Q=BASE+'/Security4K_quarantine_garden_review/'
OUT=Path('/home/jespern/c720p-home-hub/state/s9-permanent-empty-clip-purge')
FILE=re.compile(r'motion_[0-9]{13}[.]mp4\Z')
SHA=re.compile(r'[0-9a-f]{64}\Z')
SUFFIX=('.garden-retention.json','.verified.json','.thumb.jpg')
MIN_AGE=6*3600*1000

def adb(*args,timeout=28):
 p=subprocess.run(['adb','-s',PHONE,*args],capture_output=True,timeout=timeout)
 if p.returncode:
  raise RuntimeError('adb_failed:'+p.stderr[:150].decode('utf-8','replace'))
 return p.stdout

def read_json(path):
 data=adb('exec-out','cat',path)
 if len(data)<10 or len(data)>260000:raise ValueError('manifest_size_invalid')
 return json.loads(data.decode('utf-8'))

def evaluate(name,now):
 if not FILE.fullmatch(name):return None
 stamp=int(name[7:20])
 record={'clip':name,'status':'protected','reason':'uninspected','bytes':0}
 if stamp>now-MIN_AGE:
  record['reason']='too_recent';return record
 try:
  m=read_json(Q+name+'.verified.json')
  e=read_json(Q+name+'.garden-retention.json')
  size=int(adb('shell','stat','-c','%s',Q+name).strip())
  record['bytes']=size
  if m.get('name')!=name or m.get('archive')!='S9_microSD_only' or m.get('bytes')!=size:
   raise ValueError('original_manifest_mismatch')
  if not SHA.fullmatch(str(m.get('sha256',''))):
   raise ValueError('original_digest_absent')
  if m.get('sampled_frame_count',0)<6:raise ValueError('insufficient_original_frames')
  if type(m.get('person_count')) is not int or m['person_count']!=0:raise ValueError('person_count_evidence')
  if type(m.get('person_frames_at_050')) is not int or m['person_frames_at_050']!=0:
   raise ValueError('strong_person_frame_evidence')
  # Permit only very sparse sub-threshold original suggestions, and
  # only because an independent 20+ frame pass below finds NO person at .30.
  # More persistent weak evidence remains protected.
  weak=m.get('possible_person_frames_at_030')
  if (type(weak) is not int or weak<0 or weak>2 or
      weak>int(m['sampled_frame_count'])/4):
   raise ValueError('persistent_weak_person_evidence')
  kind=str(m.get('person_event_category',''))
  if kind not in ('no_person_model_detection','possible_person_below_standard_threshold'):
   raise ValueError('uncertain_person_event_category')
  if int(m.get('face_snapshots_saved') or 0)>0 or m.get('face_candidates'):
   raise ValueError('face_candidate_evidence')
  if e.get('source_name')!=name or e.get('source_size_bytes')!=size:
   raise ValueError('retention_source_mismatch')
  if e.get('outcome')!='quarantined_model_negative_not_deleted':
   raise ValueError('not_quarantined_model_negative')
  if e.get('decision')!='no_garden_person_evidence' or e.get('human_verified') is True:
   raise ValueError('retention_evidence_not_negative')
  if type(e.get('valid_frames')) is not int or e['valid_frames']<20:
   raise ValueError('insufficient_secondary_frames')
  if e.get('garden_person_frames_at_030')!=0 or e.get('any_person_frames_at_030')!=0:
   raise ValueError('secondary_person_evidence')
  if float(e.get('peak_garden_person_score',1))>=0.3:
   raise ValueError('secondary_weak_person_evidence')
  record.update(status='eligible',reason='no_person_evidence_in_original_and_20_plus_secondary_frames')
 except Exception as ex:
  record['reason']=str(ex)[:90]
 return record

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--apply',action='store_true')
 parser.add_argument('--max-clips',type=int,default=100)
 args=parser.parse_args()
 if not 1<=args.max_clips<=100:raise ValueError('max_clips_must_be_1_to_100')
 names=adb('shell','ls','-1',Q).decode('utf-8','replace').splitlines()
 if len(names)>4000:raise RuntimeError('unexpected_quarantine_listing')
 now=int(time.time()*1000)
 candidates=[n for n in names if FILE.fullmatch(n)]
 records=[]
 freed=0
 for name in candidates:
  if len(records)>=args.max_clips:break
  r=evaluate(name,now)
  if r is None:continue
  if args.apply and r['status']=='eligible':
   # Recheck all original and 24-frame conditions immediately before purge.
   verify=evaluate(name,int(time.time()*1000))
   if verify is None or verify['status']!='eligible' or verify['bytes']!=r['bytes']:
    r.update(status='protected',reason='second_predelete_check_failed')
   else:
    # Absolute, generated basename; never wildcard, recurse, or touch live.
    adb('shell','rm','-f',Q+name)
    adb('shell','sh','-c','test ! -e "$1"','_',Q+name)
    for suffix in SUFFIX:
     adb('shell','rm','-f',Q+name+suffix)
    r['status']='deleted'
    freed+=r['bytes']
  records.append(r)
 OUT.mkdir(parents=True,exist_ok=True)
 audit=OUT/('purge-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
 summary={'mode':'permanent_delete' if args.apply else 'dry_run',
          'checked':len(records),'eligible':sum(x['status'] in ('eligible','deleted') for x in records),
          'deleted':sum(x['status']=='deleted' for x in records),
          'freed_bytes':freed,'original_video_backup_created':False,
          'classification_is_model_estimated_not_human_verified':True,
          'records':records}
 audit.write_text(json.dumps(summary,indent=2))
 audit.chmod(0o600)
 print('S9_STRICT_QUARANTINE_PURGE',json.dumps({'audit':str(audit),'mode':summary['mode'],
       'quarantined_mp4s':len(candidates),'checked':len(records),
       'eligible':summary['eligible'],'deleted':summary['deleted'],
       'freed_bytes':freed,'excluded_reasons':{k:sum(r['reason']==k for r in records) for k in
       sorted(set(r['reason'] for r in records if r['status']=='protected'))}}))
if __name__=='__main__':main()
