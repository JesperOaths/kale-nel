package nl.kalenel.s9person;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.os.*;
import android.util.Log;
import org.tensorflow.lite.Interpreter;
import org.tensorflow.lite.gpu.GpuDelegate;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.*;
import java.net.*;
import java.nio.*;
import java.util.*;

public final class PersonService extends Service {
 private static final String TAG="S9PERSON";
 private volatile boolean running=false,ready=false,mlReady=false,personConfirmed=false;
 private volatile long frames=0,modelRuns=0,snapshotErrors=0,modelErrors=0,events=0;
 private volatile long latestFrame=0,lastInferenceMs=0,lastPersonMs=0,startedMs=0,lastEventMs=0;
 private volatile double lastEventConfidence=0;
 private volatile double inferenceLatencyMs=0,personScore=0,topScore=0;
 private volatile int rawTopClass=-1,rawPersonClass=-1,personStreak=0,tempDeciC=0;
 private volatile String backend="none",failure="",modelName="ssd-mobilenet-v1-coco-quant";
 private volatile int personBoxTop=0,personBoxLeft=0,personBoxRight=0,personBoxBottom=0;
 private Thread worker,api;
 private ServerSocket socket;
 private Interpreter interpreter;
 private GpuDelegate gpu;
 private ByteBuffer modelInput;
 private final float[][][] boxes=new float[1][10][4];
 private final float[][] classes=new float[1][10],scores=new float[1][10];
 private final float[] detections=new float[1];
 private long lastLogAt=0;
 private volatile String validationRequested="",validationStatus="idle",validationLast="";
 private volatile double validationPersonScore=0,validationTopScore=0;
 private volatile int validationTopClass=-1,validationCount=0;

