package nl.kalenel.s9security;

import java.util.*;

/** Clip-scoped, anonymous person tracklets; never links different videos. */
public final class AnonymousClipTracks {
 public static final String COUNT_VERSION="anonymous_temporal_support_v37";
 public static final class Hit {
  public final float[] box; public final float confidence; public final String upperColour;
  public Hit(float[] b,float c,String colour) {
   if(b==null||b.length!=4)throw new IllegalArgumentException("box");
   box=b.clone();confidence=c;upperColour=colour==null?"uncertain":colour;
  }
 }
 public static final class Track {
  public final int id; public final long firstMs; public long lastMs;
  public int samples; public float peakConfidence; public float[] firstBox,lastBox;
  private double pathInBodyHeights=0,pathInImageUnits=0;
  private int validMotionIntervals=0;
  private double confidenceSum=0;
  private float[] previousBox;private long previousMs;
  public final Map<String,Integer> colourVotes=new LinkedHashMap<>();
  private Track(int n,long ms,Hit h){id=n;firstMs=ms;firstBox=h.box.clone();update(ms,h);}
  private void update(long ms,Hit h){
   if(samples>0&&ms>lastMs){
    double dt=(ms-lastMs)/1000.0;
    double dx=(h.box[1]+h.box[3]-lastBox[1]-lastBox[3])*.5;
    double dy=(h.box[0]+h.box[2]-lastBox[0]-lastBox[2])*.5;
    double delta=Math.hypot(dx,dy);
    double height=(h.box[2]-h.box[0]+lastBox[2]-lastBox[0])*.5;
    double normalized=height>0.05?delta/height/dt:Double.POSITIVE_INFINITY;
    if(dt>=.2&&dt<=5.5&&Double.isFinite(normalized)&&normalized<=8){
     pathInBodyHeights+=delta/height;
     pathInImageUnits+=delta;
     validMotionIntervals++;
    }
   }
   if(samples>0){previousBox=lastBox.clone();previousMs=lastMs;}
   lastMs=ms;samples++;confidenceSum+=h.confidence;peakConfidence=Math.max(peakConfidence,h.confidence);lastBox=h.box.clone();
   if(!"uncertain".equals(h.upperColour))
    colourVotes.put(h.upperColour,colourVotes.getOrDefault(h.upperColour,0)+1);
  }
  /** Repeated detector evidence only; never a human-presence confirmation. */
  public boolean temporalSupport(){return samples>=2&&lastMs-firstMs>=500;}
  public double meanConfidence(){return samples==0?0:confidenceSum/samples;}
  public String evidenceStatus(){return temporalSupport()?"temporally_supported_candidate":samples==1?"single_frame_candidate":"short_span_candidate";}
  /** Camera-image movement only, never walking cadence or cross-video identity. */
  public String imageDirection(){
   if(samples<3||lastMs-firstMs<600)return "insufficient_samples";
   float x0=(firstBox[1]+firstBox[3])*.5f,y0=(firstBox[0]+firstBox[2])*.5f;
   float x1=(lastBox[1]+lastBox[3])*.5f,y1=(lastBox[0]+lastBox[2])*.5f;
   float dx=x1-x0,dy=y1-y0;
   if(dx*dx+dy*dy<.0016f)return "stationary_or_uncertain";
   if(Math.abs(dx)>=1.3f*Math.abs(dy))return dx>0?"image_right":"image_left";
   if(Math.abs(dy)>=1.3f*Math.abs(dx))return dy>0?"image_down":"image_up";
   return "diagonal";
  }
  /** Camera-image displacement per apparent body height / second.
   * NOT physical speed, stride, gait or identity: perspective remains unknown.
   */
  public Double imageSpeedBodyHeightsPerSecond(){
   if(samples<3||validMotionIntervals<2||lastMs-firstMs<600)return null;
   double v=pathInBodyHeights*1000/(lastMs-firstMs);
   return Double.isFinite(v)&&v>=0&&v<=8?Math.round(v*1000)/1000.0:null;
  }
  /** Straightness of the 2D image trajectory, not a gait measurement. */
  public Double imagePathStraightness(){
   if(samples<3||validMotionIntervals<2||pathInImageUnits<.002)return null;
   double dx=(lastBox[1]+lastBox[3]-firstBox[1]-firstBox[3])*.5;
   double dy=(lastBox[0]+lastBox[2]-firstBox[0]-firstBox[2])*.5;
   double v=Math.hypot(dx,dy)/pathInImageUnits;
   return Double.isFinite(v)?Math.round(Math.max(0,Math.min(1,v))*1000)/1000.0:null;
  }
  /** Object-detector rectangle width divided by height, NOT body posture. */
  public Double imageBoxAspectRatio(){
   if(samples<3)return null;
   double h=lastBox[2]-lastBox[0],w=lastBox[3]-lastBox[1];
   if(h<.05||w<.02)return null;
   return Math.round(w/h*1000)/1000.0;
  }
  public String postureAvailability(){return "not_measured_no_pose_keypoints";}
  public String colour(){
   String best="uncertain";int count=0;
   for(Map.Entry<String,Integer> e:colourVotes.entrySet())
    if(e.getValue()>count){best=e.getKey();count=e.getValue();}
   return best;
  }
 }
 private static final long MAX_GAP_MS=5500;
 private static final int MAX_TRACKS=64;
 private final List<Track> tracks=new ArrayList<>();
 private int nextId=1;
 private long lastFrameMs=-1;
 private int peakConcurrent=0;
 private final List<int[]> observedGroups=new ArrayList<>();
 private final Map<Long,long[]> pairSupport=new HashMap<>();
 private static float area(float[] b){return Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]);}
 private static float iou(float[] a,float[] b){
  float top=Math.max(a[0],b[0]),left=Math.max(a[1],b[1]);
  float bottom=Math.min(a[2],b[2]),right=Math.min(a[3],b[3]);
  float overlap=Math.max(0,bottom-top)*Math.max(0,right-left);
  float union=area(a)+area(b)-overlap;
  return union>0?overlap/union:0;
 }
 /** Spatial duplicate suppression, exclusively within a single decoded frame.
  * A nearby centre alone cannot collapse two genuinely overlapping people. */
 public static boolean duplicateBox(float[] a,float[] b){
  if(a==null||b==null||a.length!=4||b.length!=4)return false;
  for(float[] box:new float[][]{a,b})for(float x:box)
   if(!Float.isFinite(x)||x<0||x>1)return false;
  float aa=area(a),bb=area(b);
  if(aa<=0||bb<=0)return false;
  if(iou(a,b)>=.60f)return true;
  float intersection=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*
    Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
  float dx=Math.abs((a[1]+a[3]-b[1]-b[3])*.5f);
  float dy=Math.abs((a[0]+a[2]-b[0]-b[2])*.5f);
  return intersection/Math.min(aa,bb)>=.90f&&Math.min(aa,bb)/Math.max(aa,bb)>=.40f&&
    dx<=.12f*Math.min(a[3]-a[1],b[3]-b[1])&&
    dy<=.18f*Math.min(a[2]-a[0],b[2]-b[0]);
 }
 public static List<Hit> distinct(List<Hit> observations){
  List<Hit> sorted=new ArrayList<>();
  for(Hit h:observations){
   if(h==null||!Float.isFinite(h.confidence)||h.confidence<.5f||h.confidence>1)continue;
   boolean good=true;
   for(float v:h.box)if(!Float.isFinite(v)||v<0||v>1){good=false;break;}
   if(good&&h.box[2]>h.box[0]&&h.box[3]>h.box[1]&&area(h.box)>=.004f)sorted.add(h);
  }
  sorted.sort((a,b)->Float.compare(b.confidence,a.confidence));
  List<Hit> result=new ArrayList<>();
  for(Hit hit:sorted){
   boolean duplicate=false;
   for(Hit kept:result)if(duplicateBox(kept.box,hit.box)){duplicate=true;break;}
   if(!duplicate)result.add(hit);
   if(result.size()==10)break;
  }
  return result;
 }
 private static long pairKey(int a,int b){return ((long)Math.min(a,b)<<32)|Math.max(a,b);}
 private static boolean eligible(float[] a,float[] b) {
  if(iou(a,b)>=.18f)return true;
  float cx=(a[1]+a[3]-b[1]-b[3])*.5f,cy=(a[0]+a[2]-b[0]-b[2])*.5f;
  float ratio=Math.min(area(a),area(b))/Math.max(.00001f,Math.max(area(a),area(b)));
  return cx*cx+cy*cy<.015f&&ratio>.48f;
 }
 private static final class Pair {
  final int oldIndex,newIndex;final float score;
  Pair(int a,int b,float s){oldIndex=a;newIndex=b;score=s;}
 }
 private static float association(Track old,Hit hit,long ms){
  float[] predicted=old.lastBox.clone();
  if(old.previousBox!=null&&old.lastMs>old.previousMs){
   float ratio=Math.min(1.5f,(ms-old.lastMs)/(float)(old.lastMs-old.previousMs));
   float dx=((old.lastBox[1]+old.lastBox[3]-old.previousBox[1]-old.previousBox[3])*.5f)*ratio;
   float dy=((old.lastBox[0]+old.lastBox[2]-old.previousBox[0]-old.previousBox[2])*.5f)*ratio;
   dx=Math.max(-.15f,Math.min(.15f,dx));dy=Math.max(-.15f,Math.min(.15f,dy));
   for(int i=0;i<4;i++)predicted[i]=Math.max(0,Math.min(1,predicted[i]+(i%2==0?dy:dx)));
  }
  if(!eligible(predicted,hit.box)&&!eligible(old.lastBox,hit.box))return -1;
  if(ms-old.lastMs>3000&&iou(predicted,hit.box)<.12f)return -1;
  if(iou(old.lastBox,hit.box)<.18f&&!"uncertain".equals(hit.upperColour)&&
     !"uncertain".equals(old.colour())&&!hit.upperColour.equals(old.colour()))return -1;
  return iou(predicted,hit.box)+.25f*iou(old.lastBox,hit.box);
 }
 /** Samples must be chronological. All IDs restart at 1 for each constructed clip. */
 public void addFrame(long ms,List<Hit> observations) {
  if(ms<0||ms<=lastFrameMs)throw new IllegalArgumentException("non_chronological_frame");
  if(observations==null)throw new IllegalArgumentException("null_observations");
  lastFrameMs=ms;
  List<Hit> valid=distinct(observations);
  peakConcurrent=Math.max(peakConcurrent,valid.size());
  int[] assigned=new int[valid.size()];
  List<Pair> possible=new ArrayList<>();
  for(int t=0;t<tracks.size();t++){
   Track old=tracks.get(t);
   if(ms-old.lastMs>MAX_GAP_MS)continue;
   for(int h=0;h<valid.size();h++){
    float score=association(old,valid.get(h),ms);
    if(score>=0)possible.add(new Pair(t,h,score));
   }
  }
  Collections.sort(possible,(a,b)->Float.compare(b.score,a.score));
  boolean[] usedOld=new boolean[tracks.size()],usedHit=new boolean[valid.size()];
  for(Pair p:possible)if(!usedOld[p.oldIndex]&&!usedHit[p.newIndex]){
   tracks.get(p.oldIndex).update(ms,valid.get(p.newIndex));
   usedOld[p.oldIndex]=true;usedHit[p.newIndex]=true;
   assigned[p.newIndex]=tracks.get(p.oldIndex).id;
  }
  for(int i=0;i<valid.size()&&tracks.size()<MAX_TRACKS;i++)
   if(!usedHit[i]){Track t=new Track(nextId++,ms,valid.get(i));tracks.add(t);assigned[i]=t.id;}
  int[] group=Arrays.stream(assigned).filter(x->x>0).sorted().toArray();
  if(group.length>1){
   // Bound retained frames as well as tracks. Normal review uses <=12 frames.
   if(observedGroups.size()<256)observedGroups.add(group);
   for(int i=0;i<group.length;i++)for(int j=i+1;j<group.length;j++){
    long key=pairKey(group[i],group[j]);long[] support=pairSupport.get(key);
    if(support==null)pairSupport.put(key,new long[]{1,ms,ms});
    else{support[0]++;support[2]=ms;}
   }
  }
 }
 /** Largest concurrently observed group corroborated on separate frames.
  * Fragmented sightings never increase this count. This is a sampled lower
  * bound, not a count of unique identities or a no-person guarantee. */
 public int repeatedConcurrentPeople(){
  int best=0;for(Track track:tracks)if(track.temporalSupport()){best=1;break;}
  for(int[] group:observedGroups)for(int mask=1;mask<(1<<group.length);mask++){
   int count=Integer.bitCount(mask);if(count<=best)continue;
   boolean supported=true;
   for(int i=0;i<group.length;i++)if((mask&(1<<i))!=0&&!tracks.get(group[i]-1).temporalSupport()){supported=false;break;}
   for(int i=0;i<group.length&&supported;i++)if((mask&(1<<i))!=0)
    for(int j=i+1;j<group.length;j++)if((mask&(1<<j))!=0){
     long[] s=pairSupport.get(pairKey(group[i],group[j]));
     if(s==null||s[0]<2||s[2]-s[1]<500){supported=false;break;}
    }
   if(supported)best=count;
  }
  return best;
 }
 public int peakConcurrentPeople(){return peakConcurrent;}
 public List<Track> tracks(){return Collections.unmodifiableList(tracks);}
 public int appearances(){return tracks.size();}
}
