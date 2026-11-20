package nl.kalenel.s9offline;

import android.media.MediaExtractor;
import android.media.MediaFormat;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.InputStream;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Pattern;

/**
 * R772 read-only on-device MediaExtractor timing of the independent H264
 * preroll companion. Never decodes a frame, never reads biometric/person
 * labels, never modifies a source, never restarts Camera2, and never
 * asserts that a low-resolution preroll has the same geometry/cadence
 * as the full native-4K MediaRecorder event.
 *
 * This is physical file evidence only, NOT simultaneous model/4K proof.
 */
public final class S9PreRollCompanionTimingV772 {
  private S9PreRollCompanionTimingV772(){}
  static final Path ROOT=Paths.get("/storage/9C33-6BBD/Android/data/"
      +"nl.kalenel.s9security/files/Security4K").toAbsolutePath();
  static final Pattern CLIP=Pattern.compile("motion_[0-9]{13}[.]mp4[.]preroll[.]mp4");
  static final Pattern NONCE=Pattern.compile("[0-9a-f]{32}");
  static final long MAX_NS=13_000_000_000L;
  static void need(boolean x,String why){if(!x)throw new IllegalArgumentException(why);}
  static String digest(Path f,long deadline)throws Exception {
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    try(InputStream s=Files.newInputStream(f)){
      byte[] b=new byte[32768];int n;
      while((n=s.read(b))>=0){
        need(System.nanoTime()<deadline,"bounded_preroll_hash_deadline");
        if(n>0)md.update(b,0,n);
      }
    }
    StringBuilder out=new StringBuilder(64);
    for(byte b:md.digest())out.append(String.format(Locale.US,"%02x",b&255));
    return out.toString();
  }
  static JSONObject check(String clip,String nonce)throws Exception {
    need(CLIP.matcher(clip).matches()&&NONCE.matcher(nonce).matches(),
         "preroll_original_basename_or_nonce_invalid");
    Path source=ROOT.resolve(clip).normalize();
    need(source.getParent().equals(ROOT)&&
         Files.isRegularFile(source,LinkOption.NOFOLLOW_LINKS),
         "untrusted_preroll_source_file");
    long length=Files.size(source),deadline=System.nanoTime()+MAX_NS;
    need(length>=60_000&&length<=10_000_000,
         "preroll_companion_not_bounded_small_video");
    String before=digest(source,deadline);
    MediaExtractor m=new MediaExtractor();
    long first=-1,prev=-1,last=-1,maxGap=0,maxIndex=-1,nonmono=0;
    long firstGap=0,gt50=0,gt100=0,count=0;
    int width=0,height=0,tracks=0,vi=-1;
    String mime="";
    long durationUs=0;
    JSONArray firstEight=new JSONArray(),flags=new JSONArray();
    ArrayList<Long> steps=new ArrayList<>();
    try {
      m.setDataSource(source.toString());
      tracks=m.getTrackCount();
      need(tracks>=1&&tracks<=4,"unexpected_track_count");
      for(int t=0;t<tracks;t++){
        MediaFormat fmt=m.getTrackFormat(t);
        String type=fmt.getString(MediaFormat.KEY_MIME);
        if(type!=null&&type.startsWith("video/")){
          need(vi<0,"multiple_preroll_video_tracks");
          vi=t;mime=type;
          width=fmt.getInteger(MediaFormat.KEY_WIDTH);
          height=fmt.getInteger(MediaFormat.KEY_HEIGHT);
          durationUs=fmt.getLong(MediaFormat.KEY_DURATION);
        }
      }
      need(vi>=0&&"video/avc".equals(mime)&&width>=128&&height>=96&&
           width<=3840&&height<=2160&&durationUs>=1_000_000&&
           durationUs<=30_000_000,"untrusted_video_format_or_duration");
      m.selectTrack(vi);
      while(true){
        need(System.nanoTime()<deadline,"preroll_pts_deadline");
        long pts=m.getSampleTime();
        if(pts<0)break;
        need(count<3000&&pts>=0&&pts<=durationUs+100_000,
             "unreasonable_frame_pts_or_count");
        need(m.getSampleTrackIndex()==vi,"foreign_audio_track_in_video");
        if(count<8){firstEight.put(pts);flags.put(m.getSampleFlags());}
        if(first<0)first=pts;
        if(prev>=0){
          long gap=pts-prev;
          if(count==1)firstGap=gap;
          if(gap<=0)nonmono++;
          else{
            steps.add(gap);
            if(gap>maxGap){maxGap=gap;maxIndex=count-1;}
            if(gap>50_000)gt50++;
            if(gap>100_000)gt100++;
          }
        }
        prev=pts;last=pts;count++;
        if(!m.advance())break;
      }
      need(count>=12&&steps.size()>10&&last>first,
           "preroll_samples_underpowered");
    } finally {m.release();}
    need(Files.size(source)==length&&digest(source,deadline).equals(before),
         "preroll_source_changed_during_read");
    Collections.sort(steps);
    double avg=(count-1)*1_000_000.0/(last-first);
    double medianGap=steps.get(steps.size()/2)/1000.0;
    return new JSONObject()
      .put("schema","s9_r772_preroll_companion_onphone_encoded_pts_v1")
      .put("result","READ_ONLY_ENCODED_PREROLL_INSPECTED")
      .put("nonce",nonce)
      .put("preroll_sha256_verified_before_after_on_s9",before)
      .put("preroll_source_bytes",length)
      .put("mime",mime).put("width",width).put("height",height)
      .put("duration_ms",durationUs/1000.0)
      .put("video_samples",count)
      .put("average_sample_fps",Math.round(avg*1000)/1000.0)
      .put("median_interval_ms",Math.round(medianGap*1000)/1000.0)
      .put("first_gap_ms",firstGap/1000.0)
      .put("largest_interval_ms",maxGap/1000.0)
      .put("largest_interval_sample_index",maxIndex)
      .put("gaps_over_50ms",gt50)
      .put("gaps_over_100ms",gt100)
      .put("nonmonotonic_pts_count",nonmono)
      .put("first_eight_pts_us",firstEight)
      .put("first_eight_sample_flags",flags)
      .put("original_4k_event_was_captured_under_model_load_proven",false)
      .put("preroll_and_native_4k_event_have_same_encoding_path_proven",false)
      .put("decoded_frames",0)
      .put("person_identity_labels_read",0)
      .put("people_folders_modified",false)
      .put("source_videos_modified",false)
      .put("camera_configuration_modified",false);
  }
  public static void main(String[] args)throws Exception {
    need(args.length==3&&"--read-preroll-timestamps".equals(args[0]),
         "only_bounded_read_only_preroll_inspection_allowed");
    JSONObject out=check(args[1],args[2]);
    System.out.println("S9_PREROLL_TIMING_R772 "+out);
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }
}
