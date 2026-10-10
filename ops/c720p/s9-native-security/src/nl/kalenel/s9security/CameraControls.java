package nl.kalenel.s9security;

import android.graphics.Rect;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CaptureRequest;
import android.util.Range;
import android.util.Rational;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** Camera2 options supported by the active 4K back camera.
 *  All capture-request changes are applied on CameraService's camera handler.
 *  Never restarts a session, recorder, or chooses an alternative lens.
 */
final class CameraControls {
 private final Rect sensor;
 private final Range<Integer> compensation;
 private final float compensationStep;
 private final float maxZoom;
 private final boolean torchSupported;
 private final boolean autoFocusSupported;
 private final boolean continuousSupported;
 private float zoom=1f;
 private int exposureSteps=0;
 private boolean torch=false;
 private boolean autoFocus=false;

 CameraControls(CameraCharacteristics info) {
  Rect r=info.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
  if(r==null||r.width()<100||r.height()<100)throw new IllegalArgumentException("sensor_crop_unavailable");
  sensor=new Rect(r);
  Range<Integer> ev=info.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE);
  Rational step=info.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP);
  compensation=ev==null?new Range<>(0,0):ev;
  compensationStep=step==null||step.floatValue()<=0?1f:step.floatValue();
  Float digital=info.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM);
  maxZoom=digital==null?1f:Math.min(4f,Math.max(1f,digital));
  torchSupported=Boolean.TRUE.equals(info.get(CameraCharacteristics.FLASH_INFO_AVAILABLE));
  int[] modes=info.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
  boolean auto=false,continuous=false;
  if(modes!=null)for(int mode:modes) {
   if(mode==CaptureRequest.CONTROL_AF_MODE_AUTO)auto=true;
   if(mode==CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)continuous=true;
  }
  autoFocusSupported=auto;
  continuousSupported=continuous;
 }

 private JSONObject option(Object value,List<?> available)throws Exception {
  JSONObject o=new JSONObject();
  o.put("value",value);
  JSONArray a=new JSONArray();
  for(Object v:available)a.put(v);
  o.put("available",a);
  return o;
 }
 JSONObject status()throws Exception {
  JSONObject o=new JSONObject();
  List<String> zoomValues=new ArrayList<>();
  for(float v:new float[]{1f,1.25f,1.5f,2f,3f,4f})
   if(v<=maxZoom+0.0001f)zoomValues.add(String.valueOf(v));
  if(!zoomValues.contains(String.valueOf(zoom)))zoomValues.add(String.valueOf(zoom));
  o.put("zoom",option(String.valueOf(zoom),zoomValues));
  List<String> ev=new ArrayList<>();
  for(int v=-3;v<=3;v++){
   int steps=Math.round(v/compensationStep);
   if(compensation.contains(steps))ev.add(String.valueOf(v));
  }
  if(!ev.contains(String.valueOf(Math.round(exposureSteps*compensationStep))))
   ev.add(String.valueOf(Math.round(exposureSteps*compensationStep)));
  o.put("exposure_ev",option(String.valueOf(Math.round(exposureSteps*compensationStep)),ev));
  if(torchSupported)o.put("torch",option(torch?"on":"off",java.util.Arrays.asList("off","on")));
  if(continuousSupported && autoFocusSupported)
   o.put("focus",option(autoFocus?"auto":"continuous",java.util.Arrays.asList("continuous","auto")));
  return o;
 }
 void select(String key,String raw)throws Exception {
  if(raw==null||raw.length()>20)throw new IllegalArgumentException("invalid_control_value");
  if("zoom".equals(key)){
   float v=Float.parseFloat(raw);
   if(!Float.isFinite(v)||v<1f||v>maxZoom+0.00001f)throw new IllegalArgumentException("zoom_out_of_range");
   boolean valid=false;for(float x:new float[]{1f,1.25f,1.5f,2f,3f,4f})if(Math.abs(x-v)<.00001f)valid=true;
   if(!valid)throw new IllegalArgumentException("zoom_step_not_supported");
   zoom=v;
  }else if("exposure_ev".equals(key)){
   int ev=Integer.parseInt(raw);
   if(ev< -3||ev>3)throw new IllegalArgumentException("exposure_out_of_range");
   int steps=Math.round(ev/compensationStep);
   if(!compensation.contains(steps))throw new IllegalArgumentException("exposure_unsupported");
   exposureSteps=steps;
  }else if("torch".equals(key)){
   if(!torchSupported)throw new IllegalArgumentException("torch_unsupported");
   if(!raw.equals("off")&&!raw.equals("on"))throw new IllegalArgumentException("torch_value_invalid");
   torch=raw.equals("on");
  }else if("focus".equals(key)){
   if(!autoFocusSupported||!continuousSupported)throw new IllegalArgumentException("focus_control_unsupported");
   if(!raw.equals("auto")&&!raw.equals("continuous"))throw new IllegalArgumentException("focus_value_invalid");
   autoFocus=raw.equals("auto");
  }else throw new IllegalArgumentException("unknown_camera_control");
 }
 void apply(CaptureRequest.Builder builder){
  builder.set(CaptureRequest.CONTROL_AF_MODE,autoFocus?
    CaptureRequest.CONTROL_AF_MODE_AUTO:CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO);
  int w=Math.max(2,Math.round(sensor.width()/zoom));
  int h=Math.max(2,Math.round(sensor.height()/zoom));
  // Align crop to even sensor pixels. Never change physical camera or 4K output.
  w=Math.max(2,w&~1);h=Math.max(2,h&~1);
  int x=sensor.left+((sensor.width()-w)/2),y=sensor.top+((sensor.height()-h)/2);
  builder.set(CaptureRequest.SCALER_CROP_REGION,new Rect(x,y,x+w,y+h));
  builder.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION,exposureSteps);
  if(torchSupported)builder.set(CaptureRequest.FLASH_MODE,torch?
    CaptureRequest.FLASH_MODE_TORCH:CaptureRequest.FLASH_MODE_OFF);
 }
 boolean isAutoFocus(){return autoFocus;}
}