 @Override public IBinder onBind(Intent i){return null;}
 @Override public int onStartCommand(Intent i,int flags,int id){return START_STICKY;}
 @Override public void onCreate(){
  super.onCreate();
  startedMs=SystemClock.elapsedRealtime();running=true;
  if(Build.VERSION.SDK_INT>=26){
   NotificationChannel c=new NotificationChannel("ml","S9+ person classification",NotificationManager.IMPORTANCE_LOW);
   ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(c);
  }
  Notification n=Build.VERSION.SDK_INT>=26
   ?new Notification.Builder(this,"ml").setContentTitle("S9+ person recognition").setContentText("Phone-only neural inference").setSmallIcon(android.R.drawable.ic_menu_camera).build()
   :new Notification.Builder(this).setContentTitle("S9+ person recognition").setContentText("Local neural detection").setSmallIcon(android.R.drawable.ic_menu_camera).build();
  startForeground(1080,n);
  worker=new Thread(new Runnable(){public void run(){runModels();}},"s9-person-inference");
  api=new Thread(new Runnable(){public void run(){serve();}},"s9-person-status");
  worker.start();api.start();
 }
 @Override public void onDestroy(){
  running=false;
  try{if(socket!=null)socket.close();}catch(Exception ignored){}
  if(worker!=null)worker.interrupt();
  if(api!=null)api.interrupt();
  super.onDestroy();
 }
 private ByteBuffer loadModel() throws Exception{
  try(InputStream in=getAssets().open("detect.tflite")){
   ByteArrayOutputStream out=new ByteArrayOutputStream();
   byte[] b=new byte[32768];int n;
   while((n=in.read(b))!=-1){
    out.write(b,0,n);
    if(out.size()>10000000)throw new IOException("model_too_large");
   }
   byte[] bytes=out.toByteArray();
   ByteBuffer direct=ByteBuffer.allocateDirect(bytes.length).order(ByteOrder.nativeOrder());
   direct.put(bytes);direct.rewind();
   return direct;
  }
 }
 private void initModel() throws Exception{
  ByteBuffer model=loadModel();
  StringBuilder reasons=new StringBuilder();
  // Quantized MobileNet can outperform CPU on some Mali devices, but not all.
  // Delegate fallback is mandatory; never take down the camera when it fails.
  try{
   gpu=new GpuDelegate();
   Interpreter.Options opts=new Interpreter.Options();
   opts.addDelegate(gpu).setNumThreads(2);
   interpreter=new Interpreter(model,opts);
   backend="gpu";
  }catch(Throwable e){
   reasons.append("gpu:").append(e.getClass().getSimpleName()).append(";");
   if(interpreter!=null){try{interpreter.close();}catch(Throwable ignored){} interpreter=null;}
   if(gpu!=null){try{gpu.close();}catch(Throwable ignored){}gpu=null;}
  }
  if(interpreter==null){
   try{
    Interpreter.Options opts=new Interpreter.Options().setNumThreads(2).setUseNNAPI(true);
    interpreter=new Interpreter(model,opts);
    backend="nnapi";
   }catch(Throwable e){
    reasons.append("nnapi:").append(e.getClass().getSimpleName()).append(";");
    if(interpreter!=null){try{interpreter.close();}catch(Throwable ignored){}interpreter=null;}
   }
  }
  if(interpreter==null){
   interpreter=new Interpreter(model,new Interpreter.Options().setNumThreads(2));
   backend="cpu";
  }
  Log.i(TAG,"ML_INIT backend="+backend+" reasons="+reasons.toString()
   +" input="+Arrays.toString(interpreter.getInputTensor(0).shape())
   +" dtype="+interpreter.getInputTensor(0).dataType().name()
   +" output0="+Arrays.toString(interpreter.getOutputTensor(0).shape())
   +" output1="+Arrays.toString(interpreter.getOutputTensor(1).shape()));
  int[] shape=interpreter.getInputTensor(0).shape();
  if(shape.length!=4||shape[0]!=1||shape[3]!=3||shape[1]!=300||shape[2]!=300)
    throw new IllegalArgumentException("unexpected_model_input");
  if(!"UINT8".equals(interpreter.getInputTensor(0).dataType().name()))
    throw new IllegalArgumentException("expected_uint8_model");
  modelInput=ByteBuffer.allocateDirect(300*300*3).order(ByteOrder.nativeOrder());
  mlReady=true;
 }
 private void analyze(Bitmap original,boolean publish) throws Exception{
  Bitmap b=Bitmap.createScaledBitmap(original,300,300,true);
  int[] pixels=new int[300*300]; b.getPixels(pixels,0,300,0,0,300,300);
  if(b!=original)b.recycle();
  modelInput.rewind();
  for(int c:pixels){modelInput.put((byte)((c>>16)&255));modelInput.put((byte)((c>>8)&255));modelInput.put((byte)(c&255));}
  modelInput.rewind();
  Map<Integer,Object> outputs=new HashMap<Integer,Object>();
  outputs.put(0,boxes);outputs.put(1,classes);
  outputs.put(2,scores);outputs.put(3,detections);
  long a=SystemClock.elapsedRealtimeNanos();
  interpreter.runForMultipleInputsOutputs(new Object[]{modelInput},outputs);
  inferenceLatencyMs=(SystemClock.elapsedRealtimeNanos()-a)/1000000.0;
  modelRuns++;
  float bestPerson=0f;
  int bestId=-1,bestOverallId=-1;float bestOverall=-1;
  int count=Math.min(10,Math.max(0,Math.round(detections[0])));
  for(int i=0;i<count;i++){
   if(scores[0][i]>bestOverall){bestOverall=scores[0][i];bestOverallId=Math.round(classes[0][i]);}
   // SSD mobileNet v1 COCO output class 0 maps to first trained class, person;
   // labelmap.txt index 0 is "???" and index 1 is "person" (offset +1).
   int category=Math.round(classes[0][i]);
   if(category==0&&scores[0][i]>bestPerson){bestPerson=scores[0][i];bestId=i;}
  }
  if(!publish){
   validationPersonScore=bestPerson;
   validationTopScore=bestOverall;
   validationTopClass=bestOverallId;
   validationCount++;
   validationStatus="ok";
   return;
  }
  rawTopClass=bestOverallId;
  topScore=bestOverall;rawPersonClass=bestId>=0?0:-1;
  personScore=bestPerson;
  long now=SystemClock.elapsedRealtime();
  if(bestPerson>=0.60f){
   personStreak=Math.min(6,personStreak+1);
   lastPersonMs=now;
   if(bestId>=0){
    personBoxTop=Math.round(boxes[0][bestId][0]*1000);
    personBoxLeft=Math.round(boxes[0][bestId][1]*1000);
    personBoxBottom=Math.round(boxes[0][bestId][2]*1000);
    personBoxRight=Math.round(boxes[0][bestId][3]*1000);
   }
  }else personStreak=Math.max(0,personStreak-1);
  if(personStreak>=2&&!personConfirmed){
   events++;
   lastEventMs=now;
   lastEventConfidence=bestPerson;
   if(now-lastLogAt>10000){
    Log.i(TAG,"PERSON_EVENT seq="+events+" confidence="+bestPerson+" backend="+backend+" latency_ms="+inferenceLatencyMs);
    lastLogAt=now;
   }
  }
  personConfirmed=personStreak>=2;
  if(personConfirmed&&now-lastPersonMs>8000)personConfirmed=false;
  lastInferenceMs=now;
 }

