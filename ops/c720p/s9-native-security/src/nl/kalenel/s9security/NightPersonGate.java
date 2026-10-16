package nl.kalenel.s9security;
import java.util.*;

/** Short-lived geometric motion evidence; no appearance or identity features. */
public final class NightPersonGate {
 public static final String VERSION="night_temporal_transport_v41";
 private static final class Sample {
  final long at,jpeg; final float score; final float[] box; final boolean motion;
  Sample(long at,long jpeg,float score,float[] box,int cells){this.at=at;this.jpeg=jpeg;this.score=score;this.box=box.clone();motion=cells>0;}
 }
 private final ArrayDeque<Sample> samples=new ArrayDeque<>();
 public long rejected,duplicates,confirmed;
 public void reset(){samples.clear();}
 public boolean offer(long now,long jpeg,float score,float[] box,int cells){
  if(now<=0||jpeg<=0||jpeg>now||now-jpeg>1200||!Float.isFinite(score)||
     score<.46f||!GardenPersonTrackGate.plausiblePersonShape(box)){
   rejected++;reset();return false;
  }
  Sample last=samples.peekLast();
  if(last!=null&&jpeg<=last.jpeg){duplicates++;return false;}
  if(last!=null&&(now<last.at||now-last.at>GardenPersonTrackGate.MAX_PAIR_MS||
      !GardenPersonTrackGate.samePerson(last.box,box))){reset();last=null;}
  if(last!=null&&jpeg-last.jpeg<350){duplicates++;return false;}
  while(!samples.isEmpty()&&now-samples.peekFirst().at>6500)samples.removeFirst();
  samples.addLast(new Sample(now,jpeg,score,box,cells));
  while(samples.size()>5)samples.removeFirst();
  if(samples.size()<3||jpeg-samples.peekFirst().jpeg<1100)return false;
  Sample first=samples.peekFirst();
  float minScore=1f,path=0f;int moving=0;Sample previous=null;
  for(Sample s:samples){
   minScore=Math.min(minScore,s.score);if(s.motion)moving++;
   if(previous!=null)path+=distance(previous.box,s.box);
   previous=s;
  }
  float displacement=distance(first.box,box);
  float width=Math.min(first.box[3]-first.box[1],box[3]-box[1]);
  float height=Math.min(first.box[2]-first.box[0],box[2]-box[0]);
  float dx=Math.abs((first.box[1]+first.box[3]-box[1]-box[3])*.5f);
  float dy=Math.abs((first.box[0]+first.box[2]-box[0]-box[2])*.5f);
  boolean translated=dx>=Math.max(.025f,width*.20f)||dy>=Math.max(.025f,height*.12f);
  // Reject oscillating box jitter and headlight flicker, even with local luma
  // votes. A genuinely moving pedestrian can survive a coarse-grid miss.
  boolean coherent=path>0&&displacement/path>=.60f;
  boolean supported=moving>=2||(minScore>=.72f&&GardenPersonTrackGate.movedClearly(first.box,box));
  if(translated&&coherent&&supported){confirmed++;reset();return true;}
  rejected++;return false;
 }
 private static float distance(float[] a,float[] b){
  double x=(a[1]+a[3]-b[1]-b[3])*.5,y=(a[0]+a[2]-b[0]-b[2])*.5;
  return (float)Math.sqrt(x*x+y*y);
 }
 /** Only challenge the SAME localized object; preserve pedestrians beside vehicles. */
 public static boolean transportConflict(float[] p,float ps,float[] v,float vs,String label){
  return transportConflict(p,ps,v,vs,label,640,480);
 }
 public static boolean transportConflict(float[] p,float ps,float[] v,float vs,String label,int width,int height){
  if(GardenPersonTrackGate.transportDominates(p,ps,v,vs,label))return true;
  if(!GardenPersonTrackGate.valid(p)||!GardenPersonTrackGate.valid(v)||
      !Float.isFinite(ps)||!Float.isFinite(vs)||label==null||width<=0||height<=0)return false;
  boolean motor=Arrays.asList("car","truck","bus","train").contains(label);
  boolean cycle="bicycle".equals(label)||"motorcycle".equals(label);
  if(!motor&&!cycle)return false;
  float common=Math.max(0,Math.min(p[2],v[2])-Math.max(p[0],v[0]))*
      Math.max(0,Math.min(p[3],v[3])-Math.max(p[1],v[1]));
  float pa=(p[2]-p[0])*(p[3]-p[1]),va=(v[2]-v[0])*(v[3]-v[1]);
  float iou=common/(pa+va-common),aspect=(p[2]-p[0])*height/((p[3]-p[1])*width);
  // A broad whole-cycle/car box mislabeled as a person. An upright rider's
  // independently detected upper body is intentionally retained.
  if(vs>=.55f&&vs>=ps+.04f&&iou>=.50f&&aspect<=1.25f)return true;
  float vh=v[2]-v[0];
  return motor&&vs>=.58f&&vs>=ps+.04f&&common/pa>=.88f&&pa/va>=.06f&&
      p[0]>=v[0]+.10f*vh&&(p[2]-p[0])<=.90f*vh;
 }
}
