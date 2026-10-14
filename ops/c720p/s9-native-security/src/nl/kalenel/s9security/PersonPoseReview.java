package nl.kalenel.s9security;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import org.json.JSONObject;
import org.tensorflow.lite.DataType;
import org.tensorflow.lite.Interpreter;
import java.io.*;
import java.nio.*;
import java.security.MessageDigest;
import java.util.*;

/** Offline-only single-person MoveNet Lightning review. Call only from the
 * serialized phone review worker while idle; never from Camera2 callbacks.
 * No GPU delegate, live inference loop, network access, crops or keypoints are
 * persisted by this class. All owned bitmaps/interpreter buffers are released.
 */
final class PersonPoseReview implements AutoCloseable {
 static final String VERSION="s9_movenet_lightning_review_v1";
 static final int SIDE=192,MAX_INFERENCES=64;
 private final Context app;
 private Interpreter net;
 private ByteBuffer model,input;
 private Bitmap square;
 private Canvas canvas;
 private final Paint paint=new Paint(Paint.FILTER_BITMAP_FLAG);
 private final int[] pixels=new int[SIDE*SIDE];
 private final float[][][][] output=new float[1][1][17][3];
 private boolean attempted=false,closed=false;
 private String status="not_loaded",error="",sha="";
 private int inferences=0,rejected=0;
 private long totalInferenceNs=0,maxInferenceNs=0;

