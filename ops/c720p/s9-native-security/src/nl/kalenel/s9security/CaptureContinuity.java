package nl.kalenel.s9security;

/**
 * Logical event lineage across physical 4K MP4s.
 * Does NOT claim gapless video. Camera2 still reconfigures between segments.
 * All calls from CameraService's single cameraHandler.
 */
public final class CaptureContinuity {
 public static final String VERSION="s9_logical_event_segments_v1";
 public static final long MAX_REJOIN_MS=12000,MAX_RESUME_MS=9000;
 private String eventId="";
 private int sequence=0;
 private long lastEventMs=-1, previousEndMs=-1, startedMs=-1;
 private boolean recording=false,autoResume=false;
 private String priorClip="",startReason="new_event";
 public long automaticContinuations=0,joinedReentries=0,expiredResumes=0;
 public static final class Segment {
  public final String eventId,previousClip,transitionReason,clipName,stopReason;
  public final int sequence;
  public final long startMonotonicMs,stopMonotonicMs,gapMs,lastEvidenceAgeMs;
  public final boolean autoResumeArmed;
  Segment(String eid,String prior,String transition,String clip,String reason,int seq,
          long begin,long end,long gap,long age,boolean armed){
   eventId=eid;previousClip=prior;transitionReason=transition;clipName=clip;stopReason=reason;
   sequence=seq;startMonotonicMs=begin;stopMonotonicMs=end;gapMs=gap;
   lastEvidenceAgeMs=age;autoResumeArmed=armed;
  }
 }
 public void evidence(long now){
  if(now>lastEventMs)lastEventMs=now;
 }
 /** Should be called only AFTER MediaRecorder.start() succeeds. */
 public void started(long now,long wallMs){
  if(recording)throw new IllegalStateException("segment_already_open");
  boolean joined=!eventId.isEmpty()&&previousEndMs>=0&&now>=previousEndMs
      &&now-previousEndMs<=MAX_REJOIN_MS;
  if(!joined){
   eventId="garden_"+wallMs;
   sequence=0;priorClip="";previousEndMs=-1;
   startReason="new_event";
  }else{
   startReason=autoResume?"max_duration_continuation":"reentry_after_quiet";
   if(autoResume)automaticContinuations++;else joinedReentries++;
  }
  sequence++;startedMs=now;recording=true;autoResume=false;
 }
 public Segment stopped(long now,String clip,String reason){
  if(!recording)throw new IllegalStateException("no_recording_to_end");
  if(clip==null||!clip.matches("motion_[0-9]{13}\\.mp4"))
   throw new IllegalArgumentException("invalid_clip_name");
  long age=lastEventMs<0?Long.MAX_VALUE:Math.max(0,now-lastEventMs);
  boolean capped="max_segment".equals(reason)||"watchdog_cap".equals(reason);
  // Re-arm only when a live garden event was recently present.
  boolean resume=capped&&age<=MAX_RESUME_MS;
  long gap=previousEndMs<0?-1:Math.max(0,startedMs-previousEndMs);
  Segment s=new Segment(eventId,priorClip,startReason,clip,reason,sequence,
        startedMs,now,gap,age,resume);
  previousEndMs=now;priorClip=clip;recording=false;autoResume=resume;
  return s;
 }
 public boolean continuationReady(long now){
  if(!autoResume||recording)return false;
  if(lastEventMs<0||now<lastEventMs||now-lastEventMs>MAX_RESUME_MS){
   autoResume=false;expiredResumes++;return false;
  }
  return true;
 }
 public void cancelContinuation(){autoResume=false;}
 public boolean isContinuationPending(){return autoResume;}
 public String eventId(){return eventId;}
 public int segmentNumber(){return sequence;}
 public boolean recording(){return recording;}
 public void reset(){eventId="";sequence=0;lastEventMs=-1;previousEndMs=-1;
  startedMs=-1;recording=false;autoResume=false;priorClip="";startReason="new_event";}
}
