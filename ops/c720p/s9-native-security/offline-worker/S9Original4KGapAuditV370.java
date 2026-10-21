package nl.kalenel.s9offline;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.media.MediaMetadataRetriever;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Bounded, read-only S9+ original-frame YuNet probe for Task 9.
 *
 * This is an UNWIRED standalone Android app_process entrypoint. An external
 * authorized host must check 900 MiB C720P memory, <=34.5 C S9 temperature,
 * recording/4K/SD headroom, zero drops, source lease and both shared locks
 * BEFORE EVERY frame, and must revalidate afterwards. No camera APK/service,
 * original/media, crop, person decisions, queue or catalog are modified.
 *
 * One original 3840x2160 frame per invocation; a coordinator must collect
 * three distinct source-relative offsets under separately checked guards.
 * This process does not claim a complete or admitted three-frame result.
 */
public final class S9Original4KGapAuditV370 {
  private S9Original4KGapAuditV370() {}
  static final String ARCHIVE="/storage/9C33-6BBD/Android/data/"
      +"nl.kalenel.s9security/files/Security4K/";
  static final String MODEL="/storage/9C33-6BBD/S9OfflineModels/"
      +"face_five_point_yunet_2023mar.onnx";
  static final String MODEL_SHA=
      "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
  static final Pattern CLIP=Pattern.compile("motion_[0-9]{13}[.]mp4");
  static final Pattern DIGEST=Pattern.compile("[a-f0-9]{64}");
  static final int FRAME_W=3840, FRAME_H=2160, NET=640;
  static final long MAX_SOURCE_BYTES=800_000_000L;
  static final long MAX_RUN_NS=65_000_000_000L;
  static final int[][] TILES={
      {0,0,3840,2160},
      {0,0,1664,1280},{1088,0,1664,1280},{2176,0,1664,1280},
      {0,880,1664,1280},{1088,880,1664,1280},{2176,880,1664,1280}
  };
  static void need(boolean ok,String reason) {
    if(!ok)throw new IllegalArgumentException(reason);
  }
  static String sha(Path path) throws Exception {
    MessageDigest m=MessageDigest.getInstance("SHA-256");
    try(InputStream in=Files.newInputStream(path)) {
      byte[] bytes=new byte[65536];int n;
      while((n=in.read(bytes))>0)m.update(bytes,0,n);
    }
    StringBuilder result=new StringBuilder(64);
    for(byte b:m.digest())result.append(String.format(Locale.US,"%02x",b&255));
    return result.toString();
  }
  static final class Detection {
    final double[] box;
    final double confidence;
    final double eyeSpan;
    Detection(double[] b,double confidence,double eyeSpan) {
      this.box=b;this.confidence=confidence;this.eyeSpan=eyeSpan;
    }
  }
  static double overlap(double[] a,double[] b) {
    double x0=Math.max(a[0],b[0]),y0=Math.max(a[1],b[1]);
    double x1=Math.min(a[0]+a[2],b[0]+b[2]);
    double y1=Math.min(a[1]+a[3],b[1]+b[3]);
    double both=Math.max(0,x1-x0)*Math.max(0,y1-y0);
    return both/Math.max(1,a[2]*a[3]+b[2]*b[3]-both);
  }
  static float[] bgr(Bitmap bitmap) {
    int n=NET*NET;
    int[] pixels=new int[n];bitmap.getPixels(pixels,0,NET,0,0,NET,NET);
    float[] input=new float[n*3];
    for(int i=0;i<n;i++) {
      int p=pixels[i];
      input[i]=p&255;
      input[n+i]=(p>>>8)&255;
      input[2*n+i]=(p>>>16)&255;
    }
    return input;
  }
  static List<Detection> oneTile(OrtEnvironment env,OrtSession model,
                                 Bitmap frame,int[] tile) throws Exception {
    int x0=tile[0],y0=tile[1],w=tile[2],h=tile[3];
    double scale=Math.min((double)NET/w,(double)NET/h);
    int ww=Math.max(1,Math.min(NET,(int)Math.round(w*scale)));
    int hh=Math.max(1,Math.min(NET,(int)Math.round(h*scale)));
    int px=(NET-ww)/2,py=(NET-hh)/2;
    Bitmap crop=Bitmap.createBitmap(frame,x0,y0,w,h);
    Bitmap reduced=null,padded=null;
    Map<String,Object> heads=new HashMap<>();
    try {
      reduced=Bitmap.createScaledBitmap(crop,ww,hh,true);
      padded=Bitmap.createBitmap(NET,NET,Bitmap.Config.ARGB_8888);
      padded.eraseColor(Color.BLACK);
      new Canvas(padded).drawBitmap(reduced,px,py,null);
      try(OnnxTensor input=OnnxTensor.createTensor(
            env,FloatBuffer.wrap(bgr(padded)),new long[]{1,3,NET,NET});
          OrtSession.Result output=model.run(
            java.util.Collections.singletonMap("input",input))) {
        for(Map.Entry<String,OnnxValue> entry:output) {
          heads.put(entry.getKey(),entry.getValue().getValue());
        }
      }
    } finally {
      if(padded!=null)padded.recycle();
      if(reduced!=null&&reduced!=crop)reduced.recycle();
      if(crop!=frame)crop.recycle();
    }
    need(heads.size()==12,"yunet_model_head_mismatch");
    // The existing strict five-landmark decoder sees a padded 640x640 input;
    // no face alignment or identity vectors are created by this worker.
    List<PhoneYuNetLandmarkDecoder.Face> faces=
        PhoneYuNetLandmarkDecoder.decode(heads,NET,NET);
    List<Detection> result=new ArrayList<>();
    for(PhoneYuNetLandmarkDecoder.Face face:faces) {
      if(face.confidence<.90)continue;
      double[] b=face.nativeBox;
      double sx=(double)w/ww,sy=(double)h/hh;
      double left=x0+(b[0]-px)*sx,top=y0+(b[1]-py)*sy;
      double right=x0+(b[0]+b[2]-px)*sx;
      double bottom=y0+(b[1]+b[3]-py)*sy;
      left=Math.max(0,Math.min(FRAME_W,left));
      top=Math.max(0,Math.min(FRAME_H,top));
      right=Math.max(left,Math.min(FRAME_W,right));
      bottom=Math.max(top,Math.min(FRAME_H,bottom));
      double width=right-left,height=bottom-top;
      double[] lm=face.nativeLandmarks;
      double eye=Math.hypot((lm[0]-lm[2])*sx,(lm[1]-lm[3])*sy);
      if(width>=18&&height>=18&&eye>=8&&Double.isFinite(eye)
          &&Double.isFinite(face.confidence))
        result.add(new Detection(new double[]{left,top,width,height},
                                 face.confidence,eye));
    }
    return result;
  }
  static JSONArray detect(OrtEnvironment env,OrtSession model,
                          Bitmap source,long deadline) throws Exception {
    List<Detection> hits=new ArrayList<>();
    for(int[] tile:TILES) {
      need(System.nanoTime()<deadline,"bounded_phone_inference_deadline");
      hits.addAll(oneTile(env,model,source,tile));
      need(hits.size()<=28,"excessive_yunet_original_frame_candidates");
    }
    hits.sort((a,b)->Double.compare(b.confidence,a.confidence));
    JSONArray selected=new JSONArray();
    List<Detection> unique=new ArrayList<>();
    for(Detection detection:hits) {
      boolean redundant=false;
      for(Detection prior:unique)
        if(overlap(prior.box,detection.box)>=.35)redundant=true;
      if(redundant)continue;
      unique.add(detection);
      if(unique.size()==3)break;
    }
    for(Detection item:unique) {
      JSONArray box=new JSONArray();
      for(double v:item.box)box.put((int)Math.round(v));
      selected.put(new JSONObject()
          .put("native_face_box_xywh",box)
          .put("native_eye_span_px",Math.round(item.eyeSpan*100.)/100.)
          .put("secondary_face_score",Math.round(item.confidence*10000.)/10000.));
    }
    return selected;
  }
  static JSONObject scan(String clip,String sourceHash,long sourceBytes,
                         String mediaRevision,long requestedMs)throws Exception {
    long deadline=System.nanoTime()+MAX_RUN_NS;
    need(CLIP.matcher(clip).matches()&&DIGEST.matcher(sourceHash).matches()
          &&DIGEST.matcher(mediaRevision).matches(),"untrusted_original_request");
    need(sourceBytes>100_000&&sourceBytes<MAX_SOURCE_BYTES,
         "untrusted_original_source_size");
    Path source=Paths.get(ARCHIVE+clip);
    Path root=Paths.get(ARCHIVE);
    Path modelFile=Paths.get(MODEL);
    need(source.toAbsolutePath().normalize().getParent().equals(
         root.toAbsolutePath().normalize()),"original_source_outside_micro_sd");
    need(!Files.isSymbolicLink(source)&&Files.isRegularFile(source)
         &&Files.size(source)==sourceBytes
         &&sha(source).equals(sourceHash),"original_source_digest_changed");
    need(!Files.isSymbolicLink(modelFile)&&Files.isRegularFile(modelFile)
         &&Files.size(modelFile)>100_000&&Files.size(modelFile)<512_000
         &&sha(modelFile).equals(MODEL_SHA),"yunet_model_provenance_invalid");
    MediaMetadataRetriever video=new MediaMetadataRetriever();
    Bitmap frame=null;
    JSONArray candidates;
    long duration;
    try {
      video.setDataSource(source.toString());
      duration=Long.parseLong(
          video.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
      need(duration>=3000&&duration<=300000
           &&requestedMs>=0&&requestedMs<duration,
           "requested_sample_not_within_recording");
      frame=video.getFrameAtTime(requestedMs*1000L,
          MediaMetadataRetriever.OPTION_CLOSEST);
      need(frame!=null&&frame.getWidth()==FRAME_W
           &&frame.getHeight()==FRAME_H,"not_original_3840x2160_decoded_frame");
      need(System.nanoTime()<deadline,"bounded_phone_decode_deadline");
      OrtEnvironment env=OrtEnvironment.getEnvironment("s9-source-4k-v370");
      try(OrtSession.SessionOptions options=new OrtSession.SessionOptions()) {
        options.setIntraOpNumThreads(1);
        options.setInterOpNumThreads(1);
        try(OrtSession session=env.createSession(MODEL,options)) {
          candidates=detect(env,session,frame,deadline);
        }
      }
    } finally {
      if(frame!=null)frame.recycle();
      video.release();
    }
    need(System.nanoTime()<deadline,"bounded_phone_inference_deadline");
    // Source recheck is mandatory. Host must ALSO recheck live catalog,
    // priority, queue, 4K health, thermals and writer model before publishing.
    need(Files.size(source)==sourceBytes&&sha(source).equals(sourceHash),
         "source_revision_changed_after_phone_inference");
    return new JSONObject()
      .put("schema","s9_original4k_phone_frame_probe_v370")
      .put("source","s9_original_4k_microsd")
      .put("clip_no",clip)
      .put("source_sha256",sourceHash)
      .put("source_bytes",sourceBytes)
      .put("source_revision",mediaRevision)
      .put("model_sha256",MODEL_SHA)
      .put("duration_ms",duration)
      .put("sample",new JSONObject()
        .put("time_ms",requestedMs)
        .put("state","decoded")
        .put("original_resolution",new JSONArray().put(FRAME_W).put(FRAME_H))
        .put("face_candidates",candidates))
      .put("frame_requested_not_actual_pts",true)
      .put("one_frame_only",true)
      .put("host_attestation_required",true)
      .put("eligible_to_publish",false)
      .put("human_review_required",true)
      .put("automatic_person_assignments",0)
      .put("originals_modified",false)
      .put("review_decisions_modified",false)
      .put("camera_apk_modified",false);
  }
  public static void main(String[] args)throws Exception {
    need(args.length==6&&"--probe-one-frame".equals(args[0]),
         "usage_probe_one_frame_only");
    String clip=args[1],expectedSha=args[2],revision=args[4];
    long expectedBytes=Long.parseLong(args[3]);
    long offsetMs=Long.parseLong(args[5]);
    JSONObject receipt=scan(clip,expectedSha,expectedBytes,revision,offsetMs);
    System.out.println("S9_ORIGINAL4K_PHONE_FRAME_V370 "+receipt.toString());
    System.out.flush();
    // Android 10 app_process ORT runtime may abort on JNI shutdown after
    // successful output; halt only after flushing this bounded receipt.
    Runtime.getRuntime().halt(0);
  }
}
