package nl.kalenel.s9security;

/**
 * Pure-Java pedestrian admission gate. Never starts recording on generic
 * pixel motion or one object-model prediction. No identity inference.
 *
 * Fast walkers may be confirmed even if the coarse luma grid misses them,
 * but repeated unmoving false person boxes (parked cars, hedges, decorations)
 * must not trigger a video. Vehicle conflicts are filtered by the classifier
 * before calling this gate.
 */
public final class GardenPersonTrackGate {
 public static final String VERSION="person_spatiotemporal_transport_v9";
 public static final float MIN_SCORE=.36f;
 public static final float HIGH_CONFIDENCE=.70f;
 public static final long MAX_PAIR_MS=5200L;
 public static final String STATIONARY_HOLD_VERSION="confirmed_person_stationary_tail_v1";
 public static final long MAX_STATIONARY_AGE_MS=9000L;
 public static final float STATIONARY_HOLD_SCORE=.78f;
 public enum Decision { WEAK, FIRST, DUPLICATE_JPEG, UNRELATED, NO_LOCAL_MOTION, CONFIRMED }
 private float[] firstBox;
 private float firstScore;
 private long firstAt=-1,firstJpegAt=-1;
 private boolean firstMotion;
 public long rejectedWeak=0,duplicateFrames=0,unrelatedBoxes=0,noLocalMotion=0,confirmed=0,unlikePersonShape=0;
 public long transportInterrupted=0;
 private float[] confirmedBox,stationaryBox;
 private long confirmedAt=-1,confirmedJpegAt=-1;
 private long stationaryAt=-1,stationaryJpegAt=-1;
 public long stationaryHolds=0,stationaryHoldRejected=0;
 private void clearCandidate(){
  firstBox=null;firstAt=-1;firstJpegAt=-1;firstScore=0;firstMotion=false;
 }
 private void clearStationaryProposal(){
  stationaryBox=null;stationaryAt=-1;stationaryJpegAt=-1;
 }
 public void reset(){
  clearCandidate();confirmedBox=null;confirmedAt=-1;confirmedJpegAt=-1;
  clearStationaryProposal();
 }
 private void rememberConfirmed(long now,long jpegAt,float[] box){
  confirmedBox=box.clone();confirmedAt=now;confirmedJpegAt=jpegAt;
  clearStationaryProposal();
 }
 /** Continue an ALREADY admitted recording when its human remains still.
  * Never use this for initial recording admission. Require two new, distinct,
  * closely localized, high-confidence person JPEG observations within 9s of
  * a motion-confirmed person (or its latest high-confidence hold). Transport
  * contradictions are removed by ClipClassifier before this method is called.
  */
 public boolean confirmStationaryPresence(long now,long jpegAt,float score,float[] box){
  if(confirmedBox==null||now<1||jpegAt<1||jpegAt>now+200||
     confirmedAt<1||now<confirmedAt||now-confirmedAt>MAX_STATIONARY_AGE_MS||
     jpegAt<=confirmedJpegAt||!Float.isFinite(score)||
     score<STATIONARY_HOLD_SCORE||!plausiblePersonShape(box)||
     !sameRegionTransport(confirmedBox,box)){
   stationaryHoldRejected++;clearStationaryProposal();return false;
  }
  if(stationaryBox!=null){
   if(jpegAt<=stationaryJpegAt){stationaryHoldRejected++;return false;}
   if(now>stationaryAt&&now-stationaryAt>=800L&&
      now-stationaryAt<=MAX_PAIR_MS&&sameRegionTransport(stationaryBox,box)){
    rememberConfirmed(now,jpegAt,box);
    stationaryHolds++;return true;
   }
  }
  stationaryBox=box.clone();stationaryAt=now;stationaryJpegAt=jpegAt;
  return false;
 }
 /** Explicit same-region transport contradiction ends a pending person track. */
 public void rejectCompetingTransport(){transportInterrupted++;reset();}
 public long unrelatedTransportIgnored=0;
 /** A vehicle in another image region must not cancel a pedestrian.
  * Missing veto geometry is conservatively treated as a contradiction.
  */
 public boolean rejectCompetingTransport(float[][] vetoedPersonBoxes){
  if(firstBox==null&&confirmedBox==null)return false;
  if(vetoedPersonBoxes==null||vetoedPersonBoxes.length==0){
   rejectCompetingTransport();return true;
  }
  for(float[] veto:vetoedPersonBoxes){
   // The person-association tolerance below deliberately allows movement
   // between frames. A car contradiction must be MORE spatially precise:
   // adjacent, nonoverlapping detections are never the same object.
   boolean sameCandidate=firstBox!=null&&sameRegionTransport(firstBox,veto);
   boolean sameConfirmed=confirmedBox!=null&&sameRegionTransport(confirmedBox,veto);
   if(!sameCandidate&&!sameConfirmed)continue;
   // The car's conflict is local. Preserve an independently confirmed
   // pedestrian elsewhere when only a different proposal is rejected.
   if(sameCandidate)clearCandidate();
   if(sameConfirmed){
    confirmedBox=null;confirmedAt=-1;confirmedJpegAt=-1;
    clearStationaryProposal();
   }
   transportInterrupted++;return true;
  }
  unrelatedTransportIgnored++;return false;
 }
 public Decision offer(long now,long jpegAt,float score,float[] box,int recentMotionCells){
  if(now<1||jpegAt<1||jpegAt>now+200||!Float.isFinite(score)||
     score<MIN_SCORE||!valid(box)){
   rejectedWeak++;
   if(firstAt>0&&(now<firstAt||now-firstAt>MAX_PAIR_MS))clearCandidate();
   return Decision.WEAK;
  }
  // Images with a broad, vehicle-like box must not become person evidence.
  // Ratio is measured in pixels for the actual 640x480 preview, not simply
  // on 0..1 normalized XY coordinates.
  if(!plausiblePersonShape(box)){
   unlikePersonShape++;
   if(firstAt>0&&(now<firstAt||now-firstAt>MAX_PAIR_MS))clearCandidate();
   return Decision.WEAK;
  }
  if(firstAt>0&&jpegAt<=firstJpegAt){duplicateFrames++;return Decision.DUPLICATE_JPEG;}
  boolean motion=recentMotionCells>=1;
  if(firstAt>0&&now>=firstAt&&now-firstAt<=MAX_PAIR_MS){
   if(!samePerson(firstBox,box)){
    remember(now,jpegAt,score,box,motion);unrelatedBoxes++;return Decision.UNRELATED;
   }
   final float weaker=Math.min(firstScore,score);
   final boolean moved=personMoved(firstBox,box);
   // Weaker detections must have local garden motion on BOTH frames. Strong
   // moving pedestrians can use spatial translation to recover motion-grid
   // misses, but static high-confidence false positives can never be admitted.
   final boolean corroborated=
       (firstMotion&&motion) ||
       (weaker>=.55f && (firstMotion||motion) && moved) ||
       (weaker>=HIGH_CONFIDENCE && moved && movedClearly(firstBox,box));
   if(!corroborated){
    remember(now,jpegAt,score,box,motion);
    noLocalMotion++;
    return Decision.NO_LOCAL_MOTION;
   }
   clearCandidate();rememberConfirmed(now,jpegAt,box);confirmed++;return Decision.CONFIRMED;
  }
  remember(now,jpegAt,score,box,motion);return Decision.FIRST;
 }
 private void remember(long now,long jpegAt,float score,float[] box,boolean motion){
  firstAt=now;firstJpegAt=jpegAt;firstScore=score;
  firstBox=box.clone();firstMotion=motion;
 }
 public static boolean valid(float[] b){
  if(b==null||b.length!=4)return false;
  for(float v:b)if(!Float.isFinite(v)||v<0f||v>1.02f)return false;
  return b[2]>b[0]+.025f&&b[3]>b[1]+.012f;
 }
 public static boolean plausiblePersonShape(float[] b){
  if(!valid(b))return false;
  final float width=b[3]-b[1],height=b[2]-b[0];
  final float pixelAspect=(height*480f)/(width*640f);
  return height>=.055f&&width<=.56f&&pixelAspect>=.70f&&pixelAspect<=8f;
 }
 public static boolean personMoved(float[] a,float[] b){
  if(!valid(a)||!valid(b))return false;
  final float dx=Math.abs((a[1]+a[3]-b[1]-b[3])*.5f);
  final float dy=Math.abs((a[0]+a[2]-b[0]-b[2])*.5f);
  final float smallWidth=Math.min(a[3]-a[1],b[3]-b[1]);
  final float smallHeight=Math.min(a[2]-a[0],b[2]-b[0]);
  return dx>=Math.max(.035f,.27f*smallWidth) ||
         dy>=Math.max(.035f,.18f*smallHeight);
 }
 public static boolean movedClearly(float[] a,float[] b){
  if(!valid(a)||!valid(b))return false;
  final float dx=Math.abs((a[1]+a[3]-b[1]-b[3])*.5f);
  final float dy=Math.abs((a[0]+a[2]-b[0]-b[2])*.5f);
  return dx>=.065f||dy>=.07f;
 }
 /** Compare a vetoed *person-shaped detection* with an existing
  * person region. Unlike broad moving-person association, a transport
  * contradiction requires physical overlap, not merely nearby centers.
  */
 public static boolean sameRegionTransport(float[] a,float[] b){
  if(!valid(a)||!valid(b))return false;
  float top=Math.max(a[0],b[0]),left=Math.max(a[1],b[1]);
  float bottom=Math.min(a[2],b[2]),right=Math.min(a[3],b[3]);
  float common=Math.max(0f,bottom-top)*Math.max(0f,right-left);
  float areaA=(a[2]-a[0])*(a[3]-a[1]);
  float areaB=(b[2]-b[0])*(b[3]-b[1]);
  return common/Math.min(areaA,areaB)>=.35f;
 }
 public static boolean samePerson(float[] a,float[] b){
  if(!valid(a)||!valid(b)||!plausiblePersonShape(a)||!plausiblePersonShape(b))return false;
  float top=Math.max(a[0],b[0]),left=Math.max(a[1],b[1]);
  float bot=Math.min(a[2],b[2]),right=Math.min(a[3],b[3]);
  float area=Math.max(0,bot-top)*Math.max(0,right-left);
  float aa=(a[2]-a[0])*(a[3]-a[1]),bb=(b[2]-b[0])*(b[3]-b[1]);
  if(Math.min(aa,bb)/Math.max(aa,bb)<.28f)return false;
  if(area>0&&area/(aa+bb-area)>=.15f)return true;
  float ax=(a[1]+a[3])*.5f,ay=(a[0]+a[2])*.5f;
  float bx=(b[1]+b[3])*.5f,by=(b[0]+b[2])*.5f;
  float width=Math.max(a[3]-a[1],b[3]-b[1]);
  float height=Math.max(a[2]-a[0],b[2]-b[0]);
  return Math.abs(ax-bx)<=Math.max(.11f,width*1.30f) &&
         Math.abs(ay-by)<=Math.max(.085f,height*.60f);
 }
 // A competing transport detection is a veto only when it strongly matches
 // the very same box and confidently out-scores the person class. A person
 // beside a parked car, or a cyclist with separately localized upper body,
 // must not be vetoed just because a vehicle exists in the frame.
 public static boolean transportDominates(float[] person,float personScore,
                                          float[] vehicle,float vehicleScore,
                                          String vehicleLabel){
  if(!valid(person)||!valid(vehicle)||!Float.isFinite(vehicleScore)||
     !Float.isFinite(personScore)||vehicleScore<.55f||vehicleLabel==null)return false;
  if(!("car".equals(vehicleLabel)||"truck".equals(vehicleLabel)||
       "bus".equals(vehicleLabel)||"motorcycle".equals(vehicleLabel)||
       "bicycle".equals(vehicleLabel)||"train".equals(vehicleLabel)))return false;
  float top=Math.max(person[0],vehicle[0]),left=Math.max(person[1],vehicle[1]);
  float bottom=Math.min(person[2],vehicle[2]),right=Math.min(person[3],vehicle[3]);
  float common=Math.max(0,bottom-top)*Math.max(0,right-left);
  float p=(person[2]-person[0])*(person[3]-person[1]);
  float v=(vehicle[2]-vehicle[0])*(vehicle[3]-vehicle[1]);
  float iou=common/(p+v-common);
  // The ordinary same-box veto is retained. IoU alone misses a common
  // false positive: a small person-shaped label entirely inside a larger,
  // high-confidence car/bus/truck box, where union area makes IoU tiny.
  if(iou>=.42f&&vehicleScore>=personScore+.10f)return true;
  // Only veto that contained-box case on overwhelming transport evidence.
  // Partial overlap (e.g. a pedestrian walking beside a car) must survive.
  float personCovered=common/p;
  float sizeRatio=p/v;
  return personCovered>=.90f&&sizeRatio<=.40f&&
      vehicleScore>=.82f&&vehicleScore>=personScore+.20f;
 }
}
