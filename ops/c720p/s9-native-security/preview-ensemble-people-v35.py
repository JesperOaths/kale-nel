"""Unpublished private trial and integrity receipts; prints aggregates only."""
import collections,hashlib,json,sys,time
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');sys.path[:0]=[str(Path(__file__).parent),str(BASE/'bin')]
import s9_verified_people_v33 as p
import s9_sd_proxy_extension as proxy
import s9_archive_delete_v1 as deletion
import s9_best_fit_people_v35 as fit
p.review._sd_rows=lambda:{k:v for k,v in proxy.rows().items() if k not in deletion.deleted()}
def sha(blob):return hashlib.sha256(blob).hexdigest()
def quantiles(values):return [round(fit.quantile(values,q),3) for q in (0,.1,.25,.5,.75,.9,1)] if values else []
def main():
 started=time.monotonic();original=(p.ROOT/'features.json').read_bytes();baseline=sha(original);approved=p.allowed();approval_sha=sha(json.dumps(approved,sort_keys=True).encode());ensemble=p.read('ensemble-evaluation-v35.json');faces=p.read('independent-face-evaluation-v35.json')
 assert ensemble['baseline_features_sha256']==faces['baseline_features_sha256']==baseline
 assert ensemble['approved_sha256']==faces['approved_sha256']==approval_sha and not faces['errors']
 original_views=p.read('original-views-evaluation-v35.json')
 if original_views:
  assert not original_views['errors'] and original_views['clips']==len(approved) and original_views['baseline_features_sha256']==baseline and original_views['approved_sha256']==approval_sha
  features=p.read('features-original-views-v35.json')
 else:
  features=p.read('features-ensemble-v35.json');assert sha((p.ROOT/'features-ensemble-v35.json').read_bytes())==ensemble['staged_features_sha256']
 dense=p.read('dense-head-evaluation-v35.json')
 if dense:
  assert not dense['errors'] and dense['clips']==len(approved) and dense['baseline_features_sha256']==baseline and dense['approved_sha256']==approval_sha
  features=p.read('features-dense-headfaces-v35.json')
 native=p.read('features-independent-faces-v35.json');original_tracks=p.tracks_now();tracks={};count=collections.Counter()
 for clip_key,entry in features['entries'].items():
  if clip_key not in approved:continue
  incoming={t['id']:t for t in native['entries'][clip_key].get('tracks',[])}
  assert entry['revision']==approved[clip_key]['revision']
  for track in entry.get('tracks',[]):
   assert track['id'] in original_tracks
   if not original_views:
    for field in ('face_images','face_captures','face_vectors','images'):track[field]=incoming[track['id']][field]
   track['quality']['face_descriptor_samples']=len(track['face_vectors']);tracks[track['id']]=track
   count['face_crops']+=len(track.get('face_images',[]));count['face_templates']+=len(track.get('face_vectors',[]));count['multiple_face_templates']+=len(track.get('face_vectors',[]))>=2
   count['body_ensemble_views']+=len(track['reid_v35_vectors']);count['detector_uncertain']+=track['reid_v35_evidence']['person_detector_score']<.35
 assert set(tracks)==set(original_tracks)
 result=fit.build(tracks);assigned=[k for group in result['groups'] for k in group]
 assert len(assigned)==len(set(assigned))==len(tracks) and set(assigned)==set(tracks)
 assert all(not fit.simultaneous(tracks[a],tracks[b]) for group in result['groups'] for i,a in enumerate(group) for b in group[i+1:])
 assert all(result['comparisons']['|'.join(sorted((a,b)))]['kind']!='conflict' for group in result['groups'] for i,a in enumerate(group) for b in group[i+1:])
 distributions=collections.defaultdict(list)
 for key,value in result['comparisons'].items():
  a,b=key.split('|');kind='observed_together' if fit.simultaneous(tracks[a],tracks[b]) else 'other'
  for metric,score in value['evidence'].items():
   if score is not None:distributions[kind+':'+metric].append(score)
 old=p.read('registry.json');protected=sum(v.get('reviewed') or v.get('name')!='Person #'+str(int(k[1:])) for k,v in old['profiles'].items())
 assert (p.ROOT/'features.json').read_bytes()==original and sha(json.dumps(p.allowed(),sort_keys=True).encode())==approval_sha
 p.write('features-ready-v35.json',features);receipt={'algorithm_sha256':sha(Path(fit.__file__).read_bytes()),'baseline_features_sha256':baseline,'features_sha256':sha((p.ROOT/'features-ready-v35.json').read_bytes()),'approved_sha256':approval_sha,'result':result,'finished_at':p.utc()};p.write('best-fit-preview-v35.json',receipt)
 print(json.dumps({'published':False,'approved_clips':len(approved),'tracks':len(tracks),'groups':len(result['groups']),'multi_recording_groups':sum(len({tracks[k]['clip_key'] for k in group})>1 for group in result['groups']),'group_sizes':dict(collections.Counter(len(g) for g in result['groups'])),'protected_folders':protected,'evidence_counts':dict(count),'grouping':result['grouping'],'pair_quantiles':{k:quantiles(v) for k,v in distributions.items()},'elapsed_s':round(time.monotonic()-started,1)},sort_keys=True),flush=True)
if __name__=='__main__':main()
