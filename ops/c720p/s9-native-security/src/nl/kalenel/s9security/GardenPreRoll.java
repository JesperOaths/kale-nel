package nl.kalenel.s9security;

import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.os.SystemClock;
import android.util.Log;
import java.io.File;
import java.nio.ByteBuffer;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Independent on-phone H.264 circular PRE-EVENT encoder.
 * Feeds 640x480 YUV from the same already-active Camera2 preview into a hardware
 * MediaCodec in an independent worker; original 4K MediaRecorder is unchanged.
 * Only compressed samples from the previous ~7 sec are kept in memory.
 * When a verified event triggers, its 4-6 sec preroll is frozen and then muxed
 * on-device as name.mp4.preroll.mp4 after the 4K segment completes.
 * Never uploads video, records a false event, or writes untriggered SD media.
 */
public final class GardenPreRoll {
 static final String VERSION="s9_on_phone_avc_memory_ring_v1";
 static final int WIDTH=640,HEIGHT=480,FPS=24,BIT_RATE=1400000;
 static final long RING_US=7000000L,DESIRED_US=5000000L,MIN_US=550000L;
 private static final int MAX_BYTES=11000000;
 private final Object lock=new Object();
 private final ArrayDeque<Sample> compressed=new ArrayDeque<>();
 private final AtomicBoolean busy=new AtomicBoolean(false);
 private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{
  Thread t=new Thread(r,"s9-h264-preroll-encoder");t.setPriority(Thread.MIN_PRIORITY);return t;
 });
 private MediaCodec codec;
 private MediaFormat codecFormat;
 private int bytes=0;
 private volatile boolean ready=false,failed=false;
 public volatile long framesInput=0,framesOutput=0,dropped=0,filesSaved=0;
 public volatile long lastSavedDurationMs=0,lastSavedBytes=0;
 public volatile String lastSavedName="",lastError="";
 private volatile boolean closed=false;
 public boolean ready(){return ready&&!failed&&!closed;}
 public boolean failed(){return failed;}
 public boolean busy(){return busy.get();}
 public int cachedFrames(){synchronized(lock){return compressed.size();}}
 public long cachedDurationMs(){
  synchronized(lock){
   if(compressed.size()<2)return 0;
   return (compressed.peekLast().pts-compressed.peekFirst().pts)/1000;
  }
 }
 public boolean offer(PreviewJpeg.Snapshot snapshot,long ptsUs){
  if(closed||failed||snapshot==null||snapshot.width!=WIDTH||snapshot.height!=HEIGHT||
     ptsUs<=0||!busy.compareAndSet(false,true)){dropped++;return false;}
  try{worker.execute(()->{
    try{encode(snapshot,ptsUs);}
    catch(Throwable error){disable(error);}
    finally{busy.set(false);}
   });return true;
  }catch(RuntimeException reject){busy.set(false);dropped++;return false;}
 }
 private void prepare()throws Exception{
  if(codec!=null)return;
  MediaFormat format=MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC,WIDTH,HEIGHT);
  format.setInteger(MediaFormat.KEY_BIT_RATE,BIT_RATE);
  format.setInteger(MediaFormat.KEY_FRAME_RATE,FPS);
  format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1);
  format.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
  codec=MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
  codec.configure(format,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);
  codec.start();
 }
 private static void copyPlanes(PreviewJpeg.Snapshot s,Image image){
  Image.Plane[] dest=image.getPlanes();
  if(dest.length!=3)throw new IllegalStateException("codec_did_not_expose_YUV420");
  for(int p=0;p<3;p++){
   int width=p==0?s.width:s.width/2,height=p==0?s.height:s.height/2;
   ByteBuffer target=dest[p].getBuffer();
   int pitch=dest[p].getRowStride(),step=dest[p].getPixelStride();
   int srcPitch=s.rowStrides[p],srcStep=s.pixelStrides[p];
   byte[] bytes=s.planes[p];
   for(int y=0;y<height;y++)for(int x=0;x<width;x++){
    int from=y*srcPitch+x*srcStep,to=y*pitch+x*step;
    if(from<0||from>=bytes.length||to<0||to>=target.limit())
     throw new IllegalArgumentException("preroll_YUV_stride");
    target.put(to,bytes[from]);
   }
  }
 }
 private void encode(PreviewJpeg.Snapshot frame,long ptsUs)throws Exception{
  if(closed)return;
  prepare();
  int input=codec.dequeueInputBuffer(1000);
  if(input>=0){
   Image writable=codec.getInputImage(input);
   if(writable==null)throw new IllegalStateException("no_flexible_YUV_codec_input");
   try{copyPlanes(frame,writable);}finally{writable.close();}
   codec.queueInputBuffer(input,0,WIDTH*HEIGHT*3/2,ptsUs,0);
   framesInput++;
  }else dropped++;
  drain();
 }
 private void drain(){
  if(codec==null)return;
  MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
  for(int iteration=0;iteration<35;iteration++){
   int n=codec.dequeueOutputBuffer(info,0);
   if(n==MediaCodec.INFO_TRY_AGAIN_LATER)break;
   if(n==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){
    synchronized(lock){codecFormat=codec.getOutputFormat();}
    continue;
   }
   if(n<0)continue;
   try{
    if(info.size>0&&(info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)==0){
     ByteBuffer bytes=codec.getOutputBuffer(n);
     if(bytes!=null){
      byte[] packet=new byte[info.size];
      bytes.position(info.offset);bytes.get(packet,0,info.size);
      synchronized(lock){
       if(codecFormat!=null){
        compressed.addLast(new Sample(packet,info.presentationTimeUs,info.flags));
        this.bytes+=packet.length;
        framesOutput++;ready=true;
        long min=info.presentationTimeUs-RING_US;
        while(!compressed.isEmpty()&&(compressed.peekFirst().pts<min||
               this.bytes>MAX_BYTES)){
         Sample old=compressed.removeFirst();this.bytes-=old.data.length;
        }
       }
      }
     }
    }
   }finally{codec.releaseOutputBuffer(n,false);}
  }
 }
 public static final class Frozen {
  final MediaFormat format;
  final ArrayList<Sample> samples;
  final long durationMs;
  Frozen(MediaFormat f,ArrayList<Sample> packets,long ms){
   format=f;samples=packets;durationMs=ms;
  }
 }
 static final class Sample {
  final byte[] data;final long pts;final int flags;
  Sample(byte[] raw,long time,int bits){data=raw;pts=time;flags=bits;}
  boolean key(){return (flags&MediaCodec.BUFFER_FLAG_KEY_FRAME)!=0;}
 }
 public Frozen freeze(){
  synchronized(lock){
   if(!ready()||codecFormat==null||compressed.size()<6)return null;
   ArrayList<Sample> packets=new ArrayList<>(compressed);
   long latest=packets.get(packets.size()-1).pts;
   long min=latest-DESIRED_US;
   int first=-1;
   // Choose first keyframe at/after the nominal 5-second preroll.
   for(int i=0;i<packets.size();i++)
    if(packets.get(i).pts>=min&&packets.get(i).key()){first=i;break;}
   if(first<0){
    for(int i=0;i<packets.size();i++)
     if(packets.get(i).key()){first=i;break;}
   }
   if(first<0)return null;
   ArrayList<Sample> selected=new ArrayList<>(packets.subList(first,packets.size()));
   long duration=selected.get(selected.size()-1).pts-selected.get(0).pts;
   if(selected.size()<6||duration<MIN_US)return null;
   return new Frozen(codecFormat,selected,duration/1000);
  }
 }
 public void saveAsync(File original4K,Frozen frozen){
  if(closed||frozen==null||original4K==null)return;
  try{worker.execute(()->{
   try{save(original4K,frozen);}
   catch(Throwable problem){lastError="muxer_"+problem.getClass().getSimpleName();
    Log.w("S9_PREROLL","pre_event_mux_failed",problem);}
  });}catch(RuntimeException reject){lastError="preroll_writer_unavailable";}
 }
 private void save(File original,Frozen frozen)throws Exception{
  if(!original.isFile()||original.length()<100000)throw new IllegalArgumentException("original_not_final");
  String name=original.getName();
  if(!name.matches("motion_[0-9]{13}[.]mp4"))throw new IllegalArgumentException("invalid_original");
  File parent=original.getCanonicalFile().getParentFile();
  File finalFile=new File(parent,name+".preroll.mp4");
  if(finalFile.isFile())return;
  File temp=new File(parent,name+".preroll.partial");
  if(temp.exists())throw new IllegalStateException("pre_event_partial_exists");
  MediaMuxer muxer=null;boolean written=false;
  try{
   muxer=new MediaMuxer(temp.getAbsolutePath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
   int track=muxer.addTrack(frozen.format);muxer.start();
   long first=frozen.samples.get(0).pts,last=-1;
   for(Sample s:frozen.samples){
    long timestamp=Math.max(0,s.pts-first);
    if(timestamp<=last)continue;
    MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
    info.set(0,s.data.length,timestamp,s.flags);
    muxer.writeSampleData(track,ByteBuffer.wrap(s.data),info);
    last=timestamp;
   }
   muxer.stop();muxer.release();muxer=null;
   if(temp.length()<10000||temp.length()>MAX_BYTES)throw new IllegalStateException("preroll_invalid_size");
   if(!temp.renameTo(finalFile))throw new IllegalStateException("preroll_atomic_rename_failed");
   written=true;filesSaved++;lastSavedDurationMs=frozen.durationMs;
   lastSavedBytes=finalFile.length();lastSavedName=finalFile.getName();
  }finally{
   if(muxer!=null)try{muxer.release();}catch(Throwable ignored){}
   if(!written&&temp.isFile())temp.delete();
  }
 }
 private void disable(Throwable error){
  ready=false;failed=true;lastError=error.getClass().getSimpleName();
  Log.w("S9_PREROLL","pre_event_encoder_unavailable",error);
  try{if(codec!=null)codec.stop();}catch(Throwable ignored){}
  try{if(codec!=null)codec.release();}catch(Throwable ignored){}
  codec=null;
 }
 public void stop(){
  closed=true;
  try{worker.execute(()->{
   try{if(codec!=null){codec.stop();codec.release();}}catch(Throwable ignored){}
   codec=null;
  });}catch(RuntimeException ignored){}
  worker.shutdown();
 }
}
