package nl.kalenel.s9security;
import android.media.Image;
import android.os.SystemClock;
import java.nio.ByteBuffer;
import java.util.ArrayDeque;

/** Luma-based regional motion with exposure-change rejection and temporal voting. */
public final class MotionGrid {
 private static final int W=24,H=14,N=W*H;
 private final float[] background=new float[N],nowCells=new float[N];
 private final boolean[] changed=new boolean[N],seen=new boolean[N];
 private final int[] stack=new int[N];
 private long lastSample=0;
 private int init=0;
 private final ArrayDeque<Boolean> votes=new ArrayDeque<>();
 public double changedRatio=0,lighting=0;
 public int coherent=0;
 public boolean motion=false;
 public boolean strong=false;
 private int sustainedEvidence=0;
 // "near" now follows the owner's drawn garden boundary (2026-10-11).
 // The image was 761x568; the upper green line slopes from y~=294 at the
 // left through y~=275 in the middle to y~=245 at the right. Everything
 // BELOW that line is selected, including the image edges.
 // Keep strict/wide/all presets unchanged and the stored "near" setting
 // compatible with the existing on-device configuration.
 public static final String NEAR_ROI_VERSION="owner_drawn_sloped_garden_v6";
 private static final float[] MARKED_X={0f,.17f,.36f,.52f,.67f,1f};
 private static final float[] MARKED_Y={.519f,.519f,.497f,.484f,.441f,.433f};
 private String gardenZone="near";
 public String gardenZone(){return gardenZone;}
 public static boolean validGardenZone(String value){
  return "near".equals(value)||"strict".equals(value)||
    "wide".equals(value)||"all".equals(value);
 }
 public void setGardenZone(String value){
  if(!validGardenZone(value))throw new IllegalArgumentException("invalid_garden_region");
  if(!gardenZone.equals(value)){gardenZone=value;resetForCameraControl();}
 }
 public float topBoundary(){
  // Lower bound used by legacy archive retention probes; precise live
  // detection uses topBoundaryAt(x) instead of a horizontal cutoff.
  return "strict".equals(gardenZone)?0.72f:
    "near".equals(gardenZone)?0.433f:
    "wide".equals(gardenZone)?0.50f:0f;
 }
 public float sideMargin(){
  return "strict".equals(gardenZone)?0.09f:0f;
 }
 public static float markedTopAt(float x){
  float clamped=Math.max(0f,Math.min(1f,x));
  for(int i=1;i<MARKED_X.length;i++){
   if(clamped<=MARKED_X[i]){
    float factor=(clamped-MARKED_X[i-1])/(MARKED_X[i]-MARKED_X[i-1]);
    return MARKED_Y[i-1]+factor*(MARKED_Y[i]-MARKED_Y[i-1]);
   }
  }
  return MARKED_Y[MARKED_Y.length-1];
 }
 public static boolean insideZone(String zone,float x,float y){
  if(!validGardenZone(zone)||!Float.isFinite(x)||!Float.isFinite(y)||
     x<0f||x>1f||y<0f||y>1f)return false;
  if("near".equals(zone))return y>=markedTopAt(x);
  float boundary="strict".equals(zone)?0.72f:
      "wide".equals(zone)?0.50f:0f;
  float margin="strict".equals(zone)?0.09f:0f;
  return x>=margin&&x<=1f-margin&&y>=boundary;
 }
 public float topBoundaryAt(float x){
  return "near".equals(gardenZone)?markedTopAt(x):topBoundary();
 }
 public boolean insideGarden(float x,float y){
  return insideZone(gardenZone,x,y);
 }

