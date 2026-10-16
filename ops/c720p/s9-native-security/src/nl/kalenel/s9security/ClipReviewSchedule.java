package nl.kalenel.s9security;
import java.util.*;

/** Bounded, clip-local timestamp requests. Original native frames are decoded. */
public final class ClipReviewSchedule {
 public static final String VERSION="native_4k_dense_small_people_v39";
 private final TreeSet<Long> pending=new TreeSet<>();
 private final Set<Long> scheduled=new HashSet<>();
 private final long durationMs;private int extras=0,requested=0;
 public ClipReviewSchedule(long duration){
  if(duration<1000||duration>125000)throw new IllegalArgumentException("clip_duration");
  durationMs=duration;int n=(int)Math.min(32,Math.max(16,(duration+399)/400));
  for(int i=0;i<n;i++){long at=(long)((i+.5)*duration/n);pending.add(at);scheduled.add(at);}
 }
 public boolean hasNext(){return !pending.isEmpty()&&requested<40;}
 public long next(){if(!hasNext())throw new NoSuchElementException();requested++;return pending.pollFirst();}
 public void followUp(long decodedMs){
  // A fresh candidate receives two nearby checks. At 30 fps these are distinct
  // observed frames, not repeated inference of the same source timestamp.
  for(long gap:new long[]{220,550}){
   long at=decodedMs+gap;if(extras>=8||at>=durationMs-50)continue;
   boolean nearby=false;for(long old:scheduled)if(Math.abs(old-at)<90){nearby=true;break;}
   if(!nearby&&scheduled.add(at)){pending.add(at);extras++;}
  }
 }
 public int additionalRequests(){return extras;}
}
