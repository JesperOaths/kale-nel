package nl.kalenel.s9benchmark;

import java.util.Arrays;

public final class GardenShadowPipelineTest {
 static void check(boolean value,String label){if(!value)throw new AssertionError(label);}
 static float[] background(){float[] a=new float[GardenShadowPipeline.N];Arrays.fill(a,95f);return a;}
 static float[] onePerson(float x,float score){
  return new float[]{.49f,x,.91f,x+.13f,score};
 }
 static float[][] garden(float x,float score){return new float[][]{onePerson(x,score)};}
 static void warm(GardenShadowPipeline p,long start){
  for(int i=0;i<5;i++)p.observe(start+i*600,background(),null);
 }
 static void testRepeatedObservationsNotNewEvidence(){
  GardenShadowPipeline p=new GardenShadowPipeline();warm(p,100);
  float[][] duplicate={{.50f,.31f,.90f,.45f,.92f},{.51f,.32f,.91f,.46f,.86f}};
  GardenShadowPipeline.Result first=p.observe(3200,background(),duplicate);
  check(first.activeTracks==0,"one frame cannot confirm even with duplicate boxes");
  p.observe(3200,background(),duplicate);
  check(p.rejectedDuplicates==1,"duplicate timestamp rejected");
  check(p.confirmedEvents==0,"no event from duplicates");
  p.observe(3800,background(),garden(.31f,.90f));
  GardenShadowPipeline.Result last=p.observe(4400,background(),garden(.32f,.83f));
  check(last.newPersonEvents==1&&last.activeTracks==1,"three distinct frames confirm");
  p.observe(5000,background(),garden(.33f,.91f));
  check(p.confirmedEvents==1,"persistent track is single event");
 }
 static void testTwoPeopleSeparateTracklets(){
  GardenShadowPipeline p=new GardenShadowPipeline();warm(p,100);
  for(int i=0;i<3;i++){
   float[][] boxes={onePerson(.10f,.82f),onePerson(.72f,.91f)};
   p.observe(4000+i*700,background(),boxes);
  }
  check(p.confirmedEvents==2,"two spatially distinct people both recognized as candidates");
  check(p.observe(6200,background(),new float[0][]).activeTracks==2,"short occlusion preserves tracks");
  check(p.observe(9000,background(),new float[0][]).activeTracks==0,"lost tracks expire");
 }
 static void testStreetAndGeometryRejected(){
  GardenShadowPipeline p=new GardenShadowPipeline();
  warm(p,100);
  float[][] street={{.02f,.30f,.47f,.40f,.99f}};
  for(int i=0;i<5;i++)p.observe(4000+i*650,background(),street);
  check(p.confirmedEvents==0&&p.rejectedOffGarden>=5,"road traffic not a garden visitor");
  float[][] tooWide={{.64f,.1f,.83f,.9f,.91f}};
  for(int i=0;i<5;i++)p.observe(8000+i*650,background(),tooWide);
  check(p.confirmedEvents==0,"wide, implausible person rejected");
 }
 static void testExposureFlashSuppressed(){
  GardenShadowPipeline p=new GardenShadowPipeline();warm(p,100);
  float[] flash=background();
  for(int i=0;i<flash.length;i++)flash[i]+=85;
  for(int i=0;i<4;i++){
   GardenShadowPipeline.Result r=p.observe(4000+i*650,flash,null);
   check(!r.motion,"global light change not person motion");
  }
  check(p.exposureSuppressions>=1,"exposure guard measured");
 }
 static void testCoherentGardenMotionAndNoStreetTrigger(){
  GardenShadowPipeline p=new GardenShadowPipeline();warm(p,100);
  float[] frame=background();
  for(int y=10;y<13;y++)for(int x=10;x<14;x++)frame[y*GardenShadowPipeline.W+x]+=65;
  p.observe(4000,frame,null);
  GardenShadowPipeline.Result r=p.observe(4700,frame,null);
  check(r.motion,"coherent garden region should pass adaptive motion voting");
  check(r.largestComponent>=8,"coherence measurable");
  GardenShadowPipeline road=new GardenShadowPipeline();warm(road,100);
  float[] top=background();
  for(int y=0;y<6;y++)for(int x=3;x<20;x++)top[y*GardenShadowPipeline.W+x]+=90;
  for(int i=0;i<5;i++)check(!road.observe(4000+i*650,top,null).motion,
                            "street-only changes must never trigger");
 }
 static void testGridAndBadInput(){
  int[] a=new int[240*140];Arrays.fill(a,0xff808080);
  float[] g=GardenShadowPipeline.grid(a,240,140);
  check(g.length==GardenShadowPipeline.N,"grid size");
  for(float x:g)check(Math.abs(x-128f)<.02f,"neutral gray luma accurate");
  boolean rejected=false;
  try{new GardenShadowPipeline().observe(10,new float[3],null);}
  catch(IllegalArgumentException e){rejected=true;}
  check(rejected,"input shape guard");
 }
 public static void main(String[] args){
  testRepeatedObservationsNotNewEvidence();
  testTwoPeopleSeparateTracklets();
  testStreetAndGeometryRejected();
  testExposureFlashSuppressed();
  testCoherentGardenMotionAndNoStreetTrigger();
  testGridAndBadInput();
  System.out.println("GARDEN_SHADOW_PIPELINE_V2_PASS");
 }
}
