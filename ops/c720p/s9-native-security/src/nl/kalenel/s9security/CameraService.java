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
 private final CaptureContinuity eventChain=new CaptureContinuity();
 private volatile long segmentResumeAttempts=0,segmentResumeDenied=0;
 // Read-only Camera2 metadata distinguishes night exposure from callback load.
 private volatile long sensorCaptureResults=0,lastSensorTimestampNs=0,lastSensorCaptureAt=0;
 private volatile float sensorResultFps=0f,sensorExposureMs=-1f,sensorFrameDurationMs=-1f;
 private volatile int sensorIso=-1,sensorAeState=-1,sensorAeMinFps=-1,sensorAeMaxFps=-1;
 private final CameraCaptureSession.CaptureCallback sensorTelemetry=
   new CameraCaptureSession.CaptureCallback(){
    @Override public void onCaptureCompleted(CameraCaptureSession capture,
      CaptureRequest request,TotalCaptureResult result){
     sensorCaptureResults++;
     lastSensorCaptureAt=SystemClock.elapsedRealtime();
     Long stamp=result.get(CaptureResult.SENSOR_TIMESTAMP);
     if(stamp!=null&&stamp>0){
      long interval=stamp-lastSensorTimestampNs;
      if(lastSensorTimestampNs>0&&interval>4000000L&&interval<1000000000L){
       float hz=1000000000f/interval;
       sensorResultFps=sensorResultFps>0?0.85f*sensorResultFps+0.15f*hz:hz;
      }
      lastSensorTimestampNs=stamp;
     }
     Long exposure=result.get(CaptureResult.SENSOR_EXPOSURE_TIME);
     if(exposure!=null&&exposure>0)sensorExposureMs=exposure/1000000f;
     Long duration=result.get(CaptureResult.SENSOR_FRAME_DURATION);
     if(duration!=null&&duration>0)sensorFrameDurationMs=duration/1000000f;
     Integer iso=result.get(CaptureResult.SENSOR_SENSITIVITY);
     if(iso!=null)sensorIso=iso;
     Integer ae=result.get(CaptureResult.CONTROL_AE_STATE);
     if(ae!=null)sensorAeState=ae;
     Range<Integer> target=result.get(CaptureResult.CONTROL_AE_TARGET_FPS_RANGE);
     if(target!=null){sensorAeMinFps=target.getLower();sensorAeMaxFps=target.getUpper();}
    }
   };
 private static String aeStateLabel(int state){
  switch(state){
   case CaptureResult.CONTROL_AE_STATE_INACTIVE:return "inactive";
   case CaptureResult.CONTROL_AE_STATE_SEARCHING:return "searching";
   case CaptureResult.CONTROL_AE_STATE_CONVERGED:return "converged";
   case CaptureResult.CONTROL_AE_STATE_LOCKED:return "locked";
   case CaptureResult.CONTROL_AE_STATE_FLASH_REQUIRED:return "flash_required";
   case CaptureResult.CONTROL_AE_STATE_PRECAPTURE:return "precapture";
   default:return "unknown";
  }
 }
 private ClipClassifier classifier;
 private ExecutorService reviewer;
 // Live visitor checks cannot queue behind 4K decode or face-backfill jobs.
 private ClipClassifier gardenGateClassifier;
 private ExecutorService gardenGateExecutor;
 // Local SD evidence writes must not wait behind a multi-second archive review.
 private ExecutorService evidenceWriter;
 private volatile boolean gardenGateReady=false;
 private volatile long gardenGatePrepareErrors=0,gardenPersonGateQueueWaitMs=0;
 private volatile long gardenPersonGateStale=0;
 // Separate lower-priority phone worker: JPEG compression must never stall
 // Camera2's callback, which also drives motion and recording transitions.
 private ExecutorService jpegEncoder;
 // On-phone low-bitrate H.264 memory ring: frozen only after a verified 4K trigger.
 private GardenPreRoll preRoll;
 private GardenPreRoll.Frozen frozenPreRoll;
 private Continuous4KEncoder continuous4K;
 private volatile boolean continuous4KTrial=false;
 private volatile String continuous4KLastResult="not_tested";
 private volatile long continuous4KCompleted=0,continuous4KFailures=0;
 // Allow thermal cooldown to restore verified full-resolution history.
 private long continuous4KRetryAfterMs=0;
 private int continuous4KRecoveryAttempts=0;
 // One-shot, explicitly labelled on-phone validation clip. Never treated as
 // an ordinary person detection or indexed surveillance event.
 private boolean diagnosticPrerollActive=false,diagnosticPrerollUsed=false;
 private volatile String diagnosticPrerollClip="",diagnosticPrerollResult="not_tested";
 private volatile long preRollLastFrameAt=0;
 private volatile boolean jpegBusy=false;
 private volatile long jpegRequestedAt=0,jpegEncoded=0,jpegErrors=0;
 private File folder,partial,finished;
 private String cameraId="",mode="stopped",lastFailure="",lastClip="",lastReview="",backend="pending";
 private volatile boolean running=false,pilotOnly=true;
 private volatile long frames=0,motionEvents=0,completed=0,reviewed=0,failed=0,suppressedByRate=0;
 private volatile long reserveUsed=0,fallbackEvidenceSaved=0,fallbackEvidenceFailed=0;
 private volatile long recoveredPartials=0,recoveredReviews=0,recoveryUnplayable=0;
 private volatile boolean recoveryQueued=false;
 private volatile boolean historicalQueued=false;
 private volatile boolean faceBackfillQueued=false;
 private final Map<String,Integer> faceBackfillRetries=new ConcurrentHashMap<>();
 private volatile boolean movementBackfillQueued=false;
 private final Map<String,Integer> movementBackfillRetries=new HashMap<>();
 private volatile long movementBackfillDone=0,movementBackfillErrors=0,lastMovementBackfillScan=0;
 private volatile long faceBackfillDone=0,faceBackfillErrors=0,lastFaceBackfillScan=0;
 private volatile long historicalReviewed=0,historicalErrors=0,lastHistoricalScan=0;
 private volatile String lastHistoricalError="";
 private volatile long gardenTriageQuarantined=0,gardenTriagePreserved=0,gardenTriageErrors=0;
 private volatile long gardenTriageLastScan=0;
 private volatile boolean gardenTriageQueued=false;
 private long gardenTriageCutoffMs=0;
 private long lastFallbackAt=0;
 // Near-camera person gate executes on the S9+ review worker, never on C720P.
 // Only cameraHandler can start/stop the native MediaRecorder.
 private boolean gardenPersonGateBusy=false;
 private long gardenPersonGateLastAt=0;
 // After a motion vote, collect several NEW preview observations for up to
 // 4.5 s. Motion itself still cannot start the MediaRecorder.
 private long gardenPersonCandidateUntil=0;
 private volatile long gardenPersonMotionWindows=0,gardenPersonFollowupChecks=0;
 private static final long GARDEN_PERSON_CANDIDATE_MS=6500L;
 // Low-duty periodic GPU scan finds small/low-light people even when
 // the coarse luma motion grid never arms a candidate. Only a tracked
 // person, not this timer, can start a 4K recording.
 private static final long GARDEN_PERSON_SENTINEL_MS=1600L;
 private volatile long gardenPersonSentinelChecks=0,gardenPersonSentinelStarts=0;
 private volatile long gardenPersonInferenceLastMs=0,gardenPersonInferenceMaxMs=0;
 private volatile long gardenPersonGateChecks=0,gardenPersonGateMatches=0;
 private volatile long gardenPersonGateRejects=0,gardenPersonGateErrors=0;
 private volatile float gardenPersonGateScore=0f;
 private volatile float gardenPersonGateAnyScore=0f;
 private volatile long gardenPersonDuplicateJpegRejects=0;
 private final GardenPersonTrackGate personTrackGate=new GardenPersonTrackGate();
 private volatile int gardenPersonLastLocalMotionCells=0;
 private volatile long gardenPersonGateConfirmedStarts=0;
 private volatile long deepFaceScanned=0,deepFaceErrors=0;
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
 private static final long QUIET_MS=8500,MAX_MS=120000,COOLDOWN_MS=0;
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
  reviewer=Executors.newSingleThreadExecutor(job->{
   Thread t=new Thread(job,"s9-background-4k-review");
   t.setPriority(Math.max(Thread.MIN_PRIORITY,Thread.NORM_PRIORITY-2));return t;
  });
  gardenGateExecutor=Executors.newSingleThreadExecutor(job->{
   Thread t=new Thread(job,"s9-realtime-garden-person");
   t.setPriority(Math.min(Thread.MAX_PRIORITY,Thread.NORM_PRIORITY+1));return t;
  });
  gardenGateClassifier=new ClipClassifier(this);
  warmGardenGateAsync();

  evidenceWriter=Executors.newSingleThreadExecutor(job->{
   Thread t=new Thread(job,"s9-microsd-motion-evidence");
   t.setPriority(Math.max(Thread.MIN_PRIORITY,Thread.NORM_PRIORITY-1));
   return t;
  });
  // Failure of this independent worker never affects the native 4K recorder.
  if(!pilotOnly)preRoll=new GardenPreRoll();
  jpegEncoder=Executors.newSingleThreadExecutor(job->{
   Thread thread=new Thread(job,"s9-onphone-preview-jpeg");
   thread.setPriority(Math.max(Thread.MIN_PRIORITY,Thread.NORM_PRIORITY-2));
   thread.setDaemon(true);
   return thread;
  });
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
   android.content.SharedPreferences retentionPrefs=getSharedPreferences("native",MODE_PRIVATE);
   gardenTriageCutoffMs=retentionPrefs.getLong("garden_roi_archive_cutoff_ms",0L);
   if(gardenTriageCutoffMs<=0){
    gardenTriageCutoffMs=System.currentTimeMillis();
    retentionPrefs.edit().putLong("garden_roi_archive_cutoff_ms",gardenTriageCutoffMs).commit();
   }
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
   String region=getSharedPreferences("native",MODE_PRIVATE).getString("garden_zone","near");
   motion.setGardenZone(MotionGrid.validGardenZone(region)?region:"near");
   preview=ImageReader.newInstance(640,480,ImageFormat.YUV_420_888,3);
   preview.setOnImageAvailableListener(reader->{
    Image frame=null;
    try{
     frame=reader.acquireLatestImage();
     if(frame==null)return;
     frames++;lastFrameAt=SystemClock.elapsedRealtime();
     long jpegEvery="recording".equals(mode)?250L:120L;
     if(!jpegBusy&&jpegEncoder!=null&&lastFrameAt-jpegRequestedAt>=jpegEvery){
      // Copy the YUV planes while Image is valid, then immediately return
      // control to motion processing; no Bitmap/JPEG on the camera thread.
      jpegBusy=true;
      jpegRequestedAt=lastFrameAt;
      try{
       final PreviewJpeg.Snapshot copied=PreviewJpeg.snapshot(frame);
       jpegEncoder.execute(new Runnable(){public void run(){
        try{
         byte[] jpg=PreviewJpeg.encode(copied,58);
         if(running){latestJpeg=jpg;lastJpegAt=SystemClock.elapsedRealtime();jpegEncoded++;}
        }catch(Throwable jpegError){
         jpegErrors++;
         Log.w(TAG,"preview_jpeg_worker_failed",jpegError);
        }finally{jpegBusy=false;}
       }});
      }catch(Exception enqueueError){
       jpegBusy=false;jpegErrors++;
       Log.w(TAG,"preview_jpeg_submit_failed",enqueueError);
      }
     }
     // Store compressed PRE-EVENT video in phone RAM without writing any
     // untriggered clips to microSD. The encoder worker never blocks cameraHandler.
     if(preRoll!=null&&!preRoll.failed()&&"watching".equals(mode)&&
         temperature()<375&&lastFrameAt-preRollLastFrameAt>=44L){
      preRollLastFrameAt=lastFrameAt;
      if(!preRoll.busy()){
       try{preRoll.offer(PreviewJpeg.snapshot(frame),
                 SystemClock.elapsedRealtimeNanos()/1000L);}
       catch(Throwable prerollFailure){Log.w(TAG,"prebuffer_frame_skipped",prerollFailure);}
      }
     }
     boolean change=motion.analyze(frame);
     if(temporaryTest&&!pilotStarted&&frames>12&&"watching".equals(mode)){
      pilotStarted=true;startRecording();
     }
     if(change && lastFrameAt>=cameraControlSettleUntil){
      motionEvents++;
      lastMovementAt=lastFrameAt;
      eventChain.evidence(lastFrameAt);
      if(!pilotOnly&&"watching".equals(mode)){
       // Motion merely requests on-device person inference. Vehicles on the
       // road and non-person garden motion do not start new videos.
       if(!gardenGateReady)
        saveFallbackEvidence("realtime_person_detector_warming_or_unavailable");
       else {
        if(gardenPersonCandidateUntil<=lastFrameAt)gardenPersonMotionWindows++;
        gardenPersonCandidateUntil=lastFrameAt+GARDEN_PERSON_CANDIDATE_MS;
       }
      }
     }
     if(!pilotOnly&&"watching".equals(mode)&&gardenGateReady&&
         lastFrameAt>=cameraControlSettleUntil){
      boolean eventFollowup=lastFrameAt<gardenPersonCandidateUntil;
      boolean safeSentinel=!eventFollowup&&temperature()<370&&
           lastFrameAt-gardenPersonGateLastAt>=GARDEN_PERSON_SENTINEL_MS;
      if(eventFollowup||safeSentinel)evaluateGardenPersonAsync(safeSentinel);
     }
     if("recording".equals(mode)&&lastFrameAt-lastStart>2500){
       if(lastFrameAt-lastStart>MAX_MS)stopRecording("max_segment");
       else if(lastFrameAt-lastMovementAt>QUIET_MS)stopRecording("quiet_end");
      }
    }catch(Throwable error){failure("frame_"+error.getClass().getSimpleName(),error);}
    finally{if(frame!=null)frame.close();}
   },cameraHandler);
   mode="opening";
   manager.openCamera(cameraId,new CameraDevice.StateCallback(){
    @Override public void onOpened(CameraDevice dev){
     camera=dev;recoveryCount=0;
     // Only a verified and explicitly promoted 4K recorder can resume on boot.
     boolean preferred=!pilotOnly&&getSharedPreferences("native",MODE_PRIVATE)
       .getBoolean("continuous_4k_production_enabled",false);
     if(preferred&&temperature()<375&&folder!=null&&
         folder.getUsableSpace()>15L*1024*1024*1024){
      Continuous4KEncoder candidate=new Continuous4KEncoder();
      try{
       candidate.start();continuous4K=candidate;continuous4KTrial=true;
       if(preRoll!=null){preRoll.stop();preRoll=null;}
       continuous4KLastResult="resuming_verified_4k_on_boot";
      }catch(Throwable ex){
       try{candidate.close();}catch(Throwable ignored){}
       continuous4KFailures++;continuous4KTrial=false;continuous4K=null;
       getSharedPreferences("native",MODE_PRIVATE).edit()
         .putBoolean("continuous_4k_production_enabled",false).commit();
       continuous4KLastResult="boot_fallback_"+ex.getClass().getSimpleName();
      }
     }else if(preferred){
      // Heat is transient, keep the verified full-4K preference. Storage
      // exhaustion remains a hard safety failure that disables rearming.
      if(folder!=null&&folder.getUsableSpace()>15L*1024*1024*1024){
       continuous4KRetryAfterMs=SystemClock.elapsedRealtime()+20L*60L*1000L;
       continuous4KLastResult="boot_cooling_wait_for_4k";
      }else{
       getSharedPreferences("native",MODE_PRIVATE).edit()
         .putBoolean("continuous_4k_production_enabled",false).commit();
       continuous4KLastResult="boot_storage_guard";
      }
     }
     configurePreview();
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
 private void restoreLegacy4K(String reason){
  continuous4KLastResult="fallback_"+reason;
  boolean thermalOnly=reason.startsWith("thermal_guard");
  // Failed codecs remain disabled until explicitly re-verified. For a
  // thermal-only fallback preserve the previous verified 4K preference.
  if(thermalOnly&&getSharedPreferences("native",MODE_PRIVATE)
       .getBoolean("continuous_4k_production_enabled",false)){
   continuous4KRetryAfterMs=SystemClock.elapsedRealtime()+20L*60L*1000L;
  }else{
   getSharedPreferences("native",MODE_PRIVATE).edit()
     .putBoolean("continuous_4k_production_enabled",false).commit();
   continuous4KRetryAfterMs=0;
  }
  continuous4KTrial=false;
  if(continuous4K!=null){continuous4K.close();continuous4K=null;}
  if(!pilotOnly&&preRoll==null)preRoll=new GardenPreRoll();
  closeSession();
  if(running&&camera!=null)cameraHandler.postDelayed(()->configurePreview(),450);
 }
 private void configurePreview(){
  if(!running||camera==null||preview==null)return;
  mode="configuring_preview";
  try{
   final Surface continuousSurface=continuous4KTrial&&continuous4K!=null?
      continuous4K.inputSurface():null;
   final java.util.List<Surface> targets=continuousSurface==null?
      Collections.singletonList(preview.getSurface()):
      Arrays.asList(preview.getSurface(),continuousSurface);
   camera.createCaptureSession(targets,new CameraCaptureSession.StateCallback(){
    @Override public void onConfigured(CameraCaptureSession s){
     if(!running){s.close();return;}
     session=s;
     try{
      CaptureRequest.Builder r=camera.createCaptureRequest(
         continuousSurface==null?CameraDevice.TEMPLATE_PREVIEW:CameraDevice.TEMPLATE_RECORD);
      r.addTarget(preview.getSurface());
      if(continuousSurface!=null)r.addTarget(continuousSurface);
      cameraControls.apply(r);
      activeCameraRequest=r;
      s.setRepeatingRequest(r.build(),sensorTelemetry,cameraHandler);
      mode="watching";
      Log.i(TAG,"YUV_PREVIEW_ACTIVE 640x480 mode="+
        (continuousSurface!=null?"continuous_4k":pilotOnly?"pilot":"motion_record"));
      if(!pilotOnly&&!temporaryTest&&eventChain.continuationReady(SystemClock.elapsedRealtime())){
       segmentResumeAttempts++;
       if(temperature()<415&&folder!=null&&folder.getUsableSpace()>15L*1024*1024*1024){
        cameraHandler.postDelayed(()->{
         if(running&&"watching".equals(mode))startRecording();
        },180);
       }else{segmentResumeDenied++;eventChain.cancelContinuation();saveFallbackEvidence("event_continuation_guard");}
      }
     }catch(Exception e){failure("preview_request_failed",e);
      if(continuous4KTrial)restoreLegacy4K("preview_request");else scheduleRecover();}
    }
    @Override public void onConfigureFailed(CameraCaptureSession s){
     failure("preview_session_failed",null);
     if(continuous4KTrial)restoreLegacy4K("session_configuration");else scheduleRecover();
    }
   },cameraHandler);
  }catch(Exception e){failure("preview_setup_failed",e);
   if(continuous4KTrial)restoreLegacy4K("preview_setup");else scheduleRecover();}
 }
 // Retry occasional GPU delegate initialization failures without blocking the
 // camera callback or leaving the detector permanently unarmed.
 private void warmGardenGateAsync(){
  final ClipClassifier gate=gardenGateClassifier;
  final ExecutorService worker=gardenGateExecutor;
  if(!running||gate==null||worker==null||gardenGateReady)return;
  try{
   worker.execute(new Runnable(){public void run(){
    try{
     gate.warmPersonGate();
     if(running)gardenGateReady=true;
    }catch(Throwable error){
     gardenGatePrepareErrors++;
     Log.w(TAG,"realtime_garden_gate_init_failed",error);
     if(running&&gardenGatePrepareErrors<5&&cameraHandler!=null)
      cameraHandler.postDelayed(new Runnable(){public void run(){
       warmGardenGateAsync();
      }},Math.min(60000L,5000L*gardenGatePrepareErrors));
    }
   }});
  }catch(RejectedExecutionException error){gardenGatePrepareErrors++;}
 }
 private void evaluateGardenPersonAsync(boolean sentinel){
  final long now=SystemClock.elapsedRealtime();
  if(gardenPersonGateBusy||now-gardenPersonGateLastAt<900||latestJpeg.length<1000||
      now-lastJpegAt>1200||gardenGateExecutor==null||gardenGateClassifier==null||
      !gardenGateReady)return;
  gardenPersonGateBusy=true;gardenPersonGateLastAt=now;
  if(sentinel)gardenPersonSentinelChecks++;
  final boolean sentinelObservation=sentinel;
  if(now>lastMovementAt+250)gardenPersonFollowupChecks++;
  final long jpegAt=lastJpegAt;
  final byte[] jpg=latestJpeg.clone();
  final float top=motion.topBoundary(),margin=motion.sideMargin();
  final String selectedZone=motion.gardenZone();
  try{
   gardenGateExecutor.execute(new Runnable(){public void run(){
    final long gateStarted=SystemClock.elapsedRealtime();
    ClipClassifier.GardenPersonEvidence evidence=null;
    float wholeFrameScore=0;boolean failed=false;
    try{
     evidence=gardenGateClassifier.personEvidenceInGarden(jpg,top,margin,selectedZone);
     wholeFrameScore=gardenGateClassifier.lastPersonScoreAnywhere();
    }
    catch(Throwable issue){
     failed=true;
     Log.w(TAG,"garden_person_gate_"+issue.getClass().getSimpleName());
    }
    final float score=evidence==null?0f:evidence.score;
    final float[] personBox=evidence==null?null:evidence.box;
    final float anyScore=wholeFrameScore;
    final boolean error=failed;
    if(cameraHandler==null)return;
    cameraHandler.post(new Runnable(){public void run(){
     gardenPersonGateBusy=false;
     gardenPersonGateQueueWaitMs=Math.max(0,gateStarted-now);
     gardenPersonInferenceLastMs=SystemClock.elapsedRealtime()-gateStarted;
     gardenPersonInferenceMaxMs=Math.max(gardenPersonInferenceMaxMs,gardenPersonInferenceLastMs);
     gardenPersonGateChecks++;
     gardenPersonGateScore=score;
     gardenPersonGateAnyScore=anyScore;
     if(error){
      gardenPersonGateErrors++;
      personTrackGate.reset();
      saveFallbackEvidence("realtime_person_detector_failed");
      return;
     }
     // A weak model prediction cannot form half of a valid two-frame track.
     if(score<GardenPersonTrackGate.MIN_SCORE){
      gardenPersonGateRejects++;
      // Brief model dropout: keep last tracked positive within MAX_PAIR_MS
      // but still require a later independent, associated detection.
      personTrackGate.offer(now,jpegAt,score,null,0);
      return;
     }
     gardenPersonGateMatches++;
     if(!running||!"watching".equals(mode)||SystemClock.elapsedRealtime()-now>3500||
         lastFrameAt<cameraControlSettleUntil){
      gardenPersonGateStale++;
      personTrackGate.reset();
      if(running&&"watching".equals(mode))
       saveFallbackEvidence("stale_person_result_skipped");
      return;
     }
     // The motion grid retains 5s of accepted cells. A marginal person
     // classification must overlap actual garden movement, not merely
     // coincide with an unrelated passing vehicle or moving shrub.
     int localCells=motion.recentMotionCellsInBox(personBox,SystemClock.elapsedRealtime());
     gardenPersonLastLocalMotionCells=localCells;
     GardenPersonTrackGate.Decision verdict=
         personTrackGate.offer(now,jpegAt,score,personBox,localCells);
     gardenPersonDuplicateJpegRejects=personTrackGate.duplicateFrames;
     if(verdict!=GardenPersonTrackGate.Decision.CONFIRMED)return;
     gardenPersonCandidateUntil=0;
     // Also set the quiet-window anchor for periodic-only detections, where
     // no MotionGrid vote ever updated lastMovementAt.
     lastMovementAt=SystemClock.elapsedRealtime();
     eventChain.evidence(lastMovementAt);
     if(temperature()<415 && folder!=null&&
             folder.getUsableSpace()>15L*1024*1024*1024){
      gardenPersonGateConfirmedStarts++;
      if(sentinelObservation)gardenPersonSentinelStarts++;
      startRecording();
     }
     else saveFallbackEvidence("thermal_or_space_guard");
    }});
   }});
  }catch(RejectedExecutionException exc){
   gardenPersonGateBusy=false;gardenPersonGateErrors++;
   saveFallbackEvidence("realtime_person_detector_queue_unavailable");
  }
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
   return;
  }
  if(temperature()>=415||folder.getUsableSpace()<15L*1024*1024*1024){
   saveFallbackEvidence("recording_safety_guard");
   return;
  }

  // Capture previous H.264 frames BEFORE recorder reconfigures the camera.
  // A failed/missing preroll never blocks the full-quality event recording.
  if(continuous4KTrial){
   if(continuous4K==null||!continuous4K.readyForEvent()){
    saveFallbackEvidence("continuous_4k_ring_not_ready");return;
   }
   String clip=(diagnosticPrerollActive?"diagnostic_preroll_":"motion_")+
       System.currentTimeMillis()+".mp4";
   partial=new File(folder,clip+".recording");finished=new File(folder,clip);
   final boolean diagnostic=diagnosticPrerollActive;
   boolean accepted=continuous4K.startEvent(partial,finished,recordingRotation(),
     new Continuous4KEncoder.Listener(){
      @Override public void completed(File movie,long durationMs){
       cameraHandler.post(()->finishContinuous4K(movie,durationMs,diagnostic));
      }
      @Override public void failed(File retained,String cause){
       cameraHandler.post(()->{
        continuous4KFailures++;
        failure("continuous_4k_muxer_"+cause,null);
        eventChain.reset();restoreLegacy4K("muxer_"+cause);
       });
      }
     });
   if(!accepted){saveFallbackEvidence("continuous_4k_start_rejected");return;}
   noteRecordingStarted();
   lastStart=SystemClock.elapsedRealtime();lastRecordAt=lastStart;
   lastMovementAt=lastStart;eventChain.started(lastStart,System.currentTimeMillis());
   mode="recording";
   Log.i(TAG,"START_NATIVE_CONTINUOUS_4K "+clip);
   if(diagnostic)cameraHandler.postDelayed(()->{
    if("recording".equals(mode))stopRecording("continuous_4k_diagnostic");
   },9000);
   return;
  }
  frozenPreRoll=preRoll==null?null:preRoll.freeze();
  mode="starting";lastMovementAt=SystemClock.elapsedRealtime();
  try{
   closeSession();
   String name=(diagnosticPrerollActive?"diagnostic_preroll_":"motion_")+
      System.currentTimeMillis()+".mp4";
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
      s.setRepeatingRequest(b.build(),sensorTelemetry,cameraHandler);
      recorder.start();
      noteRecordingStarted();
      lastStart=SystemClock.elapsedRealtime();
       lastRecordAt=lastStart;
       eventChain.started(lastStart,System.currentTimeMillis());
       mode="recording";
      Log.i(TAG,"START_MOTION_4K "+finished.getName());
      if(temporaryTest||diagnosticPrerollActive)
       cameraHandler.postDelayed(new Runnable(){public void run(){
        if("recording".equals(mode))stopRecording(diagnosticPrerollActive?"diagnostic_short":"pilot_short");
       }},9000);
     }catch(Exception e){failure("recorder_start_failed",e);abortRecording();}
    }
    @Override public void onConfigureFailed(CameraCaptureSession s){
     failure("4k_plus_yuv_unsupported",null);abortRecording();
    }
   },cameraHandler);
  }catch(Exception e){failure("recorder_prepare_failed",e);abortRecording();}
 }
 private void finishContinuous4K(File clip,long durationMs,boolean diagnostic){
  if(!validCompleted4K(clip)){
   continuous4KFailures++;
   failure("continuous_4k_final_validation_failed",null);
   restoreLegacy4K("invalid_single_mp4");
   return;
  }
  continuous4KCompleted++;
  continuous4KLastResult="verified_native_4k_"+durationMs+"ms";
  mode="watching";
  if(diagnostic){
   diagnosticPrerollClip=clip.getName();
   diagnosticPrerollResult="single_native_4k_complete_"+durationMs+"ms";
   diagnosticPrerollActive=false;
   eventChain.reset();
   Log.i(TAG,"CONTINUOUS_4K_TEST_MP4 "+clip.getName());
   return;
  }
  completed++;
  lastClip=clip.getName();
  final CaptureContinuity.Segment segment=eventChain.stopped(
      SystemClock.elapsedRealtime(),lastClip,"continuous_4k_event");
  final long motionAtSave=motionEvents;
  final String evidenceReason="continuous_native_4k_"+captureTier;
  writeCaptureEvidenceAsync(clip,segment);
  reviewer.submit(()->review(clip,evidenceReason,motionAtSave,segment));
 }
 private void stopRecording(String reason){
  if(!"recording".equals(mode))return;
  if(continuous4KTrial&&continuous4K!=null){
   mode="stopping";
   if(!continuous4K.stopEvent()){
    continuous4KFailures++;restoreLegacy4K("stop_rejected");
   }
   return;
  }
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
   if(diagnosticPrerollActive){
    // No classification, no person labels, no indexed motion rows. A test
    // harness reads both MP4s over authorized ADB and deletes them afterward.
    diagnosticPrerollClip=candidate.getName();
    diagnosticPrerollResult="4k_finalized_preroll_writing";
    final GardenPreRoll.Frozen diagnosticFrozen=frozenPreRoll;
    frozenPreRoll=null;
    diagnosticPrerollActive=false;
    eventChain.reset();
    if(preRoll!=null&&diagnosticFrozen!=null)preRoll.saveAsync(candidate,diagnosticFrozen);
    else diagnosticPrerollResult="4k_finalized_preroll_snapshot_missing";
    Log.i(TAG,"PREROLL_DIAGNOSTIC_4K_SAVED "+candidate.getName());
    return;
   }
   completed++;lastClip=candidate.getName();
    final CaptureContinuity.Segment eventSegment=eventChain.stopped(
      SystemClock.elapsedRealtime(),lastClip,reason);
    Log.i(TAG,"FINALIZED_TRUE_4K name="+lastClip+" bytes="+candidate.length()
      +" event="+eventSegment.eventId+" segment="+eventSegment.sequence);
    final File saved=candidate;final long motionAtSave=motionEvents;
    if(preRoll!=null&&frozenPreRoll!=null)preRoll.saveAsync(saved,frozenPreRoll);
    frozenPreRoll=null;
    final String reviewTrigger=reason+"_"+captureTier;
    writeCaptureEvidenceAsync(saved,eventSegment);
    reviewer.submit(new Runnable(){public void run(){review(saved,reviewTrigger,motionAtSave,eventSegment);}});
  }catch(Exception e){
   failure("finalize_failed_"+e.getClass().getSimpleName(),e);
    eventChain.reset();
    // Keep the raw .recording file for forensic recovery, never delete incomplete footage.
  }finally{
   if(recorder!=null){try{recorder.release();}catch(Exception ignored){}recorder=null;}
   closeSession();
   cooldownUntil=0;
   if(temporaryTest)cameraHandler.postDelayed(new Runnable(){public void run(){shutdown();}},800);
   else cameraHandler.postDelayed(new Runnable(){public void run(){configurePreview();}},700);
  }
 }
 private void abortRecording(){
  if(diagnosticPrerollActive){
   diagnosticPrerollResult="diagnostic_recording_aborted";
   diagnosticPrerollActive=false;
  }
  frozenPreRoll=null;
  if(recorder!=null){try{recorder.release();}catch(Exception ignored){}recorder=null;}
  closeSession();
  failed++;
  cooldownUntil=SystemClock.elapsedRealtime()+20000;
  cameraHandler.postDelayed(new Runnable(){public void run(){configurePreview();}},1300);
 }
 private void writeCaptureEvidenceAsync(File video,CaptureContinuity.Segment segment){
  final ExecutorService output=evidenceWriter;
  if(output==null)return;
  try{
   output.execute(new Runnable(){public void run(){
    try{
     JSONObject evidence=new JSONObject();
     evidence.put("version",CaptureContinuity.VERSION);
     evidence.put("kind","recording_segment_event_evidence");
     evidence.put("name",video.getName());
     evidence.put("capture_event_id",segment.eventId);
     evidence.put("capture_segment_index",segment.sequence);
     evidence.put("capture_previous_segment",
       segment.previousClip.isEmpty()?JSONObject.NULL:segment.previousClip);
     evidence.put("capture_transition_reason",segment.transitionReason);
     evidence.put("capture_end_reason",segment.stopReason);
     evidence.put("physical_reconfigure_gap_ms",segment.gapMs<0?JSONObject.NULL:segment.gapMs);
     evidence.put("auto_resume_armed",segment.autoResumeArmed);
     evidence.put("timestamp_basis","Android_elapsedRealtime_not_wall_clock");
     evidence.put("video_continuity_is_gapless",false);
     evidence.put("classifier_human_verified",false);
     ClipClassifier.writeJson(
       new File(video.getParentFile(),video.getName()+".capture.json"),evidence);
    }catch(Exception problem){
     Log.w(TAG,"recording_capture_evidence_write_failed",problem);
    }
   }});
  }catch(RejectedExecutionException ignored){}
 }
 private boolean review(File f,String reason,long count){
  return review(f,reason,count,null);
 }
 private boolean review(File f,String reason,long count,CaptureContinuity.Segment segment){
  try{
   JSONObject j=classifier.process(f,folder,f.getName(),reason,count);
   if(segment!=null){
    j.put("capture_event_version",CaptureContinuity.VERSION);
    j.put("capture_event_id",segment.eventId);
    j.put("capture_segment_index",segment.sequence);
    j.put("capture_previous_segment",segment.previousClip.isEmpty()?JSONObject.NULL:segment.previousClip);
    j.put("capture_segment_transition",segment.transitionReason);
    j.put("capture_segment_end_reason",segment.stopReason);
    j.put("capture_segment_start_elapsed_ms",segment.startMonotonicMs);
    j.put("capture_segment_stop_elapsed_ms",segment.stopMonotonicMs);
    j.put("capture_segment_gap_from_previous_ms",segment.gapMs<0?JSONObject.NULL:segment.gapMs);
    j.put("capture_segment_auto_resume_armed",segment.autoResumeArmed);
    j.put("capture_segments_have_unrecorded_transition_gaps",true);
    j.put("capture_metadata_is_model_evidence_not_verified_identity",true);
    ClipClassifier.writeJson(new File(folder,f.getName()+".verified.json"),j);
   }
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
 // No still-image substitutes for a video: the request is for actual
 // recordings of a person in the foreground garden. Existing saved JPEGs
 // remain intact until independently audited, but no new ones are created.
 private volatile long skippedRecordingsWithoutStill=0;
 private void saveFallbackEvidence(String why){
  skippedRecordingsWithoutStill++;
  if(skippedRecordingsWithoutStill%40==1)
   Log.w(TAG,"VIDEO_GUARD_NO_STILL "+why);
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
     !"watching".equals(mode)||movementBackfillQueued||temperature()>=370||folder.getUsableSpace()<20L*1024*1024*1024)return;
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
 /** Scan finalized Security4K person recordings at idle: one clip per phone-local pass. */
 private void maybeFaceBackfill(){
  long now=SystemClock.elapsedRealtime();
  if(!running||faceBackfillQueued||now-lastFaceBackfillScan<60000||
     folder==null||reviewer==null||classifier==null||
     !"watching".equals(mode)||movementBackfillQueued||temperature()>=350||gardenPersonGateBusy||
     (lastMovementAt>0&&now-lastMovementAt<45000L)||
     folder.getUsableSpace()<20L*1024*1024*1024)return;
  faceBackfillQueued=true;
  final File target=folder;
  try{
   reviewer.execute(new Runnable(){public void run(){
    try{
     if(!running||!"watching".equals(mode)||temperature()>=350)return;
     File[] manifests=target.listFiles((d,n)->n.matches("motion_[0-9]{13}[.]mp4[.]verified[.]json"));
     if(manifests==null)return;
     Arrays.sort(manifests,Comparator.comparing(File::getName));
     for(File manifest:manifests){
      if(!running||!"watching".equals(mode)||temperature()>=350)return;
      if(manifest.length()<100||manifest.length()>28000)continue;
      String mp4name=manifest.getName().replace(".verified.json","");
      File video=new File(target,mp4name);
      if(faceBackfillRetries.getOrDefault(mp4name,0)>=3)continue;
      if(!video.isFile()||video.length()<100000||video.length()>800000000)continue;
      try{
       byte[] bytes=new byte[(int)manifest.length()];
       try(InputStream in=new FileInputStream(manifest)){
        int off=0;while(off<bytes.length){int n=in.read(bytes,off,bytes.length-off);if(n<0)throw new EOFException();off+=n;}
       }
       JSONObject meta=new JSONObject(new String(bytes,"UTF-8"));
       if(meta.optInt("person_count",0)<=0)continue;
       // Historical MP4s with person evidence get a second deeper on-device
       // face-only review, rather than marking "no face in 12 frames" final.
       // New-era clips stay on their standard real-time review path.
       boolean hasReview=meta.has("face_review_version");
       // Re-run only pre-v2 face-negative historical reviews. Successful
       // v2 no-face reviews are terminal for this sampler, not proof of absence.
       boolean deep=ClipClassifier.deepFaceNeedsUpgrade(meta)&&
          meta.optInt("width",0)==3840&&meta.optInt("height",0)==2160&&
          Long.parseLong(mp4name.substring(7,20))<1791687597000L;
       if(!deep&&hasReview)continue;
       if(!mp4name.equals(meta.optString("name"))||meta.optLong("bytes",-1)!=video.length())continue;
       if(deep){
        try{
         if(classifier.deepFaceReview(video,target,mp4name,meta)){
          deepFaceScanned++;faceBackfillRetries.remove(mp4name);
         }else{
          deepFaceErrors++;
          faceBackfillRetries.merge(mp4name,1,Integer::sum);
         }
        }catch(Exception e){
         deepFaceErrors++;
         faceBackfillRetries.merge(mp4name,1,Integer::sum);
         Log.w(TAG,"face_deep_review",e);
        }
       }else if(review(video,"onphone_face_backfill",0)){
        faceBackfillDone++;faceBackfillRetries.remove(mp4name);
       }else{
        faceBackfillErrors++;faceBackfillRetries.merge(mp4name,1,Integer::sum);
       }
       return;
      }catch(Exception e){
       faceBackfillErrors++;
       faceBackfillRetries.merge(mp4name,1,Integer::sum);
       Log.w(TAG,"face_backfill_manifest_skip",e);
      }
     }
    }finally{
     lastFaceBackfillScan=SystemClock.elapsedRealtime();
     faceBackfillQueued=false;
    }
   }});
  }catch(java.util.concurrent.RejectedExecutionException e){faceBackfillQueued=false;}
 }
 /** Offloaded archived-video retention review. Runs on the S9+ only,
  * never downloads/decodes videos on C720P. Quarantine is reversible and
  * never purges permanently based on an uncertain night model prediction.
  */

 /** Review missing movement observations from finalized original 4K MP4s on
  * the phone's existing serialized worker. Capture and face review stay live. */
 private void maybeMovementBackfill(){
  long now=SystemClock.elapsedRealtime();
  if(!running||movementBackfillQueued||faceBackfillQueued||historicalQueued||
     now-lastMovementBackfillScan<90000L||
     folder==null||reviewer==null||classifier==null||
     !"watching".equals(mode)||temperature()>=335||gardenPersonGateBusy||
     (lastMovementAt>0&&now-lastMovementAt<60000L)||
     folder.getUsableSpace()<20L*1024*1024*1024)return;
  movementBackfillQueued=true;
  final File target=folder;
  try{
   reviewer.execute(new Runnable(){public void run(){
    try{
     if(!running||!"watching".equals(mode)||temperature()>=335)return;
     File[] manifests=target.listFiles((d,n)->n.matches("motion_[0-9]{13}[.]mp4[.]verified[.]json"));
     if(manifests==null)return;
     Arrays.sort(manifests,Comparator.comparing(File::getName));
     for(File manifest:manifests){
      if(!running||!"watching".equals(mode)||temperature()>=335||
         gardenPersonGateBusy||(lastMovementAt>0&&
         SystemClock.elapsedRealtime()-lastMovementAt<60000L))return;
      if(manifest.length()<100||manifest.length()>28000)continue;
      String name=manifest.getName().replace(".verified.json","");
      File video=new File(target,name);
      if(movementBackfillRetries.getOrDefault(name,0)>=3)continue;
      if(!video.isFile()||video.length()<100000||video.length()>800000000)continue;
      try{
       JSONObject meta;
       try(FileInputStream in=new FileInputStream(manifest);
           ByteArrayOutputStream out=new ByteArrayOutputStream()){
        byte[] buffer=new byte[8192];int n;
        while((n=in.read(buffer))>0){
         out.write(buffer,0,n);
         if(out.size()>28000)throw new IOException("movement_manifest_too_large");
        }
        meta=new JSONObject(out.toString("UTF-8"));
       }
       if(meta.optInt("person_count",0)<=0||
          meta.has("movement_backfill_version"))continue;
       JSONArray tracks=meta.optJSONArray("anonymous_tracks");
       if("sampled_box_tracklets_v1".equals(meta.optString("anonymous_tracking_version"))&&
          tracks!=null){
        boolean complete=true;
        for(int i=0;i<tracks.length();i++){
         JSONObject track=tracks.optJSONObject(i);
         if(track==null||!track.has("image_movement_direction")){complete=false;break;}
        }
        if(complete)continue;
       }
       if(classifier.backfillMovementEvidence(video,target,name,meta)){
        movementBackfillDone++;
        Log.i(TAG,"S9_MOVEMENT_4K_BACKFILL_COMPLETE "+name);
       }
       return; // one candidate per guarded phone-local pass
      }catch(Exception e){
       movementBackfillErrors++;
       movementBackfillRetries.put(name,movementBackfillRetries.getOrDefault(name,0)+1);
       Log.w(TAG,"movement_4k_backfill_failed",e);
       return;
      }
     }
    }finally{
     lastMovementBackfillScan=SystemClock.elapsedRealtime();
     movementBackfillQueued=false;
    }
   }});
  }catch(java.util.concurrent.RejectedExecutionException e){movementBackfillQueued=false;}
 }
 // Never quarantine an existing person-negative original while testing a
 // detector whose false-negative rate is not independently established.
 // Original 4K MP4 files remain on microSD for manual review and recovery.
 private static final boolean GARDEN_AUTO_QUARANTINE_ENABLED=false;
 private void maybeGardenArchiveTriage(){
  if(!GARDEN_AUTO_QUARANTINE_ENABLED)return;
  long now=SystemClock.elapsedRealtime();
  // Increase archive throughput ONLY when the garden has been quiet for
  // 30 seconds, the realtime person GPU gate is idle, and the phone is cool.
  // If warm, fall back to the original low-impact one-per-minute cadence.
  int batteryTenths=temperature();
  long archiveWait=batteryTenths<310?18000L:
                  batteryTenths<335?40000L:60000L;
  if(!running||gardenTriageQueued||now-gardenTriageLastScan<archiveWait||
     folder==null||classifier==null||reviewer==null||
     !"watching".equals(mode)||faceBackfillQueued||historicalQueued||movementBackfillQueued||
     gardenPersonGateBusy||
     (lastMovementAt>0&&now-lastMovementAt<30000L)||
     batteryTenths>=370||folder.getUsableSpace()<20L*1024*1024*1024)return;
  gardenTriageQueued=true;
  final File media=folder;
  final long cutoff=gardenTriageCutoffMs;
  final float roiTop=motion.topBoundary(),roiMargin=motion.sideMargin();
  try{
   reviewer.execute(new Runnable(){public void run(){
    try{
     if(!running||!"watching".equals(mode)||temperature()>=370)return;
     int changed=new GardenArchiveTriage(media,classifier,roiTop,roiMargin,cutoff).processOne();
     if(changed==1)gardenTriageQuarantined++;
     if(changed==2)gardenTriagePreserved++;
    }catch(Exception ex){
     gardenTriageErrors++;
     Log.w(TAG,"garden_archive_retention_pass_failed",ex);
    }finally{
     gardenTriageLastScan=SystemClock.elapsedRealtime();
     gardenTriageQueued=false;
    }
   }});
  }catch(RejectedExecutionException reject){
   gardenTriageErrors++;
   gardenTriageQueued=false;
  }
 }
 private void maybeRestoreCool4K(){
  if(continuous4KTrial||pilotOnly||!"watching".equals(mode)||
     !getSharedPreferences("native",MODE_PRIVATE).getBoolean("continuous_4k_production_enabled",false)||
     continuous4KRecoveryAttempts>=3)return;
  long now=SystemClock.elapsedRealtime();
  if(now<continuous4KRetryAfterMs||temperature()>350||folder==null||
     folder.getUsableSpace()<15L*1024*1024*1024||camera==null||preview==null||
     now-lastFrameAt>1500||now-lastMovementAt<30000||
     gardenPersonCandidateUntil>now)return;
  continuous4KRecoveryAttempts++;
  continuous4KRetryAfterMs=now+20L*60L*1000L;
  // Never disturb an ongoing event. Reconfigure the idle camera only.
  closeSession();
  Continuous4KEncoder candidate=new Continuous4KEncoder();
  try{
   candidate.start();continuous4K=candidate;continuous4KTrial=true;
   if(preRoll!=null){preRoll.stop();preRoll=null;}
   continuous4KLastResult="rearmed_after_thermal_cooldown";
   configurePreview();
  }catch(Throwable problem){
   try{candidate.close();}catch(Throwable ignored){}
   continuous4K=null;continuous4KTrial=false;
   continuous4KFailures++;
   restoreLegacy4K("codec_rearm_"+problem.getClass().getSimpleName());
  }
 }
 private void watchdog(){
  if(!running)return;
  long n=SystemClock.elapsedRealtime();
  if("recording".equals(mode)&&n-lastStart>MAX_MS+8000)stopRecording("watchdog_cap");
  if(continuous4KTrial&&continuous4K!=null){
   boolean codecBad=continuous4K.error().length()>0||continuous4K.droppedOutputFrames()>0;
   boolean tooHot=temperature()>=395;
   if(codecBad||tooHot){
    failure("continuous_4k_trial_failed_health_guard",null);
    String reason=codecBad?"codec_health_guard":"thermal_guard";
    if("watching".equals(mode))restoreLegacy4K(reason);
    else if("recording".equals(mode))stopRecording("trial_health_guard");
    else if("stopping".equals(mode))restoreLegacy4K(reason+"_stopping");
   }
  }
  if("watching".equals(mode)&&lastFrameAt>0&&n-lastFrameAt>9000){
   failure("stalled_YUV_camera",null);scheduleRecover();
  }
  maybeMovementBackfill();
  maybeHistoricalImport();
  maybeFaceBackfill();
  maybeGardenArchiveTriage();
  maybeRestoreCool4K();
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
   d.put("preroll_version",continuous4KTrial?"continuous_native_4k_h264_ring_v1":GardenPreRoll.VERSION);
   d.put("continuous_4k_trial_active",continuous4KTrial);
   d.put("continuous_4k_production_persisted",getSharedPreferences("native",MODE_PRIVATE).getBoolean("continuous_4k_production_enabled",false));
   d.put("continuous_4k_ready",continuous4K!=null&&continuous4K.readyForEvent());
   d.put("continuous_4k_buffered_ms",continuous4K==null?0:continuous4K.bufferedMs());
   d.put("continuous_4k_buffer_bytes",continuous4K==null?0:continuous4K.bufferedBytes());
   d.put("continuous_4k_dropped_output_frames",continuous4K==null?0:continuous4K.droppedOutputFrames());
   d.put("continuous_4k_error",continuous4K==null?"":continuous4K.error());
   d.put("continuous_4k_completed",continuous4KCompleted);
   d.put("continuous_4k_failures",continuous4KFailures);
   d.put("continuous_4k_recovery_attempts",continuous4KRecoveryAttempts);
   d.put("continuous_4k_retry_after_ms",continuous4KRetryAfterMs);
   d.put("continuous_4k_last_result",continuous4KLastResult);
   d.put("preroll_enabled",preRoll!=null&&!pilotOnly);
   d.put("preroll_ready",preRoll!=null&&preRoll.ready());
   d.put("preroll_buffered_frames",preRoll==null?0:preRoll.cachedFrames());
   d.put("preroll_buffered_ms",preRoll==null?0:preRoll.cachedDurationMs());
   d.put("preroll_encoded_frames",preRoll==null?0:preRoll.framesOutput);
   d.put("preroll_dropped_frames",preRoll==null?0:preRoll.dropped);
   d.put("preroll_files_saved",preRoll==null?0:preRoll.filesSaved);
   d.put("preroll_last_name",preRoll==null?"":preRoll.lastSavedName);
   d.put("preroll_last_duration_ms",preRoll==null?0:preRoll.lastSavedDurationMs);
   d.put("preroll_last_error",preRoll==null?"not_started":preRoll.lastError);
   d.put("preroll_diagnostic_used",diagnosticPrerollUsed);
   d.put("preroll_diagnostic_active",diagnosticPrerollActive);
   d.put("preroll_diagnostic_clip",diagnosticPrerollClip);
   d.put("preroll_diagnostic_result",diagnosticPrerollResult);
   d.put("motion_detector",GardenPersonTrackGate.VERSION);
    d.put("capture_event_version",CaptureContinuity.VERSION);
    d.put("capture_event_id",eventChain.eventId());
    d.put("capture_segment_index",eventChain.segmentNumber());
    d.put("capture_segment_continuation_pending",eventChain.isContinuationPending());
    d.put("capture_segment_auto_resume_attempts",segmentResumeAttempts);
    d.put("capture_segment_auto_resume_guard_denied",segmentResumeDenied);
    d.put("capture_segments_are_gapless",false);
    d.put("thumbnail_selector",EventFrameRanker.VERSION);
   d.put("previous_detector_version","garden_roi_gpu_two_frame_person_gate_v2");
   d.put("legacy_detector_version","garden_roi_gpu_person_gate_v1");
   d.put("review_model","ssd_mobilenet_coco_gpu_cpu_v1");
   d.put("mic",false);d.put("cloud_upload",false);
   d.put("storage","removable_microSD_only");
   d.put("sd_free_bytes",folder==null?0:folder.getUsableSpace());
   d.put("frames",frames);d.put("motion_events",motionEvents);
   long age=lastSensorCaptureAt==0?-1:SystemClock.elapsedRealtime()-lastSensorCaptureAt;
   d.put("sensor_capture_result_frames",sensorCaptureResults);
   d.put("sensor_capture_result_age_ms",age);
   d.put("sensor_result_fps",age>=0&&age<5000?Math.round(sensorResultFps*100f)/100f:null);
   d.put("sensor_exposure_ms",sensorExposureMs>0?Math.round(sensorExposureMs*100f)/100f:null);
   d.put("sensor_frame_duration_ms",sensorFrameDurationMs>0?
      Math.round(sensorFrameDurationMs*100f)/100f:null);
   d.put("sensor_iso",sensorIso>0?sensorIso:null);
   d.put("sensor_ae_state",aeStateLabel(sensorAeState));
   d.put("sensor_ae_target_fps_min",sensorAeMinFps>0?sensorAeMinFps:null);
   d.put("sensor_ae_target_fps_max",sensorAeMaxFps>0?sensorAeMaxFps:null);
   d.put("sensor_lowlight_long_exposure",sensorExposureMs>=45f);
   d.put("motion_rate_suppressed",suppressedByRate);
   d.put("recording_rate_max_per_hour",MAX_4K_CLIPS_PER_HOUR);
   d.put("recording_rate_standard_per_hour",RecordingRate.BASE_PER_HOUR);
   d.put("recording_rate_priority_reserve",RecordingRate.PRIORITY_RESERVE_PER_HOUR);
   d.put("priority_motion",motion.strong);
   d.put("priority_reserve_used",reserveUsed);
   d.put("fallback_evidence_saved",fallbackEvidenceSaved);
    d.put("fallback_stills_enabled",false);
    d.put("suppressed_video_without_stills",skippedRecordingsWithoutStill);
    d.put("post_record_cooldown_ms",COOLDOWN_MS);
    d.put("max_person_clip_ms",MAX_MS);
    d.put("person_recording_extend_by_garden_motion",true);
   d.put("fallback_evidence_failed",fallbackEvidenceFailed);
   d.put("recovery_partials_finalized",recoveredPartials);
   d.put("recovery_missing_reviews_repaired",recoveredReviews);
   d.put("recovery_unplayable_preserved",recoveryUnplayable);
   d.put("historical_gpu_import_version","isolated_drive_import_v1");
   d.put("historical_import_reviewed",historicalReviewed);
   d.put("historical_import_errors",historicalErrors);
   d.put("historical_import_last_error_type",lastHistoricalError);
   d.put("historical_import_queued",historicalQueued);
   d.put("face_review_engine","s9_native_face_review_v1");
   d.put("face_backfill_queued",faceBackfillQueued);
    d.put("garden_archive_triage_version","onphone_24frame_reversible_quarantine_v1");
   d.put("garden_archive_auto_quarantine_enabled",GARDEN_AUTO_QUARANTINE_ENABLED);
    d.put("garden_archive_triage_queued",gardenTriageQueued);
    d.put("garden_archive_quarantined_since_start",gardenTriageQuarantined);
    d.put("garden_archive_preserved_since_start",gardenTriagePreserved);
    d.put("garden_archive_triage_errors",gardenTriageErrors);
    int archiveTemp=temperature();
    d.put("garden_archive_target_interval_ms",
      archiveTemp<310?18000:archiveTemp<335?40000:60000);
    d.put("garden_archive_requires_quiet_ms",30000);
    d.put("garden_archive_latest_motion_age_ms",lastMovementAt<=0?
      JSONObject.NULL:Math.max(0,SystemClock.elapsedRealtime()-lastMovementAt));
    d.put("garden_archive_triage_permanent_deletion_enabled",false);
   d.put("movement_4k_backfill_completed",movementBackfillDone);
   d.put("movement_4k_backfill_errors",movementBackfillErrors);
   d.put("movement_4k_backfill_skipped_after_retries",movementBackfillRetries.size());
   d.put("movement_4k_backfill_queued",movementBackfillQueued);
   d.put("face_backfill_completed",faceBackfillDone);
   d.put("face_deep_scanned",deepFaceScanned);
   d.put("face_deep_errors",deepFaceErrors);
   d.put("face_backfill_retry_limited_clips",faceBackfillRetries.size());
   d.put("face_backfill_errors",faceBackfillErrors);
   d.put("recordings_this_hour",getSharedPreferences("native",MODE_PRIVATE).getInt("record_rate_count",0));
   d.put("garden_person_gate_ready",gardenGateReady);
   d.put("garden_person_gate_backend",gardenGateClassifier==null?
     "unavailable":gardenGateClassifier.inferenceBackend());
   d.put("garden_person_gate_prepare_errors",gardenGatePrepareErrors);
   d.put("garden_person_gate_last_queue_wait_ms",gardenPersonGateQueueWaitMs);
   d.put("garden_person_gate_stale_dropped",gardenPersonGateStale);
   d.put("garden_person_gate_checked",gardenPersonGateChecks);
   d.put("garden_person_gate_matches",gardenPersonGateMatches);
   d.put("garden_person_gate_required_positive_frames",2);
   d.put("garden_person_gate_confirmed_starts",gardenPersonGateConfirmedStarts);
   d.put("garden_person_gate_rejected",gardenPersonGateRejects);
   d.put("garden_person_gate_errors",gardenPersonGateErrors);
   d.put("garden_person_gate_last_score",gardenPersonGateScore);
    d.put("garden_person_gate_last_anywhere_score",gardenPersonGateAnyScore);
   d.put("garden_person_spatial_gate",true);
   d.put("garden_person_motion_corroboration",true);
   d.put("garden_person_last_local_motion_cells",gardenPersonLastLocalMotionCells);
   d.put("garden_person_unrelated_boxes",personTrackGate.unrelatedBoxes);
   d.put("garden_person_no_local_motion",personTrackGate.noLocalMotion);
   d.put("garden_person_rejected_weak",personTrackGate.rejectedWeak);
    d.put("garden_person_followup_version","hybrid_periodic_multiscale_v8");
    d.put("garden_person_multiscale_version",gardenGateClassifier==null?
          "not_ready":gardenGateClassifier.gardenPersonMultiscaleVersion());
    d.put("garden_person_last_multiscale_passes",gardenGateClassifier==null?
          0:gardenGateClassifier.lastGardenInferencePasses());
    d.put("garden_person_sentinel_interval_ms",GARDEN_PERSON_SENTINEL_MS);
    d.put("garden_person_sentinel_checks",gardenPersonSentinelChecks);
    d.put("garden_person_sentinel_recordings",gardenPersonSentinelStarts);
    d.put("garden_person_inference_last_ms",gardenPersonInferenceLastMs);
    d.put("garden_person_inference_peak_ms",gardenPersonInferenceMaxMs);
    d.put("garden_person_no_motion_requires_distinct_frames",3);
    d.put("garden_person_candidate_window_ms",GARDEN_PERSON_CANDIDATE_MS);
    d.put("garden_person_motion_windows",gardenPersonMotionWindows);
    d.put("garden_person_followup_checks",gardenPersonFollowupChecks);
    d.put("garden_person_duplicate_jpeg_rejects",gardenPersonDuplicateJpegRejects);
   d.put("garden_zone",motion.gardenZone());
   d.put("garden_roi_top_fraction",motion.topBoundary());
   d.put("garden_roi_mask_version","near".equals(motion.gardenZone())?MotionGrid.NEAR_ROI_VERSION:"preset_horizontal_v1");
   d.put("garden_roi_top_left_fraction",motion.topBoundaryAt(0f));
   d.put("garden_roi_top_middle_fraction",motion.topBoundaryAt(.5f));
   d.put("garden_roi_top_right_fraction",motion.topBoundaryAt(1f));
   d.put("garden_roi_gates_person_inference",true);
   d.put("preview_jpeg_interval_ms","recording".equals(mode)?250:120);
   d.put("preview_jpeg_async",jpegEncoder!=null);
   d.put("preview_jpeg_worker_busy",jpegBusy);
   d.put("preview_jpeg_encoded",jpegEncoded);
   d.put("preview_jpeg_worker_errors",jpegErrors);
   d.put("post_record_cooldown_ms",COOLDOWN_MS);
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
    options.put("garden_zone",new JSONObject()
      .put("value",motion.gardenZone())
      .put("available",new JSONArray().put("strict").put("near").put("wide").put("all"))
      .put("description","Near garden excludes the upper road region"));
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
   if("preroll_diagnostic".equals(key)){
     if(!"record_once".equals(value)||diagnosticPrerollUsed||diagnosticPrerollActive||
        pilotOnly||(!(continuous4KTrial&&continuous4K!=null&&continuous4K.readyForEvent())&&
        (preRoll==null||!preRoll.ready()||preRoll.cachedDurationMs()<3500))||temperature()>=375||
        folder==null||folder.getUsableSpace()<15L*1024*1024*1024){
      return response.put("ok",false).put("error","diagnostic_prebuffer_not_ready_or_already_used");
     }
     diagnosticPrerollUsed=true;
     diagnosticPrerollActive=true;
     diagnosticPrerollResult="starting";
     startRecording();
     if(!"starting".equals(mode)&&!"recording".equals(mode)){
      diagnosticPrerollActive=false;diagnosticPrerollResult="recording_start_guard_denied";
      return response.put("ok",false).put("error",diagnosticPrerollResult);
     }
     return response.put("ok",true).put("mode",continuous4KTrial?
       "diagnostic_continuous_native_4k":"diagnostic_preroll_4k")
       .put("excluded_from_security_archive",true)
       .put("requested_duration_ms",9000);
    }
   if("continuous_4k_trial".equals(key)){
    if(!"enable".equals(value)&&!"disable".equals(value)&&!"promote".equals(value))
     return response.put("ok",false).put("error","invalid_4k_trial_option");
    if("promote".equals(value)){
     if(!continuous4KTrial||continuous4K==null||!continuous4K.readyForEvent()||
        continuous4KCompleted<1||continuous4KFailures>0||
        continuous4K.droppedOutputFrames()!=0||temperature()>=375||
        !continuous4KLastResult.startsWith("verified_native_4k_"))
      return response.put("ok",false).put("error","4k_trial_not_verified_or_unhealthy");
     boolean stored=getSharedPreferences("native",MODE_PRIVATE).edit()
       .putBoolean("continuous_4k_production_enabled",true).commit();
     return response.put("ok",stored).put("production_persisted",stored)
       .put("hardware_4k_pre_event",true);
    }
    if("enable".equals(value)){
     if(pilotOnly||continuous4KTrial||temperature()>=375||folder==null||
        folder.getUsableSpace()<15L*1024*1024*1024)
      return response.put("ok",false).put("error","4k_trial_guard");
     // Trial is never persisted: a service restart reverts to known v3.
     closeSession();
     Continuous4KEncoder candidate=new Continuous4KEncoder();
     try{
      candidate.start();
      continuous4K=candidate;continuous4KTrial=true;
      if(preRoll!=null){preRoll.stop();preRoll=null;}
      continuous4KLastResult="configuring_camera2_4k_surface";
      configurePreview();
      return response.put("ok",true).put("trial_only",true)
         .put("expected_mode","configuring_preview");
     }catch(Throwable exc){
      continuous4KFailures++;
      try{candidate.close();}catch(Throwable ignored){}
      continuous4K=null;continuous4KTrial=false;
      if(preRoll==null)preRoll=new GardenPreRoll();
      continuous4KLastResult="enable_failed_"+exc.getClass().getSimpleName();
      configurePreview();
      return response.put("ok",false).put("error",continuous4KLastResult);
     }
    }
    if(!continuous4KTrial)return response.put("ok",true).put("already_disabled",true);
    restoreLegacy4K("control_disabled");
    return response.put("ok",true).put("fallback","v3_legacy_verified");
   }
   if("garden_zone".equals(key)){
     if(!MotionGrid.validGardenZone(value))
      return response.put("ok",false).put("error","unsupported_garden_region");
     if(!getSharedPreferences("native",MODE_PRIVATE).edit()
         .putString("garden_zone",value).commit())
      return response.put("ok",false).put("error","failed_to_save_garden_region");
     motion.setGardenZone(value);
     cameraControlSettleUntil=SystemClock.elapsedRealtime()+2500L;
     return response.put("ok",true).put("key",key).put("value",motion.gardenZone())
       .put("top_fraction",motion.topBoundary()).put("mode",mode);
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
    session.setRepeatingRequest(activeCameraRequest.build(),sensorTelemetry,cameraHandler);
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
      session.setRepeatingRequest(activeCameraRequest.build(),sensorTelemetry,cameraHandler);
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
   // Read-only native microSD streaming; C720P stays a thin signed relay.
   if(PhoneMediaRange.handle(in,out,line,folder))return;
   if(line.startsWith("GET /shot.jpg ")){
    byte[] jpg=latestJpeg;
    if(jpg.length<1000){send(out,503,"text/plain","camera_preview_not_ready".getBytes("UTF-8"));return;}
    send(out,200,"image/jpeg",jpg);
   }else if(line.startsWith("GET /mjpeg ")||line.startsWith("GET /video ")
         ||line.startsWith("GET /videofeed ")){
    out.write(("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\n"+
      "Cache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
    byte[] lastSent=null;
    while(running){
     byte[] img=latestJpeg;
     if(img.length>1000 && img!=lastSent){
      lastSent=img;
      out.write(("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "+img.length+"\r\n\r\n").getBytes("UTF-8"));
      out.write(img);out.write("\r\n".getBytes("UTF-8"));out.flush();
     }
     try{Thread.sleep(75);}catch(InterruptedException e){return;}
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
  if(preRoll!=null){preRoll.stop();preRoll=null;frozenPreRoll=null;}
  if(continuous4K!=null){continuous4K.close();continuous4K=null;continuous4KTrial=false;}
  if(jpegEncoder!=null){jpegEncoder.shutdownNow();jpegEncoder=null;}
  jpegBusy=false;
  if(evidenceWriter!=null){evidenceWriter.shutdown();evidenceWriter=null;}
  gardenGateReady=false;
  if(gardenGateExecutor!=null){
   final ClipClassifier gateClose=gardenGateClassifier;
   try{
    if(gateClose!=null)gardenGateExecutor.execute(new Runnable(){public void run(){gateClose.close();}});
   }catch(RejectedExecutionException e){Log.w(TAG,"garden_gate_close_deferred",e);}
   gardenGateExecutor.shutdown();
   gardenGateExecutor=null;gardenGateClassifier=null;
  }
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
