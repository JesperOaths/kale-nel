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
 private static final int MAX_FILES=8, FRAMES=3, MAX_TEMP=37;
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
   int[] shape=net.getOutputTensor(0).shape();
   if(shape.length!=3||shape[0]!=1||shape[2]!=4||shape[1]>100)
    throw new IOException("unexpected_box_shape");
   num=shape[1];
   if(!Arrays.equals(net.getOutputTensor(1).shape(),new int[]{1,num})||
      !Arrays.equals(net.getOutputTensor(2).shape(),new int[]{1,num})||
      !Arrays.equals(net.getOutputTensor(3).shape(),new int[]{1}))
     throw new IOException("unexpected_detector_layout");
   for(int i=0;i<4;i++){
    Tensor o=net.getOutputTensor(i);
    if(o.dataType()!=DataType.FLOAT32)throw new IOException("unexpected_output_dtype");
    signature.put("output_"+i,o.name()+" "+Arrays.toString(o.shape()));
   }
   boxes=new float[1][num][4];classes=new float[1][num];scores=new float[1][num];
   out.put(0,boxes);out.put(1,classes);out.put(2,scores);out.put(3,count);
  }
  JSONObject test(Bitmap bitmap)throws Exception{
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
    for(int i=0;i<n;i++){
     float score=scores[0][i],category=classes[0][i];
     if(Float.isNaN(score)||score<0||score>1.01)throw new IOException("invalid_score");
     if(score<0.5)continue;
     if(Math.round(category)==0){zero++;highZero=Math.max(highZero,score);}else other++;
    }
    if(zero>0)classZeroFrames++;
    return new JSONObject().put("class_index_0_at_50",zero)
      .put("other_class_at_50",other).put("class_index_0_peak",highZero)
      .put("inference_ms",delay);
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
  JSONArray frames=new JSONArray(),issues=new JSONArray();
  try(Detector baseline=new Detector(this,"baseline.tflite","production_ssd_cpu");
      Detector contender=new Detector(this,"efficientdet_lite0_int8.tflite","efficientdet_lite0_cpu")){
   for(int file=0;file<Math.min(MAX_FILES,clips.length);file++){
    File clip=clips[file];safe();
    MediaMetadataRetriever media=new MediaMetadataRetriever();
    try{
     media.setDataSource(clip.getAbsolutePath());
     long duration=Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
     if(duration<1500||duration>90000)continue;
     for(int k=0;k<FRAMES;k++){
      safe();
      long at=(long)((k+0.5)/FRAMES*duration*1000.0);
      Bitmap img=media.getFrameAtTime(at,MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
      if(img==null){issues.put("frame_unavailable_"+file+"_"+k);continue;}
      try{
       JSONObject row=new JSONObject().put("clip",clip.getName()).put("sample",k);
       try{row.put("ssd",baseline.test(img));}catch(Exception e){baseline.errorCount++;row.put("ssd_error",e.toString());}
       try{row.put("efficientdet",contender.test(img));}catch(Exception e){contender.errorCount++;row.put("efficientdet_error",e.toString());}
       frames.put(row);
      }finally{img.recycle();}
      SystemClock.sleep(125);
     }
    }catch(Exception e){issues.put("clip_"+file+":"+e.getClass().getSimpleName());}
    finally{media.release();}
   }
   report.put("ssd",baseline.summary()).put("efficientdet",contender.summary());
  }
  JSONObject end=status();
  report.put("frames",frames).put("sampled_frames",frames.length()).put("issues",issues)
    .put("temperature_after_c",end.optDouble("temperature_c"))
    .put("camera_mode_after",end.optString("mode"))
    .put("elapsed_ms",System.currentTimeMillis()-report.optLong("started_ms"));
  report.put("ok",frames.length()>0&&"watching".equals(end.optString("mode")));
  save(report);
 }
 private void save(JSONObject result)throws Exception{
  File dir=new File(getExternalFilesDir(null),"bench-results");
  if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("no_result_dir");
  File output=new File(dir,"compare-"+System.currentTimeMillis()+".json");
  try(FileOutputStream stream=new FileOutputStream(output)){
   stream.write(result.toString(2).getBytes("UTF-8"));stream.getFD().sync();
  }
  Log.i(TAG,"RESULT_FILE "+output.getAbsolutePath());
 }
}
