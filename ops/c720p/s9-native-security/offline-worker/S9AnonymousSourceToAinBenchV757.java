package nl.kalenel.s9offline;

import android.graphics.Bitmap;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.FloatBuffer;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * R757 owner-authorized, one-shot, anonymous real-video crop + AIN x0.25
 * compatibility and CPU cost experiment, strictly S9 resident.
 *
 * The input is a fixed central scene ROI from a SHA-backed original, NOT a
 * verified person or a People folder. No person labels or embeddings leave
 * the phone. Never compares gallery vectors or auto-files recordings.
 *
 * Original source SHA verified before and after decode. The actual frame
 * PTS is MediaCodec BufferInfo.presentationTimeUs through V410, not the
 * requested seek timestamp. The pixel and normalized synthetic-independent
 * real ROI tensor digests bind exactly what was fed to ONNX. Does not
 * modify the camera, original, any crop, source metadata or other services.
 */
public final class S9AnonymousSourceToAinBenchV757 {
  private S9AnonymousSourceToAinBenchV757(){}
  static final Path MEDIA=Paths.get("/storage/9C33-6BBD/Android/data/"
      +"nl.kalenel.s9security/files/Security4K").toAbsolutePath();
  static final Path MODEL=Paths.get("/data/local/tmp/s9_reid_r740/"
      +"osnet_ain_x0_25_r744.onnx").toAbsolutePath();
  static final String MODEL_SHA=
      "e7adf72649332d97c613be93db17a047e526bf55fc8b7240f14a1da67390b7af";
  static final Path MODEL_X05=Paths.get("/data/local/tmp/s9_reid_r740/"
      +"osnet_ain_x0_5_r744.onnx").toAbsolutePath();
  static final String MODEL_X05_SHA=
      "bc0e6c3819064b2c201716594ca83daad693fb5b8e8c0e4b41b2eeb7ebd99d27";
  static final Pattern CLIP=Pattern.compile("motion_[0-9]{13}[.]mp4");
  static final Pattern SHA=Pattern.compile("[a-f0-9]{64}");
  static final Pattern NONCE=Pattern.compile("[a-f0-9]{32}");
  static final int X0=1810,Y0=950,X1=1938,Y1=1206;
  static final int W=X1-X0,H=Y1-Y0,PLANE=W*H;
  static final long MAX_NS=26_000_000_000L;

  static void need(boolean value,String reason){
    if(!value)throw new IllegalArgumentException(reason);
  }
  static String hex(byte[] bytes){
    StringBuilder b=new StringBuilder(bytes.length*2);
    for(byte v:bytes)b.append(String.format(Locale.US,"%02x",v&255));
    return b.toString();
  }
  static String hash(byte[] raw)throws Exception {
    return hex(MessageDigest.getInstance("SHA-256").digest(raw));
  }
  static String fileHash(Path file,long deadline)throws Exception {
    MessageDigest md=MessageDigest.getInstance("SHA-256");
    try(InputStream in=Files.newInputStream(file)){
      byte[] buffer=new byte[65536];int count;
      while((count=in.read(buffer))>0){
        need(System.nanoTime()<deadline,"file_hash_deadline_exceeded");
        md.update(buffer,0,count);
      }
    }
    return hex(md.digest());
  }
  static byte[] bigEndianInts(int[] arr) {
    ByteBuffer buffer=ByteBuffer.allocate(arr.length*4);
    for(int value:arr)buffer.putInt(value);
    return buffer.array();
  }
  static String floatDigest(float[] data)throws Exception {
    ByteBuffer buffer=ByteBuffer.allocate(data.length*4);
    for(float value:data){
      need(Float.isFinite(value),"nonfinite_input_tensor");
      buffer.putInt(Float.floatToRawIntBits(value));
    }
    return hash(buffer.array());
  }
  static double validNorm(Object output){
    need(output instanceof float[][],"onnx_output_must_be_rank2_float32");
    float[][] rows=(float[][])output;
    need(rows.length==1&&rows[0]!=null&&rows[0].length==512,
         "expected_single_512d_feature");
    double norm2=0;
    for(float x:rows[0]){
      need(Float.isFinite(x),"nonfinite_onnx_output");
      norm2+=(double)x*x;
    }
    double n=Math.sqrt(norm2);
    need(Double.isFinite(n)&&n>0.00001&&n<20000,
         "invalid_onnx_feature_norm");
    return n;
  }

