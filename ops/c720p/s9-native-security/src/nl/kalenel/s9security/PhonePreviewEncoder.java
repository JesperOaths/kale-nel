package nl.kalenel.s9security;

import android.graphics.Bitmap;
import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * Optional low-fps H264 playback derivative using the phone's hardware AVC
 * encoder. Decoding uses the Android media stack; CPU resizes tiny bitmaps.
 * NEVER modifies any 4K original, verified sidecar, review or retention state.
 *
 * Deliberately not wired to the camera/watchdog until physical benchmarks pass.
 * Return path is an isolated, self-described derivative, NOT identity evidence.
 */
final class PhonePreviewEncoder {
 static final String VERSION="s9_native_low_duty_preview_v1";
 private static final Pattern VIDEO=Pattern.compile("motion_[0-9]{13}[.]mp4");
 private static final AtomicBoolean BUSY=new AtomicBoolean(false);
 private static final long MAX_SOURCE=800000000L,MAX_DERIVATIVE=80L*1024*1024;
 private static final long MIN_AVAILABLE=20L*1024*1024*1024;
 private static final int FPS=8;
 interface Gate {boolean canContinue();}
 private PhonePreviewEncoder(){}

 static JSONObject build(File archive,String name,int vertical,Gate gate)throws Exception {
  if(!VIDEO.matcher(name).matches()||(vertical!=360&&vertical!=480)||
     archive==null||gate==null||!gate.canContinue())
   throw new IllegalArgumentException("unsupported_or_busy_preview_request");
  if(!BUSY.compareAndSet(false,true))throw new IOException("preview_encoder_busy");
  File temporary=null;
  try{
   File home=archive.getCanonicalFile();
   File original=new File(home,name),sidecar=new File(home,name+".verified.json");
   if(!original.isFile()||!sidecar.isFile()||
      Files.isSymbolicLink(original.toPath())||Files.isSymbolicLink(sidecar.toPath())||
      !original.getCanonicalFile().getParentFile().equals(home)||
      !sidecar.getCanonicalFile().getParentFile().equals(home))
    throw new IOException("unverified_or_noncanonical_original");
   if(original.length()<=100000||original.length()>=MAX_SOURCE||
      home.getUsableSpace()<MIN_AVAILABLE)throw new IOException("source_or_sd_space_guard");
   if(sidecar.length()<2||sidecar.length()>32768)throw new IOException("invalid_source_sidecar_size");
   ByteArrayOutputStream metaData=new ByteArrayOutputStream();
   try(InputStream in=new FileInputStream(sidecar)){
    byte[] buf=new byte[4096];int n;
    while((n=in.read(buf))>0){
     if(metaData.size()+n>32768)throw new IOException("sidecar_growth");
     metaData.write(buf,0,n);
    }
   }
   JSONObject side=new JSONObject(new String(metaData.toByteArray(),"UTF-8"));
   String originalSha=side.optString("sha256","");
   if(!name.equals(side.optString("name"))||side.optLong("bytes",-1)!=original.length()||
      side.optInt("width")!=3840||side.optInt("height")!=2160||
      !originalSha.matches("[a-f0-9]{64}"))throw new IOException("untrusted_4k_manifest");
   File copies=new File(home,"PlaybackCopies");
   if((!copies.isDirectory()&&!copies.mkdir())||Files.isSymbolicLink(copies.toPath())||
      !copies.getCanonicalFile().getParentFile().equals(home))
    throw new IOException("preview_cache_path");
   int width=vertical==360?640:848;
   String basename=name+"."+vertical+"p.mp4";
   File target=new File(copies,basename).getCanonicalFile();
   if(!target.getParentFile().equals(copies.getCanonicalFile()))
    throw new IOException("preview_output_path");
   File verified=new File(copies,basename+".verified.json");
   if(target.exists()||verified.exists())throw new IOException("preview_output_already_exists");
   reapExpired(copies,gate);
   if(cacheBytes(copies)+MAX_DERIVATIVE>300L*1024*1024)
    throw new IOException("preview_cache_budget_exceeded");
   temporary=File.createTempFile(".preview-",".mp4.tmp",copies);
   int frames=encode(original,temporary,width,vertical,gate);
   if(!gate.canContinue()||frames<2||temporary.length()<10000||
      temporary.length()>MAX_DERIVATIVE)throw new IOException("invalid_preview_output");
   String derivativeSha=digest(temporary);
   JSONObject record=new JSONObject().put("schema_version",VERSION)
      .put("original_name",name).put("original_sha256",originalSha)
      .put("derivative_name",basename).put("derivative_sha256",derivativeSha)
      .put("bytes",temporary.length()).put("width",width).put("height",vertical)
      .put("fps_target",FPS).put("frames_encoded",frames)
      .put("codec","video/avc").put("no_audio_in_preview",true)
      .put("original_4k_unchanged",true).put("manual_reviews_unchanged",true)
      .put("source","verified_S9_native_microSD");
   File metaTemp=File.createTempFile(".preview-meta-",".tmp",copies);
   try{
    try(FileOutputStream out=new FileOutputStream(metaTemp)){
     out.write(record.toString().getBytes("UTF-8"));out.flush();out.getFD().sync();
    }
    if(!temporary.renameTo(target))throw new IOException("preview_atomic_publish_failed");
    temporary=null;
    if(!metaTemp.renameTo(verified)){
     // Avoid publishing an unverified derivative. This file is only a cache.
     target.delete();
     throw new IOException("preview_manifest_publish_failed");
    }
   }finally{if(metaTemp.exists())metaTemp.delete();}
   return record;
  }finally{
   if(temporary!=null&&temporary.exists())temporary.delete();
   BUSY.set(false);
  }
 }

