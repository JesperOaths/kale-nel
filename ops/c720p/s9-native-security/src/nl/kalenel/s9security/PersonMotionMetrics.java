package nl.kalenel.s9security;

import java.util.*;

/** Bounded, clip-scoped camera-projected pose measurements. Not an identity model.
 * Coordinates use MoveNet's [y,x,score] order in the ORIGINAL image, not its crop.
 * Angles/distances correct for the original image's aspect ratio. No world height,
 * real speed, health, age, gender, or cross-video identity is inferred.
 */
public final class PersonMotionMetrics {
 public static final String VERSION="projected_pose_motion_v1";
 public static final int MAX_SAMPLES=64;
 public static final float MIN_SCORE=.45f;
 private static final int[] TORSO={5,6,11,12},LOWER={5,6,11,12,13,14,15,16};
 private static final long MAX_DENSE_GAP_MS=180,MIN_DENSE_SPAN_MS=2500;
 private static final int MIN_DENSE_SAMPLES=22;

 public static final class Observation {
  public final long atMs;
  public final int frameWidth,frameHeight;
  public final boolean touchesFrameEdge;
  public final String frameEvidenceFingerprint;
  private final float[][] points;
  private final float[] box;
  public Observation(long atMs,int width,int height,float[][] yxScores,float[] yxBox,
                     boolean touchesFrameEdge){
   this(atMs,width,height,yxScores,yxBox,touchesFrameEdge,"");
  }
  public Observation(long atMs,int width,int height,float[][] yxScores,float[] yxBox,
                     boolean touchesFrameEdge,String frameEvidenceFingerprint){
   if(atMs<0||width<16||height<16||yxScores==null||yxScores.length!=17||!validBox(yxBox))
    throw new IllegalArgumentException("invalid_pose_observation");
   this.atMs=atMs;frameWidth=width;frameHeight=height;box=yxBox.clone();
   if(frameEvidenceFingerprint!=null&&!frameEvidenceFingerprint.isEmpty()&&!frameEvidenceFingerprint.matches("[a-f0-9]{64}"))
    throw new IllegalArgumentException("invalid_frame_fingerprint");
   this.frameEvidenceFingerprint=frameEvidenceFingerprint==null?"":frameEvidenceFingerprint;
   this.touchesFrameEdge=touchesFrameEdge||box[0]<=.01f||box[1]<=.01f||box[2]>=.99f||box[3]>=.99f;
   points=new float[17][3];
   for(int i=0;i<17;i++){
    if(yxScores[i]==null||yxScores[i].length!=3)throw new IllegalArgumentException("invalid_pose_point");
    float y=yxScores[i][0],x=yxScores[i][1],score=yxScores[i][2];
    if(!Float.isFinite(y)||!Float.isFinite(x)||!Float.isFinite(score)||score<0||score>1)
     throw new IllegalArgumentException("invalid_pose_point");
    points[i][0]=y;points[i][1]=x;
    points[i][2]=y<0||y>1||x<0||x>1?0:score;
   }
  }
  public float[][] keypoints(){
   float[][] copy=new float[17][3];for(int i=0;i<17;i++)copy[i]=points[i].clone();return copy;
  }
  public float[] personBox(){return box.clone();}
  private double x(int i){return points[i][1]*frameWidth/(double)frameHeight;}
  private double y(int i){return points[i][0];}
  private double distance(int a,int b){return Math.hypot(x(a)-x(b),y(a)-y(b));}
  private boolean visible(int[] joints){
   for(int i:joints)if(points[i][2]<MIN_SCORE)return false;
   return true;
  }
  private boolean torso(){
   if(!visible(TORSO)||(box[2]-box[0])*frameHeight<70)return false;
   // Require all torso anchors near the detector's candidate; single-pose models
   // can otherwise choose a nearby person in the padded crop.
   float padX=(box[3]-box[1])*.15f,padY=(box[2]-box[0])*.1f;
   for(int i:TORSO)if(points[i][1]<box[1]-padX||points[i][1]>box[3]+padX||
                      points[i][0]<box[0]-padY||points[i][0]>box[2]+padY)return false;
   return Math.hypot(hipX()-shoulderX(),hipY()-shoulderY())>.025;
  }
  private boolean fullBody(){
   if(!torso()||touchesFrameEdge||!visible(LOWER)||(box[2]-box[0])*frameHeight<100)return false;
   for(int i:LOWER)if(points[i][0]<=.005||points[i][0]>=.995||points[i][1]<=.005||points[i][1]>=.995)
    return false;
   return bodyHeight()>.12;
  }
  private double shoulderX(){return (x(5)+x(6))*.5;}
  private double shoulderY(){return (y(5)+y(6))*.5;}
  private double hipX(){return (x(11)+x(12))*.5;}
  private double hipY(){return (y(11)+y(12))*.5;}
  private double bodyHeight(){return (box[2]-box[0]);}
  private double confidence(){double total=0;for(int i:LOWER)total+=points[i][2];return total/LOWER.length;}
  private double lean(){return Math.toDegrees(Math.atan2(Math.abs(hipX()-shoulderX()),Math.abs(hipY()-shoulderY())));}
  private double kneeBend(){return 180-(angle(11,13,15)+angle(12,14,16))*.5;}
  private double angle(int a,int b,int c){
   double ux=x(a)-x(b),uy=y(a)-y(b),vx=x(c)-x(b),vy=y(c)-y(b);
   double denominator=Math.hypot(ux,uy)*Math.hypot(vx,vy);
   return denominator<.00001?Double.NaN:Math.toDegrees(Math.acos(Math.max(-1,Math.min(1,(ux*vx+uy*vy)/denominator))));
  }
 }

