package nl.kalenel.s9security;
import java.util.*;
/** No Android dependencies. Exercise bounding-box camera-image motion only. */
public final class S9MovementMeasurementTest {
 private static void check(boolean ok,String why){if(!ok)throw new AssertionError(why);}
 private static AnonymousClipTracks.Hit hit(float left){
  return new AnonymousClipTracks.Hit(new float[]{.20f,left,.80f,left+.20f},.93f,"blue");
 }
 public static void main(String[] args){
  AnonymousClipTracks t=new AnonymousClipTracks();
  for(int i=0;i<5;i++)t.addFrame(i*600L,Collections.singletonList(hit(.20f+i*.025f)));
  check(t.appearances()==1,"single clip track");
  AnonymousClipTracks.Track one=t.tracks().get(0);
  check(one.samples==5,"five detections");
  check("image_right".equals(one.imageDirection()),"measured image direction");
  Double speed=one.imageSpeedBodyHeightsPerSecond();
  check(speed!=null&&speed>.04&&speed<.5,"camera image body-height velocity");
  Double linearity=one.imagePathStraightness();
  check(linearity!=null&&linearity>.9,"path straightness");
  check(one.imageBoxAspectRatio()!=null&&one.imageBoxAspectRatio()>.1,"box aspect");
  check("not_measured_no_pose_keypoints".equals(one.postureAvailability()),
      "no invented posture from bounding rectangles");
  AnonymousClipTracks sparse=new AnonymousClipTracks();
  sparse.addFrame(100L,Collections.singletonList(hit(.20f)));
  check(sparse.tracks().get(0).imageSpeedBodyHeightsPerSecond()==null,"sparse cannot measure speed");
  check(sparse.tracks().get(0).imagePathStraightness()==null,"sparse cannot measure path");
  AnonymousClipTracks other=new AnonymousClipTracks();
  other.addFrame(100L,Collections.singletonList(hit(.20f)));
  check(other.tracks().get(0).id==1,"IDs always start over in another clip");
  System.out.println("S9_MOVEMENT_MEASUREMENT_TEST_PASS");
 }
}
