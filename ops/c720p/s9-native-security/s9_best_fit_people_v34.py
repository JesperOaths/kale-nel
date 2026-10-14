"""Constrained best-fit grouping. Scores are similarities, never identity probabilities."""
import math,statistics

ALGORITHM='verified_multiview_best_fit_v34'
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

def simultaneous(a,b):
 return a['clip_key']==b['clip_key'] and a['id']!=b['id'] and max(a['first_s'],b['first_s'])<=min(a['last_s'],b['last_s'])

def proportions(a,b):
 first,second=a.get('shape'),b.get('shape')
 if not isinstance(first,list) or not isinstance(second,list) or len(first)!=len(second) or not first:return None
 if any(type(v) not in (int,float) or not math.isfinite(v) or v<=0 for v in first+second):return None
 # Relative errors are meaningful here; cosine of positive ratios is almost always one.
 return max(0.,1-statistics.median(abs(math.log(x/y)) for x,y in zip(first,second))/.65)

def raw(a,b):
 return {'body':views(a,b,'body_vectors'),'face':views(a,b,'face_vectors'),'colour':cosine(a.get('colour'),b.get('colour')),'shape':proportions(a,b)}

def quantile(values,q):
 values=sorted(values);return values[round((len(values)-1)*q)] if values else None

def calibrate(tracks,raw_pairs):
 negatives=[v for (a,b),v in raw_pairs.items() if simultaneous(tracks[a],tracks[b]) and v['body'] is not None]
 positives=[v for (a,b),v in raw_pairs.items() if tracks[a]['clip_key']==tracks[b]['clip_key'] and tracks[a].get('human_clip_label')==tracks[b].get('human_clip_label')=='person' and not simultaneous(tracks[a],tracks[b]) and v['body'] is not None]
 # Presence labels only provide within-recording examples. Never fit a person count.
 floor=.62;threshold=.67;new_profile_cost=.40
 if len(negatives)>=8 and len(positives)>=8:
  floor=max(.45,min(.68,(quantile([v['body'] for v in positives],.5)+quantile([v['body'] for v in negatives],.75))/2))
  def appearance(v):
   measured=[(w,v[k]) for k,w in (('body',.68),('colour',.24),('shape',.06)) if v[k] is not None]
   return sum(w*value for w,value in measured)/sum(w for w,_ in measured)
  threshold=max(.54,min(.70,(quantile([appearance(v) for v in positives],.5)+quantile([appearance(v) for v in negatives],.75))/2+.025))
  new_profile_cost=max(.35,min(.60,1-quantile([appearance(v) for v in positives],.5)))
 return {'algorithm':ALGORITHM,'body_floor':round(floor,4),'join_score':round(threshold,4),'new_profile_cost':round(new_profile_cost,4),'competition_margin':.035,'positive_pairs':len(positives),'negative_pairs':len(negatives)}

def pair(a,b,values,settings):
 body,face,colour,shape=(values[k] for k in ('body','face','colour','shape'))
 reasons=[]
 for label,value in (('Body views',body),('Face views',face),('Clothing',colour),('Projected proportions',shape)):
  if value is not None:reasons.append(label+' similarity '+str(round(value,3)))
 result={'algorithm':ALGORITHM,'evidence':values,'reasons':reasons}
 def answer(kind,score,reason=None):return {**result,'kind':kind,'score':round(max(0.,min(1.,score)),4),'reasons':([reason] if reason else [])+reasons}
 if simultaneous(a,b):return answer('conflict',0,'Visible at the same time in one recording')
 multi=min(len(a.get('face_vectors',[])),len(b.get('face_vectors',[])))>=2
 if face is not None and face<.4 and multi:return answer('conflict',0,'Contradictory independent face samples')
 if a['clip_key']==b['clip_key'] and a.get('human_clip_label')==b.get('human_clip_label')=='person':return answer('single_recording_link',.98,'Your single-person recording joins these separate views')
 if face is not None and face>=.84 and multi:return answer('face_supported',face,'Independent face samples support the fit')
 corroborated=body is not None and (body>=.5 or body>=.35 and colour is not None and colour>=.45)
 if face is not None and face>=.82 and corroborated:return answer('face_appearance_supported',.78+.2*(face-.82)/.18,'Face and body views support the same fit')
 weighted=[(.68,body),(.24,colour),(.06,shape)]
 ma,mb=a.get('metrics',{}),b.get('metrics',{})
 cadence_a,cadence_b=ma.get('cadence_spm'),mb.get('cadence_spm')
 if cadence_a is not None and cadence_b is not None:weighted.append((.02,max(0,1-abs(cadence_a-cadence_b)/35)))
 usable=[(w,v) for w,v in weighted if v is not None]
 score=sum(w*v for w,v in usable)/sum(w for w,_ in usable) if usable else 0
 if face is not None and face<.55:score-=.10*(.55-face)/.55
 gap=abs(a.get('recorded_at',0)-b.get('recorded_at',0))
 if gap>7200:score-=.025;reasons.append('Appearance fit across separate visits; clothing can change')
 if body is not None and body>=settings['body_floor'] and colour is not None and colour>=.45 and score>=settings['join_score']:
  return answer('best_fit_supported',score,'Best fit across the available body and clothing views')
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
 # First assemble views explicitly linked by the owner's single-person label.
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
   all_scores=sorted((r['score'] if r['kind'] in MATCH else min(.58 if r['evidence']['body'] is not None else .35,r['score']) for r in results),reverse=True)
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
   if values and min(values)<.40:continue
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
   for observation in units[unit]:fits[observation]={'review_required':tentative,'similarity':round(value,4),'support':'tentative_profile_fit' if tentative else 'profile_anchor' if unit==anchor else 'best_fit'}
  members=[k for unit in group for k in units[unit]]
  for i,a in enumerate(members):
   for b in members[i+1:]:
    entry=evidence(a,b)
    if entry['kind'] not in MATCH and entry['kind']!='conflict':
     entry['kind']='profile_best_fit';entry['reasons']=['Assigned through the best-fitting shared profile; review uncertain views',*entry['reasons']]
 observations=[[k for u in group for k in units[u]] for group in groups]
 observations.sort(key=lambda group:min((tracks[k].get('recorded_at',0),k) for k in group))
 return {'groups':observations,'comparisons':{'|'.join(k):v for k,v in pairs.items()},'fits':fits,'grouping':{**settings,'initial_units':len(units),'final_groups':len(groups),'cross_unit_merges':len(units)-len(groups),'tentative_appearances':sum(v['review_required'] for v in fits.values()),'merge_methods':{method:sum(m['method']==method for m in merges) for method in MATCH},'score_kind':'similarity_not_identity_probability'}}
