package nl.kalenel.s9security;
import java.util.*;

/** Volatile live-stream motion hypotheses. No saved IDs or identity features. */
public final class GardenCandidateBank {
 private static final class Slot {
  GardenPersonTrackGate gate=new GardenPersonTrackGate();
  float[] box;long at;
 }
 private final List<Slot> slots=new ArrayList<>();
 public long duplicateFrames,unrelatedBoxes,noLocalMotion,rejectedWeak;
 public void reset(){slots.clear();}
 public boolean offer(long now,long jpegAt,List<AnonymousClipTracks.Hit> hits,int[] localCells){
  if(localCells.length!=hits.size())throw new IllegalArgumentException("motion_count");
  slots.removeIf(s->now<s.at||now-s.at>GardenPersonTrackGate.MAX_PAIR_MS);
  Set<Slot> used=new HashSet<>();boolean confirmed=false;
  // One observation may update at most one hypothesis. A false, stronger
  // candidate cannot replace every other candidate in the same frame.
  for(int i=0;i<Math.min(10,hits.size());i++){
   AnonymousClipTracks.Hit hit=hits.get(i);Slot best=null;float distance=Float.MAX_VALUE;
   for(Slot slot:slots)if(!used.contains(slot)&&GardenPersonTrackGate.samePerson(slot.box,hit.box)){
    float dx=(slot.box[1]+slot.box[3]-hit.box[1]-hit.box[3])*.5f;
    float dy=(slot.box[0]+slot.box[2]-hit.box[0]-hit.box[2])*.5f;
    float d=dx*dx+dy*dy;if(d<distance){distance=d;best=slot;}
   }
   if(best==null){if(slots.size()>=20)continue;best=new Slot();slots.add(best);}
   used.add(best);GardenPersonTrackGate gate=best.gate;
   long duplicates=gate.duplicateFrames,unrelated=gate.unrelatedBoxes,motion=gate.noLocalMotion,weak=gate.rejectedWeak;
   if(gate.offer(now,jpegAt,hit.confidence,hit.box,localCells[i])==GardenPersonTrackGate.Decision.CONFIRMED)confirmed=true;
   duplicateFrames+=gate.duplicateFrames-duplicates;unrelatedBoxes+=gate.unrelatedBoxes-unrelated;
   noLocalMotion+=gate.noLocalMotion-motion;rejectedWeak+=gate.rejectedWeak-weak;
   best.box=hit.box.clone();best.at=now;
  }
  if(hits.isEmpty())rejectedWeak++;
  if(confirmed)reset();return confirmed;
 }
}