 /** TTL applies only to independently regenerated preview MP4s and their
  * completion sidecars. Original source media and original sidecars stay in
  * the parent Security4K directory and cannot match this allowlist.
  */
 static int reapExpired(File root,Gate gate){
  File[] outputs=root.listFiles((dir,name)->name.matches(
    "motion_[0-9]{13}[.]mp4[.](?:360p|480p)[.]mp4"));
  if(outputs==null)return 0;
  int removed=0;
  long now=System.currentTimeMillis();
  for(File file:outputs){
   if(removed>=12||!gate.canContinue())break;
   try{
    if(!file.isFile()||Files.isSymbolicLink(file.toPath())||
       !file.getCanonicalFile().getParentFile().equals(root.getCanonicalFile()))
     continue;
    long age=now-file.lastModified();
    if(age<=48L*60*60*1000||age>365L*24*60*60*1000)continue;
    File manifest=new File(root,file.getName()+".verified.json");
    if(!manifest.isFile()||Files.isSymbolicLink(manifest.toPath())||
       !manifest.getCanonicalFile().getParentFile().equals(root.getCanonicalFile()))
     continue;
    // Delete only both regenerable products. No original files or user labels.
    if(file.delete()){
     manifest.delete();
     removed++;
    }
   }catch(IOException ignored){}
  }
  return removed;
 }

 private static long cacheBytes(File root){
  long bytes=0;
  File[] files=root.listFiles((dir,name)->name.matches(
    "motion_[0-9]{13}[.]mp4[.](?:360p|480p)[.]mp4"));
  if(files!=null)for(File item:files)if(item.isFile()&&!Files.isSymbolicLink(item.toPath()))bytes+=item.length();
  return bytes;
 }

 private static String digest(File file)throws Exception{
  MessageDigest sha=MessageDigest.getInstance("SHA-256");
  try(InputStream in=new BufferedInputStream(new FileInputStream(file))){
   byte[] buf=new byte[65536];int n;
   while((n=in.read(buf))>0)sha.update(buf,0,n);
  }
  StringBuilder text=new StringBuilder();
  for(byte b:sha.digest())text.append(String.format(Locale.ROOT,"%02x",b&255));
  return text.toString();
 }

