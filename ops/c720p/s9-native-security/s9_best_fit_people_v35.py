"""Constrained best-fit grouping. Scores are similarities, never identity probabilities."""
import math,statistics
from s9_person_observations_v35 import simultaneous,continuity

ALGORITHM='verified_ensemble_best_fit_v35'
MATCH={'face_supported','face_appearance_supported','best_fit_supported','single_recording_link'}

_vectors={}
def normalized(values):
 if not isinstance(values,list) or not values:return None
 cached=_vectors.get(id(values))
 if cached is not None and cached[0] is values:return cached[1]
 result=None
 if all(type(v) in (int,float) and math.isfinite(v) for v in values):
  length=math.sqrt(sum(v*v for v in values))
  if math.isfinite(length) and length>1e-9:result=tuple(v/length for v in values)
 if len(_vectors)>=2048:_vectors.clear()
 _vectors[id(values)]=(values,result)
 return result

def cosine(a,b):
 if not isinstance(a,list) or not isinstance(b,list) or len(a)!=len(b):return None
 first,second=normalized(a),normalized(b)
 return max(-1.,min(1.,sum(x*y for x,y in zip(first,second)))) if first and second else None

def views(a,b,field):
 values=sorted((v for x in a.get(field,[]) for y in b.get(field,[]) if (v:=cosine(x,y)) is not None),reverse=True)
 return statistics.mean(values[:2]) if values else None

def face_views(a,b):
 first,second=a.get('face_vectors',[]),b.get('face_vectors',[])
 scores={(i,j):v for i,x in enumerate(first) for j,y in enumerate(second) if (v:=cosine(x,y)) is not None}
 # Two supporting pairs must use different temporal probes on BOTH sides.
 independent=[(v+other)/2 for (i,j),v in scores.items() for (k,l),other in scores.items() if i!=k and j!=l]
 return max(independent) if independent else max(scores.values(),default=None)

def proportions(a,b):
 first,second=a.get('shape'),b.get('shape')
 if not isinstance(first,list) or not isinstance(second,list) or len(first)!=len(second) or not first:return None
 if any(type(v) not in (int,float) or not math.isfinite(v) or v<=0 for v in first+second):return None
 # Relative errors are meaningful here; cosine of positive ratios is almost always one.
 return max(0.,1-statistics.median(abs(math.log(x/y)) for x,y in zip(first,second))/.65)

def raw(a,b):
 return {'body':views(a,b,'body_vectors'),'reid':views(a,b,'reid_v35_vectors'),'face':face_views(a,b),'colour':cosine(a.get('colour'),b.get('colour')),'shape':proportions(a,b)}

def quantile(values,q):
 values=sorted(values);return values[round((len(values)-1)*q)] if values else None

def calibrate(tracks,raw_pairs):
 negatives=[v for (a,b),v in raw_pairs.items() if simultaneous(tracks[a],tracks[b]) and v['body'] is not None]
 # Verification is eligibility only. It supplies no same-identity training pairs.
 # Repeated body views from an actual track are the only internal positive probes.
 positives=[];positive_clips=set()
 for track in tracks.values():
  times=track.get('reid_v35_evidence',{}).get('original_frame_times_s',[]);n=len(times)
  if n<2 or len(track.get('body_vectors',[]))<n or len(track.get('reid_v35_vectors',[]))<n:continue
  body,reid=track['body_vectors'][-n:],track['reid_v35_vectors'][-n:]
  for i in range(n):
   for j in range(i+1,n):
    if abs(times[i]-times[j])<1.5:continue
    first,second=cosine(body[i],body[j]),cosine(reid[i],reid[j])
    if first is not None and second is not None:positives.append({'body':first,'reid':second});positive_clips.add(track['clip_key'])
 floor=.55;reid_floor=.68;join=.66
 trained=len(positives)>=8 and len(positive_clips)>=4 and len(negatives)>=8
 if trained:
  floor=max(.30,min(.75,(quantile([v['body'] for v in positives],.25)+quantile([v['body'] for v in negatives],.75))/2))
  negative_reid=[v['reid'] for v in negatives if v.get('reid') is not None]
  if len(negative_reid)>=8:reid_floor=max(.45,min(.85,(quantile([v['reid'] for v in positives],.25)+quantile(negative_reid,.75))/2))
  def appearance(v):
   measured=[(weight,v[k]) for k,weight in (('body',.30),('reid',.55)) if v.get(k) is not None]
   return sum(weight*value for weight,value in measured)/sum(weight for weight,_ in measured)
  join=max(.50,min(.78,(quantile([appearance(v) for v in positives],.25)+quantile([appearance(v) for v in negatives],.75))/2+.015))
 return {'algorithm':ALGORITHM,'body_floor':round(floor,4),'reid_floor':round(reid_floor,4),'join_score':round(join,4),'new_profile_cost':round(1-join,4),'competition_margin':.045,'positive_pairs':len(positives),'positive_recordings':len(positive_clips),'negative_pairs':len(negatives),'calibration_trained':trained,'calibration_basis':'observed_frame_negatives_and_independent_original_track_views','presence_labels_used_as_identity':False}

