package nl.kalenel.s9security;

public final class CameraOrientationTest {
 private static void equal(int expected,int actual){
  if(expected!=actual)throw new AssertionError(expected+" != "+actual);
 }
 private static void reject(Runnable action){
  try{action.run();throw new AssertionError("invalid calibration accepted");}
  catch(IllegalArgumentException expected){}
 }
 public static void main(String[] args){
  // Back sensor 90 degrees: portrait, landscape, inverted portrait, inverted landscape.
  int[] expected={90,0,270,180};
  for(int display=0;display<4;display++)equal(expected[display],CameraOrientation.recordingHint(90,display));
  equal(0,CameraOrientation.recordingHint(270,3));
  equal(180,CameraOrientation.recordingHint(270,1));
  reject(()->CameraOrientation.recordingHint(45,1));
  reject(()->CameraOrientation.recordingHint(90,4));
  String sha="ff6bc2967e9d7d9e920ed3cb74b007f9d98cb759bcc25bc55f3d0ed5e2f307fa";
  equal(270,CameraOrientation.reviewOverride(270,"clip_rotation_override_v1","this_recording_only",sha,sha));
  reject(()->CameraOrientation.reviewOverride(270,"clip_rotation_override_v1","all_recordings",sha,sha));
  reject(()->CameraOrientation.reviewOverride(270,"clip_rotation_override_v1","this_recording_only",sha,"0"+sha.substring(1)));
  reject(()->CameraOrientation.reviewOverride(45,"clip_rotation_override_v1","this_recording_only",sha,sha));
  System.out.println("S9_CAMERA_ORIENTATION_TESTS_PASS");
 }
}