 public static final class Snapshot {
  public final String postureAvailability,gaitAvailability,posture,projectedDirection;
  public final int samples,torsoSamples,fullBodySamples,denseSamples;
  public final long firstMs,lastMs,denseSpanMs;
  public final double meanConfidence,torsoLeanDegrees,kneeBendDegrees,shoulderHipRatio;
  public final double apparentSpeedBodyHeightsPerSecond,cadenceStepsPerMinute;
  public final double ankleSwingBodyHeights,periodicity,armSwingBodyHeights;
  public final boolean identityEligible=false;
  private Snapshot(String pa,String ga,String p,String direction,int samples,int torso,int full,int dense,
                   long first,long last,long span,double confidence,double lean,double knee,double ratio,
                   double speed,double cadence,double ankle,double periodicity,double arm){
   postureAvailability=pa;gaitAvailability=ga;posture=p;projectedDirection=direction;
   this.samples=samples;torsoSamples=torso;fullBodySamples=full;denseSamples=dense;
   firstMs=first;lastMs=last;denseSpanMs=span;meanConfidence=confidence;
   torsoLeanDegrees=lean;kneeBendDegrees=knee;shoulderHipRatio=ratio;
   apparentSpeedBodyHeightsPerSecond=speed;cadenceStepsPerMinute=cadence;
   ankleSwingBodyHeights=ankle;this.periodicity=periodicity;armSwingBodyHeights=arm;
  }
 }

