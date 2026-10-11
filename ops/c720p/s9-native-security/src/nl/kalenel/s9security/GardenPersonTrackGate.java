package nl.kalenel.s9security;

/** Pure-Java live camera confirmation policy (no frames, identity or CPU inference).
 * Two unique JPEGs must agree on the same person-shaped box. Borderline SSD
 * person scores additionally require recent motion WITHIN that box, rather
 * than some unrelated car/leaf elsewhere inside the garden region.
 */
public final class GardenPersonTrackGate {
 public static final String VERSION="person_spatial_motion_corroborated_v7";
 public static final float MIN_SCORE=.44f;
 public static final float HIGH_CONFIDENCE=.72f;
 public static final long MAX_PAIR_MS=3400L;
 public enum Decision { WEAK, FIRST, DUPLICATE_JPEG, UNRELATED, NO_LOCAL_MOTION, CONFIRMED }
 private float[] firstBox;
 private float firstScore;
 private long firstAt=-1,firstJpegAt=-1;
 private boolean firstMotion;
 public long rejectedWeak=0,duplicateFrames=0,unrelatedBoxes=0,noLocalMotion=0,confirmed=0;
 public void reset(){firstBox=null;firstAt=-1;firstJpegAt=-1;firstScore=0;firstMotion=false;}
 public Decision offer(long now,long jpegAt,float score,float[] box,int recentMotionCells){
  if(now<1||jpegAt<1||jpegAt>now+200||!Float.isFinite(score)||
     score<MIN_SCORE||!valid(box)){
   // A single missed GPU observation must not erase a short but real
   // walk-by. Expire it by age instead; a later positive still needs to
   // match the exact same spatial object and local motion.
   rejectedWeak++;
   if(firstAt>0&&(now<firstAt||now-firstAt>MAX_PAIR_MS))reset();
   return Decision.WEAK;
  }
  if(firstAt>0&&jpegAt<=firstJpegAt){duplicateFrames++;return Decision.DUPLICATE_JPEG;}
  boolean motion=recentMotionCells>=1;
  if(firstAt>0&&now>=firstAt&&now-firstAt<=MAX_PAIR_MS){
   if(!samePerson(firstBox,box)){
    remember(now,jpegAt,score,box,motion);unrelatedBoxes++;return Decision.UNRELATED;
   }
   if(!(firstMotion||motion) && Math.min(firstScore,score)<HIGH_CONFIDENCE){
    remember(now,jpegAt,score,box,motion);noLocalMotion++;return Decision.NO_LOCAL_MOTION;
   }
   reset();confirmed++;return Decision.CONFIRMED;
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
 public static boolean samePerson(float[] a,float[] b){
  if(!valid(a)||!valid(b))return false;
  float top=Math.max(a[0],b[0]),left=Math.max(a[1],b[1]);
  float bot=Math.min(a[2],b[2]),right=Math.min(a[3],b[3]);
  float area=Math.max(0,bot-top)*Math.max(0,right-left);
  float aa=(a[2]-a[0])*(a[3]-a[1]),bb=(b[2]-b[0])*(b[3]-b[1]);
  if(area>0&&area/(aa+bb-area)>=.12f)return true;
  float ax=(a[1]+a[3])*.5f,ay=(a[0]+a[2])*.5f;
  float bx=(b[1]+b[3])*.5f,by=(b[0]+b[2])*.5f;
  return Math.abs(ax-bx)<=.26f&&Math.abs(ay-by)<=.18f &&
      Math.min(aa,bb)/Math.max(aa,bb)>.20f;
 }
}
