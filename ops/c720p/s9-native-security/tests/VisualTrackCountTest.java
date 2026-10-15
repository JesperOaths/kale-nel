package nl.kalenel.s9security;
import java.util.*;
public final class VisualTrackCountTest {
 private static AnonymousClipTracks.Hit hit(float left,float right,float confidence){return new AnonymousClipTracks.Hit(new float[]{.1f,left,.8f,right},confidence,"blue");}
 private static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
 public static void main(String[] args){
  AnonymousClipTracks fragmented=new AnonymousClipTracks();
  fragmented.addFrame(0,Arrays.asList(hit(.1f,.3f,.9f)));
  fragmented.addFrame(8000,Arrays.asList(hit(.7f,.9f,.9f)));
  check(fragmented.appearances()==2&&fragmented.repeatedConcurrentPeople()==0,"unsupported fragments never imply a group");
  AnonymousClipTracks group=new AnonymousClipTracks();
  group.addFrame(0,Arrays.asList(hit(.1f,.3f,.9f),hit(.7f,.9f,.9f)));
  check(group.repeatedConcurrentPeople()==0,"one multi-box frame remains uncertain");
  group.addFrame(800,Arrays.asList(hit(.11f,.31f,.9f),hit(.71f,.91f,.9f)));
  check(group.repeatedConcurrentPeople()==2,"repeated concurrent pair remains visible");
  List<AnonymousClipTracks.Hit> nms=AnonymousClipTracks.distinct(Arrays.asList(hit(.1f,.3f,.55f),hit(.11f,.31f,.95f)));
  check(nms.size()==1&&nms.get(0).confidence==.95f,"confidence sorted spatial duplicates");
  check(!AnonymousClipTracks.duplicateBox(new float[]{.1f,.1f,.8f,.3f},new float[]{.1f,.23f,.8f,.43f}),"nearby overlapping people remain distinct");
  AnonymousClipTracks unrelated=new AnonymousClipTracks();
  unrelated.addFrame(0,Arrays.asList(hit(.05f,.2f,.9f),hit(.35f,.5f,.9f)));
  unrelated.addFrame(9000,Arrays.asList(hit(.55f,.7f,.9f),hit(.8f,.95f,.9f)));
  check(unrelated.repeatedConcurrentPeople()==0,"two unrelated multi-box frames are insufficient");
  AnonymousClipTracks fast=new AnonymousClipTracks();
  fast.addFrame(0,Arrays.asList(hit(.1f,.3f,.9f),hit(.7f,.9f,.9f)));
  fast.addFrame(20,Arrays.asList(hit(.1f,.3f,.9f),hit(.7f,.9f,.9f)));
  check(fast.repeatedConcurrentPeople()==0,"near-duplicate timestamps cannot corroborate a group");
  check(AnonymousClipTracks.distinct(Arrays.asList(hit(Float.NaN,.3f,.9f))).isEmpty(),"reject invalid geometry");
  System.out.println("VISUAL_V36_TRACK_COUNT_8_CHECKS_PASS");
 }
}
