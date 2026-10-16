package nl.kalenel.s9security;
import java.util.*;
public final class SmallPeopleV39Test {
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 public static void main(String[] args){
  float[] distant={.5f,.4f,.56f,.42f};
  check(GardenPersonTrackGate.plausiblePersonShape(distant,3840,2160),"native distant 77x130 person retained");
  AnonymousClipTracks.Hit h=new AnonymousClipTracks.Hit(distant,.8f,"blue");
  check(AnonymousClipTracks.distinct(Arrays.asList(h,h)).size()==1,"small repeated boxes deduplicate without being discarded");
  AnonymousClipTracks t=new AnonymousClipTracks();t.addFrame(1000,Arrays.asList(h));t.addFrame(1600,Arrays.asList(h));
  check(t.repeatedConcurrentPeople()==1,"distant candidate receives temporal evidence");
  check(AnonymousClipTracks.distinct(Arrays.asList(new AnonymousClipTracks.Hit(new float[]{.5f,.4f,.501f,.401f},.99f,"blue"))).isEmpty(),"numerical speck rejected");
  check(!GardenPersonTrackGate.plausiblePersonShape(new float[]{.5f,.4f,.56f,.6f},3840,2160),"wide small vehicle fragment rejected");
  System.out.println("SMALL_PEOPLE_V39_TESTS_PASS");
 }
}
