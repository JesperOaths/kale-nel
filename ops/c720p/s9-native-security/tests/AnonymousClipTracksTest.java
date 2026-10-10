package nl.kalenel.s9security;
import java.util.*;
public final class AnonymousClipTracksTest {
 private static AnonymousClipTracks.Hit h(float l,float t,float r,float b,String colour){
  return new AnonymousClipTracks.Hit(new float[]{t,l,b,r},.88f,colour);
 }
 private static void check(boolean value,String description){
  if(!value)throw new AssertionError(description);
 }
 public static void main(String[] args){
  AnonymousClipTracks one=new AnonymousClipTracks();
  one.addFrame(100,Arrays.asList(h(.1f,.1f,.25f,.7f,"blue"),h(.65f,.1f,.85f,.8f,"red")));
  one.addFrame(1200,Arrays.asList(h(.12f,.1f,.27f,.7f,"blue"),h(.67f,.1f,.87f,.8f,"red")));
  check(one.appearances()==2,"two distinct anonymous tracks");
  check(one.tracks().get(0).samples==2,"first track persists");
  check(one.tracks().get(1).samples==2,"second track persists");
  check("blue".equals(one.tracks().get(0).colour()),"clothing tag attached");
  one.addFrame(7500,Arrays.asList(h(.12f,.1f,.27f,.7f,"blue")));
  check(one.appearances()==3,"long gaps allocate a new anonymous ID");
  AnonymousClipTracks two=new AnonymousClipTracks();
  two.addFrame(100,Arrays.asList(h(.12f,.1f,.27f,.7f,"blue")));
  check(two.tracks().get(0).id==1,"separate clips reset IDs");
  two.addFrame(200,Arrays.asList(h(.12f,.1f,.27f,.7f,"blue"),h(.12f,.1f,.27f,.7f,"blue")));
  check(two.appearances()==1,"overlapping model boxes deduplicated");
  boolean rejected=false;
  try{two.addFrame(200,new ArrayList<AnonymousClipTracks.Hit>());}
  catch(IllegalArgumentException ok){rejected=true;}
  check(rejected,"timestamps must increase");
  System.out.println("S9_ANONYMOUS_CLIP_TRACK_TESTS_PASS");
 }
}
