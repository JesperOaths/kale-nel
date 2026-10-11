#!/usr/bin/env python3
"""Non-deploying paired-event detector cutover gate.

Accepts independently annotated, time-matched continuous camera windows.
Archived clips alone cannot measure visits which were never recorded.
This outputs eligibility evidence, NEVER installs/removes a detector.
"""
import argparse
import collections
import csv
import json
import math
from pathlib import Path

FIELDS=("window_id","lighting","person_present","baseline_alarm","candidate_alarm",
        "human_reviewed","capture_source")
YES={"yes":True,"no":False}
LIGHT={"day","night"}
REQUIRED_PER_CELL=20
MAX_CPU_P90_REGRESSION=1.10
MIN_RECALL_GAIN=.05
MAX_PAIRED_P=.05

def exact_mcnemar(better,worse):
 n=better+worse
 if n==0:return 1.0
 tail=sum(math.comb(n,i) for i in range(min(better,worse)+1)) / (2**n)
 return min(1.,2*tail)

def evaluate(rows,health):
 errors=[];seen=set();parsed=[]
 if not isinstance(health,dict):raise ValueError("health_object_required")
 for i,row in enumerate(rows,1):
  if not isinstance(row,dict) or not all(k in row for k in FIELDS):
   raise ValueError("missing_window_column_"+str(i))
  wid=str(row["window_id"])
  if not wid or wid in seen:raise ValueError("duplicate_or_empty_window_id")
  seen.add(wid)
  if row["lighting"] not in LIGHT:raise ValueError("invalid_lighting")
  if row["human_reviewed"]!="yes":raise ValueError("window_lacks_independent_human_review")
  if row["capture_source"]!="continuous":raise ValueError("selection_biased_recorded_only_corpus")
  if any(row[k] not in YES for k in ("person_present","baseline_alarm","candidate_alarm")):
   raise ValueError("invalid_person_or_prediction")
  parsed.append((row["lighting"],*[YES[row[k]] for k in
     ("person_present","baseline_alarm","candidate_alarm")]))
 subsets=collections.defaultdict(list)
 for light,actual,base,candidate in parsed:
  subsets[(light,actual)].append((base,candidate))
 for light in sorted(LIGHT):
  for positive in (True,False):
   observed=len(subsets[light,positive])
   if observed<REQUIRED_PER_CELL:
    errors.append(f"insufficient_{light}_{'person' if positive else 'nonperson'}_windows:{observed}")
 def rate(tp,denominator):
  return round(tp/denominator,4) if denominator else None
 confusion={}
 for model,idx in (("baseline",0),("candidate",1)):
  tp=fp=fn=tn=0;per_light={}
  for light in LIGHT:
   z={"tp":0,"fp":0,"fn":0,"tn":0}
   for actual in (True,False):
    for a,b in subsets[light,actual]:
     prediction=(a,b)[idx]
     label="tp" if actual and prediction else (
         "fn" if actual else ("fp" if prediction else "tn"))
     z[label]+=1
   per_light[light]=z
   tp+=z["tp"];fp+=z["fp"];fn+=z["fn"];tn+=z["tn"]
  confusion[model]={"tp":tp,"fp":fp,"fn":fn,"tn":tn,
   "recall":rate(tp,tp+fn),"precision":rate(tp,tp+fp),
   "false_alarms_per_negative_window":rate(fp,fp+tn),"by_lighting":per_light}
 pairs=[(baseline,candidate) for _,actual,baseline,candidate in parsed if actual]
 better=sum((not a) and b for a,b in pairs)
 worse=sum(a and (not b) for a,b in pairs)
 p=exact_mcnemar(better,worse)
 npos=len(pairs)
 recall_gain=(better-worse)/npos if npos else None
 if not npos:errors.append("no_positive_labeled_windows")
 elif recall_gain<MIN_RECALL_GAIN:errors.append("recall_gain_below_5_percentage_points")
 if p>=MAX_PAIRED_P:errors.append("paired_recall_improvement_not_statistically_significant")
 for light in LIGHT:
  if confusion["candidate"]["by_lighting"][light]["fp"]>confusion["baseline"]["by_lighting"][light]["fp"]:
   errors.append("candidate_false_alarms_increase_"+light)
  if confusion["candidate"]["by_lighting"][light]["fn"]>confusion["baseline"]["by_lighting"][light]["fn"]:
   errors.append("candidate_misses_more_people_"+light)
 for k in ("baseline_p90_ms","candidate_p90_ms","temperature_baseline_c",
           "temperature_candidate_c","soak_days"):
  v=health.get(k)
  if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<0:
   errors.append("invalid_health_metric_"+k)
 if all(isinstance(health.get(k),(int,float)) and not isinstance(health[k],bool)
        and math.isfinite(health[k]) and health[k]>0
        for k in ("baseline_p90_ms","candidate_p90_ms")):
  if health["candidate_p90_ms"]>health["baseline_p90_ms"]*MAX_CPU_P90_REGRESSION:
   errors.append("candidate_p90_latency_regression_above_10_percent")
 if all(isinstance(health.get(k),(int,float)) and not isinstance(health[k],bool)
        and math.isfinite(health[k]) for k in ("temperature_baseline_c","temperature_candidate_c")):
  if health["temperature_candidate_c"]-health["temperature_baseline_c"]>2:
   errors.append("candidate_thermal_increase_above_2C")
 for k in ("4k_resolution_verified","native_camera_healthy","rollback_apk_verified",
           "playback_test_passed","sd_storage_safe","no_capture_loss"):
  if health.get(k) is not True:errors.append("required_device_health_missing_"+k)
 eligible=not errors
 return {"gate_version":"s9_independent_event_validation_v1",
  "annotated_windows":len(parsed),"minimum_windows":4*REQUIRED_PER_CELL,
  "paired_positive_wins":better,"paired_positive_losses":worse,
  "positive_recall_gain":rate(better-worse,npos),
  "paired_exact_two_sided_p":round(p,6),
  "confusion":confusion,
  "eligible_for_guarded_shadow_cutover":eligible,
  "old_detector_retirement_authorized":eligible and health.get("soak_days",0)>=7
     and health.get("shadow_soak_no_camera_incidents") is True,
  "production_change_performed":False,
  "decision":"ELIGIBLE_FOR_SEPARATE_GUARDED_ROLLOUT" if eligible else "HOLD_EXISTING_DETECTOR",
  "blockers":sorted(set(errors)),
  "bias_warning":"Archived motion-only MP4s alone cannot measure never-recorded persons."}

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--labels",type=Path,required=True)
 ap.add_argument("--health",type=Path,required=True)
 ap.add_argument("--output",type=Path)
 args=ap.parse_args()
 with args.labels.open(newline="",encoding="utf-8-sig") as f:
  reader=csv.DictReader(f)
  if not reader.fieldnames or not set(FIELDS).issubset(reader.fieldnames):
   raise ValueError("independent_label_columns_missing")
  rows=list(reader)
  if len(rows)>10000:raise ValueError("audit_input_unbounded")
 data=json.loads(args.health.read_text(encoding="utf-8"))
 result=evaluate(rows,data)
 string=json.dumps(result,indent=2,sort_keys=True)+"\n"
 if args.output:args.output.write_text(string,encoding="utf-8")
 else:print(string,end="")
if __name__=="__main__":main()
