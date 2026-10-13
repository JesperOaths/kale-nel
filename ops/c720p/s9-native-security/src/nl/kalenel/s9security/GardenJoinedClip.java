package nl.kalenel.s9security;

import android.media.MediaMetadataRetriever;
import android.util.Log;
import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFmpegSession;
import com.arthenica.ffmpegkit.ReturnCode;
import java.io.File;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * On-phone, single-file pre-event playback assembly.
 *
 * Sources: 640x480 H264 pre-event ring + untouched 3840x2160 H264 event MP4.
 * Destination: 1280x720 30fps H264, video-only complete timeline. Preserves
 * source aspect ratios and NEVER overwrites either original. 4K remains in
 * the archive as a separately selectable source.
 *
 * Both different-size H264 bitstreams MUST be decoded and re-encoded into one
 * uniform stream; appending bytes or muxing incompatible SPS/PPS is invalid.
 * The finished file is written only after a full mux + metadata validation.
 */
public final class GardenJoinedClip {
 public static final String VERSION="s9_onphone_event_prepend_transcode_v1";
 public interface Guard {boolean mayMerge();}
 private final Guard guard;
 private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{
  Thread t=new Thread(r,"s9-phone-once-event-prepend");
  t.setPriority(Thread.MIN_PRIORITY);
  return t;
 });
 private final ArrayDeque<File> queue=new ArrayDeque<>();
 private boolean closed=false;
 private volatile boolean busy=false,cancelled=false;
 private volatile long completed=0,failed=0,skipped=0;
 private volatile long lastDurationMs=0,lastPreRollMs=0;
 private volatile String lastName="",lastError="";
 private volatile long activeSession=-1L;
 public GardenJoinedClip(Guard gate){guard=gate;}
 public long joined(){return completed;}
 public long errors(){return failed;}
 public long skipped(){return skipped;}
 public boolean busy(){return busy;}
 public int pending(){synchronized(queue){return queue.size();}}
 public long lastDurationMs(){return lastDurationMs;}
 public long lastPreRollMs(){return lastPreRollMs;}
 public String lastName(){return lastName;}
 public String lastError(){return lastError;}
 public void offer(File original,File preroll){
  if(closed||original==null||preroll==null)return;
  String name=original.getName();
  if(!name.matches("motion_[0-9]{13}[.]mp4"))return;
  if(!preroll.equals(new File(original.getParentFile(),name+".preroll.mp4")))return;
  if(!original.isFile()||!preroll.isFile())return;
  File joined=new File(original.getParentFile(),name+".complete.mp4");
  if(joined.isFile()&&joined.length()>20000)return;
  synchronized(queue){
   if(queue.size()>=8){skipped++;lastError="merge_queue_full";return;}
   if(!queue.contains(original))queue.addLast(original);
  }
  schedule();
 }
 public void maybeRetryOne(File media){
  if(closed||busy||media==null||!guard.mayMerge())return;
  File[] pending=media.listFiles((dir,n)->n.matches("motion_[0-9]{13}[.]mp4[.]preroll[.]mp4"));
  if(pending==null)return;
  java.util.Arrays.sort(pending,(a,b)->Long.compare(b.lastModified(),a.lastModified()));
  for(File pre:pending){
   String nm=pre.getName().replace(".preroll.mp4","");
   File original=new File(media,nm);
   File out=new File(media,nm+".complete.mp4");
   if(original.isFile()&&!out.isFile()&&
      pre.length()>10000&&original.length()>200000){
    offer(original,pre);return;
   }
  }
 }
 private void schedule(){
  if(closed)return;
  try{worker.execute(this::processOne);}catch(RejectedExecutionException e){
   lastError="worker_rejected";failed++;
  }
 }
 private void processOne(){
  if(busy||closed)return;
  File original;
  synchronized(queue){original=queue.pollFirst();}
  if(original==null)return;
  if(!guard.mayMerge()){
   synchronized(queue){if(queue.size()<8&&!queue.contains(original))queue.addLast(original);}
   return; // periodic idle backfill will resubmit
  }
  busy=true;cancelled=false;
  try{
   combine(original);
  }catch(Throwable e){
   failed++;lastError="merged_"+e.getClass().getSimpleName();
   Log.w("S9_EVENT_PREPEND",lastError,e);
  }finally{
   busy=false;activeSession=-1L;
  }
 }
 private static long duration(File f)throws Exception{
  MediaMetadataRetriever mm=new MediaMetadataRetriever();
  try{
   mm.setDataSource(f.getAbsolutePath());
   String d=mm.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
   if(d==null)return -1L;
   return Long.parseLong(d);
  }finally{mm.release();}
 }
 private void combine(File original)throws Exception{
  File folder=original.getParentFile();
  File preroll=new File(folder,original.getName()+".preroll.mp4");
  File output=new File(folder,original.getName()+".complete.mp4");
  File tmp=new File(folder,original.getName()+".complete.partial.mp4");
  if(output.isFile()&&output.length()>20000)return;
  if(!preroll.isFile()||preroll.length()<10000||
     !original.isFile()||original.length()<200000||
     folder.getUsableSpace()<8L*1024*1024*1024)throw new IOException("source_or_storage");
  long prefix=duration(preroll),main=duration(original);
  if(prefix<500||prefix>9000||main<900||main>130000)
   throw new IOException("invalid_input_durations");
  if(tmp.exists())throw new IOException("previous_partial_exists");
  // Preserve 4:3 preview and 16:9 4K event via aspect-preserving letterbox.
  final String prep="[0:v:0]setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,"
    +"pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[p];";
  final String event="[1:v:0]setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,"
    +"pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[e];";
  String[] args={
   "-hide_banner","-loglevel","error","-nostdin","-y",
   "-threads","2","-i",preroll.getAbsolutePath(),"-i",original.getAbsolutePath(),
   "-filter_complex",prep+event+"[p][e]concat=n=2:v=1:a=0[v]",
   "-map","[v]","-an","-c:v","h264_mediacodec","-b:v","2600000",
   "-g","45","-pix_fmt","yuv420p","-movflags","+faststart",
   tmp.getAbsolutePath()
  };
  try{
   CountDownLatch finish=new CountDownLatch(1);
   AtomicReference<FFmpegSession> completed=new AtomicReference<>();
   FFmpegSession session=FFmpegKit.executeWithArgumentsAsync(args,finished->{
    completed.set(finished);
    finish.countDown();
   });
   if(session==null)throw new IOException("ffmpeg_session_not_started");
   activeSession=session.getSessionId();
   if(cancelled)FFmpegKit.cancel(activeSession);
   if(!finish.await(300,TimeUnit.SECONDS)){
    FFmpegKit.cancel(activeSession);
    throw new IOException("ffmpegkit_timeout");
   }
   FFmpegSession result=completed.get();
   if(result==null||!ReturnCode.isSuccess(result.getReturnCode())||
      cancelled)throw new IOException("ffmpegkit_"+(result==null?"null":String.valueOf(result.getReturnCode())));
   if(!tmp.isFile()||tmp.length()<25000||tmp.length()>250000000)
    throw new IOException("joined_mp4_size");
   long joined=duration(tmp);
   // Important: a truncated, one-segment MP4 must never be published.
   if(joined<main+prefix-1200||joined>main+prefix+2800)
    throw new IOException("join_duration_invalid_"+joined+"_expected_"+(main+prefix));
   if(cancelled||!guard.mayMerge())throw new IOException("recording_started_before_merge_commit");
   if(!tmp.renameTo(output))throw new IOException("join_atomic_rename_failed");
   completed++;lastName=output.getName();
   lastDurationMs=joined;lastPreRollMs=prefix;lastError="";
   Log.i("S9_EVENT_PREPEND","VERIFIED_COMBINED_CLIP "+lastName+
     " pre_ms="+prefix+" total_ms="+joined+" bytes="+output.length());
  }finally{
   if(tmp.isFile())tmp.delete(); // ONLY temporary derivative, never inputs
  }
 }
 /** Prefer the next live 4K recording over any background transcode. */
 public void pauseForCapture(){
  cancelled=true;
  long session=activeSession;
  if(session>0)try{FFmpegKit.cancel(session);}catch(Throwable ignored){}
 }
 public void stop(){
  closed=true;
  pauseForCapture();
  worker.shutdownNow();
 }
}