 private static MediaCodec hardwareEncoder(int width,int height)throws IOException {
  for(MediaCodecInfo info:new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()){
   if(!info.isEncoder()||!info.isHardwareAccelerated())continue;
   for(String mime:info.getSupportedTypes()){
    if(!"video/avc".equalsIgnoreCase(mime))continue;
    MediaCodecInfo.CodecCapabilities caps=info.getCapabilitiesForType(mime);
    if(caps.getVideoCapabilities()==null||
       !caps.getVideoCapabilities().areSizeAndRateSupported(width,height,FPS))continue;
    boolean flexible=false;
    for(int format:caps.colorFormats)
     if(format==MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)flexible=true;
    if(flexible)return MediaCodec.createByCodecName(info.getName());
   }
  }
  throw new IOException("no_hardware_flexible_yuv_avc_encoder");
 }

 private static byte limit(int value){return (byte)Math.max(0,Math.min(255,value));}
 private static void planar(Image output,int[] rgb,int width,int height)throws IOException {
  if(output==null||output.getFormat()!=android.graphics.ImageFormat.YUV_420_888)
   throw new IOException("unsupported_hardware_encoder_input_image");
  Image.Plane[] planes=output.getPlanes();
  if(planes.length!=3)throw new IOException("unsupported_yuv_plane_count");
  for(int y=0;y<height;y+=2)for(int x=0;x<width;x+=2){
   int u=0,v=0;
   for(int dy=0;dy<2;dy++)for(int dx=0;dx<2;dx++){
    int col=rgb[(y+dy)*width+x+dx];
    int r=(col>>>16)&255,g=(col>>>8)&255,b=col&255;
    int yy=((66*r+129*g+25*b+128)>>8)+16;
    u+=((-38*r-74*g+112*b+128)>>8)+128;
    v+=((112*r-94*g-18*b+128)>>8)+128;
    Image.Plane plane=planes[0];
    int index=(y+dy)*plane.getRowStride()+(x+dx)*plane.getPixelStride();
    if(index>=plane.getBuffer().capacity())throw new IOException("yuv_luma_buffer_bounds");
    plane.getBuffer().put(index,limit(yy));
   }
   int row=y/2,col=x/2;
   for(int p=1;p<3;p++){
    Image.Plane plane=planes[p];
    int index=row*plane.getRowStride()+col*plane.getPixelStride();
    if(index>=plane.getBuffer().capacity())throw new IOException("yuv_chroma_buffer_bounds");
    plane.getBuffer().put(index,limit(p==1?u/4:v/4));
   }
  }
 }

 private static final class Output {
  boolean started=false,ended=false;
  int track=-1,frames=0;
 }
 private static void drain(MediaCodec encoder,MediaMuxer muxer,Output state,long waitUs)throws Exception{
  MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
  while(true){
   int index=encoder.dequeueOutputBuffer(info,waitUs);
   if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){
    if(state.started)throw new IOException("duplicate_video_output_format");
    state.track=muxer.addTrack(encoder.getOutputFormat());
    muxer.start();state.started=true;
   }else if(index>=0){
    ByteBuffer bytes=encoder.getOutputBuffer(index);
    if(bytes==null)throw new IOException("missing_encoded_frame");
    if((info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)!=0)info.size=0;
    if(info.size>0){
     if(!state.started)throw new IOException("encoded_sample_before_muxer");
     bytes.position(info.offset);bytes.limit(info.offset+info.size);
     muxer.writeSampleData(state.track,bytes,info);
     state.frames++;
    }
    if((info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0)state.ended=true;
    encoder.releaseOutputBuffer(index,false);
   }else return;
   if(state.ended)return;
   waitUs=0;
  }
 }

