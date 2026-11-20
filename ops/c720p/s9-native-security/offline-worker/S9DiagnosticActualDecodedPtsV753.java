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

/**
 * R753. Physically decode exactly one bounded ROI from a SHA-pinned
 * DIAGNOSTIC recording and bind actual decoder output presentationTimeUs
 * to a SHA-256 of its in-memory ARGB pixels.
 *
 * Does not inspect/identify people, create image files, modify originals,
 * read motion clips, or touch camera services. The pixel digest is
 * repeatable output evidence, NOT a human identity/embedding or gallery key.
 * Never use this diagnostic-only proof to attest the older 99 research crops.
 */
public final class S9DiagnosticActualDecodedPtsV753 {
  private S9DiagnosticActualDecodedPtsV753(){}
  static final Path ROOT=Paths.get("/storage/9C33-6BBD/Android/data/"
      +"nl.kalenel.s9security/files/Security4K").toAbsolutePath();
  static final Path ORIGINAL=ROOT.resolve("diagnostic_preroll_1795047726878.mp4");
  static final long SOURCE_BYTES=40366251L;
  static final String SOURCE_SHA256=
      "04975e917bbb0671aef54e94e382141abd0f77fadb221f4122ef5e8bd1da9de2";
  // Bounded small, upright, central sample of the garden scene, not person ROIs.
  static final int X0=1810,Y0=950,X1=1938,Y1=1206;
  static final int ROI_WIDTH=X1-X0,ROI_HEIGHT=Y1-Y0;
  static final long MAX_NS=20_000_000_000L;
  static void need(boolean value,String reason){
    if(!value)throw new IllegalStateException(reason);
  }
  static String digest(byte[] data)throws Exception {
    byte[] sha=MessageDigest.getInstance("SHA-256").digest(data);
    StringBuilder b=new StringBuilder(64);
    for(byte v:sha)b.append(String.format(Locale.US,"%02x",v&255));
    return b.toString();
  }
  static String sourceHash(long deadline)throws Exception {
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    try(InputStream in=Files.newInputStream(ORIGINAL)){
      byte[] bytes=new byte[1<<16];int n;
      while((n=in.read(bytes))>0){
        need(System.nanoTime()<deadline,"source_hash_deadline");
        md.update(bytes,0,n);
      }
    }
    StringBuilder b=new StringBuilder(64);
    for(byte v:md.digest())b.append(String.format(Locale.US,"%02x",v&255));
    return b.toString();
  }
  static String argbDigest(Bitmap bitmap)throws Exception {
    need(bitmap!=null && bitmap.getWidth()==ROI_WIDTH
         &&bitmap.getHeight()==ROI_HEIGHT,"roi_geometry_mismatch");
    int[] pixels=new int[ROI_WIDTH*ROI_HEIGHT];
    bitmap.getPixels(pixels,0,ROI_WIDTH,0,0,ROI_WIDTH,ROI_HEIGHT);
    // Big-endian ARGB8888, deterministic across JVM ABI/endianness.
    ByteBuffer packed=ByteBuffer.allocate(pixels.length*4);
    for(int pixel:pixels)packed.putInt(pixel);
    return digest(packed.array());
  }
  static JSONObject inspect(long requestMs)throws Exception {
    need(requestMs==2000||requestMs==4000,"unsupported_diagnostic_offset");
    long deadline=System.nanoTime()+MAX_NS;
    need(Files.isRegularFile(ORIGINAL,LinkOption.NOFOLLOW_LINKS)
         &&Files.size(ORIGINAL)==SOURCE_BYTES,"source_missing_or_changed");
    need(SOURCE_SHA256.equals(sourceHash(deadline)),
         "source_hash_invalid_before_decode");
    S9Original4KTimedDecoderV410.Frame frame=
        S9Original4KTimedDecoderV410.decodeCrop(
            ORIGINAL,requestMs,deadline,X0,Y0,X1,Y1);
    need(frame.image!=null,"decoder_did_not_return_bitmap");
    String pixelsSha;
    try {
      pixelsSha=argbDigest(frame.image);
    } finally {
      frame.image.recycle();
    }
    need(System.nanoTime()<deadline,"diagnostic_decode_timeout");
    need(SOURCE_SHA256.equals(sourceHash(deadline)),
         "original_changed_after_decoding");
    need(frame.actualPtsUs>=requestMs*1000L-1000L
         &&frame.actualPtsUs<=requestMs*1000L+500_000L,
         "physical_pts_does_not_bind_seek");
    JSONObject out=new JSONObject()
        .put("schema","s9_r753_pinned_diagnostic_actual_decoded_crop_pts_v1")
        .put("result","DIAGNOSTIC_ACTUAL_DECODER_PTS_AND_PIXEL_SHA_VERIFIED")
        .put("source_sha256",SOURCE_SHA256)
        .put("source_bytes",SOURCE_BYTES)
        .put("requested_seek_ms",requestMs)
        .put("physical_output_frame_pts_us",frame.actualPtsUs)
        .put("physical_pts_producer","MEDIACODEC_BUFFERINFO_PRESENTATIONTIMEUS_V410")
        .put("frame_time_not_inferred_from_requested_seek",true)
        .put("roi_x0",X0).put("roi_y0",Y0)
        .put("roi_x1",X1).put("roi_y1",Y1)
        .put("roi_width",ROI_WIDTH).put("roi_height",ROI_HEIGHT)
        .put("argb8888_pixel_sha256",pixelsSha)
        .put("original_source_revision_verified_twice_on_phone",true)
        .put("person_crop_PTS_independently_verified",false)
        .put("source_is_diagnostic_recording_only",true)
        .put("processed_person_recording",false)
        .put("biometric_identity_matching",false)
        .put("camera_service_modified",false)
        .put("source_written",false)
        .put("crop_image_saved",false)
        .put("automatic_person_folder_assignments",0);
    return out;
  }
  public static void main(String[] args)throws Exception {
    need(args.length==2 && "--diagnostic-only".equals(args[0]),
         "diagnostic_only_fixed_offsets");
    long requestMs=Long.parseLong(args[1]);
    JSONObject out=inspect(requestMs);
    System.out.println("S9_DIAGNOSTIC_ACTUAL_PTS_V753 "+out.toString());
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }
}
