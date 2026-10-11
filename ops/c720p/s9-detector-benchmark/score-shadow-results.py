#!/usr/bin/env python3
"""Score phone-local shadow model results. No video or face bytes needed.

No precision/recall without independent human labels. CSV fields:
clip,contains_person (yes/no),lighting (day/night/unknown optional)
"""
import argparse,csv,json,math
from pathlib import Path

def score(report, labels=None):
 if report.get('shadow_engine')!='garden-shadow-v2-20261011':
  raise ValueError('not_a_v2_shadow_report')
 clips=report.get('clip_summary',[])
 if not isinstance(clips,list) or not clips:raise ValueError('no_clip_comparisons')
 seen=set()
 for rec in clips:
  if not isinstance(rec,dict):raise ValueError('invalid_clip_result')
  name=rec.get('clip')
  if not isinstance(name,str) or not name.startswith('motion_') or not name.endswith('.mp4') or name in seen:
   raise ValueError('unsafe_or_duplicate_clip_reference')
  seen.add(name)
 total=sum(int(x.get('paired_comparisons',0)) for x in clips)
 diffs=sum(int(x.get('temporal_disagreement_frames',0)) for x in clips)
 summary={
  'report_type':'independent_cpu_shadow_comparison_v2',
  'model_accuracy_verified':False,
  'clips_compared':len(clips),
  'paired_frames':total,
  'paired_track_disagreements':diffs,
  'disagreement_fraction':round(diffs/total,4) if total else None,
  'ssd_inference_p50_ms':report.get('ssd',{}).get('p50_ms'),
  'ssd_inference_p90_ms':report.get('ssd',{}).get('p90_ms'),
  'lite0_inference_p50_ms':report.get('efficientdet',{}).get('p50_ms'),
  'lite0_inference_p90_ms':report.get('efficientdet',{}).get('p90_ms'),
  'ssd_confirmed_track_events':sum(int(x.get('ssd_confirmed_track_events',0)) for x in clips),
  'lite0_confirmed_track_events':sum(int(x.get('lite0_confirmed_track_events',0)) for x in clips),
  'motion_positive_frames':sum(int(x.get('adaptive_motion_frames',0)) for x in clips),
  'exposure_suppressions':sum(int(x.get('exposure_flash_suppressions',0)) for x in clips),
  'unlabeled_accuracy':None,
 }
 if labels is None:return summary
 if not isinstance(labels,dict):raise ValueError('label_mapping_required')
 if set(labels)-seen:raise ValueError('labelled_clip_not_in_benchmark')
 summary['human_labeled_clips']=len(labels)
 summary['human_positive_clips']=sum(v[0] for v in labels.values())
 summary['human_negative_clips']=len(labels)-summary['human_positive_clips']
 if not labels:return summary
 def stats(model):
  tp=fp=fn=tn=0
  by_light={}
  for rec in clips:
   name=rec['clip']
   if name not in labels:continue
   human,light=labels[name]
   guessed=int(rec.get(model+'_confirmed_track_events',0))>0
   if guessed and human:tp+=1
   elif guessed and not human:fp+=1
   elif not guessed and human:fn+=1
   else:tn+=1
   key=light or 'unknown'
   d=by_light.setdefault(key,{'tp':0,'fp':0,'fn':0,'tn':0})
   if guessed and human:d['tp']+=1
   elif guessed and not human:d['fp']+=1
   elif not guessed and human:d['fn']+=1
   else:d['tn']+=1
  def ratio(a,b):return round(a/b,4) if b else None
  return {'tp':tp,'fp':fp,'fn':fn,'tn':tn,
   'precision':ratio(tp,tp+fp),
   'recall':ratio(tp,tp+fn),
   'false_positive_rate':ratio(fp,fp+tn),
   'f1':ratio(2*tp,2*tp+fp+fn),
   'by_lighting_confusion_counts':by_light}
 # Single-digit sample evaluations are purely descriptive; do not publish
 # "accuracy verified" from a selection of only motion-triggered clips.
 summary['ssd_on_labeled_subset']=stats('ssd')
 summary['lite0_on_labeled_subset']=stats('lite0')
 summary['model_accuracy_verified']=(
  summary['human_positive_clips']>=20 and summary['human_negative_clips']>=20)
 summary['label_sampling_limitation']='Only already-recorded motion clips; no missed-person negatives from non-recorded intervals.'
 return summary

def load_labels(path):
 labels={}
 with path.open(newline='',encoding='utf-8-sig') as handle:
  reader=csv.DictReader(handle)
  if not reader.fieldnames or not {'clip','contains_person'}.issubset(reader.fieldnames):
   raise ValueError('label_csv_columns_missing')
  for row in reader:
   name=str(row['clip']).strip();v=str(row['contains_person']).strip().lower()
   if v not in ('yes','no'):raise ValueError('unknown_human_label_for_'+name)
   if name in labels:raise ValueError('duplicate_annotation_'+name)
   light=str(row.get('lighting') or 'unknown').strip().lower()
   if light not in ('day','night','unknown'):raise ValueError('invalid_lighting_'+name)
   labels[name]=(v=='yes',light)
 return labels

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('report',type=Path,help='S9 shadow v2 comparison JSON')
 parser.add_argument('--labels',type=Path,help='Independently reviewed clip labels')
 parser.add_argument('--output',type=Path,help='Summary JSON; default stdout')
 args=parser.parse_args()
 report=json.loads(args.report.read_text(encoding='utf-8'))
 labels=load_labels(args.labels) if args.labels else None
 result=score(report,labels)
 text=json.dumps(result,indent=2,sort_keys=True)+'\n'
 if args.output:args.output.write_text(text,encoding='utf-8')
 else:print(text,end='')
if __name__=='__main__':main()
