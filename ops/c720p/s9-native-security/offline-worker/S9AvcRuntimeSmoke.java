package nl.kalenel.s9offline;

import android.graphics.ImageFormat;
import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import org.json.JSONObject;

/** Short 360p/480p synthetic hardware AVC encode benchmark.
 * Never reads or writes user videos or creates a retained preview.
 * Exits if the 4K camera starts recording, is unhealthy or exceeds 39C.
 */
public final class S9AvcRuntimeSmoke {
 static final int FPS=8,FRAMES=12;
 private S9AvcRuntimeSmoke(){}
 static boolean captureSafe(){
  HttpURLConnection c=null;
  try {
   c=(HttpURLConnection)new URL("http://127.0.0.1:8808/status").openConnection();
   c.setConnectTimeout(500);c.setReadTimeout(700);
   if(c.getResponseCode()!=200)return false;
   ByteArrayOutputStream bytes=new ByteArrayOutputStream();
   try(InputStream in=c.getInputStream()){
    byte[] buffer=new byte[4096];int n;
    while((n=in.read(buffer))!=-1){
     if(bytes.size()+n>65536)return false;
     bytes.write(buffer,0,n);
    }
   }
   JSONObject d=new JSONObject(bytes.toString("UTF-8"));
   return d.optBoolean("ok",false)&&d.optBoolean("continuous_4k_ready",false)
    &&d.optBoolean("native_4k_enabled",false)
    &&d.optInt("continuous_4k_dropped_output_frames",1)==0
    &&"watching".equals(d.optString("mode"))
    &&d.optDouble("temperature_c",100)<39.0;
  }catch(Exception error){return false;}
  finally{if(c!=null)c.disconnect();}
 }
 static MediaCodec encoder(int w,int h)throws Exception{
  for(MediaCodecInfo info:new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()){
   if(!info.isEncoder()||!info.isHardwareAccelerated())continue;
   for(String mime:info.getSupportedTypes()){
    if(!"video/avc".equalsIgnoreCase(mime))continue;
    MediaCodecInfo.CodecCapabilities caps=info.getCapabilitiesForType(mime);
    if(caps.getVideoCapabilities()==null||
      !caps.getVideoCapabilities().areSizeAndRateSupported(w,h,FPS))continue;
    boolean flexible=false;
    for(int color:caps.colorFormats)
     if(color==MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)flexible=true;
    if(flexible)return MediaCodec.createByCodecName(info.getName());
   }
  }
  throw new IllegalStateException("s9_hardware_flexible_avc_encoder_unavailable");
 }
 static void fill(Image img,int w,int h,int frame)throws Exception{
  if(img==null||img.getFormat()!=ImageFormat.YUV_420_888)
   throw new IllegalStateException("s9_yuv_input_image_unavailable");
  Image.Plane[] planes=img.getPlanes();
  if(planes.length!=3)throw new IllegalStateException("s9_yuv_planes_invalid");
  for(int p=0;p<3;p++){
   Image.Plane plane=planes[p];
   ByteBuffer b=plane.getBuffer();
   int width=p==0?w:w/2,height=p==0?h:h/2;
   for(int y=0;y<height;y++)for(int x=0;x<width;x++){
    int pos=y*plane.getRowStride()+x*plane.getPixelStride();
    if(pos<0||pos>=b.limit())throw new IllegalStateException("s9_yuv_plane_out_of_bounds");
    int value=p==0?16+((x+y+frame*7)%208):128;
    b.put(pos,(byte)value);
   }
  }
 }
 static JSONObject run(int width,int height)throws Exception{
  if(!captureSafe())throw new IllegalStateException("s9_camera_not_idle_cool");
  MediaCodec codec=null;boolean started=false;
  int count=0,outputBytes=0;
  boolean eos=false,formatChanged=false;
  String name="";
  long begin=System.nanoTime();
  try {
   codec=encoder(width,height);
   name=codec.getName();
   MediaFormat fmt=MediaFormat.createVideoFormat("video/avc",width,height);
   fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT,
      MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
   fmt.setInteger(MediaFormat.KEY_BIT_RATE,height==360?600000:1000000);
   fmt.setInteger(MediaFormat.KEY_FRAME_RATE,FPS);
   fmt.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1);
   codec.configure(fmt,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);
   codec.start();started=true;
   MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
   for(int frame=0;frame<FRAMES;frame++){
    if(!captureSafe()||System.nanoTime()-begin>12_000_000_000L)
     throw new IllegalStateException("s9_encode_preempted_for_live_camera");
    int input=codec.dequeueInputBuffer(300000);
    if(input<0)throw new IllegalStateException("s9_input_backpressure");
    Image image=codec.getInputImage(input);
    try{fill(image,width,height,frame);}
    finally{if(image!=null)image.close();}
    ByteBuffer b=codec.getInputBuffer(input);
    if(b==null)throw new IllegalStateException("s9_input_missing");
    codec.queueInputBuffer(input,0,b.capacity(),frame*1000000L/FPS,0);
    for(int attempt=0;attempt<24;attempt++){
     int index=codec.dequeueOutputBuffer(info,10000);
     if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED)formatChanged=true;
     if(index>=0){
      if((info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)==0&&info.size>0){
       outputBytes+=info.size;
       count++;
      }
      codec.releaseOutputBuffer(index,false);
     }
     if(index==MediaCodec.INFO_TRY_AGAIN_LATER)break;
    }
   }
   if(!captureSafe())throw new IllegalStateException("s9_live_capture_priority");
   int idx=codec.dequeueInputBuffer(300000);
   if(idx<0)throw new IllegalStateException("s9_missing_eos_slot");
   codec.queueInputBuffer(idx,0,0,FRAMES*1000000L/FPS,MediaCodec.BUFFER_FLAG_END_OF_STREAM);
   for(int attempt=0;attempt<120&&!eos;attempt++){
    if(!captureSafe())throw new IllegalStateException("s9_live_camera_became_busy");
    int index=codec.dequeueOutputBuffer(info,20000);
    if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED)formatChanged=true;
    if(index>=0){
     if((info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)==0&&info.size>0){
      outputBytes+=info.size;
      count++;
     }
     eos=(info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0;
     codec.releaseOutputBuffer(index,false);
    }
   }
   if(!eos||!formatChanged||count<FRAMES||outputBytes<1500)
    throw new IllegalStateException("s9_incomplete_hardware_avc_output");
   return new JSONObject().put("width",width).put("height",height)
     .put("hardware_encoder",name).put("input_frames",FRAMES)
     .put("encoded_nonconfig_samples",count).put("encoded_bytes",outputBytes)
     .put("output_eos",true).put("output_format_changed",true)
     .put("synthetic_yuv_only",true).put("video_files_read",false)
     .put("video_files_written",false).put("camera_apk_changed",false)
     .put("live_playback_switch",false);
  }finally{
   if(codec!=null){
    if(started)try{codec.stop();}catch(Exception ignored){}
    codec.release();
   }
  }
 }
 public static void main(String[] args){
  try{
   if(args.length!=0)throw new IllegalArgumentException("no_arguments");
   JSONObject result=new JSONObject().put("schema_version","s9_runtime_avc_encode_smoke_v1")
     .put("android_sdk",android.os.Build.VERSION.SDK_INT)
     .put("encode360",run(640,360)).put("encode480",run(848,480))
     .put("read_only_originals",true)
     .put("capture_priority_checked",true)
     .put("concurrent_4k_recording_test_performed",false);
   System.out.println("S9_AVC_RUNTIME_SMOKE "+result.toString());
  }catch(Exception unavailable){
   System.err.println("S9_AVC_RUNTIME_SMOKE_UNAVAILABLE "+
     unavailable.getClass().getSimpleName()+":"+
     String.valueOf(unavailable.getMessage()).replaceAll("[^A-Za-z0-9_-]","_").substring(
        0,Math.min(100,String.valueOf(unavailable.getMessage()).length())));
   System.exit(2);
  }
 }
}