 private void runValidationIfRequested(){
  String name=validationRequested;
  if(name==null||name.isEmpty())return;
  validationRequested="";
  validationStatus="loading";
  try{
   File dir=new File(getExternalFilesDir(null),"validation");
   File image=new File(dir,name);
   if(!image.getCanonicalPath().startsWith(dir.getCanonicalPath()+File.separator))
    throw new IOException("validation_path_invalid");
   if(!image.isFile()||image.length()>9000000L)
    throw new IOException("validation_image_missing_or_large");
   Bitmap test=BitmapFactory.decodeFile(image.getAbsolutePath());
   if(test==null)throw new IOException("validation_image_decode_failed");
   try{analyze(test,false);}
   finally{test.recycle();}
   validationLast=name;
   Log.i(TAG,"VALIDATION name="+name+" score="+validationPersonScore+
    " top_class="+validationTopClass+" top_score="+validationTopScore);
  }catch(Exception e){
   validationStatus=e.getClass().getSimpleName()+":"+e.getMessage();
   Log.w(TAG,"validation",e);
  }
 }

 private int temperature(){
  Intent i=registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
  return i==null?0:i.getIntExtra("temperature",0);
 }
 private void runModels(){
  try{
   initModel();
   while(running){
    long start=SystemClock.elapsedRealtime();
    tempDeciC=temperature();
    if(tempDeciC>=415){
     personStreak=0;personConfirmed=false;failure="thermal_pause";
     Thread.sleep(5000);continue;
    }
    try{
     HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:8080/shot.jpg").openConnection();
     c.setConnectTimeout(1600);c.setReadTimeout(2300);
     BitmapFactory.Options options=new BitmapFactory.Options();
     options.inSampleSize=4;options.inPreferredConfig=Bitmap.Config.RGB_565;
     Bitmap b;
     try(InputStream in=c.getInputStream()){b=BitmapFactory.decodeStream(in,null,options);}
     finally{c.disconnect();}
     if(b==null)throw new IOException("snapshot_empty");
     frames++;latestFrame=SystemClock.elapsedRealtime();
     analyze(b,true);b.recycle();
     runValidationIfRequested();
     failure="";
    }catch(Throwable err){
     snapshotErrors++;personStreak=0;personConfirmed=false;
     failure=err.getClass().getSimpleName()+":"+err.getMessage();
     Log.w(TAG,"ML_CYCLE_FAIL "+failure);
     if(snapshotErrors>=12&&modelRuns==0)throw new IOException("repeated_initial_failure",err);
    }
    long elapsed=SystemClock.elapsedRealtime()-start;
    long sleep=tempDeciC>=385?Math.max(1500,2500-elapsed):Math.max(200,850-elapsed);
    Thread.sleep(sleep);
   }
  }catch(Throwable e){
   modelErrors++;mlReady=false;
   failure=e.getClass().getSimpleName()+":"+e.getMessage();
   Log.e(TAG,"ML_FATAL "+failure,e);
  }finally{
   if(interpreter!=null){try{interpreter.close();}catch(Throwable ignored){}interpreter=null;}
   if(gpu!=null){try{gpu.close();}catch(Throwable ignored){}gpu=null;}
  }
 }
 private JSONObject state(){
  JSONObject j=new JSONObject();
  try{
   long now=SystemClock.elapsedRealtime();
   j.put("ok",mlReady&&latestFrame>0&&now-latestFrame<7000);
   j.put("model_ready",mlReady);j.put("backend",backend);j.put("model",modelName);
   j.put("frames",frames);j.put("inferences",modelRuns);
   j.put("snapshot_errors",snapshotErrors);j.put("model_errors",modelErrors);
   j.put("inference_ms",Math.round(inferenceLatencyMs*10.0)/10.0);
   j.put("frame_age_ms",latestFrame==0?-1:now-latestFrame);
   j.put("person_confidence",Math.round(personScore*1000.0)/1000.0);
   j.put("person_confirmed",personConfirmed);
   j.put("person_streak",personStreak);
   j.put("person_events",events);
   j.put("person_event_age_ms",lastEventMs==0?-1:now-lastEventMs);
   j.put("person_event_confidence",Math.round(lastEventConfidence*1000.0)/1000.0);
   j.put("person_recent_age_ms",lastPersonMs==0?-1:now-lastPersonMs);
   JSONArray area=new JSONArray();area.put(personBoxTop);area.put(personBoxLeft);area.put(personBoxBottom);area.put(personBoxRight);
   j.put("person_box_milli",area);
   j.put("top_detection_class",rawTopClass);j.put("top_detection_confidence",Math.round(topScore*1000.0)/1000.0);
   j.put("person_class_index",0);
   j.put("temperature_c",tempDeciC/10.0);
   j.put("validation_status",validationStatus);
   j.put("validation_name",validationLast);
   j.put("validation_person_score",Math.round(validationPersonScore*1000.0)/1000.0);
   j.put("validation_top_class",validationTopClass);
   j.put("validation_top_score",Math.round(validationTopScore*1000.0)/1000.0);
   j.put("validation_count",validationCount);
   j.put("captures_triggered",false);
   j.put("recording_integrated",false);
   j.put("error",failure);
  }catch(Exception ignored){}
  return j;
 }
 private void serve(){
  try{
   socket=new ServerSocket();socket.setReuseAddress(true);
   socket.bind(new InetSocketAddress("127.0.0.1",8799));socket.setSoTimeout(1500);
   while(running){
    Socket client=null;
    try{
     client=socket.accept();client.setSoTimeout(1500);
     BufferedReader r=new BufferedReader(new InputStreamReader(client.getInputStream(),"UTF-8"));
     String first=r.readLine();
     if(first!=null&&first.startsWith("GET /")){
      if(first.startsWith("GET /validate?name=")){
       int end=first.indexOf(" HTTP/");
       String requested=end>0?first.substring("GET /validate?name=".length(),end):"";
       if(requested.matches("(person|negative)[0-9]{1,2}\\.jpg")){
        validationStatus="queued";
        validationRequested=requested;
       }else validationStatus="invalid_validation_name";
      }
      byte[] body=state().toString().getBytes("UTF-8");
      OutputStream out=client.getOutputStream();
      out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
      out.write(body);out.flush();
     }
    }catch(SocketTimeoutException ignored){}
     catch(Exception e){Log.w(TAG,"status",e);}
    finally{try{if(client!=null)client.close();}catch(Exception ignored){}}
   }
  }catch(Exception e){failure="api:"+e.getClass().getSimpleName();}
 }
}