  static JSONObject run(String basename,String sourceSha,long bytes,
                        long requestMs,String nonce,boolean halfModel)
      throws Exception {
    need(CLIP.matcher(basename).matches()&&
         SHA.matcher(sourceSha).matches()&&
         NONCE.matcher(nonce).matches(),
         "invalid_source_and_nonce");
    need(bytes>=35_000_000L&&bytes<=110_000_000L,
         "original_size_outside_bounded_offline_benchmark");
    need(requestMs==2000L,"only_prevalidated_single_frame_offset");
    Path selectedModel=halfModel?MODEL_X05:MODEL;
    String selectedModelSha=halfModel?MODEL_X05_SHA:MODEL_SHA;
    long selectedModelBytes=halfModel?2603447L:900103L;
    need(Files.isRegularFile(selectedModel,LinkOption.NOFOLLOW_LINKS)&&
         Files.size(selectedModel)==selectedModelBytes,
         "pinned_research_model_missing_or_changed");
    long deadline=System.nanoTime()+MAX_NS;
    need(fileHash(selectedModel,deadline).equals(selectedModelSha),
         "research_model_sha256_mismatch");
    Path original=MEDIA.resolve(basename).normalize();
    need(original.getParent().equals(MEDIA)&&
         Files.isRegularFile(original,LinkOption.NOFOLLOW_LINKS)&&
         Files.size(original)==bytes,"original_source_revision_wrong");
    need(fileHash(original,deadline).equals(sourceSha),
         "phone_original_sha256_does_not_match_catalog");
    long decodeStart=System.nanoTime();
    S9Original4KTimedDecoderV410.Frame frame=
        S9Original4KTimedDecoderV410.decodeCrop(
            original,requestMs,deadline,X0,Y0,X1,Y1);
    long decodeNs=System.nanoTime()-decodeStart;
    need(frame.actualPtsUs>=requestMs*1000L-1000L&&
         frame.actualPtsUs<=requestMs*1000L+500000L,
         "physical_output_pts_unbound");
    Bitmap bitmap=frame.image;
    need(bitmap!=null&&bitmap.getWidth()==W&&bitmap.getHeight()==H,
         "untrusted_roi_bitmap");
    int[] argb=new int[PLANE];
    try {
      bitmap.getPixels(argb,0,W,0,0,W,H);
    } finally {bitmap.recycle();}
    String pixelsSha=hash(bigEndianInts(argb));
    long preprocessingStart=System.nanoTime();
    float[] sample=new float[PLANE*3];
    final float[] mean={.485f,.456f,.406f};
    final float[] std={.229f,.224f,.225f};
    for(int i=0;i<PLANE;i++) {
      int pixel=argb[i];
      sample[i]=((((pixel>>>16)&255)/255f)-mean[0])/std[0];
      sample[PLANE+i]=((((pixel>>>8)&255)/255f)-mean[1])/std[1];
      sample[2*PLANE+i]=(((pixel&255)/255f)-mean[2])/std[2];
    }
    String inputSha=floatDigest(sample);
    // This is deterministic content binding, not an identity label or
    // independently signed phone provenance. Source SHA and physical PTS
    // were already verified by this SAME trusted one-shot decoder.
    String sourceToTensorTranscript=
        S9CropSourceProvenanceV768.transcript(
            sourceSha,bytes,frame.actualPtsUs,X0,Y0,X1,Y1,
            pixelsSha,inputSha,selectedModelSha);
    long preprocessNs=System.nanoTime()-preprocessingStart;
    double firstNorm=0,lastNorm=0;
    long[] inferenceNs=new long[2];
    OrtEnvironment env=OrtEnvironment.getEnvironment("s9-r757-anon-single-crop");
    try(OrtSession.SessionOptions opt=new OrtSession.SessionOptions()){
      opt.setIntraOpNumThreads(1);
      opt.setInterOpNumThreads(1);
      try(OrtSession session=env.createSession(selectedModel.toString(),opt)){
        need(session.getInputNames().size()==1&&
             session.getOutputNames().size()==1,
             "unknown_ondevice_onnx_signature");
        String inputName=session.getInputNames().iterator().next();
        long[] in=((TensorInfo)session.getInputInfo().get(inputName).getInfo()).getShape();
        need(in.length==4&&(in[0]==-1||in[0]==1)&&
             in[1]==3&&in[2]==H&&in[3]==W,
             "onnx_input_wrong_shape");
        try(OnnxTensor tensor=OnnxTensor.createTensor(
              env,FloatBuffer.wrap(sample),new long[]{1,3,H,W})){
          for(int i=0;i<2;i++){
            long start=System.nanoTime();
            try(OrtSession.Result result=session.run(
                    Collections.singletonMap(inputName,tensor))){
              need(result.size()==1,"unexpected_onnx_outputs");
              double norm=validNorm(result.get(0).getValue());
              if(i==0)firstNorm=norm;
              else lastNorm=norm;
            }
            inferenceNs[i]=System.nanoTime()-start;
            need(System.nanoTime()<deadline,"model_benchmark_deadline_exceeded");
          }
        }
      }
    }
    need(Math.abs(firstNorm-lastNorm)<0.001,
         "same_image_onnx_repeat_norm_not_deterministic");
    need(Files.size(original)==bytes&&
         fileHash(original,deadline).equals(sourceSha),
         "source_sha_modified_during_benchmark");
    need(System.nanoTime()<deadline,"overall_bounded_runtime_exceeded");
    // Physical source and ONNX execution alone never demonstrate that a
    // center-scene ROI contains an unambiguous single person. Enforce the
    // *negative-only* pre-match boundary on the exact real ROI receipt.
    S9PreMatchEvidenceGateV765.Evidence quality=
        new S9PreMatchEvidenceGateV765.Evidence();
    quality.originalSha=sourceSha;
    quality.originalVersion=null; // No independently approved source-version receipt.
    quality.cropSha=pixelsSha;
    quality.modelSha=selectedModelSha;
    quality.outputDimensions=512;
    quality.frameWidth=3840;
    quality.frameHeight=2160;
    quality.x0=X0;quality.y0=Y0;quality.x1=X1;quality.y1=Y1;
    quality.decodedPtsUs=frame.actualPtsUs;
    quality.requestedSeekUs=requestMs*1000L;
    quality.sourceVerifiedBeforeAndAfterOnS9=true;
    quality.exactPixelRegionBoundToActualPts=true;
    quality.modelInputTensorShaVerifiedOnS9=true;
    quality.strictUprightCropQuality=false; // No independently attested person ROI.
    quality.personsInsideCrop=0; // Not independently established; never assume one.
    quality.singleUnambiguousTrack=false;
    quality.sourceVersionCurrentInLedger=false;
    quality.personDetectorConfidence=Double.NaN;
    S9PreMatchEvidenceGateV765.Verdict gate=
        S9PreMatchEvidenceGateV765.inspect(quality);
    need(!gate.canScoreForIndependentResearch &&
         !gate.canAutomaticallyFilePeople &&
         "ABSTAIN_UNVERIFIED_SOURCE_OR_CROP".equals(gate.status),
         "anonymous_scene_frame_improperly_admitted_to_person_scoring");
    return new JSONObject()
      .put("schema","s9_r757_anonymous_original_to_ain_x025_pipeline")
      .put("status","ANONYMOUS_ORIGINAL_FRAME_TO_ONNX_PIPELINE_PASS")
      .put("nonce",nonce)
      .put("source_basename_sha256",hash(basename.getBytes("UTF-8")))
      .put("original_sha256",sourceSha)
      .put("source_sha_verified_twice_on_phone",true)
      .put("source_bytes",bytes)
      .put("actual_decoder_frame_pts_us",frame.actualPtsUs)
      .put("requested_seek_ms",requestMs)
      .put("image_roi_argb_sha256",pixelsSha)
      .put("normalized_onnx_input_sha256",inputSha)
      .put("physical_source_to_input_transcript_schema",
           S9CropSourceProvenanceV768.SCHEMA)
      .put("physical_source_to_input_transcript_sha256",
           sourceToTensorTranscript)
      .put("source_to_input_transcript_is_signed_attestation",false)
      .put("source_to_input_transcript_contains_identity",false)
      .put("roi_dimensions","128x256")
      .put("roi_anonymous_scene_only",true)
      .put("model_sha256",selectedModelSha)
      .put("osnet_ain_model_variant",halfModel?"x0_5":"x0_25")
      .put("research_model_not_proven_for_person_identity_accuracy",true)
      .put("output_feature_dimensions",512)
      .put("output_feature_norm_only",Math.round(lastNorm*1000.0)/1000.0)
      .put("decode_roi_ms",Math.round(decodeNs/1000000.0*100.0)/100.0)
      .put("rgb_preprocessing_ms",Math.round(preprocessNs/1000000.0*100.0)/100.0)
      .put("onnx_warmup_ms",Math.round(inferenceNs[0]/1000000.0*100.0)/100.0)
      .put("onnx_timed_ms",Math.round(inferenceNs[1]/1000000.0*100.0)/100.0)
      .put("phone_prematch_evidence_status",gate.status)
      .put("phone_prematch_abstention_reason_count",gate.reasons.length)
      .put("phone_prematch_person_scoring_authorized",gate.canScoreForIndependentResearch)
      .put("phone_prematch_automatic_filing_authorized",gate.canAutomaticallyFilePeople)
      .put("people_identity_scoring_performed",false)
      .put("private_vector_values_exported",0)
      .put("real_image_copied_to_hub",false)
      .put("original_or_camera_modified",false)
      .put("existing_person_reference_crop_pts_certified",false)
      .put("automatic_people_folder_assignments",0);
  }
  public static void main(String[] args)throws Exception{
    need(args.length==6&&
         ("--research-anonymous-source".equals(args[0])||
          "--research-anonymous-source-x05".equals(args[0])),
         "standalone_one_source_only");
    boolean halfModel="--research-anonymous-source-x05".equals(args[0]);
    JSONObject result=run(args[1],args[2],
                          Long.parseLong(args[3]),
                          Long.parseLong(args[4]),args[5],halfModel);
    System.out.println("S9_ANON_SOURCE_TO_AIN_V757 "+result.toString());
    System.out.flush();
    Runtime.getRuntime().halt(0);
  }
}
