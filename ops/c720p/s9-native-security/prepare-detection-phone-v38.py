"""Pinned v11 recorder + V37 review + audited V38 detection changes."""
import importlib.util,json,hashlib,shutil,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
def once(text,old,new):
 if text.count(old)!=1:raise ValueError('source_contract_changed:'+old[:90])
 return text.replace(old,new,1)
def prepare(stage,*,current=False):
 if not current and 'native_4k_dense_small_people_v39' in (HERE/'src/nl/kalenel/s9security/ClipReviewSchedule.java').read_text(encoding='utf-8'):
  raise ValueError('current_sources_require_prepare_detection_phone_v39')
 spec=importlib.util.spec_from_file_location('v37',HERE/'prepare-temporal-phone-v37.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base);base.prepare(stage,current=True)
 src=stage/'src/nl/kalenel/s9security'
 for name in ('GardenCandidateBank','GardenPersonTrackGate'):shutil.copy2(HERE/'src/nl/kalenel/s9security'/f'{name}.java',src/f'{name}.java')
 p=src/'ClipClassifier.java';t=p.read_text()
 start=t.index('  for(Detection hit:detectGardenPeopleMultiscale(frame))');end=t.index('  return AnonymousClipTracks.distinct(result);',start)
 t=t[:start]+'''  for(Detection hit:detectGardenPeopleMultiscale(frame)){
   if(!"person".equals(hit.label)||hit.score<.50f||
      !GardenPersonTrackGate.plausiblePersonShape(hit.box,frame.getWidth(),frame.getHeight()))continue;
   boolean vehicle=false;
   for(Detection transport:lastGardenTransports)if(GardenPersonTrackGate.transportDominates(hit.box,hit.score,transport.box,transport.score,transport.label)){vehicle=true;break;}
   if(!vehicle)result.add(new AnonymousClipTracks.Hit(hit.box,hit.score,upperClothingColour(frame,hit.box)));
  }
'''+t[end:]
 # Additional overlapping vertical garden tiles on native 4K review frames.
 # Live preview remains three GPU passes to preserve live capture latency.
 t=once(t,'  int[] starts={0,width-tileWidth};','  int[] starts=width>=3000?new int[]{0,(width-tileWidth)/2,width-tileWidth}:new int[]{0,width-tileWidth};')
 t=once(t,' public synchronized GardenPersonEvidence personEvidenceInGarden(byte[] jpeg,float top,float margin,String zone)throws Exception{',''' public synchronized GardenPersonEvidence personEvidenceInGarden(byte[] jpeg,float top,float margin,String zone)throws Exception{
  List<GardenPersonEvidence> candidates=personCandidatesInGarden(jpeg,top,margin,zone);
  return candidates.isEmpty()?null:candidates.get(0);
 }
 public synchronized List<GardenPersonEvidence> personCandidatesInGarden(byte[] jpeg,float top,float margin,String zone)throws Exception{''')
 t=once(t,'   float highest=0f,any=0f;','   float highest=0f,any=0f;\n   List<GardenPersonEvidence> candidates=new ArrayList<>();')
 t=once(t,'    if(GardenPersonTrackGate.valid(b)&&detection.score>highest){','    if(detection.score>=GardenPersonTrackGate.MIN_SCORE)candidates.add(new GardenPersonEvidence(detection.score,b));\n    if(GardenPersonTrackGate.valid(b)&&detection.score>highest){')
 t=once(t,'   return bestBox==null?null:new GardenPersonEvidence(highest,bestBox);','   candidates.sort((a,b)->Float.compare(b.score,a.score));\n   return candidates.subList(0,Math.min(10,candidates.size()));')
 p.write_text(t)
 p=src/'CameraService.java';t=p.read_text()
 t=once(t,'private final GardenPersonTrackGate personTrackGate=new GardenPersonTrackGate();','private final GardenCandidateBank personTrackGate=new GardenCandidateBank();')
 t=once(t,'    ClipClassifier.GardenPersonEvidence evidence=null;','    List<ClipClassifier.GardenPersonEvidence> evidence=new ArrayList<>();')
 t=once(t,'evidence=gardenGateClassifier.personEvidenceInGarden(jpg,top,margin,selectedZone);','evidence=gardenGateClassifier.personCandidatesInGarden(jpg,top,margin,selectedZone);')
 t=once(t,'    final float score=evidence==null?0f:evidence.score;\n    final float[] personBox=evidence==null?null:evidence.box;','''    final List<ClipClassifier.GardenPersonEvidence> candidates=evidence;
    final float score=candidates.isEmpty()?0f:candidates.get(0).score;''')
 t=once(t,'      personTrackGate.offer(now,jpegAt,score,null,0);','      personTrackGate.offer(now,jpegAt,Collections.emptyList(),new int[0]);')
 old='''     int localCells=motion.recentMotionCellsInBox(personBox,SystemClock.elapsedRealtime());
     gardenPersonLastLocalMotionCells=localCells;
     GardenPersonTrackGate.Decision verdict=
         personTrackGate.offer(now,jpegAt,score,personBox,localCells);'''
 new='''     List<AnonymousClipTracks.Hit> hits=new ArrayList<>();
     int[] localCells=new int[candidates.size()];gardenPersonLastLocalMotionCells=0;
     for(int i=0;i<candidates.size();i++){
      ClipClassifier.GardenPersonEvidence candidate=candidates.get(i);
      hits.add(new AnonymousClipTracks.Hit(candidate.box,candidate.score,"uncertain"));
      localCells[i]=motion.recentMotionCellsInBox(candidate.box,SystemClock.elapsedRealtime());
      gardenPersonLastLocalMotionCells=Math.max(gardenPersonLastLocalMotionCells,localCells[i]);
     }
     boolean confirmed=personTrackGate.offer(now,jpegAt,hits,localCells);'''
 t=once(t,old,new);t=once(t,'if(verdict!=GardenPersonTrackGate.Decision.CONFIRMED)return;','if(!confirmed)return;')
 t=once(t,'   d.put("garden_person_gate_required_positive_frames",2);','   d.put("garden_person_gate_required_positive_frames",2);\n   d.put("garden_person_candidate_capacity",10);')
 p.write_text(t)
 proof={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in src.glob('*.java')}
 (stage/'source-sha256.json').write_text(json.dumps(proof,indent=2))
 print(json.dumps({'source_files':len(proof),'recording_timing_unchanged':True,'identity_matching':False}))
if __name__=='__main__':prepare(Path(sys.argv[1]))
