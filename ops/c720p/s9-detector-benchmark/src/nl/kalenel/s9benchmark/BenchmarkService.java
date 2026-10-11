package nl.kalenel.s9benchmark;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.os.*;
import android.util.Log;
import org.json.*;
import org.tensorflow.lite.Interpreter;
import org.tensorflow.lite.DataType;
import org.tensorflow.lite.Tensor;
import java.io.*;
import java.net.*;
import java.nio.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Independent one-shot CPU benchmark; NO camera, mic, cloud or production modifications. */
public final class BenchmarkService extends Service {
 private static final String TAG="S9_AB_TEST";
 private static final String SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K";
 private static final AtomicBoolean busy=new AtomicBoolean(false);
 private static final int MAX_FILES=6, FRAMES=15, MAX_TEMP=37;
 private static final long MAX_SESSION_MS=6*60*1000L;
 @Override public IBinder onBind(Intent i){return null;}
 @Override public int onStartCommand(Intent intent,int flags,int id){
  if(!busy.compareAndSet(false,true))return START_NOT_STICKY;
  if(Build.VERSION.SDK_INT>=26){
   NotificationManager m=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
   m.createNotificationChannel(new NotificationChannel("benchmark","Local detector A/B",NotificationManager.IMPORTANCE_LOW));
   startForeground(8430,new Notification.Builder(this,"benchmark")
     .setSmallIcon(android.R.drawable.ic_menu_info_details)
     .setContentTitle("S9 offline detector comparison").build());
  }
  new Thread(()->{
   try{benchmark();}catch(Throwable e){
    Log.e(TAG,"bench_failed",e);
    try{save(new JSONObject().put("ok",false).put("error",e.toString()));}catch(Exception ignored){}
   }finally{busy.set(false);stopForeground(true);stopSelf(id);}
  },"s9-benchmark-once").start();
  return START_NOT_STICKY;
 }
 private JSONObject status()throws Exception{
  HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:8808/status").openConnection();
  try{
   c.setConnectTimeout(2000);c.setReadTimeout(2500);
   try(InputStream in=c.getInputStream()){
    byte[] b=new byte[12000];int n=in.read(b);
    if(n<=0)throw new IOException("empty_native_status");
    return new JSONObject(new String(b,0,n,"UTF-8"));
   }
  }finally{c.disconnect();}
 }
 private JSONObject safe()throws Exception{
  JSONObject s=status();
  if(!s.optBoolean("ok")||!"watching".equals(s.optString("mode")))
   throw new IOException("camera_not_idle");
  if(s.optDouble("temperature_c",100)>=MAX_TEMP)
   throw new IOException("thermal_guard");
  if(s.optLong("sd_free_bytes",0)<20L*1024*1024*1024)
   throw new IOException("microSD_space_guard");
  return s;
 }
 static byte[] asset(Context c,String name)throws Exception{
  try(InputStream in=c.getAssets().open(name);ByteArrayOutputStream b=new ByteArrayOutputStream()){
   byte[] a=new byte[8192];int n;while((n=in.read(a))>0){
    b.write(a,0,n);if(b.size()>15000000)throw new IOException("model_too_big");
   }return b.toByteArray();
  }
 }
 static String sha(byte[] content)throws Exception{
  MessageDigest d=MessageDigest.getInstance("SHA-256");StringBuilder s=new StringBuilder();
  for(byte b:d.digest(content))s.append(String.format(Locale.US,"%02x",b&255));return s.toString();
 }
 private static class Detector implements AutoCloseable {
  final String name;
  final Interpreter net;
  final int h,w,num;
  final ByteBuffer input;
  final float[][][] boxes;
  final float[][] classes,scores;
  final float[] count=new float[1];
  final Map<Integer,Object> out=new HashMap<>();
  final ArrayList<Long> ms=new ArrayList<>();
  final JSONObject signature=new JSONObject();
  int frameCount=0,classZeroFrames=0,errorCount=0;
  Detector(Context ctx,String filename,String label)throws Exception{
   name=label;byte[] bytes=asset(ctx,filename);
   ByteBuffer bb=ByteBuffer.allocateDirect(bytes.length).order(ByteOrder.nativeOrder());
   bb.put(bytes);bb.rewind();net=new Interpreter(bb,new Interpreter.Options().setNumThreads(2));
   Tensor t=net.getInputTensor(0);int[] dims=t.shape();
   if(t.dataType()!=DataType.UINT8||dims.length!=4||dims[0]!=1||dims[3]!=3||
     dims[1]>512||dims[2]>512)throw new IOException("unexpected_rgb_uint8_input");
   h=dims[1];w=dims[2];input=ByteBuffer.allocateDirect(h*w*3).order(ByteOrder.nativeOrder());
   signature.put("model_sha256",sha(bytes)).put("input_shape",Arrays.toString(dims))
    .put("input_dtype",t.dataType().toString());
   if(net.getOutputTensorCount()!=4)throw new IOException("unexpected_output_count");
   // SSD and TFHub Lite0 expose the same four semantic tensors in
   // different name/order layouts. Resolve by verified tensor names, never
   // assume output index 0 is boxes.
   String base="baseline.tflite".equals(filename)?"TFLite_Detection_PostProcess":"StatefulPartitionedCall";
   String[] roles="baseline.tflite".equals(filename)?
     new String[]{base,base+":1",base+":2",base+":3"}:
     new String[]{base+":3",base+":2",base+":1",base+":0"};
   int[] indices=new int[]{-1,-1,-1,-1};
   for(int i=0;i<4;i++){
    Tensor o=net.getOutputTensor(i);
    if(o.dataType()!=DataType.FLOAT32)throw new IOException("unexpected_output_dtype");
    signature.put("output_"+i,o.name()+" "+Arrays.toString(o.shape()));
    for(int j=0;j<4;j++)if(roles[j].equals(o.name()))indices[j]=i;
   }
   for(int i:indices)if(i<0)throw new IOException("unknown_model_output_semantics");
   int[] shape=net.getOutputTensor(indices[0]).shape();
   if(shape.length!=3||shape[0]!=1||shape[2]!=4||shape[1]>100)
    throw new IOException("unexpected_box_shape");
   num=shape[1];
   if(!Arrays.equals(net.getOutputTensor(indices[1]).shape(),new int[]{1,num})||
      !Arrays.equals(net.getOutputTensor(indices[2]).shape(),new int[]{1,num})||
      !Arrays.equals(net.getOutputTensor(indices[3]).shape(),new int[]{1}))
     throw new IOException("unexpected_detector_layout");
   boxes=new float[1][num][4];classes=new float[1][num];scores=new float[1][num];
   out.put(indices[0],boxes);out.put(indices[1],classes);
   out.put(indices[2],scores);out.put(indices[3],count);
  }
  static final class Observation {
   final JSONObject metrics;final float[][] personBoxes;
   Observation(JSONObject m,float[][] b){metrics=m;personBoxes=b;}
  }
  Observation test(Bitmap bitmap)throws Exception{
   Bitmap scaled=Bitmap.createScaledBitmap(bitmap,w,h,true);
   try{
    int[] p=new int[w*h];scaled.getPixels(p,0,w,0,0,w,h);
    input.rewind();for(int v:p){input.put((byte)(v>>16));input.put((byte)(v>>8));input.put((byte)v);}
    input.rewind();
    long start=SystemClock.elapsedRealtimeNanos();
    net.runForMultipleInputsOutputs(new Object[]{input},out);
    long delay=(SystemClock.elapsedRealtimeNanos()-start)/1000000;
    ms.add(delay);frameCount++;
    int n=Math.min(num,Math.max(0,Math.round(count[0]))),zero=0,other=0;
    double highZero=0;
    ArrayList<float[]> personBoxes=new ArrayList<>();
    for(int i=0;i<n;i++){
     float score=scores[0][i],category=classes[0][i];
     if(Float.isNaN(score)||score<0||score>1.01)throw new IOException("invalid_score");
     if(Math.round(category)==0 && score>=.44f){
      float[] b=boxes[0][i];
      if(b!=null&&b.length==4&&Float.isFinite(b[0])&&Float.isFinite(b[1])&&
         Float.isFinite(b[2])&&Float.isFinite(b[3])){
       float y1=Math.max(0f,b[0]),x1=Math.max(0f,b[1]);
       float y2=Math.min(1f,b[2]),x2=Math.min(1f,b[3]);
       if(y2>y1&&x2>x1)personBoxes.add(new float[]{y1,x1,y2,x2,score});
      }
     }
     if(score<0.5f)continue;
     if(Math.round(category)==0){zero++;highZero=Math.max(highZero,score);}else other++;
    }
    if(zero>0)classZeroFrames++;
    JSONObject metrics=new JSONObject().put("class_index_0_at_50",zero)
      .put("other_class_at_50",other).put("class_index_0_peak",highZero)
      .put("person_boxes_at_44",personBoxes.size()).put("inference_ms",delay);
    return new Observation(metrics,personBoxes.toArray(new float[personBoxes.size()][]));
   }finally{if(scaled!=bitmap)scaled.recycle();}
  }
  JSONObject summary()throws Exception{
   ArrayList<Long> times=new ArrayList<>(ms);Collections.sort(times);
   JSONObject o=new JSONObject().put("model",name).put("frames",frameCount)
      .put("class_index_0_positive_frames",classZeroFrames).put("errors",errorCount)
      .put("tensor_signature",signature);
   if(!times.isEmpty()){
    o.put("p50_ms",times.get(times.size()/2));
    o.put("p90_ms",times.get(Math.max(0,(int)Math.ceil(times.size()*.9)-1)));
   }return o;
  }
  @Override public void close(){try{net.close();}catch(Throwable ignored){}}
 }
 private void benchmark()throws Exception{
  JSONObject initial=safe();
  if(checkSelfPermission("android.permission.READ_EXTERNAL_STORAGE")!=PackageManager.PERMISSION_GRANTED)
   throw new SecurityException("storage_permission_not_granted");
  File[] clips=new File(SD).listFiles(f->f.isFile()&&f.getName().matches("motion_[0-9]{13}\\.mp4")&&f.length()>200000);
  if(clips==null||clips.length==0)throw new IOException("no_readable_4K_clips");
  Arrays.sort(clips,(a,b)->Long.compare(b.lastModified(),a.lastModified()));
  JSONObject report=new JSONObject().put("ok",false).put("method","on_phone_cpu_only")
   .put("camera_changes",0).put("cloud_upload",false).put("ground_truth_available",false)
   .put("temperature_before_c",initial.optDouble("temperature_c"))
   .put("started_ms",System.currentTimeMillis());
  JSONArray frames=new JSONArray(),issues=new JSONArray(),clipSummary=new JSONArray();
  long began=SystemClock.elapsedRealtime();
  int compared=0,disagreements=0,motionFrames=0,baselineEvents=0,contenderEvents=0;
  final String shadowVersion=GardenShadowPipeline.VERSION;
  try(Detector baseline=new Detector(this,"baseline.tflite","production_ssd_cpu");
      Detector contender=new Detector(this,"efficientdet_lite0_int8.tflite","efficientdet_lite0_cpu")){
   for(int file=0;file<Math.min(MAX_FILES,clips.length);file++){
    if(SystemClock.elapsedRealtime()-began>MAX_SESSION_MS){
     issues.put("time_budget_reached");break;
    }
    File clip=clips[file];safe();
    GardenShadowPipeline ssdShadow=new GardenShadowPipeline();
    GardenShadowPipeline liteShadow=new GardenShadowPipeline();
    int paired=0,clipDifferences=0;
    long lastSampleMs=-1;
    MediaMetadataRetriever media=new MediaMetadataRetriever();
    try{
     media.setDataSource(clip.getAbsolutePath());
     long duration=Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
     if(duration<6500||duration>120000){issues.put("duration_out_of_range_"+file);continue;}
     for(int k=0;k<FRAMES;k++){
      if(SystemClock.elapsedRealtime()-began>MAX_SESSION_MS){
       issues.put("time_budget_reached_during_"+file);break;
      }
      safe();
      // Three temporal windows per clip, 5 images 650ms apart.
      int window=k/5,within=k%5;
      double anchor=(window==0?.05:(window==1?.43:.79));
      long atMs=Math.min(duration-250L,(long)(duration*anchor)+within*650L);
      if(atMs<=lastSampleMs)continue;
      lastSampleMs=atMs;
      long at=atMs*1000L;
      Bitmap img=media.getFrameAtTime(at,MediaMetadataRetriever.OPTION_CLOSEST);
      if(img==null){issues.put("frame_unavailable_"+file+"_"+k);continue;}
      try{
       JSONObject row=new JSONObject().put("clip",clip.getName()).put("sample",k)
        .put("clip_offset_ms",atMs).put("window",window).put("frame_source","closest_decoded");
       Bitmap mini=Bitmap.createScaledBitmap(img,240,140,true);
       int[] argb=new int[240*140];mini.getPixels(argb,0,240,0,0,240,140);
       if(mini!=img)mini.recycle();
       float[] luma=GardenShadowPipeline.grid(argb,240,140);
       Detector.Observation a=null,b=null;
       try{a=baseline.test(img);row.put("ssd",a.metrics);}
       catch(Exception e){baseline.errorCount++;row.put("ssd_error",e.toString());}
       try{b=contender.test(img);row.put("efficientdet",b.metrics);}
       catch(Exception e){contender.errorCount++;row.put("efficientdet_error",e.toString());}
       GardenShadowPipeline.Result base=ssdShadow.observe(atMs,luma,a==null?null:a.personBoxes);
       GardenShadowPipeline.Result next=liteShadow.observe(atMs,luma,b==null?null:b.personBoxes);
       row.put("adaptive_motion",base.motion).put("adaptive_motion_strong",base.strongMotion)
        .put("garden_changed_ratio",base.changedRatio)
        .put("garden_coherent_cells",base.largestComponent)
        .put("garden_exposure_shift",base.exposureShift)
        .put("ssd_new_person_events",base.newPersonEvents)
        .put("lite0_new_person_events",next.newPersonEvents)
        .put("ssd_active_person_tracks",base.activeTracks)
        .put("lite0_active_person_tracks",next.activeTracks);
       if(base.motion)motionFrames++;
       if(a!=null&&b!=null){
        paired++;compared++;
        if((base.activeTracks>0)!=(next.activeTracks>0)){
         clipDifferences++;disagreements++;
        }
       }
       frames.put(row);
      }finally{img.recycle();}
      SystemClock.sleep(125);
     }
    }catch(Exception e){issues.put("clip_"+file+":"+e.getClass().getSimpleName());}
    finally{media.release();}
    baselineEvents+=ssdShadow.confirmedEvents;
    contenderEvents+=liteShadow.confirmedEvents;
    clipSummary.put(new JSONObject().put("clip",clip.getName())
     .put("frames_observed",ssdShadow.frames).put("paired_comparisons",paired)
     .put("temporal_disagreement_frames",clipDifferences)
     .put("adaptive_motion_frames",ssdShadow.motionFrames)
     .put("strong_motion_frames",ssdShadow.strongMotionFrames)
     .put("exposure_flash_suppressions",ssdShadow.exposureSuppressions)
     .put("ssd_confirmed_track_events",ssdShadow.confirmedEvents)
     .put("lite0_confirmed_track_events",liteShadow.confirmedEvents)
     .put("ssd_off_garden_rejections",ssdShadow.rejectedOffGarden)
     .put("lite0_off_garden_rejections",liteShadow.rejectedOffGarden));
   }
   report.put("ssd",baseline.summary()).put("efficientdet",contender.summary());
  }
  JSONObject end=status();
  report.put("frames",frames).put("sampled_frames",frames.length()).put("issues",issues)
    .put("clip_summary",clipSummary).put("shadow_engine",shadowVersion)
    .put("shadow_pipeline_active_on_camera",false)
    .put("ground_truth_person_labels",JSONObject.NULL)
    .put("paired_model_frames",compared)
    .put("temporal_model_disagreement_frames",disagreements)
    .put("motion_positive_frames",motionFrames)
    .put("ssd_confirmed_track_events",baselineEvents)
    .put("lite0_confirmed_track_events",contenderEvents)
    .put("temperature_after_c",end.optDouble("temperature_c"))
    .put("camera_mode_after",end.optString("mode"))
    .put("elapsed_ms",System.currentTimeMillis()-report.optLong("started_ms"));
  report.put("ok",compared>0&&"watching".equals(end.optString("mode")));
  save(report);
 }
 private void save(JSONObject result)throws Exception{
  File removable=null;
  File[] volumes=getExternalFilesDirs(null);
  if(volumes!=null)for(File candidate:volumes){
   if(candidate!=null && candidate.getAbsolutePath().startsWith("/storage/9C33-6BBD/")){
    removable=candidate;break;
   }
  }
  if(removable==null)throw new IOException("removable_SD_results_path_unavailable");
  File dir=new File(removable,"bench-results");
  if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("no_SD_result_dir");
  File output=new File(dir,"compare-"+System.currentTimeMillis()+".json");
  try(FileOutputStream stream=new FileOutputStream(output)){
   stream.write(result.toString(2).getBytes("UTF-8"));stream.getFD().sync();
  }
  Log.i(TAG,"RESULT_FILE "+output.getAbsolutePath());
 }
}
