package nl.kalenel.s9offline;

import android.graphics.Bitmap;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * R755: One-shot, source-SHA-bound, ANONYMOUS actual-decoded PTS test on
 * one existing owner-authorized motion original. No identity inference,
 * no person detection, no named People folder, no matching or reference
 * approval, no image writes and no changes to the camera APK.
 *
 * The ROI is a fixed, tiny CENTER SCENE REGION, not a person detector
 * or an existing owner-verified reference crop. It is kept in memory
 * and deleted when this app_process exits.
 *
 * Calls the previously validated V410 ROI-only decoder; the PTS comes
 * from MediaCodec.BufferInfo.presentationTimeUs, NOT requested seek time.
 * This proves method portability to original media but does NOT
 * retrospectively attest any other crop, nor enable auto filing.
 */
public final class S9OriginalAnonymousPtsV755 {
  private S9OriginalAnonymousPtsV755(){}
  static final Path ROOT=Paths.get("/storage/9C33-6BBD/Android/data/"
      +"nl.kalenel.s9security/files/Security4K").toAbsolutePath();
  static final Pattern CLIP=Pattern.compile("motion_[0-9]{13}[.]mp4");
  static final Pattern SHA=Pattern.compile("[a-f0-9]{64}");
  static final Pattern NONCE=Pattern.compile("[a-f0-9]{32}");
  static final int X0=1810,Y0=950,X1=1938,Y1=1206;
  static final int ROI_W=X1-X0,ROI_H=Y1-Y0;
  static final long LIMIT_NS=23_000_000_000L;
  static void need(boolean ok,String reason){
    if(!ok)throw new IllegalArgumentException(reason);
  }
  static String hex(byte[] data){
    StringBuilder b=new StringBuilder(data.length*2);
    for(byte v:data)b.append(String.format(Locale.US,"%02x",v&255));
    return b.toString();
  }
  static String sha256(byte[] data)throws Exception{
    return hex(MessageDigest.getInstance("SHA-256").digest(data));
  }
  static String fileSha(Path source,long deadline)throws Exception {
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    try(InputStream in=Files.newInputStream(source)){
      byte[] buffer=new byte[1<<16];int len;
      while((len=in.read(buffer))>0){
        need(System.nanoTime()<deadline,"original_sha_deadline");
        md.update(buffer,0,len);
      }
    }
    return hex(md.digest());
  }
  static String imageHash(Bitmap bmp)throws Exception {
    need(bmp!=null&&bmp.getWidth()==ROI_W&&bmp.getHeight()==ROI_H,
         "decoded_roi_not_expected_center_sample");
    int[] argb=new int[ROI_W*ROI_H];
    bmp.getPixels(argb,0,ROI_W,0,0,ROI_W,ROI_H);
    ByteBuffer bytes=ByteBuffer.allocate(argb.length*4);
    for(int pixel:argb)bytes.putInt(pixel);
    return sha256(bytes.array());
  }
  static JSONObject inspect(String basename,String sourceSha,long expectedBytes,
                            long requestMs,String nonce)throws Exception {
    need(CLIP.matcher(basename).matches()&&
         SHA.matcher(sourceSha).matches()&&NONCE.matcher(nonce).matches(),
         "invalid_original_source_identity_or_nonce");
    need(expectedBytes>=10_000_000L&&expectedBytes<=220_000_000L,
         "source_size_outside_single-original_safe_bound");
    need(requestMs>=1200&&requestMs<=20000,"seek_offset_outside_safe_bound");
    Path source=ROOT.resolve(basename).normalize();
    need(source.getParent().equals(ROOT)&&
         Files.isRegularFile(source,LinkOption.NOFOLLOW_LINKS),
         "source_not_regular_original_in_sd_archive");
    long deadline=System.nanoTime()+LIMIT_NS;
    need(Files.size(source)==expectedBytes,"original_size_revision_changed");
    need(fileSha(source,deadline).equals(sourceSha),
         "original_sha_mismatch_at_phone_precondition");
    S9Original4KTimedDecoderV410.Frame frame=
        S9Original4KTimedDecoderV410.decodeCrop(
            source,requestMs,deadline,X0,Y0,X1,Y1);
    need(frame.image!=null,"no_physical_output_frame");
    String roiSha;
    try {
      roiSha=imageHash(frame.image);
    } finally {frame.image.recycle();}
    need(System.nanoTime()<deadline,"single_source_timeout");
    need(Files.size(source)==expectedBytes&&
         fileSha(source,deadline).equals(sourceSha),
         "original_sha_mismatch_after_frame_decode");
    need(frame.actualPtsUs>=requestMs*1000L-1000L&&
         frame.actualPtsUs<=requestMs*1000L+500_000L,
         "decoded_frame_outside_requested_window");
    return new JSONObject()
      .put("schema","s9_r755_anonymous_original_frame_pts_evidence_v1")
      .put("status","ONE_ORIGINAL_REAL_MEDIA_PHYSICAL_PTS_ROI_HASH_VERIFIED")
      .put("nonce",nonce)
      .put("original_basename_sha256",sha256(basename.getBytes("UTF-8")))
      .put("original_sha256",sourceSha)
      .put("original_size_bytes",expectedBytes)
      .put("original_sha_verified_before_after_on_s9",true)
      .put("requested_seek_ms",requestMs)
      .put("physical_output_frame_pts_us",frame.actualPtsUs)
      .put("physical_pts_from_decoder_bufferinfo",true)
      .put("roi_pixel_sha256_on_s9",roiSha)
      .put("roi_x0",X0).put("roi_y0",Y0)
      .put("roi_x1",X1).put("roi_y1",Y1)
      .put("roi_is_anonymous_center_scene_sample",true)
      .put("roi_image_file_created",false)
      .put("owner_verified_person_crop_pts_attested",false)
      .put("person_identity_or_folder_label_read",false)
      .put("biometric_similarity_computed",false)
      .put("camera_apk_modified",false)
      .put("original_media_modified",false)
      .put("automatic_people_folder_assignments",0);
  }
  public static void main(String[] args)throws Exception {
    need(args.length==6&&"--one-verified-original".equals(args[0]),
         "research_one_original_only");
    String clip=args[1],sha=args[2],nonce=args[5];
    long bytes=Long.parseLong(args[3]),offsetMs=Long.parseLong(args[4]);
    JSONObject result=inspect(clip,sha,bytes,offsetMs,nonce);
    System.out.println("S9_ORIGINAL_ANON_PTS_R755 "+result.toString());
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }
}
