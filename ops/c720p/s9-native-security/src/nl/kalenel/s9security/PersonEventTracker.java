package nl.kalenel.s9security;

/**
 * Person-first temporal evidence tracker, independent of Camera2/TFLite.
 *
 * One primary garden-person track is tracked here for the recording trigger;
 * the scene classifier continues to account for multiple people offline.
 * All calls are serialized on CameraService.cameraHandler. No face identity.
 *
 * Detector outputs are NOT truth: short intermittent hits cannot confirm a
 * visitor. Missing frames do not immediately discard a previously confirmed
 * track. Do not use this class as an authorization or retention decision.
 */
public final class PersonEventTracker {
 public static final String VERSION="s9_person_event_track_v4_20261011";
 public static final long ASSOCIATION_WINDOW_MS=3500L;
 public static final long DISAPPEAR_GRACE_MS=2500L;
 private static final float WEAK=.45f,STRONG=.60f;
 private final float[] lastBox=new float[4];
 private long lastSeenAt=-1,firstSeenAt=-1,lastObservedAt=-1;
 private int associated=0,strong=0;
 private boolean confirmed=false;
 public long confirmedEvents=0,rejectedTransitions=0,observations=0;

 public static final class Decision {
  public final boolean confirmedNow;
  public final boolean active;
  public final boolean candidate;
  public final int associatedFrames;
  Decision(boolean now,boolean active,boolean candidate,int frames){
   this.confirmedNow=now;this.active=active;
   this.candidate=candidate;this.associatedFrames=frames;
  }
 }
 public void reset(){
  lastSeenAt=-1;firstSeenAt=-1;lastObservedAt=-1;
  associated=0;strong=0;confirmed=false;
 }
 private static boolean valid(float[] b){
  if(b==null||b.length!=4)return false;
  for(float v:b)if(Float.isNaN(v)||Float.isInfinite(v))return false;
  return b[0]>=0&&b[1]>=0&&b[2]<=1&&b[3]<=1&&
   b[2]-b[0]>=.115f&&b[3]-b[1]>=.032f&&
   (b[3]-b[1])/(b[2]-b[0])<=.92f;
 }
 private static boolean related(float[] a,float[] b){
  float ix=Math.max(0f,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
  float iy=Math.max(0f,Math.min(a[2],b[2])-Math.max(a[0],b[0]));
  float areaA=(a[3]-a[1])*(a[2]-a[0]);
  float areaB=(b[3]-b[1])*(b[2]-b[0]);
  float iou=ix*iy/Math.max(.00001f,areaA+areaB-ix*iy);
  float acx=(a[1]+a[3])*.5f,bcx=(b[1]+b[3])*.5f;
  float ah=a[2]-a[0],bh=b[2]-b[0];
  return iou>=.12f||
   (Math.abs(acx-bcx)<Math.max(.08f,Math.max(ah,bh)*.45f)&&
    Math.abs(a[2]-b[2])<Math.max(.12f,Math.max(ah,bh)*.50f));
 }
 public Decision observe(long timestampMs,float score,float[] box){
  observations++;
  // Stale/duplicated/clock-regressed inference cannot vote twice.
  if(timestampMs<=lastObservedAt)
   return new Decision(false,isActive(timestampMs),associated>0,associated);
  lastObservedAt=timestampMs;
  if(lastSeenAt>=0&&timestampMs-lastSeenAt>DISAPPEAR_GRACE_MS)
   resetTrackOnly();
  if(score<WEAK||!valid(box))
   return new Decision(false,isActive(timestampMs),associated>0,associated);
  if(lastSeenAt>=0 && (timestampMs-lastSeenAt>ASSOCIATION_WINDOW_MS||!related(lastBox,box))){
   rejectedTransitions++;
   resetTrackOnly();
  }
  if(lastSeenAt<0)firstSeenAt=timestampMs;
  lastSeenAt=timestampMs;
  System.arraycopy(box,0,lastBox,0,4);
  associated=Math.min(999,associated+1);
  if(score>=STRONG)strong=Math.min(999,strong+1);
  // Three spatially associated independent frames, two strong outputs,
  // with bounded elapsed time; a single AI hallucination is insufficient.
  boolean newConfirmed=!confirmed&&associated>=3&&strong>=2
      &&timestampMs-firstSeenAt<=4500L;
  if(newConfirmed){confirmed=true;confirmedEvents++;}
  return new Decision(newConfirmed,isActive(timestampMs),true,associated);
 }
 private void resetTrackOnly(){
  lastSeenAt=-1;firstSeenAt=-1;associated=0;strong=0;confirmed=false;
 }
 public boolean isActive(long now){
  return confirmed&&lastSeenAt>=0&&now>=lastSeenAt&&now-lastSeenAt<=DISAPPEAR_GRACE_MS;
 }
 public int associatedFrames(){return associated;}
 public boolean isConfirmed(){return confirmed;}
 public long lastPersonSeenAt(){return lastSeenAt;}
}
