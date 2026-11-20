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

/**
 * R751: S9+ read-only MP4 PTS integrity on ONE known diagnostic 4K recording.
 *
 * No decoding, thumbnails, cropped pixels, classification, identities,
 * People-folders, face recognition, service controls, scheduling or writes.
 * The input path is a pinned owner-created DIAGNOSTIC file, not a motion
 * person recording. Only sample metadata, track format and SHA are read.
 * Source-level MP4 PTS verification cannot attest any existing crop PTS.
 */
public final class S9DiagnosticPtsInspectorV751 {
  static final Path ROOT=Paths.get("/storage/9C33-6BBD/Android/data/"
      +"nl.kalenel.s9security/files/Security4K").toAbsolutePath();
  static final Path SOURCE=ROOT.resolve("diagnostic_preroll_1795047726878.mp4");
  static final long EXPECTED_SIZE=40366251L;
  static final String EXPECTED_SHA=
      "04975e917bbb0671aef54e94e382141abd0f77fadb221f4122ef5e8bd1da9de2";
  static final int WIDTH=3840,HEIGHT=2160;
  static final long MAX_SAMPLE_COUNT=2000,MAX_INSPECTION_NS=20_000_000_000L;
  static void require(boolean ok,String reason){
    if(!ok)throw new IllegalStateException(reason);
  }
  static String sha256(Path p,long deadline)throws Exception {
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    try(InputStream in=Files.newInputStream(p)){
      byte[] buf=new byte[1<<16];int n;
      while((n=in.read(buf))>0){
        require(System.nanoTime()<deadline,"sha_deadline_exceeded");
        md.update(buf,0,n);
      }
    }
    StringBuilder b=new StringBuilder();
    for(byte x:md.digest())b.append(String.format(Locale.US,"%02x",x&255));
    return b.toString();
  }
  static JSONObject inspect()throws Exception {
    long deadline=System.nanoTime()+MAX_INSPECTION_NS;
    require(Files.isRegularFile(SOURCE,LinkOption.NOFOLLOW_LINKS),
        "pinned_diagnostic_source_missing");
    require(Files.size(SOURCE)==EXPECTED_SIZE,"source_size_revision_mismatch");
    require(sha256(SOURCE,deadline).equals(EXPECTED_SHA),
        "source_SHA256_revision_mismatch");
    MediaExtractor extractor=new MediaExtractor();
    try {
      require(System.nanoTime()<deadline,"no_capture_priority_headroom");
      extractor.setDataSource(SOURCE.toString());
      int videoIndex=-1;
      MediaFormat video=null;
      for(int i=0;i<extractor.getTrackCount();i++){
        MediaFormat format=extractor.getTrackFormat(i);
        String mime=format.getString(MediaFormat.KEY_MIME);
        if(mime!=null&&mime.startsWith("video/")){
          require(videoIndex<0,"multiple_video_tracks_unsupported");
          videoIndex=i;
          video=format;
        }
      }
      require(videoIndex>=0&&video!=null,"no_mp4_video_track");
      require("video/avc".equals(video.getString(MediaFormat.KEY_MIME)),
          "unexpected_codec_not_H264");
      require(video.getInteger(MediaFormat.KEY_WIDTH)==WIDTH&&
              video.getInteger(MediaFormat.KEY_HEIGHT)==HEIGHT,
          "diagnostic_not_native_4k");
      long duration=video.getLong(MediaFormat.KEY_DURATION);
      require(duration>=4_000_000L&&duration<=120_000_000L,
              "implausible_diagnostic_duration");
      extractor.selectTrack(videoIndex);
      long first=-1,last=-1,count=0,nonmonotonic=0,intervalsOver50ms=0;
      ArrayList<Long> intervals=new ArrayList<>();
      while(true){
        require(System.nanoTime()<deadline,"extractor_inspection_deadline");
        long pts=extractor.getSampleTime();
        if(pts<0)break;
        require(extractor.getSampleTrackIndex()==videoIndex,
                "unexpected_nonvideo_selected_sample");
        require(count<MAX_SAMPLE_COUNT,"excessive_video_sample_count");
        require(pts>=0&&pts<=duration+100_000L,
                "sample_pts_outside_diagnostic_duration");
        if(first<0)first=pts;
        if(last>=0){
          long delta=pts-last;
          if(delta<=0)nonmonotonic++;
          else {
            intervals.add(delta);
            if(delta>50_000L)intervalsOver50ms++;
          }
        }
        last=pts;
        count++;
        if(!extractor.advance())break;
      }
      require(count>=100&&intervals.size()>=99,
          "not_enough_video_timestamps");
      Collections.sort(intervals);
      double medianMs=intervals.get(intervals.size()/2)/1000.0;
      double averageFps=(count-1)*1_000_000.0/(last-first);
      boolean verified=nonmonotonic==0&&first>=0&&
          medianMs>=27.0&&medianMs<=40.0&&
          averageFps>=24.0&&averageFps<=31.0;
      return new JSONObject()
          .put("schema","s9_diagnostic_mp4_source_pts_v751")
          .put("result",verified?"SOURCE_PTS_TRACK_VERIFIED":"SOURCE_PTS_TRACK_NOT_VERIFIED")
          .put("source_category","existing_diagnostic_only")
          .put("sha256_checked_on_phone",true)
          .put("source_size_bytes",EXPECTED_SIZE)
          .put("codec","H264")
          .put("width",WIDTH).put("height",HEIGHT)
          .put("media_duration_ms",duration/1000L)
          .put("video_samples",count)
          .put("first_video_pts_ms",first/1000.0)
          .put("last_video_pts_ms",last/1000.0)
          .put("median_video_pts_step_ms",Math.round(medianMs*100.0)/100.0)
          .put("average_sample_fps",Math.round(averageFps*1000.0)/1000.0)
          .put("nonmonotonic_video_pts_count",nonmonotonic)
          .put("positive_video_intervals_over_50ms",intervalsOver50ms)
          .put("independent_person_crop_frame_pts_attested",false)
          .put("actual_person_clip_processed",false)
          .put("images_decoded",0)
          .put("identity_data_read",false)
          .put("camera_configuration_modified",false)
          .put("people_folder_assignments",0);
    } finally {
      extractor.release();
    }
  }
  public static void main(String[] args)throws Exception {
    require(args.length==1&&"--inspect-pinned-diagnostic".equals(args[0]),
        "Only pinned diagnostic metadata inspection is allowed");
    JSONObject result=inspect();
    System.out.println("S9_DIAGNOSTIC_PTS_V751 "+result.toString());
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }
}
