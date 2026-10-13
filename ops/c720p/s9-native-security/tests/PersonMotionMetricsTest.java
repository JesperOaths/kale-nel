package nl.kalenel.s9security;

public final class PersonMotionMetricsTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 private static PersonMotionMetrics.Observation sample(long ms,boolean walk,boolean truncated,boolean missingAnkle,int width){
  float shift=walk?ms/1000f*.025f:0;
  float[][] p=new float[17][3];for(int i=0;i<17;i++){p[i][0]=.3f;p[i][1]=.35f+shift;p[i][2]=.95f;}
  float aspect=1080f/width;
  p[5]=new float[]{.3f,.35f+shift-.04f*aspect,.95f};p[6]=new float[]{.3f,.35f+shift+.04f*aspect,.95f};
  p[11]=new float[]{.55f,.35f+shift-.03f*aspect,.95f};p[12]=new float[]{.55f,.35f+shift+.03f*aspect,.95f};
  p[13]=new float[]{.72f,p[11][1],.95f};p[14]=new float[]{.72f,p[12][1],.95f};
  float swing=walk?(float)Math.sin(ms/1000.0*2*Math.PI)*.06f*aspect:0;
  p[15]=new float[]{.9f,p[11][1]+swing,missingAnkle?.1f:.95f};
  p[16]=new float[]{.9f,p[12][1]-swing,.95f};
  p[9]=new float[]{.56f,.35f+shift-.09f*aspect-swing,.95f};
  p[10]=new float[]{.56f,.35f+shift+.09f*aspect+swing,.95f};
  return new PersonMotionMetrics.Observation(ms,width,1080,p,new float[]{.2f,.35f+shift-.15f*aspect,.95f,.35f+shift+.15f*aspect},truncated,
    String.format(java.util.Locale.US,"%064x",ms));
 }
 public static void main(String[] args){
  PersonMotionMetrics sparse=new PersonMotionMetrics();
  for(int i=0;i<12;i++)sparse.add(sample(i*600,true,false,false,1920));
  PersonMotionMetrics.Snapshot s=sparse.snapshot();
  check("available".equals(s.postureAvailability),"actual high-score torso joints provide posture");
  check(Double.isNaN(s.cadenceStepsPerMinute),"12 sparse samples cannot estimate walking cadence");
  check(!s.identityEligible,"pose descriptors never establish identity");
  PersonMotionMetrics walking=new PersonMotionMetrics();
  for(int i=0;i<32;i++)walking.add(sample(i*100,true,false,false,1920));
  s=walking.snapshot();
  check("available_projected_ankle_cycle".equals(s.gaitAvailability),"dense continuous alternating ankle movement measured");
  check(Math.abs(s.cadenceStepsPerMinute-120)<13,"two steps in each one-second gait cycle");
  check("projected_upright".equals(s.posture),"upright torso in image projection");
  check("image_right".equals(s.projectedDirection),"image movement direction");
  check(Double.isFinite(s.armSwingBodyHeights),"visible wrists measure projected swing");
  PersonMotionMetrics stationary=new PersonMotionMetrics();
  for(int i=0;i<32;i++)stationary.add(sample(i*100,false,false,false,1920));
  check(Double.isNaN(stationary.snapshot().cadenceStepsPerMinute),"still feet never produce cadence");
  PersonMotionMetrics clipped=new PersonMotionMetrics();
  for(int i=0;i<32;i++)clipped.add(sample(i*100,true,true,false,1920));
  check(Double.isNaN(clipped.snapshot().cadenceStepsPerMinute),"cut-off body cannot produce cadence");
  PersonMotionMetrics gap=new PersonMotionMetrics();
  for(int i=0;i<32;i++)gap.add(sample(i*100,true,false,i==15,1920));
  check(Double.isNaN(gap.snapshot().cadenceStepsPerMinute),"occlusion breaks continuous measurement");
  PersonMotionMetrics repeated=new PersonMotionMetrics();
  for(int i=0;i<32;i++){
   PersonMotionMetrics.Observation original=sample(i*100,true,false,false,1920);
   repeated.add(new PersonMotionMetrics.Observation(original.atMs,original.frameWidth,original.frameHeight,
     original.keypoints(),original.personBox(),false,String.format(java.util.Locale.US,"%064x",1)));
  }
  check(Double.isNaN(repeated.snapshot().cadenceStepsPerMinute),"decoder repeats cannot fabricate dense gait samples");
  PersonMotionMetrics widescreen=new PersonMotionMetrics(),square=new PersonMotionMetrics();
  for(int i=0;i<32;i++){widescreen.add(sample(i*100,true,false,false,1920));square.add(sample(i*100,true,false,false,1080));}
  check(Math.abs(widescreen.snapshot().kneeBendDegrees-square.snapshot().kneeBendDegrees)<.001,"angles correct for aspect ratio");
  check(Math.abs(widescreen.snapshot().ankleSwingBodyHeights-square.snapshot().ankleSwingBodyHeights)<.001,"joint motion correct for aspect ratio");
  PersonMotionMetrics limited=new PersonMotionMetrics();
  for(int i=0;i<200;i++)limited.add(sample(i*5,false,false,false,1920));
  check(limited.snapshot().samples==64,"bounded memory");
  limited.add(sample(0,false,false,false,1920));check(limited.snapshot().samples==64,"same-timestamp duplicate is not another observation");
  PersonMotionMetrics reversed=new PersonMotionMetrics();
  for(int i=31;i>=0;i--)reversed.add(sample(i*100,true,false,false,1920));
  check(Math.abs(reversed.snapshot().cadenceStepsPerMinute-walking.snapshot().cadenceStepsPerMinute)<.001,"sparse then burst insertion is sorted chronologically");
  boolean rejected=false;
  try{new PersonMotionMetrics.Observation(-1,1920,1080,new float[17][3],new float[]{.1f,.1f,.9f,.9f},false);}catch(IllegalArgumentException expected){rejected=true;}
  check(rejected,"invalid timestamp rejected");
  System.out.println("S9_PROJECTED_POSE_MOTION_TESTS_PASS");
 }
}
