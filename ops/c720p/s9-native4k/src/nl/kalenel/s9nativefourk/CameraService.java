package nl.kalenel.s9nativefourk;
import android.app.*;import android.content.*;import android.graphics.ImageFormat;
import android.hardware.camera2.*;import android.hardware.camera2.params.*;
import android.media.*;import android.os.*;import android.util.*;import android.view.Surface;
import org.json.JSONObject;
import java.io.*;import java.security.MessageDigest;import java.util.*;
public final class CameraService extends Service {
 private static final String TAG="S9_NATIVE4K";
 private HandlerThread thread;private Handler handler;
 private CameraDevice camera;private CameraCaptureSession session;private MediaRecorder recorder;
 private File pending,finished,dir;
 private volatile boolean started=false,done=false;
 private boolean manageWebcam=false;
 private int seconds=8;private long began=0;
 @Override public IBinder onBind(Intent i){return null;}
 @Override public int onStartCommand(Intent intent,int flags,int id){
  seconds=Math.max(4,Math.min(12,intent==null?8:intent.getIntExtra("seconds",8)));
  manageWebcam=intent!=null&&intent.getBooleanExtra("manage_ipwebcam",false);
  startForeground(8129,notification("Camera recording test"));
  thread=new HandlerThread("s9-native-4k-camera");thread.start();handler=new Handler(thread.getLooper());
  handler.post(new Runnable(){public void run(){begin();}});
  return START_NOT_STICKY;
 }
 private Notification notification(String s){
  Notification.Builder b=new Notification.Builder(this);
  if(Build.VERSION.SDK_INT>=26){
   NotificationManager n=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
   NotificationChannel ch=new NotificationChannel("native4k","Native camera test",NotificationManager.IMPORTANCE_LOW);
   n.createNotificationChannel(ch);b.setChannelId("native4k");
  }
  return b.setSmallIcon(android.R.drawable.ic_menu_camera).setContentTitle("S9 4K Camera Pilot").setContentText(s).build();
 }
 private File externalSD(){
  File[] dirs=getExternalFilesDirs(null);
  if(dirs!=null)for(File d:dirs)if(d!=null&&Environment.isExternalStorageRemovable(d)){
   File f=new File(d,"Native4K");if(f.mkdirs()||f.isDirectory())return f;
  }
  throw new IllegalStateException("removable_SD_app_folder_unavailable");
 }
 private void begin(){
  if(manageWebcam){
   try{
    Intent stop=new Intent("com.pas.webcam.CONTROL");
    stop.setPackage("com.pas.webcam.pro");
    stop.putExtra("action","stop");
    sendBroadcast(stop);
    Log.i(TAG,"REQUESTED_WEBCAM_RELEASE");
   }catch(Exception e){Log.e(TAG,"CAMERA_RELEASE_FAILED",e);complete("webcam_release_failed",e);return;}
   handler.postDelayed(new Runnable(){public void run(){beginCamera();}},4000);
  }else beginCamera();
 }
 private void beginCamera(){
  try{
   dir=externalSD();
   CameraManager m=(CameraManager)getSystemService(CAMERA_SERVICE);
   String chosen=null;
   for(String id:m.getCameraIdList()){
    CameraCharacteristics c=m.getCameraCharacteristics(id);
    if(c.get(CameraCharacteristics.LENS_FACING)==CameraCharacteristics.LENS_FACING_BACK&&
       CamcorderProfile.hasProfile(Integer.parseInt(id),CamcorderProfile.QUALITY_2160P)){
     CamcorderProfile p=CamcorderProfile.get(Integer.parseInt(id),CamcorderProfile.QUALITY_2160P);
     if(p.videoFrameWidth==3840&&p.videoFrameHeight==2160){chosen=id;break;}
    }
   }
   if(chosen==null){complete("no_true_3840x2160_camcorder_profile",null);return;}
   CamcorderProfile profile=CamcorderProfile.get(Integer.parseInt(chosen),CamcorderProfile.QUALITY_2160P);
   String name="native4k_"+System.currentTimeMillis();
   pending=new File(dir,name+".recording");
   finished=new File(dir,name+".mp4");
   recorder=new MediaRecorder();
   recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
   recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
   recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
   recorder.setVideoSize(3840,2160);
   recorder.setVideoFrameRate(Math.min(30,Math.max(24,profile.videoFrameRate)));
   recorder.setVideoEncodingBitRate(Math.max(16000000,Math.min(36000000,profile.videoBitRate)));
   recorder.setOutputFile(pending.getAbsolutePath());
   recorder.setOrientationHint(90);
   recorder.prepare();
   final Surface surface=recorder.getSurface();
   final CameraManager manager=m;
   final String id=chosen;
   Log.i(TAG,"OPEN_4K_CAMERA camera="+id+" dst="+pending.getAbsolutePath()+" bitrate="+profile.videoBitRate);
   manager.openCamera(id,new CameraDevice.StateCallback(){
    @Override public void onOpened(CameraDevice dev){
     camera=dev;
     try {
      CaptureRequest.Builder b=dev.createCaptureRequest(CameraDevice.TEMPLATE_RECORD);
      b.addTarget(surface);
      b.set(CaptureRequest.CONTROL_MODE,CaptureRequest.CONTROL_MODE_AUTO);
      b.set(CaptureRequest.CONTROL_AF_MODE,CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO);
      dev.createCaptureSession(Collections.singletonList(surface),new CameraCaptureSession.StateCallback(){
       @Override public void onConfigured(CameraCaptureSession s){
        session=s;
        try{
         session.setRepeatingRequest(b.build(),null,handler);
         recorder.start();started=true;began=SystemClock.elapsedRealtime();
         Log.i(TAG,"4K_RECORDING_STARTED");
         handler.postDelayed(new Runnable(){public void run(){end("recording_duration_complete");}},seconds*1000L);
        }catch(Exception e){complete("capture_start_"+e.getClass().getSimpleName(),e);}
       }
       @Override public void onConfigureFailed(CameraCaptureSession s){complete("capture_session_failed",null);}
      },handler);
     }catch(Exception e){complete("camera_session_"+e.getClass().getSimpleName(),e);}
    }
    @Override public void onDisconnected(CameraDevice dev){dev.close();complete("camera_disconnected",null);}
    @Override public void onError(CameraDevice dev,int err){dev.close();complete("camera_error_"+err,null);}
   },handler);
   handler.postDelayed(new Runnable(){public void run(){if(!done)end("hard_timeout");}},22000);
  }catch(Exception e){complete("prepare_"+e.getClass().getSimpleName(),e);}
 }
 private void end(String reason){
  if(done)return;
  try{
   if(started){
    recorder.stop();started=false;
    if(!pending.renameTo(finished))throw new IOException("rename_mp4_failed");
   }
   verify(reason);
  }catch(Exception e){complete("finalize_"+e.getClass().getSimpleName(),e);}
 }
 private void verify(String reason){
  if(!finished.isFile()||finished.length()<100000){complete("mp4_not_finalized",null);return;}
  MediaMetadataRetriever meta=new MediaMetadataRetriever();
  int w=0,h=0;long duration=0;
  try{
   meta.setDataSource(finished.getAbsolutePath());
   w=Integer.parseInt(meta.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
   h=Integer.parseInt(meta.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
   duration=Long.parseLong(meta.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
  }catch(Exception e){complete("metadata_"+e.getClass().getSimpleName(),e);return;}
  finally{try{meta.release();}catch(Exception ignored){}}
  String result=(w==3840&&h==2160&&duration>=3000)?"VERIFIED_4K":"NOT_4K";
  Log.i(TAG,"RECORD_RESULT "+result+" "+w+"x"+h+" duration="+duration+" bytes="+finished.length());
  try{
   JSONObject j=new JSONObject();
   j.put("status",result);j.put("reason",reason);j.put("file",finished.getName());
   j.put("width",w);j.put("height",h);j.put("duration_ms",duration);
   j.put("bytes",finished.length());j.put("verified_at",System.currentTimeMillis());
   MessageDigest sha=MessageDigest.getInstance("SHA-256");
   try(FileInputStream in=new FileInputStream(finished)){
    byte[] buffer=new byte[65536];int n;
    while((n=in.read(buffer))>0)sha.update(buffer,0,n);
   }
   StringBuilder sum=new StringBuilder();
   for(byte x:sha.digest())sum.append(String.format(Locale.US,"%02x",x&255));
   j.put("sha256",sum.toString());
   try(FileOutputStream fos=new FileOutputStream(new File(dir,"native4k-test-result.json"))){
    fos.write(j.toString(2).getBytes("UTF-8"));fos.getFD().sync();
   }
  }catch(Exception e){Log.e(TAG,"MANIFEST_WRITE_FAILED",e);}
  complete(result,null);
 }
 private synchronized void complete(String reason,Exception exception){
  if(done)return;done=true;
  Log.i(TAG,"TEST_ENDED reason="+reason+" elapsed_ms="+(SystemClock.elapsedRealtime()-began));
  if(exception!=null)Log.e(TAG,reason,exception);
  try{if(session!=null)session.close();}catch(Exception ignored){}
  try{if(camera!=null)camera.close();}catch(Exception ignored){}
  try{if(recorder!=null)recorder.release();}catch(Exception ignored){}
  if(manageWebcam){
   try{
    Intent resume=new Intent("com.pas.webcam.CONTROL");
    resume.setPackage("com.pas.webcam.pro");
    resume.putExtra("action","start");
    sendBroadcast(resume);
    Log.i(TAG,"REQUESTED_WEBCAM_RESTART");
   }catch(Exception e){Log.e(TAG,"WEBCAM_RESTART_FAILED",e);}
  }
  stopForeground(true);stopSelf();
  if(thread!=null)thread.quitSafely();
 }
 @Override public void onDestroy(){super.onDestroy();if(!done)complete("service_destroyed",null);}
}
