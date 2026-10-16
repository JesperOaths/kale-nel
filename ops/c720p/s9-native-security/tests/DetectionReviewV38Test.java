package nl.kalenel.s9security;
import java.util.*;
public final class DetectionReviewV38Test {
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 static AnonymousClipTracks.Hit hit(float[] b,float score){return new AnonymousClipTracks.Hit(b,score,"uncertain");}
 public static void main(String[] args){
  float[] car={.4f,.2f,.8f,.8f},window={.5f,.35f,.76f,.55f},beside={.2f,.82f,.8f,.95f};
  check(GardenPersonTrackGate.transportDominates(window,.51f,car,.87f,"car"),"nested car-window false person veto");
  check(!GardenPersonTrackGate.transportDominates(beside,.61f,car,.94f,"car"),"person beside car retained");
  check(!GardenPersonTrackGate.transportDominates(new float[]{.1f,.32f,.8f,.48f},.65f,car,.94f,"car"),"head above roof retained");
  check(!GardenPersonTrackGate.transportDominates(window,.85f,car,.72f,"car"),"weaker vehicle class cannot veto person");
  check(!GardenPersonTrackGate.transportDominates(window,.51f,car,.87f,"bicycle"),"contained rider not suppressed as motor vehicle");
  check(GardenPersonTrackGate.plausiblePersonShape(new float[]{.2f,.2f,.8f,.55f},640,480),"preview aspect accepted");
  check(!GardenPersonTrackGate.plausiblePersonShape(new float[]{.2f,.2f,.8f,.8f},3840,2160),"wide native4k object rejected using actual aspect");
  GardenCandidateBank bank=new GardenCandidateBank();
  float[] staticObject={.15f,.05f,.6f,.18f},person={.2f,.55f,.8f,.7f},moved={.2f,.62f,.8f,.77f};
  check(!bank.offer(1000,980,Arrays.asList(hit(staticObject,.98f),hit(person,.62f)),new int[]{0,2}),"first frame never confirms");
  check(bank.offer(2000,1980,Arrays.asList(hit(staticObject,.98f),hit(moved,.63f)),new int[]{0,2}),"lower scoring moving person survives stronger false candidate");
  bank.reset();bank.offer(3000,2980,Arrays.asList(hit(person,.8f)),new int[]{3});
  check(!bank.offer(4000,2980,Arrays.asList(hit(moved,.8f)),new int[]{3}),"same JPEG never corroborates");
  bank.reset();bank.offer(5000,4980,Arrays.asList(hit(person,.8f)),new int[]{3});
  check(!bank.offer(12000,11980,Arrays.asList(hit(moved,.8f)),new int[]{3}),"expired hypothesis cannot confirm");
  for(long duration:new long[]{8000,18590,125000}){
   ClipReviewSchedule s=new ClipReviewSchedule(duration);long last=0,maxGap=0;int n=0;
   while(s.hasNext()){long at=s.next();maxGap=Math.max(maxGap,at-last);last=at;n++;}
   maxGap=Math.max(maxGap,duration-last);
   check(n>=20&&n<=32,"denser bounded overview");
   if(duration<=18590)check(maxGap<=600,"short walk coverage at most 600ms gap");
  }
  System.out.println("DETECTION_REVIEW_V38_TESTS_PASS");
 }
}
