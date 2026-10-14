package nl.kalenel.s9security;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.view.Surface;
import java.io.File;
import java.nio.ByteBuffer;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * EXPERIMENTAL / NOT WIRED INTO LIVE CAMERA SERVICE.
 *
 * One hardware H.264 encoder produces all 3840x2160 compressed frames,
 * including the pre-event and the event, through a persistent Camera2 Surface.
 * CameraService must submit this Surface plus its 640x480 YUV analysis reader
 * in ONE long-lived CameraCaptureSession. There must be no preview->MediaRecorder
 * reconfiguration at the event boundary.
 *
 * 4K capability in vendor XML != sustained thermal/camera-session proof.
 * Deployment must be guarded behind a disabled-by-default feature flag.
 */
public final class Continuous4KEncoder {
 public interface Listener {
  void completed(File path,long durationMs);
  void failed(File retainedPartial,String explanation);
 }
 private static final class Work {
  static final int START=1,FRAME=2,END=3,QUIT=4;
  final int kind;
  final Session session;
  final Encoded4KRing.Frozen prefix;
  final Encoded4KRing.Sample sample;
  final MediaFormat format;
  Work(int kind,Session s,Encoded4KRing.Frozen p,Encoded4KRing.Sample n,MediaFormat f){
   this.kind=kind;session=s;prefix=p;sample=n;format=f;
  }
 }
 private static final class Session {
  final File temporary,finalFile;
  final int rotation;
  final Listener listener;
  long originUs,lastUs;
  long count;
  boolean finished;
  Session(File tmp,File output,int degrees,Listener callback){
   temporary=tmp;finalFile=output;rotation=degrees;listener=callback;
  }
 }
 private final Object guard=new Object();
 private final Encoded4KRing ring=new Encoded4KRing();
 // One START item retains the pre-event prefix; FRAME items are small AVC
 // packets. Bound the backlog; do not allocate an unbounded 4K writer queue.
 private final ArrayBlockingQueue<Work> outputQueue=new ArrayBlockingQueue<>(256);
 private volatile boolean running;
 private volatile Throwable failure;
 private volatile long droppedOutputFrames;
 private volatile MediaFormat encodedFormat;
 private volatile boolean outputFormatReady;
 private volatile Session active;
 private volatile long stopAfterPtsUs=-1;
 private MediaCodec encoder;
 private Surface surface;
 private Thread drainThread,writeThread;
 private static final String H264=MediaFormat.MIMETYPE_VIDEO_AVC;

