package nl.kalenel.s9security;
import java.util.*;
public final class NightDetectionV41Test {
 static int n;
 static void check(boolean b,String m){n++;if(!b)throw new AssertionError(m);}
 static float[] box(float x){return new float[]{.30f,x,.78f,x+.16f};}
 static boolean offer(NightPersonGate g,int i,float x,float score,int cells){return g.offer(1000+i*900,950+i*900,score,box(x),cells);}
 static AnonymousClipTracks.Hit hit(float x,float score){return new AnonymousClipTracks.Hit(box(x),score,"uncertain");}
 public static void main(String[] args){
  for(float score:new float[]{.47f,.60f,.90f}){
   NightPersonGate g=new NightPersonGate();
   for(int i=0;i<20;i++)check(!offer(g,i,.3f,score,8),"headlights over stationary false person never admit");
  }
  NightPersonGate g=new NightPersonGate();
  for(int i=0;i<20;i++)check(!offer(g,i,.3f+(i%2==0?.005f:-.005f),.8f,9),"oscillating detector jitter rejected");
  for(float score:new float[]{.47f,.62f,.84f}){
   g=new NightPersonGate();check(!offer(g,0,.30f,score,2),"first waits");
   check(!offer(g,1,.34f,score,2),"second waits");
   check(offer(g,2,.38f,score,2),"moving lowlight pedestrian admitted");
  }
  g=new NightPersonGate();offer(g,0,.3f,.8f,0);offer(g,1,.34f,.8f,0);
  check(offer(g,2,.38f,.8f,0),"strong pedestrian survives coarse-grid miss");
  g=new NightPersonGate();offer(g,0,.3f,.51f,0);offer(g,1,.34f,.51f,0);
  check(!offer(g,2,.38f,.51f,0),"weak moving boxes need fresh motion");
  g=new NightPersonGate();offer(g,0,.3f,.8f,3);
  check(!g.offer(1900,950,.8f,box(.34f),3),"duplicate JPEG rejected");
  check(!g.offer(2500,1000,.8f,box(.38f),3),"stale JPEG resets evidence");
  g=new NightPersonGate();offer(g,0,.3f,.8f,3);offer(g,1,.34f,.8f,3);
  check(!g.offer(9000,8950,.8f,box(.38f),3),"expired track cannot confirm");
  g=new NightPersonGate();offer(g,0,.3f,.8f,3);
  check(!g.offer(500,450,.8f,box(.38f),3),"clock reversal resets");
  g=new NightPersonGate();check(!offer(g,0,.3f,Float.NaN,3),"NaN rejected");
  check(!g.offer(1000,950,.8f,null,3),"null box rejected");
  float[] car={.4f,.2f,.8f,.8f},window={.5f,.35f,.76f,.55f};
  check(NightPersonGate.transportConflict(window,.53f,car,.62f,"car"),"night car-window ambiguity vetoed");
  check(!NightPersonGate.transportConflict(window,.82f,car,.62f,"car"),"stronger pedestrian retained");
  check(!NightPersonGate.transportConflict(new float[]{.1f,.32f,.8f,.48f},.60f,car,.94f,"car"),"head above roof preserved");
  check(!NightPersonGate.transportConflict(new float[]{.2f,.82f,.8f,.95f},.60f,car,.94f,"car"),"person beside car preserved");
  check(!NightPersonGate.transportConflict(window,.53f,car,.62f,"bicycle"),"separate rider upper body preserved");
  float[] cycle={.4f,.2f,.8f,.58f};
  check(NightPersonGate.transportConflict(cycle,.53f,cycle,.62f,"bicycle"),"whole bicycle mislabeled person vetoed");
  NightScenePolicy p=new NightScenePolicy();
  check(p.update(25,1000),"real dark-scene luma activates night");
  check(p.update(120,2000),"headlight flash stays night");
  check(p.update(25,6000),"return to dark resets bright timer");
  check(p.update(90,10000),"sustained dawn begins");
  check(p.update(90,24999),"hysteresis retained");
  check(!p.update(90,25000),"sustained daylight restores daytime");
  check(!p.update(Double.NaN,26000),"invalid luma does not change mode");
  check(p.update(20,27000),"darkness restores night");
  GardenCandidateBank bank=new GardenCandidateBank();
  check(!bank.offer(1000,950,Arrays.asList(hit(.05f,.98f),hit(.30f,.52f)),new int[]{9,2},true),"multiple candidates first");
  check(!bank.offer(1900,1850,Arrays.asList(hit(.05f,.98f),hit(.34f,.52f)),new int[]{9,2},true),"multiple candidates second");
  check(bank.offer(2800,2750,Arrays.asList(hit(.05f,.98f),hit(.38f,.52f)),new int[]{9,2},true),"moving person survives stronger stationary false positive");
  bank=new GardenCandidateBank();bank.offer(1000,950,Arrays.asList(hit(.3f,.8f)),new int[]{2});
  check(!bank.offer(1900,1850,Arrays.asList(hit(.34f,.8f)),new int[]{2},true),"day evidence cannot seed night confirmation");
  System.out.println("NIGHT_V41_TESTS_PASS assertions="+n);
 }
}