def pair(a,b,values,settings):
 body,face,colour,shape=(values[k] for k in ('body','face','colour','shape'));reid=values.get('reid')
 reasons=[]
 for label,value in (('Body views',body),('Independent body model',reid),('Face views',face),('Clothing',colour),('Projected proportions',shape)):
  if value is not None:reasons.append(label+' similarity '+str(round(value,3)))
 result={'algorithm':ALGORITHM,'evidence':values,'reasons':reasons}
 def answer(kind,score,reason=None):return {**result,'kind':kind,'score':round(max(0.,min(1.,score)),4),'reasons':([reason] if reason else [])+reasons}
 if simultaneous(a,b):return answer('conflict',0,'Visible at the same time in one recording')
 multi=min(len(a.get('face_vectors',[])),len(b.get('face_vectors',[])))>=2
 if face is not None and face<.4 and multi:return answer('conflict',0,'Contradictory independent face samples')
 if continuity(a,b) and body is not None and body>=.65 and colour is not None and colour>=.65 and (reid is None or reid>=settings['reid_floor']):return answer('single_recording_link',.91,'A short, spatially consistent track break has matching visual evidence')
 if face is not None and face>=.84 and multi:return answer('face_supported',face,'Independent face samples support the fit')
 corroborated=body is not None and (body>=.5 or body>=.35 and colour is not None and colour>=.45)
 if face is not None and face>=.82 and corroborated:return answer('face_appearance_supported',.78+.2*(face-.82)/.18,'Face and body views support the same fit')
 weighted=[(.30,body),(.55,reid),(.10,colour),(.04,shape)] if reid is not None else [(.70,body),(.24,colour),(.06,shape)]
 ma,mb=a.get('metrics',{}),b.get('metrics',{})
 cadence_a,cadence_b=ma.get('cadence_spm'),mb.get('cadence_spm')
 if cadence_a is not None and cadence_b is not None:weighted.append((.01,max(0,1-abs(cadence_a-cadence_b)/35)))
 usable=[(w,v) for w,v in weighted if v is not None]
 score=sum(w*v for w,v in usable)/sum(w for w,_ in usable) if usable else 0
 if face is not None and face<.55:score-=.10*(.55-face)/.55
 gap=abs(a.get('recorded_at',0)-b.get('recorded_at',0))
 if gap>7200:score-=.025;reasons.append('Appearance fit across separate visits; clothing can change')
 ensemble=reid is not None and reid>=settings['reid_floor'] and body is not None and body>=settings['body_floor']
 legacy=reid is None and body is not None and body>=.78 and colour is not None and colour>=.7
 if (ensemble or legacy) and score>=settings['join_score']:
  return answer('best_fit_supported',score,'Two body models support the same fit' if ensemble else 'Body appearance and clothing support this fit')
 return answer('suggestion' if score>=.53 or face is not None and face>=.70 else 'separate',score)