 private final TreeMap<Long,Observation> observations=new TreeMap<>();
 public void add(Observation observation){
  if(observation==null)throw new IllegalArgumentException("null_pose_observation");
  Observation old=observations.get(observation.atMs);
  if(old!=null){if(observation.confidence()>old.confidence())observations.put(observation.atMs,observation);return;}
  if(observations.size()<MAX_SAMPLES)observations.put(observation.atMs,observation);
 }
 public static boolean validBox(float[] b){
  if(b==null||b.length!=4)return false;
  for(float value:b)if(!Float.isFinite(value)||value<0||value>1)return false;
  return b[2]>b[0]&&b[3]>b[1];
 }
 private static double median(List<Double> values){
  if(values.isEmpty())return Double.NaN;
  List<Double> sorted=new ArrayList<>(values);Collections.sort(sorted);int mid=sorted.size()/2;
  return sorted.size()%2==1?sorted.get(mid):(sorted.get(mid-1)+sorted.get(mid))*.5;
 }
 private static double range(double[] signal){
  double lo=Double.POSITIVE_INFINITY,hi=Double.NEGATIVE_INFINITY;
  for(double v:signal){lo=Math.min(lo,v);hi=Math.max(hi,v);}return hi-lo;
 }
 private static double rms(double[] signal){double sum=0;for(double v:signal)sum+=v*v;return Math.sqrt(sum/signal.length);}
 private static double mean(double[] values){double total=0;for(double v:values)total+=v;return total/values.length;}
 private static double[] demean(double[] values){double m=mean(values);double[] result=values.clone();for(int i=0;i<result.length;i++)result[i]-=m;return result;}
 private static double correlation(double[] values,int lag){
  double a=0,b=0,c=0;
  for(int i=0;i<values.length-lag;i++){a+=values[i]*values[i+lag];b+=values[i]*values[i];c+=values[i+lag]*values[i+lag];}
  return b*c<1e-10?0:a/Math.sqrt(b*c);
 }
 // Resampling accepts only already dense/continuous measured frames. It does
 // not turn sparse clip samples or an occlusion gap into a walking sequence.
 private static double[] uniformSignal(List<Observation> dense,boolean horizontal,boolean wrist){
  int n=(int)((dense.get(dense.size()-1).atMs-dense.get(0).atMs)/100)+1;
  double[] result=new double[n];int left=0;
  for(int i=0;i<n;i++){
   long time=dense.get(0).atMs+i*100;
   while(left+1<dense.size()-1&&dense.get(left+1).atMs<time)left++;
   Observation a=dense.get(left),b=dense.get(Math.min(left+1,dense.size()-1));
   double fraction=b.atMs==a.atMs?0:(time-a.atMs)/(double)(b.atMs-a.atMs);
   int j=wrist?9:15,k=wrist?10:16;
   double av=(horizontal?a.x(j)-a.x(k):a.y(j)-a.y(k))/a.bodyHeight();
   double bv=(horizontal?b.x(j)-b.x(k):b.y(j)-b.y(k))/b.bodyHeight();
   result[i]=av+(bv-av)*fraction;
  }
  return result;
 }
 public Snapshot snapshot(){
  List<Observation> frames=new ArrayList<>(observations.values()),torso=new ArrayList<>(),full=new ArrayList<>();
  List<Double> leans=new ArrayList<>(),knees=new ArrayList<>(),ratios=new ArrayList<>();
  double confidence=0;
  for(Observation frame:frames){
   confidence+=frame.confidence();
   if(frame.torso()){
    torso.add(frame);leans.add(frame.lean());
    double hipWidth=frame.distance(11,12);
    if(hipWidth>.025&&frame.distance(5,6)>.025)ratios.add(frame.distance(5,6)/hipWidth);
   }
   if(frame.fullBody()){full.add(frame);double knee=frame.kneeBend();if(Double.isFinite(knee))knees.add(knee);}
  }
  String pa=torso.size()>=3?"available":"insufficient_visible_torso",posture="unavailable";
  double lean=torso.size()>=3?median(leans):Double.NaN;
  double knee=knees.size()>=3?median(knees):Double.NaN;
  double ratio=ratios.size()>=3?median(ratios):Double.NaN;
  if(Double.isFinite(lean))posture=lean>=65?"projected_horizontal":lean>=20?"projected_leaning":
    Double.isFinite(knee)&&knee>=45?"projected_bent_knees":"projected_upright";
  String direction="insufficient_samples";
  double speed=Double.NaN;
  if(torso.size()>=3){
   Observation first=torso.get(0),last=torso.get(torso.size()-1);
   if(last.atMs-first.atMs>=600){
    double dx=last.hipX()-first.hipX(),dy=last.hipY()-first.hipY();
    double scale=(first.bodyHeight()+last.bodyHeight())*.5,displacement=Math.hypot(dx,dy)/scale;
    if(displacement<.1)direction="stationary_or_uncertain";
    else if(Math.abs(dx)>=1.3*Math.abs(dy))direction=dx>0?"image_right":"image_left";
    else if(Math.abs(dy)>=1.3*Math.abs(dx))direction=dy>0?"image_down":"image_up";
    else direction="diagonal";
    speed=displacement*1000/(last.atMs-first.atMs);
   }
  }
  // Pick the longest contiguous full-body series. Any low-confidence frame,
  // crop cut-off or >180ms gap breaks the series instead of being interpolated.
  List<Observation> dense=new ArrayList<>(),current=new ArrayList<>();
  Set<String> frameEvidence=new HashSet<>();
  for(Observation frame:frames){
   boolean unique=!frame.frameEvidenceFingerprint.isEmpty()&&frameEvidence.add(frame.frameEvidenceFingerprint);
   if(!frame.fullBody()||!unique){if(current.size()>dense.size())dense=new ArrayList<>(current);current.clear();continue;}
   if(!current.isEmpty()&&frame.atMs-current.get(current.size()-1).atMs>MAX_DENSE_GAP_MS){
    if(current.size()>dense.size())dense=new ArrayList<>(current);current.clear();
   }
   current.add(frame);
  }
  if(current.size()>dense.size())dense=new ArrayList<>(current);
  long span=dense.isEmpty()?0:dense.get(dense.size()-1).atMs-dense.get(0).atMs;
  String ga="insufficient_dense_full_body_samples";
  double cadence=Double.NaN,ankle=Double.NaN,periodicity=Double.NaN,arm=Double.NaN;
  if(dense.size()>=MIN_DENSE_SAMPLES&&span>=MIN_DENSE_SPAN_MS&&span<=6000){
   // Preserve an actual >=8fps mean cadence as well as the per-gap bound.
   if((dense.size()-1)*1000.0/span>=8){
    double[] horizontal=uniformSignal(dense,true,false),vertical=uniformSignal(dense,false,false);
    boolean useHorizontal=range(horizontal)>=range(vertical);
    double[] signal=demean(useHorizontal?horizontal:vertical);
    ankle=range(signal);
    Observation first=dense.get(0),last=dense.get(dense.size()-1);
    double displacement=Math.hypot(last.hipX()-first.hipX(),last.hipY()-first.hipY())/
      ((first.bodyHeight()+last.bodyHeight())*.5);
    ga="no_reliable_walking_periodicity";
    if(ankle>=.08&&rms(signal)>=.025&&displacement>=.12){
     // Same-leg full cycles: search 0.6..2.0s, retain >=2 observed cycles;
     // steps/min = two steps per bilateral gait cycle. The estimate describes
     // visible alternating ankle motion and must not be treated as identity.
     int bestLag=0;double best=0;
     int maxLag=Math.min(20,(signal.length-1)/2);
     for(int lag=6;lag<=maxLag;lag++){
      double correlation=correlation(signal,lag);
      if(correlation>best){best=correlation;bestLag=lag;}
     }
     // Reject flat autocorrelation / slow drift; an oscillation should invert
     // roughly halfway through its full cycle.
     if(bestLag>0&&best>=.72&&correlation(signal,Math.max(1,bestLag/2))<=-.25){
      cadence=1200.0/bestLag;periodicity=best;ga="available_projected_ankle_cycle";
     }
    }
    boolean wrists=true;
    for(Observation frame:dense)if(frame.points[9][2]<MIN_SCORE||frame.points[10][2]<MIN_SCORE){wrists=false;break;}
    if(wrists)arm=range(uniformSignal(dense,useHorizontal,true));
   }
  }
  return new Snapshot(pa,ga,posture,direction,frames.size(),torso.size(),full.size(),dense.size(),
    frames.isEmpty()?0:frames.get(0).atMs,frames.isEmpty()?0:frames.get(frames.size()-1).atMs,span,
    frames.isEmpty()?0:confidence/frames.size(),lean,knee,ratio,speed,cadence,ankle,periodicity,arm);
 }
}
