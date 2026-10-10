package nl.kalenel.s9security;

import java.util.*;

/** Clip-scoped, anonymous person tracklets; never links different videos. */
public final class AnonymousClipTracks {
 public static final class Hit {
  public final float[] box; public final float confidence; public final String upperColour;
  public Hit(float[] b,float c,String colour) {
   if(b==null||b.length!=4)throw new IllegalArgumentException("box");
   box=b.clone();confidence=c;upperColour=colour==null?"uncertain":colour;
  }
 }
 public static final class Track {
  public final int id; public final long firstMs; public long lastMs;
  public int samples; public float peakConfidence; public float[] lastBox;
  public final Map<String,Integer> colourVotes=new LinkedHashMap<>();
  private Track(int n,long ms,Hit h){id=n;firstMs=ms;update(ms,h);}
  private void update(long ms,Hit h){
   lastMs=ms;samples++;peakConfidence=Math.max(peakConfidence,h.confidence);lastBox=h.box.clone();
   if(!"uncertain".equals(h.upperColour))
    colourVotes.put(h.upperColour,colourVotes.getOrDefault(h.upperColour,0)+1);
  }
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
 private static float area(float[] b){return Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]);}
 private static float iou(float[] a,float[] b){
  float top=Math.max(a[0],b[0]),left=Math.max(a[1],b[1]);
  float bottom=Math.min(a[2],b[2]),right=Math.min(a[3],b[3]);
  float overlap=Math.max(0,bottom-top)*Math.max(0,right-left);
  float union=area(a)+area(b)-overlap;
  return union>0?overlap/union:0;
 }
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
 /** Samples must be chronological. All IDs restart at 1 for each constructed clip. */
 public void addFrame(long ms,List<Hit> observations) {
  if(ms<0||ms<=lastFrameMs)throw new IllegalArgumentException("non_chronological_frame");
  if(observations==null)throw new IllegalArgumentException("null_observations");
  lastFrameMs=ms;
  List<Hit> valid=new ArrayList<>();
  for(Hit h:observations){
   if(h==null||!Float.isFinite(h.confidence)||h.confidence<.5f||h.confidence>1)continue;
   boolean good=true;
   for(float v:h.box)if(!Float.isFinite(v)||v<0||v>1){good=false;break;}
   if(!good||h.box[2]<=h.box[0]||h.box[3]<=h.box[1]||area(h.box)<.004f)continue;
   boolean duplicate=false;
   for(Hit prev:valid)if(iou(prev.box,h.box)>.65f){duplicate=true;break;}
   if(!duplicate)valid.add(h);
  }
  List<Pair> possible=new ArrayList<>();
  for(int t=0;t<tracks.size();t++){
   Track old=tracks.get(t);
   if(ms-old.lastMs>MAX_GAP_MS)continue;
   for(int h=0;h<valid.size();h++)if(eligible(old.lastBox,valid.get(h).box))
    possible.add(new Pair(t,h,iou(old.lastBox,valid.get(h).box)));
  }
  Collections.sort(possible,(a,b)->Float.compare(b.score,a.score));
  boolean[] usedOld=new boolean[tracks.size()],usedHit=new boolean[valid.size()];
  for(Pair p:possible)if(!usedOld[p.oldIndex]&&!usedHit[p.newIndex]){
   tracks.get(p.oldIndex).update(ms,valid.get(p.newIndex));
   usedOld[p.oldIndex]=true;usedHit[p.newIndex]=true;
  }
  for(int i=0;i<valid.size()&&tracks.size()<MAX_TRACKS;i++)
   if(!usedHit[i])tracks.add(new Track(nextId++,ms,valid.get(i)));
 }
 public List<Track> tracks(){return Collections.unmodifiableList(tracks);}
 public int appearances(){return tracks.size();}
}