def build(tracks,cache=None):
 _vectors.clear()
 keys=sorted(tracks);pairs={};measurements={}
 for i,a in enumerate(keys):
  for b in keys[i+1:]:
   saved=(cache or {}).get(a+'|'+b)
   measurements[a,b]=saved['evidence'] if saved and saved.get('algorithm')==ALGORITHM else raw(tracks[a],tracks[b])
 settings=calibrate(tracks,measurements)
 for (a,b),values in measurements.items():pairs[a,b]=pair(tracks[a],tracks[b],values,settings)
 def evidence(a,b):return pairs[tuple(sorted((a,b)))]
 def conflict(first,second):return any(evidence(a,b)['kind']=='conflict' for a in first for b in second)
 # Assemble only measured track continuity, never a presence label alone.
 units=[[k] for k in keys]
 for (a,b),value in pairs.items():
  if value['kind']!='single_recording_link':continue
  first=next(g for g in units if a in g);second=next(g for g in units if b in g)
  if first is not second and not conflict(first,second):first.extend(second);units.remove(second)
 unit_scores={};unit_kinds={};unit_conflicts=set()
 for i,first in enumerate(units):
  for j in range(i+1,len(units)):
   second=units[j];results=[evidence(a,b) for a in first for b in second]
   if any(r['kind']=='conflict' for r in results):unit_conflicts.add((i,j))
   supporting=sorted((r for r in results if r['kind'] in MATCH),key=lambda r:r['score']+(.2 if r['kind']=='face_supported' else .1 if r['kind']=='face_appearance_supported' else 0),reverse=True)
   all_scores=sorted((r['score'] if r['kind'] in MATCH else min(settings['join_score']-.04 if r['evidence']['body'] is not None else .35,r['score']) for r in results),reverse=True)
   # A clear view represents obscured fragments; the second best view reduces outliers.
   unit_scores[i,j]=(.75*all_scores[0]+.25*all_scores[1]) if len(all_scores)>1 else all_scores[0]
   unit_kinds[i,j]=supporting[0]['kind'] if supporting else 'separate'
 def score(i,j):return unit_scores[tuple(sorted((i,j)))]
 def incompatible(first,second):return any(tuple(sorted((a,b))) in unit_conflicts for a in first for b in second)
 def prototype(group):
  # Facility cost balances the observed same-person variation against a new folder.
  # Each unit must fit a real central view directly; transitive chains cannot drift.
  choices=[]
  for anchor in group:
   values=[score(anchor,k) for k in group if k!=anchor]
   if values and min(values)<max(.35,settings['join_score']-.14):continue
   choices.append((sum(1-v for v in values),anchor))
  return min(choices) if choices else (float('inf'),None)
 groups=[[i] for i in range(len(units))];merges=[];rejected=0;penalty=settings['new_profile_cost']
 while True:
  candidates=[]
  for i,first in enumerate(groups):
   for j in range(i+1,len(groups)):
    second=groups[j]
    if incompatible(first,second):continue
    merged_cost,anchor=prototype(first+second)
    gain=prototype(first)[0]+prototype(second)[0]+penalty-merged_cost
    if gain<=1e-8:continue
    kinds={unit_kinds[tuple(sorted((a,b)))] for a in first for b in second}
    kind='face_supported' if 'face_supported' in kinds else 'face_appearance_supported' if 'face_appearance_supported' in kinds else 'best_fit_supported'
    candidates.append((gain,i,j,kind))
  if not candidates:break
  _,i,j,kind=max(candidates);groups[i].extend(groups[j]);groups.pop(j);merges.append({'method':kind})
 # Reassign an individual recording unit when another compatible profile fits better.
 for _ in range(len(units)):
  best=None
  for i,first in enumerate(groups):
   for unit in first:
    remaining=[k for k in first if k!=unit];old_cost=prototype(first)[0]
    for j,second in enumerate(groups):
     if i==j or incompatible([unit],second):continue
     new_cost=prototype(remaining)[0] if remaining else -penalty
     gain=old_cost+prototype(second)[0]-new_cost-prototype(second+[unit])[0]
     if gain>1e-8 and (best is None or gain>best[0]):best=(gain,i,j,unit)
  if best is None:break
  _,i,j,unit=best;groups[i].remove(unit);groups[j].append(unit);groups=[g for g in groups if g]
 fits={}
 for group in groups:
  _,anchor=prototype(group)
  for unit in group:
   value=max((score(unit,k) for k in group if k!=unit),default=1.) if unit==anchor else score(unit,anchor)
   rivals=[max(score(unit,k) for k in other) for other in groups if other is not group]
   ambiguous=bool(rivals) and value-max(rivals)<settings['competition_margin']
   tentative=len(group)>1 and (value<settings['join_score'] or ambiguous)
   kinds=[unit_kinds[tuple(sorted((unit,k)))] for k in group if k!=unit]
   basis='face_supported' if 'face_supported' in kinds else 'face_appearance_supported' if 'face_appearance_supported' in kinds else 'best_fit_supported' if 'best_fit_supported' in kinds else 'single_recording_link' if len(units[unit])>1 else 'single_appearance'
   for observation in units[unit]:fits[observation]={'review_required':tentative,'similarity':round(value,4),'support':'tentative_profile_fit' if tentative else 'profile_anchor' if unit==anchor else 'best_fit','basis':basis}
  members=[k for unit in group for k in units[unit]]
  for i,a in enumerate(members):
   for b in members[i+1:]:
    entry=evidence(a,b)
    if entry['kind'] not in MATCH and entry['kind']!='conflict':
     entry['kind']='profile_best_fit';entry['reasons']=['Assigned through the best-fitting shared profile; review uncertain views',*entry['reasons']]
 observations=[[k for u in group for k in units[u]] for group in groups]
 observations.sort(key=lambda group:min((tracks[k].get('recorded_at',0),k) for k in group))
 return {'groups':observations,'comparisons':{'|'.join(k):v for k,v in pairs.items()},'fits':fits,'grouping':{**settings,'initial_units':len(units),'final_groups':len(groups),'cross_unit_merges':len(units)-len(groups),'tentative_appearances':sum(v['review_required'] for v in fits.values()),'merge_methods':{method:sum(m['method']==method for m in merges) for method in MATCH},'score_kind':'similarity_not_identity_probability'}}