 private static int encode(File source,File destination,int width,int height,Gate gate)throws Exception {
  MediaMetadataRetriever retriever=new MediaMetadataRetriever();
  MediaCodec encoder=null;
  MediaMuxer muxer=null;
  Output output=new Output();
  long started=System.nanoTime();
  try {
   retriever.setDataSource(source.getAbsolutePath());
   String ms=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
   String w=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
   String h=retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
   long duration=Long.parseLong(ms);
   if(duration<1000||duration>120000||Integer.parseInt(w)!=3840||Integer.parseInt(h)!=2160)
    throw new IOException("unrecognized_source_video_dimensions_or_duration");
   encoder=hardwareEncoder(width,height);
   MediaFormat format=MediaFormat.createVideoFormat("video/avc",width,height);
   format.setInteger(MediaFormat.KEY_COLOR_FORMAT,
      MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
   format.setInteger(MediaFormat.KEY_BIT_RATE,height==360?750000:1200000);
   format.setInteger(MediaFormat.KEY_FRAME_RATE,FPS);
   format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1);
   encoder.configure(format,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);
   encoder.start();
   muxer=new MediaMuxer(destination.getAbsolutePath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
   int[] pixels=new int[width*height];
   int count=0;
   long stepUs=1000000L/FPS;
   for(long stamp=0;stamp<duration*1000;stamp+=stepUs){
    if(!gate.canContinue()||System.nanoTime()-started>150_000_000_000L)
     throw new InterruptedIOException("capture_priority_or_preview_time_budget");
    // Android platform decoder returns already downscaled frame; the 4K source
    // is never re-encoded or copied on the C720P.
    Bitmap frame=retriever.getScaledFrameAtTime(stamp,
        MediaMetadataRetriever.OPTION_CLOSEST,width,height);
    if(frame==null)throw new IOException("native_decode_frame_unavailable");
    Bitmap exact=frame;
    if(frame.getWidth()!=width||frame.getHeight()!=height)
     exact=Bitmap.createScaledBitmap(frame,width,height,true);
    try{
     exact.getPixels(pixels,0,width,0,0,width,height);
    }finally{
     if(exact!=frame)exact.recycle();
     frame.recycle();
    }
    int index=encoder.dequeueInputBuffer(20000);
    if(index<0){
     drain(encoder,muxer,output,0);
     index=encoder.dequeueInputBuffer(40000);
    }
    if(index<0)throw new IOException("hardware_encoder_backpressure");
    Image image=encoder.getInputImage(index);
    try{planar(image,pixels,width,height);}
    finally{if(image!=null)image.close();}
    ByteBuffer input=encoder.getInputBuffer(index);
    if(input==null)throw new IOException("no_input_buffer");
    encoder.queueInputBuffer(index,0,input.capacity(),stamp,0);
    drain(encoder,muxer,output,0);
    count++;
    if(destination.length()>MAX_DERIVATIVE)
     throw new IOException("derivative_grew_beyond_budget");
   }
   if(count<2)throw new IOException("preview_has_insufficient_frames");
   int eos=encoder.dequeueInputBuffer(100000);
   if(eos<0)throw new IOException("missing_end_input_slot");
   encoder.queueInputBuffer(eos,0,0,duration*1000,MediaCodec.BUFFER_FLAG_END_OF_STREAM);
   for(int attempt=0;attempt<100&&!output.ended;attempt++){
    if(!gate.canContinue())throw new InterruptedIOException("capture_priority_during_encode_drain");
    drain(encoder,muxer,output,20000);
   }
   if(!output.ended||!output.started||output.frames<2)
    throw new IOException("native_encoder_not_complete");
   return output.frames;
  }finally{
   try{retriever.release();}catch(Exception ignored){}
   if(encoder!=null){
    try{encoder.stop();}catch(Exception ignored){}
    try{encoder.release();}catch(Exception ignored){}
   }
   if(muxer!=null){
    if(output.started)try{muxer.stop();}catch(Exception ignored){}
    try{muxer.release();}catch(Exception ignored){}
   }
  }
 }
}
