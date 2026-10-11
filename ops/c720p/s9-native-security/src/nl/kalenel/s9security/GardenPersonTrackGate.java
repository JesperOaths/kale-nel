package nl.kalenel.s9security;

/** Pure Java temporal person gate: two different source frames must contain a
 * spatially compatible person. This rejects isolated false boxes and duplicate
 * JPEG samples without adding another inference pass or cloud dependencies.
 *
 * A positive here is detector evidence, not proof of human identity.
 * All methods are called on the single Camera2 callback handler.
 */
public final class GardenPersonTrackGate {
 public static final String VERSION="ssd_mobilenet_garden_spatial_2frame_v3";
 public static final float MIN_SCORE=.44f;
 public static final long MAX_PAIR_INTERVAL_MS=3200L;
 public static final float MAX_X_SHIFT=.27f,MAX_Y_SHIFT=.20f;
 public static final float MIN_IOU=.08f;
 public enum Result {WEAK, DUPLICATE_FRAME, FIRST, UNRELATED, CONFIRMED}
 private long lastJpegAt=-1,firstAt=-1;
 private float[] previous=null;
 public long weak=0,duplicate=0,unrelated=0,confirmed=0;
 public void reset(){lastJpegAt=-1;firstAt=-1;previous=null;}
 private void clearCandidate(){firstAt=-1;previous=null;}
 public Result offer(long now,long jpegStamp,float score,float[] box){
  if(now<=0||jpegStamp<=0||jpegStamp>now+200||
    score<MIN_SCORE||!Float.isFinite(score)||!valid(box)){
   clearCandidate();weak++;return Result.WEAK;
  }
  if(jpegStamp<=lastJpegAt){duplicate++;return Result.DUPLICATE_FRAME;}
  lastJpegAt=jpegStamp;
  if(previous!=null&&firstAt>0&&now>=firstAt&&now-firstAt<=MAX_PAIR_INTERVAL_MS){
   if(associated(previous,box)){
    clearCandidate();confirmed++;return Result.CONFIRMED;
   }
   previous=box.clone();firstAt=now;unrelated++;return Result.UNRELATED;
  }
  previous=box.clone();firstAt=now;return Result.FIRST;
 }
 static boolean valid(float[] b){
  if(b==null||b.length!=4)return false;
  for(float v:b)if(!Float.isFinite(v)||v<0f||v>1.02f)return false;
  return b[2]>b[0]&&b[3]>b[1];
 }
 public static boolean associated(float[] a,float[] b){
  if(!valid(a)||!valid(b))return false;
  float top=Math.max(a[0],b[0]),left=Math.max(a[1],b[1]);
  float bottom=Math.min(a[2],b[2]),right=Math.min(a[3],b[3]);
  float overlap=Math.max(0f,bottom-top)*Math.max(0f,right-left);
  float aa=(a[2]-a[0])*(a[3]-a[1]),bb=(b[2]-b[0])*(b[3]-b[1]);
  float iou=overlap/(aa+bb-overlap);
  if(iou>=MIN_IOU)return true;
  float ax=(a[1]+a[3])*.5f,ay=(a[0]+a[2])*.5f;
  float bx=(b[1]+b[3])*.5f,by=(b[0]+b[2])*.5f;
  return Math.abs(ax-bx)<=MAX_X_SHIFT&&Math.abs(ay-by)<=MAX_Y_SHIFT;
 }
}
