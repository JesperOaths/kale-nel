package nl.kalenel.s9security;

import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.os.SystemClock;
import android.util.Log;
import org.json.*;
import org.tensorflow.lite.Interpreter;
import org.tensorflow.lite.gpu.GpuDelegate;
import java.io.*;
import java.nio.*;
import java.util.*;
import java.security.MessageDigest;

/** Offline after-motion clip classification. No cloud or biometric face recognition. */
public final class ClipClassifier {
 private final Context app;
 private Interpreter net;
 private GpuDelegate delegate;
 private ByteBuffer input;
 private String backend="uninitialized";
 private final float[][][] boxes=new float[1][10][4];
 private final float[][] classes=new float[1][10],scores=new float[1][10];
 private final float[] count=new float[1];
 private final ArrayList<String> labels=new ArrayList<>();
 private final Map<Integer,Object> outputs=new HashMap<>();
 ClipClassifier(Context c){app=c; }
 private void init()throws Exception{
  if(net!=null)return;
  try(InputStream in=app.getAssets().open("labelmap.txt");BufferedReader br=new BufferedReader(new InputStreamReader(in))){
   String l;while((l=br.readLine())!=null)labels.add(l.trim().toLowerCase(Locale.US));
  }
  ByteArrayOutputStream bytes=new ByteArrayOutputStream();
  try(InputStream in=app.getAssets().open("detect.tflite")){
   byte[] b=new byte[32768];int n;while((n=in.read(b))>0){
    bytes.write(b,0,n);
    if(bytes.size()>10000000)throw new IOException("ML_asset_too_large");
   }
  }
  ByteBuffer model=ByteBuffer.allocateDirect(bytes.size()).order(ByteOrder.nativeOrder());
  model.put(bytes.toByteArray());model.rewind();
  try{
   delegate=new GpuDelegate();
   net=new Interpreter(model,new Interpreter.Options().addDelegate(delegate).setNumThreads(2));
   backend="gpu";
  }catch(Throwable gpuFailure){
   if(delegate!=null){try{delegate.close();}catch(Throwable ignored){}delegate=null;}
   net=null;
   net=new Interpreter(model,new Interpreter.Options().setNumThreads(2));
   backend="cpu";
   Log.w("S9SEC","gpu_fallback_"+gpuFailure.getClass().getSimpleName());
  }
  input=ByteBuffer.allocateDirect(300*300*3).order(ByteOrder.nativeOrder());
  outputs.put(0,boxes);outputs.put(1,classes);outputs.put(2,scores);outputs.put(3,count);
 }
 private String label(int category){
  int id=category+1; // COCO quant detector labels use a placeholder at index zero.
  return id>=0&&id<labels.size()?labels.get(id):"unknown";
 }
 private static final class Detection {
  String label;float score;float[] box;
 }
 private List<Detection> detect(Bitmap original)throws Exception{
  Bitmap scaled=Bitmap.createScaledBitmap(original,300,300,true);
  try{
   int[] pixels=new int[300*300];scaled.getPixels(pixels,0,300,0,0,300,300);
   input.rewind();
   for(int rgb:pixels){
    input.put((byte)((rgb>>16)&255));
    input.put((byte)((rgb>>8)&255));
    input.put((byte)(rgb&255));
   }
   input.rewind();
   net.runForMultipleInputsOutputs(new Object[]{input},outputs);
   ArrayList<Detection> found=new ArrayList<>();
   int total=Math.min(10,Math.max(0,Math.round(count[0])));
   for(int i=0;i<total;i++){
    float confidence=scores[0][i];if(confidence<0.50f)continue;
    Detection d=new Detection();
    d.label=label(Math.round(classes[0][i]));
    d.score=confidence;d.box=boxes[0][i].clone();
    found.add(d);
   }
   return found;
  }finally{if(scaled!=original)scaled.recycle();}
 }
 public synchronized JSONObject process(File mp4, File folder, String name, String trigger, long motionEvents)throws Exception{
  long begin=SystemClock.elapsedRealtime();
  JSONObject result=new JSONObject();
  result.put("name",name).put("bytes",mp4.length()).put("sha256",digest(mp4));
  result.put("archive","S9_microSD_only").put("review_version","ssd_mobilenet_coco_v1_post4k_v1");
  result.put("motion_trigger",trigger).put("motion_events",motionEvents);
  result.put("auto_identity_status","appearance_based_identity_not_verified");
  MediaMetadataRetriever media=new MediaMetadataRetriever();
  int persons=0,animals=0,vehicles=0;
  double maxPerson=0,maxAnimal=0,maxVehicle=0;
  Bitmap best=null;double bestScore=-1;
  long duration=0;
  try{
   media.setDataSource(mp4.getAbsolutePath());
   duration=Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
   result.put("duration_ms",duration);
   result.put("width",Integer.parseInt(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)));
   result.put("height",Integer.parseInt(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)));
   init();
   int frames=(int)Math.max(2,Math.min(6,duration/2400L));
   for(int n=0;n<frames;n++){
    long micros=(long)(((n+0.5)/(double)frames)*duration*1000);
    Bitmap bitmap=media.getFrameAtTime(micros,MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
    if(bitmap==null)continue;
    try{
     List<Detection> found=detect(bitmap);
     int p=0,a=0,v=0;double confidence=0;
     for(Detection d:found){
      if("person".equals(d.label)){p++;maxPerson=Math.max(maxPerson,d.score);confidence=Math.max(confidence,d.score);}
      else if("cat".equals(d.label)||"dog".equals(d.label)||"bird".equals(d.label)||"horse".equals(d.label)
          ||"sheep".equals(d.label)||"cow".equals(d.label)){a++;maxAnimal=Math.max(maxAnimal,d.score);}
      else if("car".equals(d.label)||"truck".equals(d.label)||"bus".equals(d.label)||"motorcycle".equals(d.label)
          ||"bicycle".equals(d.label)){v++;maxVehicle=Math.max(maxVehicle,d.score);}
     }
     persons=Math.max(persons,p);animals=Math.max(animals,a);vehicles=Math.max(vehicles,v);
     double quality=confidence*2.0+0.05*(p+a+v);
     if(quality>bestScore){
      if(best!=null)best.recycle();
      best=Bitmap.createScaledBitmap(bitmap,1200,Math.max(2,(int)(bitmap.getHeight()*1200.0/bitmap.getWidth())),true);
      bestScore=quality;
     }
    }finally{bitmap.recycle();}
   }
   JSONArray categories=new JSONArray();
   String scene="motion_other";
   if(persons>0){scene=persons>=2?"multiple_people":"one_person";categories.put("person");}
   if(vehicles>0)categories.put("vehicle");
   if(animals>0)categories.put("animal");
   if(categories.length()==0)categories.put("other_motion");
   result.put("scene_category",scene);
   result.put("content_group",scene);
   result.put("categories",categories);
   result.put("person_count",persons);
   result.put("ai_person_count_at_trigger",persons);
   result.put("vehicle_count",vehicles);
   result.put("animal_count",animals);
   result.put("person_confidence",Math.round(maxPerson*1000)/1000.0);
   result.put("animal_confidence",Math.round(maxAnimal*1000)/1000.0);
   result.put("vehicle_confidence",Math.round(maxVehicle*1000)/1000.0);
   result.put("backend",backend);
   result.put("processing_elapsed_ms",SystemClock.elapsedRealtime()-begin);
   if(best!=null){
    File thumb=new File(folder,name+".thumb.jpg");
    File temp=new File(folder,name+".thumb.partial");
    try(FileOutputStream o=new FileOutputStream(temp)){
     best.compress(Bitmap.CompressFormat.JPEG,90,o);
     o.getFD().sync();
    }
    if(!temp.renameTo(thumb))throw new IOException("thumbnail_rename_failed");
    result.put("thumbnail",thumb.getName());
   }
  }finally{
   if(best!=null)best.recycle();
   try{media.release();}catch(Exception ignored){}
  }
  writeJson(new File(folder,name+".verified.json"),result);
  return result;
 }
 private static String digest(File file)throws Exception{
  MessageDigest md=MessageDigest.getInstance("SHA-256");
  try(FileInputStream in=new FileInputStream(file)){
   byte[] bytes=new byte[131072];int n;
   while((n=in.read(bytes))>0)md.update(bytes,0,n);
  }
  StringBuilder result=new StringBuilder();
  for(byte n:md.digest())result.append(String.format(Locale.US,"%02x",n&255));
  return result.toString();
 }
 static void writeJson(File f,JSONObject j)throws Exception{
  File t=new File(f.getParentFile(),f.getName()+".tmp");
  try(FileOutputStream o=new FileOutputStream(t)){
   o.write(j.toString(2).getBytes("UTF-8"));
   o.getFD().sync();
  }
  if(!t.renameTo(f))throw new IOException("manifest_rename_failed");
 }
 public synchronized void close(){
  if(net!=null){try{net.close();}catch(Throwable ignored){}net=null;}
  if(delegate!=null){try{delegate.close();}catch(Throwable ignored){}delegate=null;}
 }
}
