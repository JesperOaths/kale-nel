package nl.kalenel.s9security;

import android.graphics.Bitmap;
import android.graphics.Rect;
import android.media.*;
import android.os.SystemClock;
import java.io.*;
import java.nio.ByteBuffer;
import java.util.function.BooleanSupplier;

/** Bounded hardware AVC decode into original-resolution YUV frames. */
public final class Native4KFrames implements AutoCloseable {
 public static final class Frame {
  public final Bitmap bitmap;public final long ptsUs;
  Frame(Bitmap b,long pts){bitmap=b;ptsUs=pts;}
 }
 private MediaExtractor extractor;private MediaCodec codec;private String name="",failure="";
 public Native4KFrames(File file){
  try{
   extractor=new MediaExtractor();extractor.setDataSource(file.getAbsolutePath());MediaFormat format=null;
   for(int i=0;i<extractor.getTrackCount();i++){
    MediaFormat f=extractor.getTrackFormat(i);
    if("video/avc".equals(f.getString(MediaFormat.KEY_MIME))){format=f;extractor.selectTrack(i);break;}
   }
   if(format==null||format.getInteger(MediaFormat.KEY_WIDTH)!=3840||format.getInteger(MediaFormat.KEY_HEIGHT)!=2160)
    throw new IOException("not_original_4k_avc");
   for(MediaCodecInfo info:new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()){
    if(info.isEncoder()||!info.getName().toLowerCase().contains("exynos"))continue;
    for(String mime:info.getSupportedTypes())if("video/avc".equals(mime)){name=info.getName();break;}
    if(!name.isEmpty())break;
   }
   if(name.isEmpty())throw new IOException("exynos_avc_decoder_unavailable");
   format.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
   codec=MediaCodec.createByCodecName(name);codec.configure(format,null,null,0);codec.start();
  }catch(Exception error){failure=error.getClass().getSimpleName();close();}
 }
 public String decoderName(){return name;}
 public Frame frame(long wantedUs,BooleanSupplier safe)throws IOException{
  if(codec==null)throw new IOException("native_decoder_unavailable_"+failure);
  try{
   extractor.seekTo(wantedUs,MediaExtractor.SEEK_TO_PREVIOUS_SYNC);codec.flush();
   boolean eof=false;long start=SystemClock.elapsedRealtime();MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
   while(SystemClock.elapsedRealtime()-start<6000){
    if(!safe.getAsBoolean())throw new IOException("capture_or_thermal_preemption");
    if(!eof){int input=codec.dequeueInputBuffer(1000);if(input>=0){
     ByteBuffer bytes=codec.getInputBuffer(input);if(bytes==null)throw new IOException("decoder_input_missing");
     int size=extractor.readSampleData(bytes,0);
     if(size<0){codec.queueInputBuffer(input,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM);eof=true;}
     else{codec.queueInputBuffer(input,0,size,extractor.getSampleTime(),0);extractor.advance();}
    }}
    int output=codec.dequeueOutputBuffer(info,1000);
    if(output>=0){
     try{
      if(info.size>0&&info.presentationTimeUs>=wantedUs){
       Image image=codec.getOutputImage(output);if(image==null)throw new IOException("native_yuv_image_unavailable");
       try{return new Frame(toBitmap(image),info.presentationTimeUs);}finally{image.close();}
      }
      if((info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0)throw new IOException("decode_end_before_sample");
     }finally{codec.releaseOutputBuffer(output,false);}
    }
   }throw new IOException("native_decode_budget_exceeded");
  }catch(IOException error){throw error;}catch(Exception error){throw new IOException("native_decoder_failed",error);}
 }
 private static Bitmap toBitmap(Image image)throws IOException{
  Rect crop=image.getCropRect();int width=crop.width(),height=crop.height();
  if(width!=3840||height!=2160||image.getPlanes().length!=3)throw new IOException("decoded_image_not_native_4k_yuv");
  Image.Plane[] planes=image.getPlanes();ByteBuffer yy=planes[0].getBuffer(),uu=planes[1].getBuffer(),vv=planes[2].getBuffer();
  int yp=yy.position(),up=uu.position(),vp=vv.position();int[] pixels=new int[width*height];
  for(int row=0;row<height;row++)for(int col=0;col<width;col++){
   int x=col+crop.left,y=row+crop.top;
   int l=(yy.get(yp+y*planes[0].getRowStride()+x*planes[0].getPixelStride())&255)-16;
   int u=(uu.get(up+(y/2)*planes[1].getRowStride()+(x/2)*planes[1].getPixelStride())&255)-128;
   int v=(vv.get(vp+(y/2)*planes[2].getRowStride()+(x/2)*planes[2].getPixelStride())&255)-128;
   int c=298*Math.max(0,l),r=(c+409*v+128)>>8,g=(c-100*u-208*v+128)>>8,b=(c+516*u+128)>>8;
   pixels[row*width+col]=0xff000000|(Math.max(0,Math.min(255,r))<<16)|(Math.max(0,Math.min(255,g))<<8)|Math.max(0,Math.min(255,b));
  }
  return Bitmap.createBitmap(pixels,width,height,Bitmap.Config.ARGB_8888);
 }
 @Override public void close(){
  if(codec!=null){try{codec.stop();}catch(Exception ignored){}try{codec.release();}catch(Exception ignored){}codec=null;}
  if(extractor!=null){try{extractor.release();}catch(Exception ignored){}extractor=null;}
 }
}