 /** Restart temporal voting after an intentional Camera2 scene/exposure adjustment.
  *  Do not carry votes from the pre-control view into a new crop or lighting state.
  *  Called only from CameraService's cameraHandler; never deletes video evidence.
  */
 public void resetForCameraControl(){
  init=0;lastSample=0;sustainedEvidence=0;
  votes.clear();
  java.util.Arrays.fill(background,0f);
  java.util.Arrays.fill(nowCells,0f);
  java.util.Arrays.fill(changed,false);
  java.util.Arrays.fill(seen,false);
  changedRatio=0;coherent=0;lighting=0;
  motion=false;strong=false;
 }
 public boolean analyze(Image frame) {
  long t=SystemClock.elapsedRealtime();
  // A 30-fps ImageReader can call us several times between 190-ms
  // analysis windows. Re-emitting the previous true vote made one event
  // look like ~6 new motion events and extended the quiet window. Only
  // fresh sampled evidence is an actionable trigger.
  if(t-lastSample<190)return false;
  lastSample=t;
  Image.Plane p=frame.getPlanes()[0];
  ByteBuffer y=p.getBuffer();
  int width=frame.getWidth(),height=frame.getHeight();
  int stride=p.getRowStride(),pixelStride=p.getPixelStride();
  double global=0;
  for(int gy=0;gy<H;gy++){
   for(int gx=0;gx<W;gx++){
    int x=(gx*width/W)+(width/(W*2));
    int yy=(gy*height/H)+(height/(H*2));
    int acc=0,n=0;
    for(int dy=-2;dy<=2;dy+=2)for(int dx=-2;dx<=2;dx+=2){
     int xx=Math.max(0,Math.min(width-1,x+dx));
     int ry=Math.max(0,Math.min(height-1,yy+dy));
     int ix=ry*stride+xx*pixelStride;
     if(ix<y.limit()){acc+=(y.get(ix)&0xff);n++;}
    }
    int i=gy*W+gx;
    nowCells[i]=n>0?acc/(float)n:0;
    global+=nowCells[i];
   }
  }
  lighting=global/N;
  if(init<7){
   if(init==0)System.arraycopy(nowCells,0,background,0,N);
   else for(int i=0;i<N;i++)background[i]=0.75f*background[i]+0.25f*nowCells[i];
   init++;motion=false;strong=false;return false;
  }
  float shift=0;
  int validCells=0;
  for(int i=0;i<N;i++){
   int gx=i%W,gy=i/W;
   if(insideGarden((gx+.5f)/W,(gy+.5f)/H)){
    shift+=nowCells[i]-background[i];validCells++;
   }
  }
  if(validCells==0)return false;
  shift/=validCells;
  int nChange=0;
  for(int i=0;i<N;i++){
   // Garden-motion V4: lower only the dim-scene luma threshold modestly
   // (23 -> 22); keep daytime pixels, exposure subtraction and ROI unchanged.
   boolean c=Math.abs(nowCells[i]-background[i]-shift)>(lighting<42?22.0f:18.5f);
   // Motion outside the garden cannot vote or join connected regions.
   int gx=i%W,gy=i/W;
   c=c&&insideGarden((gx+.5f)/W,(gy+.5f)/H);
   changed[i]=c;
   if(c)nChange++;
  }
  changedRatio=nChange/(double)validCells;
  coherent=0;
  java.util.Arrays.fill(seen,false);
  for(int i=0;i<N;i++)if(changed[i]&&!seen[i]){
   int head=0,tail=0;
   stack[tail++]=i;seen[i]=true;
   while(head<tail){
    int j=stack[head++],x=j%W,z=j/W;
    int[] near=new int[]{x>0?j-1:-1,x<W-1?j+1:-1,z>0?j-W:-1,z<H-1?j+W:-1};
    for(int k:near)if(k>=0&&changed[k]&&!seen[k]){seen[k]=true;stack[tail++]=k;}
   }
   coherent=Math.max(coherent,tail);
  }
  // Sudden global exposure/camera adjustment should not count as an intruder.
  boolean dim=lighting<42;
  // Garden-motion V4 admits shorter/smaller garden crossings as *candidates*,
  // not as recordings. Existing SSD person gate remains the final decision.
  // 7-sample temporal vote and exposure-change rejection still apply.
  boolean meaningful=changedRatio>=(dim?0.030:0.020)&&changedRatio<0.46
      &&coherent>=(dim?8:6)&&Math.abs(shift)<(dim?18:26);
  votes.addLast(meaningful);
  while(votes.size()>7)votes.removeFirst();
  int positive=0;for(Boolean yes:votes)if(yes)positive++;
  motion=positive>=4;
  // Priority evidence must be coherent and sustained, not a single flash.
  boolean priority=meaningful && changedRatio>=(dim?0.055:0.035)
      && coherent>=(dim?13:9) && Math.abs(shift)<(dim?16:23);
  sustainedEvidence=priority?Math.min(8,sustainedEvidence+1):Math.max(0,sustainedEvidence-2);
  strong=motion && sustainedEvidence>=3;
  float alpha=motion?0.008f:0.045f;
  for(int i=0;i<N;i++)background[i]=background[i]*(1-alpha)+nowCells[i]*alpha;
  return motion;
 }
}
