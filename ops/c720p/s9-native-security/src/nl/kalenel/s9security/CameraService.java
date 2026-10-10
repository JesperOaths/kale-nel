package nl.kalenel.s9security;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.hardware.camera2.*;
import android.graphics.ImageFormat;
import android.media.*;
import android.os.*;
import android.util.*;
import android.view.Surface;
import android.view.WindowManager;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;

/** Owns the camera directly: low-res YUV analysis + triggered 3840x2160 H.264 on removable SD.
 *  All review and classification remains on the phone. Never calls IP Webcam or Drive.
 */
public final class CameraService extends Service {
 public static final String PACKAGE="nl.kalenel.s9security";
 private static final String TAG="S9_NATIVE_SECURITY";
 private HandlerThread cameraThread;
 private Handler cameraHandler;
 private CameraDevice camera;
 private CameraCaptureSession session;
 private ImageReader preview;
 private MediaRecorder recorder;
 private CameraControls cameraControls;
 private CaptureRequest.Builder activeCameraRequest;
 private final MotionGrid motion=new MotionGrid();
 private ClipClassifier classifier;
 private ExecutorService reviewer;
 private File folder,partial,finished;
 private String cameraId="",mode="stopped",lastFailure="",lastClip="",lastReview="",backend="pending";
 private volatile boolean running=false,pilotOnly=true;
 private volatile long frames=0,motionEvents=0,completed=0,reviewed=0,failed=0,suppressedByRate=0;
 private volatile long reserveUsed=0,fallbackEvidenceSaved=0,fallbackEvidenceFailed=0;
 private volatile long recoveredPartials=0,recoveredReviews=0,recoveryUnplayable=0;
 private volatile boolean recoveryQueued=false;
 private volatile boolean historicalQueued=false;
 private volatile long historicalReviewed=0,historicalErrors=0,lastHistoricalScan=0;
 private volatile String lastHistoricalError="";
 private long lastFallbackAt=0;
 private String captureTier="normal";
 private long lastFrameAt=0,lastMovementAt=0,lastRecordAt=0,cooldownUntil=0,lastStart=0;
 // Ignore detector triggers from deliberate user changes of zoom, torch or exposure.
 // Seven fresh motion-grid samples first recalibrate the scene.
 private long cameraControlSettleUntil=0;
 private final Object stateLock=new Object();
 private ServerSocket apiSocket;
 private Thread apiThread;
 private volatile boolean temporaryTest=false,pilotStarted=false,pilotHandoff=false;
 private volatile byte[] latestJpeg=new byte[0];
 private volatile long lastJpegAt=0;
 private int recoveryCount=0;
 private static final long QUIET_MS=8500,MAX_MS=30000,COOLDOWN_MS=25000;
 private static final int MAX_4K_CLIPS_PER_HOUR=RecordingRate.TOTAL_PER_HOUR;
 @Override public IBinder onBind(Intent intent){return null;}
 @Override public int onStartCommand(Intent intent,int flags,int id){
  if(intent!=null&&"STOP".equals(intent.getAction())){
   getSharedPreferences("native",MODE_PRIVATE).edit().putBoolean("enabled",false).apply();
   if(cameraHandler!=null)cameraHandler.post(new Runnable(){public void run(){shutdown();}});
   return START_NOT_STICKY;
  }
  boolean allow=intent!=null&&intent.getBooleanExtra("enable_native_camera",false);
  boolean test=intent!=null&&intent.getBooleanExtra("pilot_only",false);
  boolean validate=intent!=null&&intent.getBooleanExtra("validate_dual_stream",false);
  if(allow&&!test)getSharedPreferences("native",MODE_PRIVATE).edit().putBoolean("enabled",true).apply();
  boolean persisted=getSharedPreferences("native",MODE_PRIVATE).getBoolean("enabled",false);
  if(!allow&&!persisted){Log.w(TAG,"Service disabled until explicitly armed");stopSelf();return START_NOT_STICKY;}
  pilotOnly=test||!persisted;
  temporaryTest=test&&validate;
  pilotHandoff=test;
  boolean takeover=intent!=null&&intent.getBooleanExtra("takeover_ipwebcam",false)&&!pilotOnly;
  if(running){Log.i(TAG,"Already running mode="+mode);return START_STICKY;}
  startForeground(8228,notification());
  running=true;
  reviewer=Executors.newSingleThreadExecutor();
  classifier=new ClipClassifier(this);
  cameraThread=new HandlerThread("native-security-camera");cameraThread.start();
  cameraHandler=new Handler(cameraThread.getLooper());
  cameraHandler.post(new Runnable(){public void run(){
   if(pilotHandoff||takeover){
    try{
     Intent stop=new Intent("com.pas.webcam.CONTROL");
     stop.setPackage("com.pas.webcam.pro");stop.putExtra("action","stop");
     sendBroadcast(stop);Log.i(TAG,takeover?"NATIVE_SECURITY_CAMERA_TAKEOVER":"PILOT_PAUSE_IP_WEBCAM");
    }catch(Exception e){failure("pilot_handoff_failed",e);}
    cameraHandler.postDelayed(new Runnable(){public void run(){prepare();}},4500);
   }else prepare();
  }});
  startApi();
  return START_STICKY;
 }
 @Override public void onCreate(){super.onCreate();}
 private Notification notification(){
  if(Build.VERSION.SDK_INT>=26){
   NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
   nm.createNotificationChannel(new NotificationChannel("native-security","S9 Security 4K camera",NotificationManager.IMPORTANCE_LOW));
   return new Notification.Builder(this,"native-security").setSmallIcon(android.R.drawable.ic_menu_camera)
    .setContentTitle("S9+ native microSD security").setContentText("On-phone motion detection, 4K clips, no cloud").build();
  }
  return new Notification.Builder(this).setSmallIcon(android.R.drawable.ic_menu_camera)
   .setContentTitle("S9+ native security").build();
 }
 private File sd()throws IOException{
  File[] roots=getExternalFilesDirs(null);
  for(File root:roots){
   if(root!=null&&Environment.isExternalStorageRemovable(root)){
    File d=new File(root,"Security4K");
    if((d.mkdirs()||d.isDirectory())&&d.getUsableSpace()>1024L*1024*1024)return d;
   }
  }
  throw new IOException("removable_microSD_missing_or_less_than_1_GiB_available");
 }
 private int temperature(){
  Intent battery=registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
  return battery==null?0:battery.getIntExtra("temperature",0);
 }
 private void prepare(){
  try{
   folder=sd();
   queueArchiveRecovery();
   if(checkSelfPermission("android.permission.CAMERA")!=PackageManager.PERMISSION_GRANTED)
    throw new SecurityException("camera_permission_required");
   CameraManager manager=(CameraManager)getSystemService(CAMERA_SERVICE);
   for(String id:manager.getCameraIdList()){
    CameraCharacteristics ch=manager.getCameraCharacteristics(id);
    Integer facing=ch.get(CameraCharacteristics.LENS_FACING);
    if(facing!=null&&facing==CameraCharacteristics.LENS_FACING_BACK){
     try{
      if(!CamcorderProfile.hasProfile(Integer.parseInt(id),CamcorderProfile.QUALITY_2160P))continue;
      CamcorderProfile p=CamcorderProfile.get(Integer.parseInt(id),CamcorderProfile.QUALITY_2160P);
      if(p.videoFrameWidth==3840&&p.videoFrameHeight==2160){cameraId=id;break;}
     }catch(NumberFormatException ignored){}
    }
   }
   if(cameraId.isEmpty())throw new IOException("camera_has_no_3840_2160_30fps_profile");
   cameraControls=new CameraControls(manager.getCameraCharacteristics(cameraId));
   preview=ImageReader.newInstance(640,480,ImageFormat.YUV_420_888,3);
   preview.setOnImageAvailableListener(reader->{
    Image frame=null;
    try{
     frame=reader.acquireLatestImage();
     if(frame==null)return;
     frames++;lastFrameAt=SystemClock.elapsedRealtime();
     if(lastFrameAt-lastJpegAt>=1200){
      try{
       byte[] jpg=PreviewJpeg.encode(frame,72);
       latestJpeg=jpg;lastJpegAt=lastFrameAt;
      }catch(Exception e){Log.w(TAG,"preview_jpeg_failed",e);}
     }
     boolean change=motion.analyze(frame);
     if(temporaryTest&&!pilotStarted&&frames>12&&"watching".equals(mode)){
      pilotStarted=true;startRecording();
     }
     if(change && lastFrameAt>=cameraControlSettleUntil){
      motionEvents++;
      lastMovementAt=lastFrameAt;
      if(!pilotOnly&&"watching".equals(mode)){
       if(lastFrameAt<cooldownUntil)saveFallbackEvidence("cooldown_motion");
       else if(temperature()<415 && folder.getUsableSpace()>15L*1024*1024*1024)
        startRecording();
       else saveFallbackEvidence("thermal_or_space_guard");
      }
     }
     if("recording".equals(mode)&&lastFrameAt-lastStart>2500&&
        (lastFrameAt-lastStart>MAX_MS||lastFrameAt-lastMovementAt>QUIET_MS))stopRecording("motion_completed");
    }catch(Throwable error){failure("frame_"+error.getClass().getSimpleName(),error);}
    finally{if(frame!=null)frame.close();}
   },cameraHandler);
   mode="opening";
   manager.openCamera(cameraId,new CameraDevice.StateCallback(){
    @Override public void onOpened(CameraDevice dev){
     camera=dev;recoveryCount=0;configurePreview();
    }
    @Override public void onDisconnected(CameraDevice dev){
     dev.close();camera=null;
     failure("camera_disconnected",null);scheduleRecover();
    }
    @Override public void onError(CameraDevice dev,int code){
     dev.close();camera=null;
     failure("camera_error_"+code,null);scheduleRecover();
    }
   },cameraHandler);
   cameraHandler.postDelayed(new Runnable(){public void run(){watchdog();}},5000);
  }catch(Exception e){failure("prepare_"+e.getClass().getSimpleName()+":"+e.getMessage(),e);shutdown();}
 }
 private void configurePreview(){
  if(!running||camera==null||preview==null)return;
  mode="configuring_preview";
  try{
   camera.createCaptureSession(Collections.singletonList(preview.getSurface()),new CameraCaptureSession.StateCallback(){
    @Override public void onConfigured(CameraCaptureSession s){
     if(!running){s.close();return;}
     session=s;
     try{
      CaptureRequest.Builder r=camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
      r.addTarget(preview.getSurface());
      cameraControls.apply(r);
      activeCameraRequest=r;
      s.setRepeatingRequest(r.build(),null,cameraHandler);
      mode="watching";Log.i(TAG,"YUV_PREVIEW_ACTIVE 640x480 mode="+(pilotOnly?"pilot":"motion_record"));
     }catch(Exception e){failure("preview_request_failed",e);scheduleRecover();}
    }
    @Override public void onConfigureFailed(CameraCaptureSession s){
     failure("preview_session_failed",null);scheduleRecover();
    }
   },cameraHandler);
  }catch(Exception e){failure("preview_setup_failed",e);scheduleRecover();}
 }
 private boolean rateAllowed(boolean sustainedCoherent){
  if(temporaryTest)return true;
  android.content.SharedPreferences prefs=getSharedPreferences("native",MODE_PRIVATE);
  long now=System.currentTimeMillis(),start=prefs.getLong("record_rate_start",0L);
  if(start<=0||start>now||now-start>=3600000L){
   prefs.edit().putLong("record_rate_start",now).putInt("record_rate_count",0).apply();
   return true;
  }
  return RecordingRate.allow(prefs.getInt("record_rate_count",0),sustainedCoherent);
 }
 private void noteRecordingStarted(){
  if(temporaryTest)return;
  android.content.SharedPreferences prefs=getSharedPreferences("native",MODE_PRIVATE);
  int count=prefs.getInt("record_rate_count",0);
  captureTier=RecordingRate.reserve(count)?"priority_reserve":"normal";
  if(RecordingRate.reserve(count))reserveUsed++;
  prefs.edit().putInt("record_rate_count",count+1).apply();
 }
 // Preserve the installed Camera2 APK's sensor/display-aware recording hint.
 // Manual overrides are for a verified fixed mounting angle only.
 private int recordingRotation(){
  int override=getSharedPreferences("native",MODE_PRIVATE).getInt("recording_rotation_degrees",-1);
  if(override==0||override==90||override==180||override==270)return override;
  CameraManager manager=(CameraManager)getSystemService(Context.CAMERA_SERVICE);
  WindowManager display=(WindowManager)getSystemService(Context.WINDOW_SERVICE);
  try{
   Integer sensor=manager.getCameraCharacteristics(cameraId).get(CameraCharacteristics.SENSOR_ORIENTATION);
   if(sensor==null||display==null)throw new IllegalStateException("orientation_sensor_unavailable");
   return CameraOrientation.recordingHint(sensor,display.getDefaultDisplay().getRotation());
  }catch(Exception problem){
   Log.w(TAG,"auto_orientation_fallback",problem);
   return 90;
  }
 }
 private void startRecording(){
  if(!running||(pilotOnly&&!temporaryTest)||!"watching".equals(mode))return;
  if(!rateAllowed(motion.strong)){
   if(suppressedByRate++%140==0)Log.w(TAG,"4K_RATE_GUARD_PRIORITY_RESERVE_EXHAUSTED_OR_WEAK");
   saveFallbackEvidence("recording_budget_rejected");
   cooldownUntil=SystemClock.elapsedRealtime()+12000;
   return;
  }
  if(temperature()>=415||folder.getUsableSpace()<15L*1024*1024*1024){
   saveFallbackEvidence("recording_safety_guard");
   return;
  }
  mode="starting";lastMovementAt=SystemClock.elapsedRealtime();
  try{
   closeSession();
   String name="motion_"+System.currentTimeMillis()+".mp4";
   partial=new File(folder,name+".recording");
   finished=new File(folder,name);
   recorder=new MediaRecorder();
   recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
   recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
   recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
   recorder.setVideoSize(3840,2160);
   recorder.setVideoFrameRate(30);
   recorder.setVideoEncodingBitRate(36000000);
   recorder.setOrientationHint(recordingRotation());
   recorder.setOutputFile(partial.getAbsolutePath());
   recorder.prepare();
   Surface video=recorder.getSurface();
   camera.createCaptureSession(Arrays.asList(preview.getSurface(),video),new CameraCaptureSession.StateCallback(){
    @Override public void onConfigured(CameraCaptureSession s){
     if(!running){s.close();return;}
     session=s;
     try{
      CaptureRequest.Builder b=camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD);
      b.addTarget(video);b.addTarget(preview.getSurface());
      cameraControls.apply(b);
      activeCameraRequest=b;
      s.setRepeatingRequest(b.build(),null,cameraHandler);
      recorder.start();
      noteRecordingStarted();
      lastStart=SystemClock.elapsedRealtime();
      lastRecordAt=lastStart;
      mode="recording";
      Log.i(TAG,"START_MOTION_4K "+finished.getName());
      if(temporaryTest)cameraHandler.postDelayed(new Runnable(){public void run(){if("recording".equals(mode))stopRecording("pilot_short");}},9000);
     }catch(Exception e){failure("recorder_start_failed",e);abortRecording();}
    }
    @Override public void onConfigureFailed(CameraCaptureSession s){
     failure("4k_plus_yuv_unsupported",null);abortRecording();
    }
   },cameraHandler);
  }catch(Exception e){failure("recorder_prepare_failed",e);abortRecording();}
 }
 private void stopRecording(String reason){
  if(!"recording".equals(mode))return;
  mode="stopping";
  File candidate=finished,unfinished=partial;
  try{
   if(session!=null)session.stopRepeating();
   recorder.stop();
   recorder.reset();recorder.release();recorder=null;
   closeSession();
   if(!unfinished.isFile()||unfinished.length()<200000)throw new IOException("empty_4k_output");
   if(!unfinished.renameTo(candidate))throw new IOException("atomic_rename_failed");
   MediaMetadataRetriever m=new MediaMetadataRetriever();
   try{
    m.setDataSource(candidate.getAbsolutePath());
    int w=Integer.parseInt(m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
    int h=Integer.parseInt(m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
    if(w!=3840||h!=2160)throw new IOException("encoded_resolution_"+w+"x"+h);
   }finally{m.release();}
   completed++;lastClip=candidate.getName();
   Log.i(TAG,"FINALIZED_TRUE_4K name="+lastClip+" bytes="+candidate.length());
   final File saved=candidate;final long motionAtSave=motionEvents;
   final String reviewTrigger=reason+"_"+captureTier;
   reviewer.submit(new Runnable(){public void run(){review(saved,reviewTrigger,motionAtSave);}});
  }catch(Exception e){
   failure("finalize_failed_"+e.getClass().getSimpleName(),e);
   // Keep the raw .recording file for forensic recovery, never delete incomplete footage.
  }finally{
   if(recorder!=null){try{recorder.release();}catch(Exception ignored){}recorder=null;}
   closeSession();
   cooldownUntil=SystemClock.elapsedRealtime()+COOLDOWN_MS;
   if(temporaryTest)cameraHandler.postDelayed(new Runnable(){public void run(){shutdown();}},800);
   else cameraHandler.postDelayed(new Runnable(){public void run(){configurePreview();}},700);
  }
 }
 private void abortRecording(){
  if(recorder!=null){try{recorder.release();}catch(Exception ignored){}recorder=null;}
  closeSession();
  failed++;
  cooldownUntil=SystemClock.elapsedRealtime()+20000;
  cameraHandler.postDelayed(new Runnable(){public void run(){configurePreview();}},1300);
 }
 private boolean review(File f,String reason,long count){
  try{
   JSONObject j=classifier.process(f,folder,f.getName(),reason,count);
   backend=j.optString("backend","unknown");
   reviewed++;
   lastReview=j.optString("scene_category")+" people="+j.optInt("person_count");
   Log.i(TAG,"REVIEW "+f.getName()+" "+lastReview);
   return true;
  }catch(Exception e){
   failure("review_"+e.getClass().getSimpleName()+":"+e.getMessage(),e);
   // Preserve original movie even when classifier fails. A later recovery job can retry.
   return false;
  }
 }
 // Keep an SD-only low-resolution evidence frame if the 4K budget, cooldown,
 // thermal or free-space guard prevents a recording. Rate-limit independently
 // so a flickering light cannot fill the microSD with preview images.
 private void saveFallbackEvidence(String why){
  long now=SystemClock.elapsedRealtime();
  if(now-lastFallbackAt<45000L || latestJpeg.length<2000 || folder==null || reviewer==null)return;
  lastFallbackAt=now;
  final byte[] jpeg=latestJpeg.clone();
  final File archive=folder;
  final long timestamp=System.currentTimeMillis();
  final String reason=why;
  try{
   reviewer.execute(new Runnable(){public void run(){
    String name="preview_motion_"+timestamp+".jpg";
    File target=new File(archive,name);
    File temp=new File(archive,name+".partial");
    try{
     try(FileOutputStream out=new FileOutputStream(temp)){
      out.write(jpeg);
      out.getFD().sync();
     }
     if(!temp.renameTo(target))throw new IOException("preview_evidence_rename_failed");
     JSONObject meta=new JSONObject();
     meta.put("name",name).put("kind","preview_only_motion_evidence")
         .put("reason",reason).put("captured_at_ms",timestamp)
         .put("width",640).put("height",480)
         .put("archive","S9_microSD_only")
         .put("person_identity","not_evaluated");
     ClipClassifier.writeJson(new File(archive,name+".json"),meta);
     fallbackEvidenceSaved++;
    }catch(Exception e){fallbackEvidenceFailed++;Log.w(TAG,"fallback_evidence_failed",e);}
   }});
  }catch(java.util.concurrent.RejectedExecutionException e){
   fallbackEvidenceFailed++;
  }
 }
 private static boolean validCompleted4K(File movie){
  if(!movie.isFile() || movie.length()<200000)return false;
  MediaMetadataRetriever reader=new MediaMetadataRetriever();
  try{
   reader.setDataSource(movie.getAbsolutePath());
   return "3840".equals(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH))
       && "2160".equals(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT))
       && Long.parseLong(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))>=1000;
  }catch(Exception e){return false;}
  finally{try{reader.release();}catch(Exception ignored){}}
 }
 // Interrupted MP4s are never deleted. Only promote a fully readable 4K
 // recording; opaque/truncated remnants stay at their original path.
 private void queueArchiveRecovery(){
  if(recoveryQueued || reviewer==null || folder==null)return;
  recoveryQueued=true;
  final File archive=folder;
  try{reviewer.execute(new Runnable(){public void run(){recoverArchive(archive);}});}
  catch(java.util.concurrent.RejectedExecutionException e){recoveryQueued=false;}
 }
 private void recoverArchive(File archive){
  try{
   File[] originals=archive.listFiles();
   if(originals==null)return;
   Arrays.sort(originals,(a,b)->Long.compare(b.lastModified(),a.lastModified()));
   int inspected=0;
   for(File existing:originals){
    if(!running || inspected>=100)break;
    String filename=existing.getName();
    if(!filename.startsWith("motion_") || !(filename.endsWith(".mp4.recording")||filename.endsWith(".mp4")))continue;
    inspected++;
    if(filename.endsWith(".mp4.recording")){
     if(existing.equals(partial) && ("recording".equals(mode)||"starting".equals(mode)))continue;
     if(!validCompleted4K(existing)){recoveryUnplayable++;continue;}
     File promoted=new File(archive,filename.substring(0,filename.length()-".recording".length()));
     if(promoted.exists() || !existing.renameTo(promoted)){recoveryUnplayable++;continue;}
     recoveredPartials++;
     if(!new File(archive,promoted.getName()+".verified.json").exists()){
      if(review(promoted,"startup_recovered_4k",0))recoveredReviews++;
     }
    }else if(!new File(archive,filename+".verified.json").exists()){
     if(!validCompleted4K(existing)){recoveryUnplayable++;continue;}
     if(review(existing,"startup_missing_review_repaired",0))recoveredReviews++;
    }
   }
  }catch(Exception e){failure("archive_recovery_scan_failed",e);}
 }
 private void closeSession(){
  activeCameraRequest=null;
  if(session!=null){try{session.stopRepeating();}catch(Exception ignored){}
   try{session.close();}catch(Exception ignored){}session=null;}
 }
 private void scheduleRecover(){
  if(!running)return;
  if(recoveryCount++>=3){Log.e(TAG,"CAMERA_RECOVERY_EXHAUSTED");shutdown();return;}
  cameraHandler.postDelayed(new Runnable(){public void run(){
   if(!running)return;
   closeSession();
   if(camera!=null){camera.close();camera=null;}
   if(preview!=null){preview.close();preview=null;}
   prepare();
  }},3000L*recoveryCount);
 }
 private void maybeHistoricalImport(){
  long now=SystemClock.elapsedRealtime();
  if(!running||historicalQueued||now-lastHistoricalScan<60000||folder==null||classifier==null||reviewer==null||
     !"watching".equals(mode)||temperature()>=370||folder.getUsableSpace()<20L*1024*1024*1024)return;
  historicalQueued=true;
  final File sandbox=folder.getParentFile();
  final ClipClassifier model=classifier;
  try{
   reviewer.execute(new Runnable(){public void run(){
    try{
     if(!running||!"watching".equals(mode)||temperature()>=370)return;
     int done=new HistoricalImportWorker(sandbox,model).processOne();
     if(done>0){historicalReviewed+=done;Log.i(TAG,"HISTORICAL_IMPORT_REVIEW_COMPLETED "+done);}
    }catch(Exception e){
     historicalErrors++;
     lastHistoricalError=e.getClass().getSimpleName();
     Log.w(TAG,"HISTORICAL_IMPORT_REVIEW_FAILED",e);
    }finally{
     lastHistoricalScan=SystemClock.elapsedRealtime();
     historicalQueued=false;
    }
   }});
  }catch(java.util.concurrent.RejectedExecutionException e){historicalQueued=false;}
 }
 private void watchdog(){
  if(!running)return;
  long n=SystemClock.elapsedRealtime();
  if("recording".equals(mode)&&n-lastStart>MAX_MS+8000)stopRecording("watchdog_cap");
  else if("watching".equals(mode)&&lastFrameAt>0&&n-lastFrameAt>9000){
   failure("stalled_YUV_camera",null);scheduleRecover();
  }
  maybeHistoricalImport();
  cameraHandler.postDelayed(new Runnable(){public void run(){watchdog();}},4500);
 }
 private void failure(String text,Throwable e){
  lastFailure=text;failed++;
  if(e==null)Log.w(TAG,text);else Log.e(TAG,text,e);
 }
 private JSONObject state(){
  JSONObject d=new JSONObject();
  try{
   d.put("ok",running&&lastFrameAt>0&&SystemClock.elapsedRealtime()-lastFrameAt<9000);
   d.put("mode",mode);d.put("native_4k_enabled",!pilotOnly);
   d.put("pilot_only",pilotOnly);
   d.put("takeover_completed",!pilotOnly&&running&&lastFrameAt>0);
   d.put("recorder","camera2_3840x2160_h264");
   d.put("motion_detector","regional_yuv_adaptive_v2_priority");
   d.put("review_model","ssd_mobilenet_coco_gpu_cpu_v1");
   d.put("mic",false);d.put("cloud_upload",false);
   d.put("storage","removable_microSD_only");
   d.put("sd_free_bytes",folder==null?0:folder.getUsableSpace());
   d.put("frames",frames);d.put("motion_events",motionEvents);
   d.put("motion_rate_suppressed",suppressedByRate);
   d.put("recording_rate_max_per_hour",MAX_4K_CLIPS_PER_HOUR);
   d.put("recording_rate_standard_per_hour",RecordingRate.BASE_PER_HOUR);
   d.put("recording_rate_priority_reserve",RecordingRate.PRIORITY_RESERVE_PER_HOUR);
   d.put("priority_motion",motion.strong);
   d.put("priority_reserve_used",reserveUsed);
   d.put("fallback_evidence_saved",fallbackEvidenceSaved);
   d.put("fallback_evidence_failed",fallbackEvidenceFailed);
   d.put("recovery_partials_finalized",recoveredPartials);
   d.put("recovery_missing_reviews_repaired",recoveredReviews);
   d.put("recovery_unplayable_preserved",recoveryUnplayable);
   d.put("historical_gpu_import_version","isolated_drive_import_v1");
   d.put("historical_import_reviewed",historicalReviewed);
   d.put("historical_import_errors",historicalErrors);
   d.put("historical_import_last_error_type",lastHistoricalError);
   d.put("historical_import_queued",historicalQueued);
   d.put("recordings_this_hour",getSharedPreferences("native",MODE_PRIVATE).getInt("record_rate_count",0));
   d.put("changed_ratio",motion.changedRatio);d.put("coherent_cells",motion.coherent);
   d.put("brightness",motion.lighting);
   d.put("recorded",completed);d.put("reviewed",reviewed);
   d.put("failed",failed);d.put("last_file",lastClip);d.put("last_review",lastReview);
   d.put("review_backend",backend);d.put("last_error",lastFailure);
   d.put("temperature_c",temperature()/10.0);
   d.put("last_frame_age_ms",lastFrameAt==0?-1:SystemClock.elapsedRealtime()-lastFrameAt);
   d.put("snapshot_ready",latestJpeg.length>1000);
   d.put("snapshot_age_ms",lastJpegAt==0?-1:SystemClock.elapsedRealtime()-lastJpegAt);
   d.put("privacy","scene_tags_no_verified_cross_recording_identity");
   d.put("camera_controls_available",cameraControls!=null && "watching".equals(mode));
    d.put("recording_orientation_hint_degrees",recordingRotation());
  }catch(Exception ignored){}
  return d;
 }
 private JSONObject controlsStatus()throws Exception {
  JSONObject result=new JSONObject();
  result.put("ok",cameraControls!=null);
  result.put("mode",mode);
  result.put("read_only",false);
  result.put("changing_controls_while_recording",false);
  JSONObject options=cameraControls==null?new JSONObject():cameraControls.status();
   if(cameraControls!=null){
    JSONArray choices=new JSONArray().put("auto");
    for(int angle:new int[]{0,90,180,270})choices.put(String.valueOf(angle));
    int saved=getSharedPreferences("native",MODE_PRIVATE).getInt("recording_rotation_degrees",-1);
    String selected=saved==0||saved==90||saved==180||saved==270?String.valueOf(saved):"auto";
    options.put("recording_rotation",new JSONObject()
      .put("value",selected).put("available",choices)
      .put("effective_degrees",recordingRotation()));
   }
   result.put("controls",options);
  return result;
 }
 private JSONObject updateControl(String key,String value)throws Exception {
  FutureTask<JSONObject> job=new FutureTask<>(()->{
   JSONObject response=new JSONObject();
   if(!"watching".equals(mode)||session==null||activeCameraRequest==null||cameraControls==null){
    return response.put("ok",false).put("error","control_unavailable_during_recording_or_camera_transition");
   }
   if("recording_rotation".equals(key)){
     // Future-recordings-only MP4 hint, without a capture session restart.
     if(!("auto".equals(value)||"0".equals(value)||"90".equals(value)||
          "180".equals(value)||"270".equals(value)))
      return response.put("ok",false).put("error","unsupported_or_invalid_control");
     int desired="auto".equals(value)?-1:Integer.parseInt(value);
     boolean stored=getSharedPreferences("native",MODE_PRIVATE).edit()
       .putInt("recording_rotation_degrees",desired).commit();
     return response.put("ok",stored).put("key",key).put("value",value)
       .put("effective_degrees",recordingRotation())
       .put("mode",mode).put("future_recordings_only",true);
    }
    JSONObject old=cameraControls.status();
   try {
    cameraControls.select(key,value);
    cameraControls.apply(activeCameraRequest);
    session.setRepeatingRequest(activeCameraRequest.build(),null,cameraHandler);
    // Refresh the motion model after a deliberate camera setting change.
    // Without this reset a changed crop/torch/exposure can look like an intruder.
    motion.resetForCameraControl();
    cameraControlSettleUntil=SystemClock.elapsedRealtime()+2500L;
    if("focus".equals(key)&&cameraControls.isAutoFocus()){
     CaptureRequest.Builder focus=camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
     focus.addTarget(preview.getSurface());
     cameraControls.apply(focus);
     focus.set(CaptureRequest.CONTROL_AF_TRIGGER,CaptureRequest.CONTROL_AF_TRIGGER_START);
     session.capture(focus.build(),null,cameraHandler);
    }
    return response.put("ok",true).put("key",key)
      .put("value",cameraControls.status().getJSONObject(key).get("value"))
      .put("mode",mode);
   }catch(Exception e){
    try {
     if(old.has(key)){
      cameraControls.select(key,old.getJSONObject(key).getString("value"));
      cameraControls.apply(activeCameraRequest);
      session.setRepeatingRequest(activeCameraRequest.build(),null,cameraHandler);
     }
    }catch(Exception ignored){}
    return response.put("ok",false).put("error",e instanceof IllegalArgumentException?
       "unsupported_or_invalid_control":"camera2_control_apply_failed");
   }
  });
  if(cameraHandler==null)throw new IllegalStateException("camera_handler_unavailable");
  cameraHandler.post(job);
  return job.get(4,TimeUnit.SECONDS);
 }
 private void startApi(){
  apiThread=new Thread(new Runnable(){public void run(){
   try(ServerSocket s=new ServerSocket(8808,5,InetAddress.getByName("127.0.0.1"))){
    apiSocket=s;s.setSoTimeout(5000);
    while(running){
     try{
      final Socket peer=s.accept();
      Thread t=new Thread(new Runnable(){public void run(){serve(peer);}},"native-security-http");
      t.setDaemon(true);t.start();
     }catch(SocketTimeoutException ignored){}
      catch(Exception e){if(running)Log.w(TAG,"http_accept",e);}
    }
   }catch(Exception e){if(running)Log.e(TAG,"http_listener",e);}
  }},"native-security-status");
  apiThread.setDaemon(true);apiThread.start();
 }
 private void serve(Socket peer){
  try(Socket socket=peer){
   socket.setSoTimeout(6000);
   BufferedReader in=new BufferedReader(new InputStreamReader(socket.getInputStream(),"UTF-8"));
   String line=in.readLine();if(line==null)return;
   OutputStream out=socket.getOutputStream();
   if(line.startsWith("GET /shot.jpg ")){
    byte[] jpg=latestJpeg;
    if(jpg.length<1000){send(out,503,"text/plain","camera_preview_not_ready".getBytes("UTF-8"));return;}
    send(out,200,"image/jpeg",jpg);
   }else if(line.startsWith("GET /mjpeg ")||line.startsWith("GET /video ")
         ||line.startsWith("GET /videofeed ")){
    out.write(("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\n"+
      "Cache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
    while(running){
     byte[] img=latestJpeg;
     if(img.length>1000){
      out.write(("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "+img.length+"\r\n\r\n").getBytes("UTF-8"));
      out.write(img);out.write("\r\n".getBytes("UTF-8"));out.flush();
     }
     try{Thread.sleep(950);}catch(InterruptedException e){return;}
    }
   }else if(line.startsWith("GET /controls ")){
    try{send(out,200,"application/json",controlsStatus().toString().getBytes("UTF-8"));}
    catch(Exception e){send(out,503,"application/json","{\"ok\":false,\"error\":\"controls_unavailable\"}".getBytes("UTF-8"));}
   }else if(line.startsWith("POST /control ")){
    int length=-1;boolean jsonType=false;
    for(int lineCount=0;lineCount<24;lineCount++){
     String header=in.readLine();
     if(header==null)break;
     if(header.isEmpty())break;
     int colon=header.indexOf(':');
     if(colon<1)continue;
     String name=header.substring(0,colon).trim().toLowerCase(Locale.ROOT);
     String hv=header.substring(colon+1).trim();
     if("content-length".equals(name)){try{length=Integer.parseInt(hv);}catch(NumberFormatException ignored){}}
     if("content-type".equals(name)&&hv.toLowerCase(Locale.ROOT).startsWith("application/json"))jsonType=true;
    }
    if(!jsonType||length<2||length>256){
     send(out,400,"application/json","{\"ok\":false,\"error\":\"invalid_camera_control_request\"}".getBytes("UTF-8"));return;
    }
    char[] content=new char[length];int bytes=0;
    while(bytes<length){int n=in.read(content,bytes,length-bytes);if(n<0)break;bytes+=n;}
    if(bytes!=length){send(out,400,"application/json","{\"ok\":false,\"error\":\"short_request_body\"}".getBytes("UTF-8"));return;}
    JSONObject response;
    try {
     JSONObject request=new JSONObject(new String(content));
     if(request.length()!=2||!request.has("key")||!request.has("value"))
      throw new IllegalArgumentException("bad_request_fields");
     String key=request.getString("key");
     String value=request.getString("value");
     if(key.length()>30||value.length()>20)throw new IllegalArgumentException("control_field_length");
     response=updateControl(key,value);
    }catch(Exception e){response=new JSONObject().put("ok",false).put("error","invalid_or_unavailable_control");}
    send(out,response.optBoolean("ok")?200:409,"application/json",response.toString().getBytes("UTF-8"));
   }else if(line.startsWith("GET /status")||line.startsWith("GET / ")){
    send(out,200,"application/json",state().toString().getBytes("UTF-8"));
   }else send(out,404,"text/plain","not_found".getBytes("UTF-8"));
  }catch(Exception e){if(running&&!(e instanceof java.net.SocketException))Log.w(TAG,"http_client",e);}
 }
 private static void send(OutputStream out,int code,String contentType,byte[] bytes)throws IOException{
  out.write(("HTTP/1.1 "+code+(code==200?" OK":code==503?" Service Unavailable":code==409?" Conflict":code==400?" Bad Request":" Not Found")+
   "\r\nContent-Type: "+contentType+"\r\nContent-Length: "+bytes.length+
   "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
  out.write(bytes);out.flush();
 }
 private void shutdown(){
  // Normal service destruction must finish a 4K MP4, rather than silently
  // discarding the MediaRecorder output without its verified manifest.
  if("recording".equals(mode)){
   Log.i(TAG,"FINALIZE_ACTIVE_RECORDING_ON_SHUTDOWN");
   stopRecording("service_shutdown");
  }
  if("starting".equals(mode))Log.w(TAG,"SHUTDOWN_DURING_RECORDER_PREPARE_PARTIAL_PRESERVED");
  running=false;mode="stopped";
  if(recorder!=null){try{recorder.stop();}catch(Exception ignored){}try{recorder.release();}catch(Exception ignored){}recorder=null;}
  closeSession();
  if(camera!=null){camera.close();camera=null;}
  if(preview!=null){preview.close();preview=null;}
  // GPU delegates may be thread-affine. Never close one while a queued clip
  // review is still using it; release it on the review executor last.
  if(reviewer!=null){
   final ClipClassifier toClose=classifier;
   try{if(toClose!=null)reviewer.execute(new Runnable(){public void run(){toClose.close();}});}
   catch(java.util.concurrent.RejectedExecutionException e){Log.w(TAG,"classifier_close_deferred",e);}
   reviewer.shutdown();reviewer=null;classifier=null;
  }else if(classifier!=null){classifier.close();classifier=null;}
  try{if(apiSocket!=null)apiSocket.close();}catch(Exception ignored){}
  if(pilotHandoff){
   try{
    Intent resume=new Intent("com.pas.webcam.CONTROL");resume.setPackage("com.pas.webcam.pro");
    resume.putExtra("action","start");sendBroadcast(resume);Log.i(TAG,"PILOT_IP_WEBCAM_RESTORED");
   }catch(Exception e){Log.e(TAG,"PILOT_RESTORE_FAILED",e);}
   pilotHandoff=false;
  }
  stopForeground(true);stopSelf();
 }
 @Override public void onDestroy(){
  running=false;
  if(cameraHandler!=null)cameraHandler.post(new Runnable(){public void run(){shutdown();}});
  super.onDestroy();
 }
}
