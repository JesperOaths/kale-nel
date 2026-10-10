package nl.kalenel.s9security;

/** Back-camera recording rotation and explicitly scoped legacy review calibration. */
final class CameraOrientation {
 private CameraOrientation(){}
 static int quarterTurn(int degrees){
  if(degrees!=0&&degrees!=90&&degrees!=180&&degrees!=270)
   throw new IllegalArgumentException("orientation_must_be_quarter_turn");
  return degrees;
 }
 static int recordingHint(int sensorDegrees,int displayRotation){
  quarterTurn(sensorDegrees);
  if(displayRotation<0||displayRotation>3)throw new IllegalArgumentException("invalid_display_rotation");
  return (sensorDegrees-displayRotation*90+360)%360;
 }
 static int reviewOverride(int degrees,String version,String scope,String expectedSha,String actualSha){
  quarterTurn(degrees);
  if(!"clip_rotation_override_v1".equals(version)||!"this_recording_only".equals(scope)
     ||expectedSha==null||!expectedSha.matches("[0-9a-f]{64}")||!expectedSha.equals(actualSha))
   throw new IllegalArgumentException("invalid_clip_orientation_override");
  return degrees;
 }
}