 public Surface start()throws Exception {
  synchronized(guard){
   if(running||encoder!=null)throw new IllegalStateException("already_started");
   MediaFormat f=MediaFormat.createVideoFormat(H264,Encoded4KRing.WIDTH,Encoded4KRing.HEIGHT);
   f.setInteger(MediaFormat.KEY_BIT_RATE,Encoded4KRing.BITRATE);
   f.setInteger(MediaFormat.KEY_FRAME_RATE,Encoded4KRing.FPS);
   f.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1);
   f.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
   encoder=MediaCodec.createEncoderByType(H264);
   if(!encoder.getName().startsWith("OMX.Exynos.")){
    String which=encoder.getName();encoder.release();encoder=null;
    throw new IllegalStateException("refuse_non_hardware_exynos_4k_encoder_"+which);
   }
   try{
    encoder.configure(f,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);
    surface=encoder.createInputSurface();
    encoder.start();
   }catch(Exception e){
    if(surface!=null)try{surface.release();}catch(Throwable ignored){}
    try{encoder.release();}catch(Throwable ignored){}
    encoder=null;surface=null;throw e;
   }
   running=true;
   writeThread=new Thread(this::writerLoop,"s9-4k-onphone-muxer");
   writeThread.setPriority(Thread.NORM_PRIORITY-1);
   drainThread=new Thread(this::drainLoop,"s9-4k-onphone-avc-drain");
   drainThread.setPriority(Thread.NORM_PRIORITY);
   writeThread.start();drainThread.start();
   return surface;
  }
 }
 public Surface inputSurface(){synchronized(guard){return surface;}}
 public boolean healthy(){return running&&failure==null&&outputFormatReady;}
 public long bufferedMs(){return ring.bufferedUs()/1000L;}
 public int bufferedBytes(){return ring.bytes();}
 public long droppedOutputFrames(){return droppedOutputFrames;}
 public String error(){Throwable f=failure;return f==null?"":f.getClass().getSimpleName();}
 public boolean readyForEvent(){return healthy()&&ring.freeze()!=null;}

 /**
  * An event starts on an IDR from the preceding ~7s, then *continues with
  * packets from this exact same encoder*. The writer thread owns MediaMuxer.
  * Returns false without creating anything when the ring is not ready.
  */
 public boolean startEvent(File recording,File finalFile,int orientation,Listener callback){
  if(recording==null||finalFile==null||callback==null)return false;
  synchronized(guard){
   if(!running||failure!=null||!outputFormatReady||active!=null||
       recording.exists()||finalFile.exists()||!recording.getParentFile().equals(finalFile.getParentFile()))return false;
   Encoded4KRing.Frozen prefix=ring.freeze();
   if(prefix==null)return false;
   Session s=new Session(recording,finalFile,orientation,callback);
   if(!outputQueue.offer(new Work(Work.START,s,prefix,null,encodedFormat)))return false;
   active=s;
   stopAfterPtsUs=-1;
   return true;
  }
 }
 /** Stop is enqueued after all previously drained samples; never switches camera mode. */
 public boolean stopEvent(){
  synchronized(guard){
   Session s=active;
   if(s==null||stopAfterPtsUs>=0)return false;
   // Camera2 and MediaCodec input timestamps share the boot clock. Do not
   // enqueue END before in-flight hardware output has been drained.
   stopAfterPtsUs=android.os.SystemClock.elapsedRealtimeNanos()/1000L;
   return true;
  }
 }
 private void drainLoop(){
  MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
  try{
   while(running){
    int index=encoder.dequeueOutputBuffer(info,25000);
    if(index==MediaCodec.INFO_TRY_AGAIN_LATER)continue;
    if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){
     encodedFormat=encoder.getOutputFormat();
     outputFormatReady=true;continue;
    }
    if(index<0)continue;
    try{
     if(info.size<=0||(info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)!=0)continue;
     ByteBuffer raw=encoder.getOutputBuffer(index);
     if(raw==null)throw new IllegalStateException("missing_avc_data");
     byte[] data=new byte[info.size];
     raw.position(info.offset);raw.get(data,0,info.size);
     boolean key=(info.flags&MediaCodec.BUFFER_FLAG_KEY_FRAME)!=0;
     synchronized(guard){
      if(!ring.offer(data,info.presentationTimeUs,info.flags,key))continue;
      Session s=active;
      if(s!=null){
       // Prefix was frozen at START, so subsequent packets in one encoder
       // flow into the event without a Camera2 reconfiguration.
       if(!outputQueue.offer(new Work(Work.FRAME,s,null,
          new Encoded4KRing.Sample(data,info.presentationTimeUs,info.flags,key),null))){
        droppedOutputFrames++;
        markFailure(new IllegalStateException("4k_mp4_writer_queue_overflow"));
       }
       if(stopAfterPtsUs>=0&&info.presentationTimeUs>=stopAfterPtsUs){
        active=null;stopAfterPtsUs=-1;
        if(!outputQueue.offer(new Work(Work.END,s,null,null,null)))
         markFailure(new IllegalStateException("4k_mp4_end_queue_overflow"));
       }
      }
     }
    }finally{
     encoder.releaseOutputBuffer(index,false);
    }
   }
  }catch(Throwable e){markFailure(e);}
 }
 private void writerLoop(){
  Session current=null;
  MediaMuxer muxer=null;
  try{
   while(running||!outputQueue.isEmpty()){
    Work w=outputQueue.poll(200,TimeUnit.MILLISECONDS);
    if(w==null)continue;
    if(w.kind==Work.QUIT)break;
    if(w.kind==Work.START){
     if(muxer!=null||current!=null)throw new IllegalStateException("overlapping_4k_event");
     current=w.session;
     if(w.prefix==null||w.prefix.durationUs<Encoded4KRing.MIN_VALID_US)
      throw new IllegalStateException("incomplete_4k_event_prefix");
     muxer=new MediaMuxer(current.temporary.getAbsolutePath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
     muxer.setOrientationHint(current.rotation);
     int track=muxer.addTrack(w.format);muxer.start();
     // single AVC track, track always 0 after exactly one addTrack()
     if(track!=0)throw new IllegalStateException("unexpected_track_number");
     current.originUs=w.prefix.firstPtsUs;
     current.lastUs=-1;
     for(Encoded4KRing.Sample packet:w.prefix.samples)
      write(muxer,current,packet);
    }else if(w.kind==Work.FRAME){
     if(current!=w.session||muxer==null)continue;
     write(muxer,current,w.sample);
    }else if(w.kind==Work.END){
     if(current!=w.session||muxer==null)continue;
     if(current.count<6)throw new IllegalStateException("insufficient_output_frames");
     muxer.stop();muxer.release();muxer=null;
     if(!current.temporary.isFile()||current.temporary.length()<100000)
      throw new IllegalStateException("empty_native_4k_mp4");
     MediaMetadataRetriever metadata=new MediaMetadataRetriever();
     int width,height;long durationMs;
     try{
      metadata.setDataSource(current.temporary.getAbsolutePath());
      width=Integer.parseInt(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
      height=Integer.parseInt(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
      durationMs=Long.parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
     }finally{metadata.release();}
     if(width!=Encoded4KRing.WIDTH||height!=Encoded4KRing.HEIGHT||
        durationMs<Encoded4KRing.MIN_VALID_US/1000L)
      throw new IllegalStateException("invalid_native_4k_complete_file");
     if(!current.temporary.renameTo(current.finalFile))
      throw new IllegalStateException("atomic_mp4_publish_failed");
     current.finished=true;current.listener.completed(current.finalFile,durationMs);
     current=null;
    }
   }
  }catch(Throwable e){
   markFailure(e);
  }finally{
   if(muxer!=null)try{muxer.release();}catch(Throwable ignored){}
   // Includes codec failure, queue overflow, explicit stop and muxer I/O.
   // Always notify about an unfinished event; never silently discard it.
   if(current!=null&&!current.finished)try{
    Throwable cause=failure;
    current.listener.failed(current.temporary,
       cause==null?"4k_writer_stopped":cause.getClass().getSimpleName());
   }catch(Throwable ignored){}
   // Retain any .recording partial for forensic recovery.
  }
 }
 private static void write(MediaMuxer muxer,Session s,Encoded4KRing.Sample p){
  if(p.ptsUs<=s.lastUs)return;
  long relative=p.ptsUs-s.originUs;
  if(relative<0)return;
  MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
  info.set(0,p.size(),relative,p.flags);
  muxer.writeSampleData(0,ByteBuffer.wrap(p.data),info);
  s.lastUs=p.ptsUs;s.count++;
 }
 private void markFailure(Throwable e){
  if(failure==null)failure=e;
  running=false;
 }
 public void close(){
  synchronized(guard){running=false;active=null;}
  outputQueue.offer(new Work(Work.QUIT,null,null,null,null));
  if(drainThread!=null)try{drainThread.join(1800);}catch(InterruptedException e){Thread.currentThread().interrupt();}
  if(writeThread!=null)try{writeThread.join(2500);}catch(InterruptedException e){Thread.currentThread().interrupt();}
  if(surface!=null)try{surface.release();}catch(Throwable ignored){}
  if(encoder!=null){
   try{encoder.stop();}catch(Throwable ignored){}
   try{encoder.release();}catch(Throwable ignored){}
  }
  encoder=null;surface=null;ring.clear();
 }
}
