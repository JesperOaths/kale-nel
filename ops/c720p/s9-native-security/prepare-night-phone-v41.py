"""Exact V39 recorder/review plus clip-local night admission. Never historical sources."""
import importlib.util,hashlib,json,shutil,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
def once(t,old,new):
 if t.count(old)!=1:raise RuntimeError('source_contract_changed:'+old[:100])
 return t.replace(old,new,1)
def prepare(stage):
 spec=importlib.util.spec_from_file_location('v39',HERE/'prepare-detection-phone-v39.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.prepare(stage,current=True)
 src=stage/'src/nl/kalenel/s9security'
 for name in ('NightPersonGate','NightScenePolicy'):shutil.copy2(HERE/'src/nl/kalenel/s9security'/f'{name}.java',src/f'{name}.java')
 p=src/'ClipClassifier.java';t=p.read_text(encoding='utf-8')
 needle=' public synchronized List<GardenPersonEvidence> personCandidatesInGarden(byte[] jpeg,float top,float margin,String zone)throws Exception{'
 t=once(t,needle,needle+'''
  return personCandidatesInGarden(jpeg,top,margin,zone,false);
 }
 public synchronized List<GardenPersonEvidence> personCandidatesInGarden(byte[] jpeg,float top,float margin,String zone,boolean night)throws Exception{''')
 t=once(t,'if(GardenPersonTrackGate.transportDominates(b,detection.score,\n          transport.box,transport.score,transport.label)){','if(night?NightPersonGate.transportConflict(b,detection.score,transport.box,transport.score,transport.label):\n         GardenPersonTrackGate.transportDominates(b,detection.score,transport.box,transport.score,transport.label)){')
 # Apply the same same-object vehicle conflict checks on original 4K review
 # frames, using their real dimensions. Never change manual review labels.
 t=once(t,'  init();List<AnonymousClipTracks.Hit> result=new ArrayList<>();','  init();List<AnonymousClipTracks.Hit> result=new ArrayList<>();\n  final boolean nightFrame=isNightFrame(frame);')
 t=once(t,'if(GardenPersonTrackGate.transportDominates(hit.box,hit.score,transport.box,transport.score,transport.label))','if(nightFrame?NightPersonGate.transportConflict(hit.box,hit.score,transport.box,transport.score,transport.label,frame.getWidth(),frame.getHeight()):GardenPersonTrackGate.transportDominates(hit.box,hit.score,transport.box,transport.score,transport.label))')
 t=once(t,'     found.removeIf(d->{','     final boolean nightFrame=isNightFrame(bitmap);\n     found.removeIf(d->{')
 t=once(t,'if(GardenPersonTrackGate.transportDominates(d.box,d.score,transport.box,transport.score,transport.label))return true;','if(nightFrame?NightPersonGate.transportConflict(d.box,d.score,transport.box,transport.score,transport.label,bitmap.getWidth(),bitmap.getHeight()):GardenPersonTrackGate.transportDominates(d.box,d.score,transport.box,transport.score,transport.label))return true;')
 t=once(t,' private static int[] sampleGardenLuma(Bitmap bitmap,float start){',''' private static boolean isNightFrame(Bitmap bitmap){
  int[] luma=sampleGardenLuma(bitmap,.433f);Arrays.sort(luma);
  return luma[luma.length/2]<55;
 }
 private static int[] sampleGardenLuma(Bitmap bitmap,float start){''')
 p.write_text(t,encoding='utf-8')
 p=src/'MotionGrid.java';t=p.read_text(encoding='utf-8')
 t=once(t,' public int recentMotionCellsInBox(float[] box,long now){',''' public int recentMotionCellsInBox(float[] box,long now){return recentMotionCellsInBox(box,now,5000L);}
 public int recentMotionCellsInBox(float[] box,long now,long maxAgeMs){''')
 t=once(t,'now-recentMotionAt[i]<=5000L','now-recentMotionAt[i]<=maxAgeMs')
 p.write_text(t,encoding='utf-8')
 p=src/'CameraService.java';t=p.read_text(encoding='utf-8')
 t=once(t,'private final GardenCandidateBank personTrackGate=new GardenCandidateBank();','private final GardenCandidateBank personTrackGate=new GardenCandidateBank();\n private final NightScenePolicy nightScenePolicy=new NightScenePolicy();')
 t=once(t,'  final String selectedZone=motion.gardenZone();','  final String selectedZone=motion.gardenZone();\n  final boolean nightObservation=nightScenePolicy.update(motion.lighting,now);')
 t=once(t,'personCandidatesInGarden(jpg,top,margin,selectedZone)','personCandidatesInGarden(jpg,top,margin,selectedZone,nightObservation)')
 t=once(t,'personTrackGate.offer(now,jpegAt,Collections.emptyList(),new int[0])','personTrackGate.offer(now,jpegAt,Collections.emptyList(),new int[0],nightObservation)')
 t=once(t,'motion.recentMotionCellsInBox(candidate.box,SystemClock.elapsedRealtime())','motion.recentMotionCellsInBox(candidate.box,SystemClock.elapsedRealtime(),nightObservation?1200L:5000L)')
 t=once(t,'personTrackGate.offer(now,jpegAt,hits,localCells)','personTrackGate.offer(now,jpegAt,hits,localCells,nightObservation)')
 t=once(t,'     gardenPersonGateMatches++;','''     gardenPersonGateMatches++;
     // A first night candidate gets a short faster follow-up window, even
     // when the coarse luma grid misses a small pedestrian. Do not refresh
     // it on every observation of a static object.
     if(nightObservation&&score>=.46f&&temperature()<370&&now>=gardenPersonCandidateUntil)
      gardenPersonCandidateUntil=now+3500L;''')
 t=once(t,'d.put("motion_detector",GardenPersonTrackGate.VERSION);','d.put("motion_detector",NightPersonGate.VERSION);')
 t=once(t,'d.put("garden_person_gate_required_positive_frames",2);','''d.put("garden_person_gate_required_positive_frames",nightScenePolicy.isNight()?3:2);
   d.put("garden_person_night_policy",NightPersonGate.VERSION);
   d.put("garden_person_night_active",nightScenePolicy.isNight());
   d.put("garden_person_night_rejected",personTrackGate.nightRejected);
   d.put("garden_person_night_confirmed",personTrackGate.nightConfirmed);
   d.put("garden_person_local_motion_max_age_ms",nightScenePolicy.isNight()?1200:5000);
   d.put("garden_person_night_requires_coherent_translation",true);''')
 p.write_text(t,encoding='utf-8')
 proof={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in src.glob('*.java')}
 (stage/'source-sha256.json').write_text(json.dumps(proof,indent=2))
 print(json.dumps({'source_files':len(proof),'night_policy':'night_temporal_transport_v41','recorder_timing_unchanged':True}))
if __name__=='__main__':prepare(Path(sys.argv[1]))