 PersonPoseReview(Context app){this.app=app.getApplicationContext();}
 private static String digest(byte[] value)throws Exception{
  StringBuilder hex=new StringBuilder();
  for(byte b:MessageDigest.getInstance("SHA-256").digest(value))hex.append(String.format(Locale.US,"%02x",b&255));
  return hex.toString();
 }
 private void init(){
  if(attempted||closed)return;attempted=true;
  try{
   String expected;
   try(BufferedReader reader=new BufferedReader(new InputStreamReader(app.getAssets().open("person_pose.sha256"),"US-ASCII"))){
    expected=reader.readLine();
    if(expected==null||!expected.trim().matches("[a-f0-9]{64}")||reader.readLine()!=null)
     throw new IOException("pose_checksum_invalid");
    expected=expected.trim();
   }
   ByteArrayOutputStream bytes=new ByteArrayOutputStream();
   try(InputStream source=app.getAssets().open("person_pose.tflite")){
    byte[] chunk=new byte[32768];int n;
    while((n=source.read(chunk))!=-1){
     bytes.write(chunk,0,n);if(bytes.size()>10000000)throw new IOException("pose_model_too_large");
    }
   }
   if(bytes.size()<500000)throw new IOException("pose_model_invalid_size");
   byte[] source=bytes.toByteArray();sha=digest(source);
   if(!sha.equals(expected))throw new IOException("pose_checksum_mismatch");
   model=ByteBuffer.allocateDirect(source.length).order(ByteOrder.nativeOrder());model.put(source);model.rewind();
   net=new Interpreter(model,new Interpreter.Options().setNumThreads(2));
   if(net.getInputTensorCount()!=1||net.getOutputTensorCount()!=1||
      net.getInputTensor(0).dataType()!=DataType.UINT8||net.getOutputTensor(0).dataType()!=DataType.FLOAT32||
      !Arrays.equals(net.getInputTensor(0).shape(),new int[]{1,SIDE,SIDE,3})||
      !Arrays.equals(net.getOutputTensor(0).shape(),new int[]{1,1,17,3}))
    throw new IOException("unsupported_movenet_lightning_uint8_contract");
   input=ByteBuffer.allocateDirect(SIDE*SIDE*3).order(ByteOrder.nativeOrder());
   square=Bitmap.createBitmap(SIDE,SIDE,Bitmap.Config.ARGB_8888);canvas=new Canvas(square);
   status="available";
  }catch(Exception | LinkageError failure){
   error=failure instanceof FileNotFoundException?"pose_model_or_checksum_not_bundled":
    failure instanceof IOException?failure.getMessage():failure.getClass().getSimpleName();
   status="unavailable";release();
  }
 }
 synchronized boolean available(){init();return net!=null&&!closed;}
 synchronized PersonMotionMetrics.Observation infer(Bitmap frame,float[] box,long atMs){
  return infer(frame,box,atMs,"");
 }
 synchronized PersonMotionMetrics.Observation infer(Bitmap frame,float[] box,long atMs,String frameEvidenceFingerprint){
  if(closed)return null;
  init();if(net==null)return null;
  if(inferences>=MAX_INFERENCES){status="inference_budget_exhausted";return null;}
  if(frame==null||frame.isRecycled()||!PersonMotionMetrics.validBox(box)||atMs<0){rejected++;return null;}
  int width=frame.getWidth(),height=frame.getHeight();
  float subjectWidth=(box[3]-box[1])*width,subjectHeight=(box[2]-box[0])*height;
  if(subjectWidth<28||subjectHeight<70){rejected++;return null;}
  // A padded SQUARE crop preserves joints' geometry and boosts small subjects.
  // Areas outside the original frame remain black instead of stretching it.
  float side=Math.max(subjectWidth,subjectHeight)*1.18f;
  float left=(box[1]+box[3])*width*.5f-side*.5f,top=(box[0]+box[2])*height*.5f-side*.5f;
  float scale=SIDE/side;
  try{
   canvas.drawColor(Color.BLACK);
   canvas.drawBitmap(frame,null,new RectF(-left*scale,-top*scale,(width-left)*scale,(height-top)*scale),paint);
   square.getPixels(pixels,0,SIDE,0,0,SIDE,SIDE);input.rewind();
   for(int pixel:pixels){input.put((byte)((pixel>>16)&255));input.put((byte)((pixel>>8)&255));input.put((byte)(pixel&255));}
   input.rewind();long began=System.nanoTime();net.run(input,output);
   long elapsed=System.nanoTime()-began;inferences++;totalInferenceNs+=elapsed;maxInferenceNs=Math.max(maxInferenceNs,elapsed);
   float[][] points=new float[17][3];
   for(int i=0;i<17;i++){
    float y=output[0][0][i][0],x=output[0][0][i][1],confidence=output[0][0][i][2];
    if(!Float.isFinite(y)||!Float.isFinite(x)||!Float.isFinite(confidence)||
       y<0||y>1||x<0||x>1||confidence<0||confidence>1)throw new IOException("invalid_pose_model_output");
    points[i][0]=(top+y*side)/height;points[i][1]=(left+x*side)/width;
    points[i][2]=points[i][0]<0||points[i][0]>1||points[i][1]<0||points[i][1]>1?0:confidence;
   }
   return new PersonMotionMetrics.Observation(atMs,width,height,points,box,false,frameEvidenceFingerprint);
  }catch(Exception | LinkageError failure){
   status="unavailable";error=failure instanceof IOException?failure.getMessage():failure.getClass().getSimpleName();
   release();return null;
  }
 }
 synchronized JSONObject statusJson()throws Exception{
  JSONObject json=new JSONObject();json.put("version",VERSION);json.put("status",status);
  json.put("available",net!=null&&!closed);json.put("error",error);json.put("model_sha256",sha);
  json.put("backend","cpu_2_threads");json.put("inferences",inferences);json.put("rejected_inputs",rejected);
  json.put("inference_limit",MAX_INFERENCES);json.put("mean_inference_ms",inferences==0?0:totalInferenceNs/1e6/inferences);
  json.put("max_inference_ms",maxInferenceNs/1e6);json.put("scope","projected_measurements_only");
  return json;
 }
 static JSONObject metricsJson(PersonMotionMetrics.Snapshot summary)throws Exception{
  JSONObject json=new JSONObject();json.put("version",PersonMotionMetrics.VERSION);json.put("scope","this_recording_only");
  json.put("identity_eligible",false);json.put("measurement_space","camera_image_projection_not_world_measurements");
  json.put("posture_availability",summary.postureAvailability);json.put("gait_availability",summary.gaitAvailability);
  json.put("posture",summary.posture);json.put("projected_direction",summary.projectedDirection);
  json.put("samples",summary.samples);json.put("torso_samples",summary.torsoSamples);json.put("full_body_samples",summary.fullBodySamples);
  json.put("dense_samples",summary.denseSamples);json.put("dense_span_ms",summary.denseSpanMs);
  json.put("first_ms",summary.firstMs);json.put("last_ms",summary.lastMs);json.put("mean_confidence",summary.meanConfidence);
  putFinite(json,"torso_lean_degrees",summary.torsoLeanDegrees);putFinite(json,"knee_bend_degrees",summary.kneeBendDegrees);
  putFinite(json,"shoulder_hip_projected_ratio",summary.shoulderHipRatio);
  putFinite(json,"apparent_speed_body_heights_per_second",summary.apparentSpeedBodyHeightsPerSecond);
  putFinite(json,"cadence_steps_per_minute",summary.cadenceStepsPerMinute);
  putFinite(json,"ankle_swing_body_heights",summary.ankleSwingBodyHeights);
  putFinite(json,"walking_periodicity",summary.periodicity);putFinite(json,"arm_swing_body_heights",summary.armSwingBodyHeights);
  return json;
 }
 private static void putFinite(JSONObject json,String key,double value)throws Exception{json.put(key,Double.isFinite(value)?value:JSONObject.NULL);}
 private void release(){
  if(net!=null){try{net.close();}catch(Exception ignored){}net=null;}
  if(square!=null&&!square.isRecycled())square.recycle();square=null;canvas=null;model=null;input=null;
 }
 @Override public synchronized void close(){if(closed)return;closed=true;release();status="closed";}
}
