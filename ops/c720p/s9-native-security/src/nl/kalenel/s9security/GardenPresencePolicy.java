package nl.kalenel.s9security;

/** Phone-only, pure Java temporal evidence policy for the near-garden person gate.
 * A score is an object-detection proposal, never an identity or proof of a person.
 * All timestamps are elapsedRealtime milliseconds, supplied by CameraService.
 */
public final class GardenPresencePolicy {
 public static final class Decision {
  public final boolean personCandidate;
  public final boolean startVideo;
  public final boolean extendVideo;
  public final String reason;
  Decision(boolean candidate,boolean start,boolean extend,String reason) {
   personCandidate=candidate;startVideo=start;extendVideo=extend;this.reason=reason;
  }
 }
 private int streak=0;
 private long lastSeen=0,lastSample=0,lastVideoAt=0;
 private float previousX=-1,previousFeet=-1;
 private boolean episodeLatched=false;

 public void reset() {
  streak=0;lastSeen=0;lastSample=0;lastVideoAt=0;
  previousX=-1;previousFeet=-1;episodeLatched=false;
 }
 public boolean episodeLatched(){return episodeLatched;}
 public int streak(){return streak;}

 /** Call on each inference result, not on every camera frame.
  * All score, x and foot positions are validated before entering the policy.
  */
 public Decision observe(float score,float x,float feet,long now,boolean motion,
                         boolean strongMotion,boolean recording) {
  if(now<=0||!Float.isFinite(score)||!Float.isFinite(x)||!Float.isFinite(feet)
      ||score<0||score>1||x<0||x>1||feet<0||feet>1.02f)
   return new Decision(false,false,false,"invalid_observation");

  if(lastSample>0 && now<=lastSample)
   return new Decision(false,false,false,"out_of_order_sample");
  if(lastSeen>0 && now-lastSeen>6000) {
   streak=0;episodeLatched=false;
  }
  boolean proposal=score>=.38f;
  boolean stable=(lastSeen>0 && now-lastSeen<=4500
    && Math.abs(x-previousX)<=.22f && Math.abs(feet-previousFeet)<=.22f);
  if(proposal) {
   streak=stable?Math.min(12,streak+1):1;
   previousX=x;previousFeet=feet;lastSeen=now;
  }else if(lastSeen>0&&now-lastSeen>6000){
   streak=0;episodeLatched=false;
  }
  lastSample=now;
  if(recording) {
   // A confidently present, stationary person extends a clip up to MAX_MS.
   return new Decision(proposal,false,score>=.43f,"recording_presence");
  }
  if(!proposal)return new Decision(false,false,false,"no_person_candidate");
  if(episodeLatched && now-lastVideoAt<29000)
   return new Decision(true,false,false,"same_presence_episode");

  boolean immediate=motion && strongMotion && score>=.68f;
  boolean moving=motion && streak>=2 && score>=.42f;
  boolean stationary=streak>=2 && score>=.57f || streak>=3 && score>=.44f;
  if(immediate)return new Decision(true,true,false,"strong_garden_walkby");
  if(moving)return new Decision(true,true,false,"confirmed_garden_walkby");
  if(stationary)return new Decision(true,true,false,"persistent_garden_person");
  return new Decision(true,false,false,"needs_temporal_confirmation");
 }
 public void videoStarted(long now) {
  episodeLatched=true;lastVideoAt=now;streak=0;
 }
}
