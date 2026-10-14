"""Apply narrowly scoped visual-review changes to the exact deployed v11 source.

The caller stages the immutable source revision ae547c163909 first. Older
branch camera sources are never compiled into this release.
"""
from pathlib import Path
import argparse,hashlib,json,shutil

def replace_once(text,old,new):
 if text.count(old)!=1:raise ValueError('source_contract_changed:'+old[:70])
 return text.replace(old,new,1)

def prepare(stage):
 here=Path(__file__).resolve().parent;src=stage/'src/nl/kalenel/s9security'
 baseline=json.loads((here/'visual-phone-v36-base-sources.json').read_text(encoding='utf-8'))
 for name,digest in baseline['sources'].items():
  if hashlib.sha256((src/name).read_bytes()).hexdigest()!=digest:raise ValueError('not_fresh_pinned_v11_source:'+name)
 for name in ('AnonymousClipTracks','Native4KFrames','VisualAttributeReview'):
  shutil.copy2(here/'src/nl/kalenel/s9security'/f'{name}.java',src/f'{name}.java')
 clip=src/'ClipClassifier.java';text=clip.read_text(encoding='utf-8')
 start=text.index(' private static boolean samePersonBox(');end=text.index(' private List<Detection> detect(',start)
 text=text[:start]+''' private static boolean samePersonBox(float[] a,float[] b){return AnonymousClipTracks.duplicateBox(a,b);}
 private JSONArray visualObjects=new JSONArray();
 public synchronized JSONArray visualObjectEvidence(){return visualObjects;}
 public synchronized List<AnonymousClipTracks.Hit> visualPeople(Bitmap frame)throws Exception{
  init();List<AnonymousClipTracks.Hit> result=new ArrayList<>();
  visualObjects=new JSONArray();
  for(Detection hit:detect(frame))if(hit.score>=.65f&&hit.box!=null&&
    Arrays.asList("bicycle","car","truck","bus","motorcycle","dog","cat","backpack","handbag","suitcase").contains(hit.label))
   visualObjects.put(new JSONObject().put("label",hit.label).put("box",new JSONArray(hit.box)).put("score",hit.score));
  for(Detection hit:detectGardenPeopleMultiscale(frame))
   if("person".equals(hit.label)&&hit.score>=.50f&&hit.box!=null)
    result.add(new AnonymousClipTracks.Hit(hit.box,hit.score,upperClothingColour(frame,hit.box)));
  return AnonymousClipTracks.distinct(result);
 }
'''+text[end:]
 text=replace_once(text,'   JSONArray categories=new JSONArray();','''   int repeatedPeople=anonymousTracks.repeatedConcurrentPeople();
   result.put("person_count_version",AnonymousClipTracks.COUNT_VERSION);
   result.put("person_repeated_simultaneous",repeatedPeople);
   result.put("person_peak_simultaneous",anonymousTracks.peakConcurrentPeople());
   result.put("person_count_is_unique_identities",false);
   JSONArray categories=new JSONArray();''')
 text=text.replace('framesWithMultiplePeople>=2','repeatedPeople>=2')
 text=text.replace('framesWithMultiplePeople==1','anonymousTracks.peakConcurrentPeople()>1')
 text=replace_once(text,'result.put("person_count",persons);','result.put("person_count",repeatedPeople);')
 text=replace_once(text,'result.put("person_count_is_max_simultaneous_detections",true);','result.put("person_count_is_repeated_simultaneous_evidence",true);')
 text=text.replace('"iou_045_or_center_distance_005"','"confidence_sorted_spatial_duplicates_v36"')
 clip.write_text(text,encoding='utf-8')
 camera=src/'CameraService.java';text=camera.read_text(encoding='utf-8')
 text=replace_once(text,' private void maybeMovementBackfill(){',''' private volatile boolean visualReviewBusy=false;
 private volatile int visualReviewCompleted=0,visualReviewErrors=0;
 private volatile String visualReviewLast="",visualReviewError="";
 private long lastVisualScan=0;
 private final Map<String,Integer> visualRetries=new HashMap<>();
 private boolean visualReviewSafe(){
  return running&&"watching".equals(mode)&&temperature()>0&&temperature()<370&&
   folder!=null&&folder.getUsableSpace()>15L*1024*1024*1024&&
   (lastMovementAt==0||SystemClock.elapsedRealtime()-lastMovementAt>15000L);
 }
 private void maybeVisualReview(){
  long now=SystemClock.elapsedRealtime();
  if(visualReviewBusy||reviewer==null||classifier==null||now-lastVisualScan<35000L||!visualReviewSafe())return;
  visualReviewBusy=true;lastVisualScan=now;
  try{reviewer.execute(()->{
   try{
    if(!visualReviewSafe())return;
    File[] clips=folder.listFiles((d,n)->n.matches("motion_[0-9]{13}[.]mp4"));if(clips==null)return;
    Arrays.sort(clips,Comparator.comparing(File::getName).reversed());
    for(File clip:clips){
     if(!visualReviewSafe())return;
     if(new File(folder,clip.getName()+".visual-v36.json").isFile()||
        !new File(folder,clip.getName()+".verified.json").isFile()||
        visualRetries.getOrDefault(clip.getName(),0)>=3)continue;
     visualReviewLast=clip.getName();
     try{
      VisualAttributeReview.process(clip,classifier,()->visualReviewSafe());
      visualReviewCompleted++;visualReviewError="";
     }catch(Exception problem){
      visualReviewError=problem.getMessage()==null?problem.getClass().getSimpleName():problem.getMessage();
      if(visualReviewSafe()){
       visualReviewErrors++;visualRetries.put(clip.getName(),visualRetries.getOrDefault(clip.getName(),0)+1);
      }
      Log.w(TAG,"visual_attribute_review_interrupted",problem);
     }return;
    }
   }finally{visualReviewBusy=false;lastVisualScan=SystemClock.elapsedRealtime();}
  });}catch(RejectedExecutionException ended){visualReviewBusy=false;}
 }
 private void maybeMovementBackfill(){''')
 text=replace_once(text,'  maybeMovementBackfill();','  maybeVisualReview();\n  maybeMovementBackfill();')
 text=replace_once(text,'   d.put("privacy","scene_tags_no_verified_cross_recording_identity");','''   d.put("visual_review_version",VisualAttributeReview.VERSION);
   d.put("visual_review_busy",visualReviewBusy);d.put("visual_review_completed",visualReviewCompleted);
   d.put("visual_review_errors",visualReviewErrors);d.put("visual_review_last_clip",visualReviewLast);
   d.put("visual_review_last_error",visualReviewError);
   d.put("visual_review_count_version",AnonymousClipTracks.COUNT_VERSION);
   d.put("visual_review_identity_matching",false);
   d.put("privacy","scene_tags_no_verified_cross_recording_identity");''')
 for invariant in ('person_spatiotemporal_transport_v9','stopAfterPtsUs=lastAcceptedEncodedPtsUs+'):
  # Implementations live in their original helper classes, which are unchanged.
  if not any(invariant in p.read_text(encoding='utf-8') for p in src.glob('*.java')):raise ValueError('lost_camera_invariant')
 camera.write_text(text,encoding='utf-8')
 hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in src.glob('*.java')}
 (stage/'source-sha256.json').write_text(json.dumps(hashes,indent=2)+'\n',encoding='utf-8')
 return hashes
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('stage',type=Path);args=parser.parse_args()
 print(json.dumps({'source_files':len(prepare(args.stage)),'identity_matching':False}))
