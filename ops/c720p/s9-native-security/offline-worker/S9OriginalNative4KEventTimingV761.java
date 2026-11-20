package nl.kalenel.s9offline;

import android.media.MediaExtractor;
import android.media.MediaFormat;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * R761: one-shot SHA-revision-pinned, phone-only native 4K event sample PTS
 * proof. Reads encoded MP4 sample timestamps without decoding pixels or
 * person/face/body features. Never modifies the camera, original MP4,
 * People folders, review lists or research vector models.
 *
 * This attests *finished event file timing* on a previously completed
 * video. It MUST NOT be used to claim that model inference was running
 * concurrently with that file's ORIGINAL capture.
 */
public final class S9OriginalNative4KEventTimingV761 {
  private S9OriginalNative4KEventTimingV761(){}
  static final Path ROOT=Paths.get("/storage/9C33-6BBD/Android/data/"
      +"nl.kalenel.s9security/files/Security4K").toAbsolutePath();
  static final Pattern FILE=Pattern.compile("motion_[0-9]{13}[.]mp4");
  static final Pattern HEX=Pattern.compile("[a-f0-9]{64}");
  static final Pattern NONCE=Pattern.compile("[a-f0-9]{32}");
  static final long MAX_RUNTIME_NS=22_000_000_000L;
  static final long MAX_FILE=240_000_000L;
  static final long MAX_SAMPLE_COUNT=8000;
  static void need(boolean good,String why){
    if(!good)throw new IllegalArgumentException(why);
  }
  static String digest(String str)throws Exception {
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    byte[] bytes=md.digest(str.getBytes("UTF-8"));
    StringBuilder sb=new StringBuilder(64);
    for(byte b:bytes)sb.append(String.format(Locale.US,"%02x",b&255));
    return sb.toString();
  }
  static String sha(Path file,long deadline)throws Exception{
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    try(InputStream stream=Files.newInputStream(file)){
      byte[] buf=new byte[65536];int n;
      while((n=stream.read(buf))>0){
        need(System.nanoTime()<deadline,"source_digest_timeout");
        md.update(buf,0,n);
      }
    }
    StringBuilder sb=new StringBuilder(64);
    for(byte v:md.digest())sb.append(String.format(Locale.US,"%02x",v&255));
    return sb.toString();
  }
  static JSONObject check(String basename,String expectedSha,long bytes,
                          String nonce)throws Exception{
    need(FILE.matcher(basename).matches()&&
         HEX.matcher(expectedSha).matches()&&
         NONCE.matcher(nonce).matches(),"invalid_original_clip_binding");
    need(bytes>=10_000_000L&&bytes<=MAX_FILE,
         "source_file_outside_bounded_size");
    Path path=ROOT.resolve(basename).normalize();
    need(path.getParent().equals(ROOT)&&
         Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS),
         "original_not_regular_current_sd_file");
    long deadline=System.nanoTime()+MAX_RUNTIME_NS;
    need(Files.size(path)==bytes&&sha(path,deadline).equals(expectedSha),
         "source_sha_revision_not_verified_before_track");
    MediaExtractor extractor=new MediaExtractor();
    long count=0,firstPts=-1,lastPts=-1,nonmonotonic=0;
    long maxStep=0,stepsOver50ms=0,stepsOver100ms=0;
    double medianMs=Double.NaN,avgFps=Double.NaN;
    int videoIndex=-1,tracks=0;
    long durationUs=0;
    String mime="";
    try{
      extractor.setDataSource(path.toString());
      tracks=extractor.getTrackCount();
      for(int i=0;i<tracks;i++){
        MediaFormat fmt=extractor.getTrackFormat(i);
        String type=fmt.getString(MediaFormat.KEY_MIME);
        if(type!=null&&type.startsWith("video/")){
          need(videoIndex<0,"ambiguous_multiple_video_tracks");
          videoIndex=i;
          need("video/avc".equals(type),"original_video_codec_not_h264");
          need(fmt.getInteger(MediaFormat.KEY_WIDTH)==3840&&
               fmt.getInteger(MediaFormat.KEY_HEIGHT)==2160,
               "event_file_not_true_native_4k");
          durationUs=fmt.getLong(MediaFormat.KEY_DURATION);
          need(durationUs>=3_000_000L&&durationUs<=180_000_000L,
               "original_event_duration_outside_bounded_window");
          mime=type;
        }
      }
      need(videoIndex>=0,"missing_video_track");
      extractor.selectTrack(videoIndex);
      ArrayList<Long> positiveSteps=new ArrayList<>();
      while(true){
        need(System.nanoTime()<deadline,"track_pts_deadline");
        long pts=extractor.getSampleTime();
        if(pts<0)break;
        need(extractor.getSampleTrackIndex()==videoIndex,
             "unexpected_non_video_sample");
        need(count<MAX_SAMPLE_COUNT,"too_many_video_samples");
        need(pts>=0&&pts<=durationUs+100_000L,
             "sample_pts_outside_valid_track_duration");
        if(firstPts<0)firstPts=pts;
        if(lastPts>=0){
          long delta=pts-lastPts;
          if(delta<=0)nonmonotonic++;
          else{
            positiveSteps.add(delta);
            if(delta>maxStep)maxStep=delta;
            if(delta>50000L)stepsOver50ms++;
            if(delta>100000L)stepsOver100ms++;
          }
        }
        lastPts=pts;
        count++;
        if(!extractor.advance())break;
      }
      need(count>=90&&positiveSteps.size()>=89&&
           lastPts>firstPts,"insufficient_event_video_samples");
      Collections.sort(positiveSteps);
      medianMs=positiveSteps.get(positiveSteps.size()/2)/1000.0;
      avgFps=(count-1)*1_000_000.0/(lastPts-firstPts);
    }finally{extractor.release();}
    need(Files.size(path)==bytes&&sha(path,deadline).equals(expectedSha),
         "source_sha_revision_changed_after_track");
    need(System.nanoTime()<deadline,"evidence_over_budget");
    boolean timingOk=nonmonotonic==0&&
        avgFps>=29.0&&avgFps<=31.0&&
        medianMs>=30.0&&medianMs<=36.0&&
        stepsOver100ms==0;
    return new JSONObject()
      .put("schema","s9_r761_original_native4k_sample_timing_v1")
      .put("result",timingOk?
            "NATIVE_4K_EVENT_SOURCE_SAMPLE_TIMING_PASS":
            "NATIVE_4K_EVENT_SOURCE_SAMPLE_TIMING_BELOW_TARGET")
      .put("nonce",nonce)
      .put("source_filename_sha256",digest(basename))
      .put("source_sha256_verified_on_s9",expectedSha)
      .put("original_source_bytes",bytes)
      .put("sha_checked_before_and_after_on_phone",true)
      .put("codec",mime)
      .put("resolution_width",3840)
      .put("resolution_height",2160)
      .put("track_count",tracks)
      .put("duration_ms",durationUs/1000.0)
      .put("encoded_video_sample_count",count)
      .put("first_pts_ms",firstPts/1000.0)
      .put("last_pts_ms",lastPts/1000.0)
      .put("median_sample_interval_ms",Math.round(medianMs*1000)/1000.0)
      .put("average_encoded_sample_fps",Math.round(avgFps*1000)/1000.0)
      .put("nonmonotonic_pts",nonmonotonic)
      .put("max_sample_interval_ms",maxStep/1000.0)
      .put("intervals_over_50ms",stepsOver50ms)
      .put("intervals_over_100ms",stepsOver100ms)
      .put("finished_native4k_event_proven",true)
      .put("candidate_model_inference_concurrent_with_original_capture_proven",false)
      .put("photos_or_video_frames_decoded",0)
      .put("identity_or_folder_labels_read",false)
      .put("people_folder_assignments",0)
      .put("camera_settings_modified",false)
      .put("original_video_modified",false);
  }
  public static void main(String[] args)throws Exception{
    need(args.length==5&&"--verified-native4k-original".equals(args[0]),
         "only_source_bound_existing_original_supported");
    JSONObject result=check(args[1],args[2],Long.parseLong(args[3]),args[4]);
    System.out.println("S9_NATIVE4K_EVENT_R761 "+result.toString());
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }
}
