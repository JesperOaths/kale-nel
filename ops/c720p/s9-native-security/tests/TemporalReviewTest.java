package nl.kalenel.s9security;
import java.util.*;
public final class TemporalReviewTest {
 private static AnonymousClipTracks.Hit hit(){return new AnonymousClipTracks.Hit(new float[]{.1f,.2f,.8f,.4f},.9f,"blue");}
 private static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 public static void main(String[] args){
  AnonymousClipTracks tracks=new AnonymousClipTracks();tracks.addFrame(100,Arrays.asList(hit()));
  check(tracks.repeatedConcurrentPeople()==0,"singleton cannot claim repeatedly observed person");
  check(!tracks.tracks().get(0).temporalSupport(),"singleton unsupported");
  tracks.addFrame(120,Arrays.asList(hit()));check(tracks.repeatedConcurrentPeople()==0,"near-identical times insufficient");
  tracks.addFrame(650,Arrays.asList(hit()));check(tracks.repeatedConcurrentPeople()==1,"distinct repeated observations support a candidate");
  check("temporally_supported_candidate".equals(tracks.tracks().get(0).evidenceStatus()),"support remains candidate, not confirmation");
  check(Math.abs(tracks.tracks().get(0).meanConfidence()-.9)<.00001,"mean detector score recorded");
  for(long duration:new long[]{1000,5500,20000,125000}){
   ClipReviewSchedule schedule=new ClipReviewSchedule(duration);long last=-1;int n=0;
   while(schedule.hasNext()){
    long at=schedule.next();check(at>last&&at>=0&&at<duration,"strict chronological requests within clip");
    last=at;n++;schedule.followUp(at);
   }
   check(n<=40&&schedule.additionalRequests()<=8,"bounded decode and followup workload");
  }
  ClipReviewSchedule schedule=new ClipReviewSchedule(20000);long first=schedule.next();schedule.followUp(first);
  check(schedule.next()==first+220,"new candidate receives a nearby native frame check");
  boolean bad=false;try{new ClipReviewSchedule(500);}catch(IllegalArgumentException e){bad=true;}
  check(bad,"invalid duration rejected");
  System.out.println("TEMPORAL_REVIEW_V37_TESTS_PASS");
 }
}
