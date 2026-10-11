package nl.kalenel.s9benchmark;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/**
 * Isolated experiment: 24x14 adaptive luma grid plus multi-person temporal tracker.
 * No Android dependency, camera ownership, storage writes or identity recognition.
 * Every input is a separate decoded video frame with a strictly increasing timestamp.
 *
 * Model detections: [yMin,xMin,yMax,xMax,score], coordinates in 0..1.
 * Person labels are supplied by the caller; class mapping MUST be verified there.
 */
public final class GardenShadowPipeline {
 public static final String VERSION="garden-shadow-v2-20261011";
 public static final int W=24,H=14,N=W*H,MAX_TRACKS=6;
 private static final float BOUNDARY=.64f,EDGE=.045f,WEAK=.44f,STRONG=.62f;
 private static final long GRACE_MS=2800,WINDOW_MS=5200;
 private final float[] background=new float[N],noise=new float[N],cells=new float[N];
 private final boolean[] changed=new boolean[N],visited=new boolean[N];
 private final int[] stack=new int[N];
 private final ArrayList<Track> tracks=new ArrayList<>();
 private final boolean[] votes=new boolean[5];
 private int warmup=0,voteCount=0,votePos=0,nextTrackId=1;
 private long lastTime=-1;
 public int frames=0,motionFrames=0,strongMotionFrames=0,confirmedEvents=0,
            rejectedDuplicates=0,rejectedOffGarden=0,exposureSuppressions=0;
 private static final class Track {
  int id,frames,strong;
  long first,last;
  boolean confirmed,matched;
  float[] box;
  Track(int id,long time,float[] v){
   this.id=id;first=time;last=time;frames=1;
   strong=v[4]>=STRONG?1:0;box=v.clone();matched=true;
  }
 }
 public static final class Result {
  public final boolean warmup,motion,strongMotion;
  public final int activeTracks,newPersonEvents,largestComponent,changedCells;
  public final float peakPersonScore,changedRatio,exposureShift;
  Result(boolean warm,boolean moving,boolean strong,int active,int events,int component,
         int cells,float peak,float ratio,float shift){
   warmup=warm;motion=moving;strongMotion=strong;activeTracks=active;
   newPersonEvents=events;largestComponent=component;changedCells=cells;
   peakPersonScore=peak;changedRatio=ratio;exposureShift=shift;
  }
 }
 private static float clamp(float v,float min,float max){return Math.max(min,Math.min(max,v));}
 private static float median(float[] values,int length){
  float[] ordered=Arrays.copyOf(values,length);Arrays.sort(ordered);
  return length%2==0?(ordered[length/2-1]+ordered[length/2])*.5f:ordered[length/2];
 }
 private static boolean validBox(float[] b){
  if(b==null||b.length!=5)return false;
  for(float n:b)if(Float.isNaN(n)||Float.isInfinite(n))return false;
  float width=b[3]-b[1],height=b[2]-b[0];
  return b[0]>=0&&b[1]>=0&&b[2]<=1&&b[3]<=1&&
   width>=.018f&&height>=.095f&&height/width>=1.05f&&
   b[4]>=WEAK&&b[4]<=1f;
 }
 private static boolean gardenBox(float[] b){
  float feet=b[2],cx=(b[1]+b[3])*.5f;
  float overlap=Math.max(0,b[2]-Math.max(BOUNDARY,b[0]))/Math.max(.01f,b[2]-b[0]);
  return feet>=BOUNDARY&&cx>=EDGE&&cx<=1-EDGE&&overlap>=.15f;
 }
 private static float similarity(float[] a,float[] b){
  float y1=Math.max(a[0],b[0]),x1=Math.max(a[1],b[1]);
  float y2=Math.min(a[2],b[2]),x2=Math.min(a[3],b[3]);
  float overlap=Math.max(0,y2-y1)*Math.max(0,x2-x1);
  float aa=(a[2]-a[0])*(a[3]-a[1]),bb=(b[2]-b[0])*(b[3]-b[1]);
  float iou=overlap/Math.max(.000001f,aa+bb-overlap);
  float ax=(a[1]+a[3])*.5f,bx=(b[1]+b[3])*.5f;
  float ay=(a[0]+a[2])*.5f,by=(b[0]+b[2])*.5f;
  float dh=Math.max(a[2]-a[0],b[2]-b[0]);
  float dx=Math.abs(ax-bx),dy=Math.abs(ay-by);
  // Gentle motion may have no box overlap over one second; bound association
  // by the apparent height so a different part of the garden is not joined.
  return iou>=.10f?2f+iou:(dx<Math.max(.055f,dh*.55f)&&dy<Math.max(.075f,dh*.45f)?
     1f-(dx+dy):0f);
 }
 public void reset(){
  Arrays.fill(background,0);Arrays.fill(noise,0);Arrays.fill(cells,0);
  Arrays.fill(votes,false);tracks.clear();
  warmup=0;voteCount=0;votePos=0;lastTime=-1;nextTrackId=1;
  frames=motionFrames=strongMotionFrames=confirmedEvents=rejectedDuplicates=
    rejectedOffGarden=exposureSuppressions=0;
 }
 private static boolean gardenCell(int i){
  int x=i%W,y=i/W;
  return (x+.5f)/W>=EDGE&&(x+.5f)/W<=1f-EDGE&&(y+.5f)/H>=BOUNDARY;
 }
 private int component(){
  Arrays.fill(visited,false);
  int biggest=0;
  for(int i=0;i<N;i++){
   if(!changed[i]||visited[i])continue;
   int head=0,tail=0;stack[tail++]=i;visited[i]=true;
   while(head<tail){
    int j=stack[head++],x=j%W,y=j/W;
    int top=y>0?j-W:-1,down=y<H-1?j+W:-1;
    int left=x>0?j-1:-1,right=x<W-1?j+1:-1;
    if(top>=0&&changed[top]&&!visited[top]){visited[top]=true;stack[tail++]=top;}
    if(down>=0&&changed[down]&&!visited[down]){visited[down]=true;stack[tail++]=down;}
    if(left>=0&&changed[left]&&!visited[left]){visited[left]=true;stack[tail++]=left;}
    if(right>=0&&changed[right]&&!visited[right]){visited[right]=true;stack[tail++]=right;}
   }
   biggest=Math.max(biggest,tail);
  }
  return biggest;
 }
 private int updateTracks(long time,float[][] detections){
  tracks.removeIf(t->time-t.last>GRACE_MS);
  for(Track t:tracks)t.matched=false;
  float[][] candidates=detections==null?new float[0][]:detections.clone();
  Arrays.sort(candidates,new Comparator<float[]>(){
   public int compare(float[] a,float[] b){
    float sa=a==null||a.length<5?0:a[4],sb=b==null||b.length<5?0:b[4];
    return Float.compare(sb,sa);
   }
  });
  int events=0;
  for(float[] d:candidates){
   if(!validBox(d))continue;
   if(!gardenBox(d)){rejectedOffGarden++;continue;}
   Track best=null;float max=0;
   for(Track t:tracks)if(!t.matched){
    float score=similarity(t.box,d);
    if(score>max){max=score;best=t;}
   }
   if(best==null){
    if(tracks.size()>=MAX_TRACKS)continue;
    tracks.add(new Track(nextTrackId++,time,d));
    continue;
   }
   if(time<=best.last)continue;
   // Require a fresh observation, not a duplicate inference from same image.
   if(time-best.first>WINDOW_MS&&!best.confirmed){
    best.first=time;best.frames=0;best.strong=0;
   }
   best.matched=true;best.frames++;
   if(d[4]>=STRONG)best.strong++;
   best.last=time;best.box=d.clone();
   if(!best.confirmed&&best.frames>=3&&best.strong>=2&&time-best.first<=WINDOW_MS){
    best.confirmed=true;confirmedEvents++;events++;
   }
  }
  return events;
 }
 public Result observe(long time,float[] luma,float[][] boxes){
  if(luma==null||luma.length!=N)throw new IllegalArgumentException("exact_24x14_luma_grid_required");
  if(time<=lastTime){rejectedDuplicates++;
   return new Result(warmup<5,false,false,activeTracks(time),0,0,0,0,0,0);
  }
  lastTime=time;frames++;
  for(int i=0;i<N;i++)cells[i]=clamp(luma[i],0,255);
  int events=updateTracks(time,boxes);
  float peak=0;for(float[] b:boxes==null?new float[0][]:boxes)
   if(validBox(b)&&gardenBox(b))peak=Math.max(peak,b[4]);
  if(warmup<5){
   for(int i=0;i<N;i++){
    background[i]=warmup==0?cells[i]:background[i]*.75f+cells[i]*.25f;
    noise[i]=Math.max(2f,noise[i]*.8f+Math.abs(cells[i]-background[i])*.2f);
   }
   warmup++;
   return new Result(true,false,false,activeTracks(time),events,0,0,peak,0,0);
  }
  float[] offsets=new float[N];
  int n=0;
  for(int i=0;i<N;i++)if(gardenCell(i))offsets[n++]=cells[i]-background[i];
  float exposure=median(offsets,n);
  if(Math.abs(exposure)>=38f)exposureSuppressions++;
  boolean exposureFlash=Math.abs(exposure)>=38f;
  int count=0,valid=0;
  for(int i=0;i<N;i++){
   if(!gardenCell(i)){changed[i]=false;continue;}
   valid++;
   float delta=Math.abs(cells[i]-background[i]-exposure);
   float threshold=Math.max(13f,Math.min(42f,14.5f+noise[i]*2.25f));
   changed[i]=!exposureFlash&&delta>threshold;
   if(changed[i])count++;
   // Learn the stationary sensor noise quickly, but avoid absorbing a
   // moving person into the background. Brightness changes tracked separately.
   float deviation=Math.min(30f,delta);
   float noiseRate=changed[i]?.016f:.085f;
   noise[i]=Math.max(1f,noise[i]*(1f-noiseRate)+deviation*noiseRate);
   float backgroundRate=changed[i]?.008f:.052f;
   background[i]=background[i]*(1f-backgroundRate)+(cells[i]-exposure)*backgroundRate;
  }
  float ratio=valid==0?0:count/(float)valid;
  int coherent=component();
  boolean meaningful=!exposureFlash&&ratio>=.035f&&ratio<=.48f&&coherent>=5;
  votes[votePos]=meaningful;votePos=(votePos+1)%votes.length;
  voteCount=Math.min(votes.length,voteCount+1);
  int positives=0;for(int i=0;i<voteCount;i++)if(votes[i])positives++;
  boolean motion=voteCount>=3&&positives>=2;
  boolean strong=motion&&meaningful&&coherent>=10&&ratio>=.075f;
  if(motion)motionFrames++;
  if(strong)strongMotionFrames++;
  return new Result(false,motion,strong,activeTracks(time),events,coherent,count,peak,ratio,exposure);
 }
 private int activeTracks(long now){
  int total=0;
  for(Track t:tracks)if(t.confirmed&&now-t.last<=GRACE_MS)total++;
  return total;
 }
 /** Bitmap pixels in ARGB8888 -> 24x14 mean luma, unbiased and independent of Android. */
 public static float[] grid(int[] argb,int width,int height){
  if(argb==null||width<=0||height<=0||(long)width*height>argb.length)
   throw new IllegalArgumentException("invalid_argb_frame");
  float[] result=new float[N];
  for(int y=0;y<H;y++)for(int x=0;x<W;x++){
   int x0=x*width/W,x1=Math.max(x0+1,(x+1)*width/W);
   int y0=y*height/H,y1=Math.max(y0+1,(y+1)*height/H);
   float sum=0;int n=0;
   for(int py=y0;py<y1;py+=Math.max(1,(y1-y0)/4))
    for(int px=x0;px<x1;px+=Math.max(1,(x1-x0)/4)){
     int c=argb[py*width+px];
     sum+=.2126f*((c>>16)&255)+.7152f*((c>>8)&255)+.0722f*(c&255);n++;
    }
   result[y*W+x]=sum/Math.max(1,n);
  }
  return result;
 }
}
