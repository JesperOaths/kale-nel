package nl.kalenel.s9offline;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * R768: versioned, deterministic transcript binding an on-S9 decoded
 * original's exact physical output PTS, 4K crop ROI, pixel SHA, normalized
 * input tensor SHA and pinned model SHA to the owner's original-file SHA.
 *
 * This is a content-commitment, NOT a signed independent attestation and
 * not a source-to-person-identity label. The trusted caller must itself
 * verify MediaCodec output PTS and original bytes on S9; an untrusted JSON
 * or boolean alone is NOT adequate. No person embeddings or labels.
 */
public final class S9CropSourceProvenanceV768 {
  private S9CropSourceProvenanceV768(){}
  public static final String SCHEMA="s9_physical_decoder_roi_onnx_input_transcript_v1";
  static final Pattern HASH=Pattern.compile("[a-f0-9]{64}");

  static void require(boolean ok,String reason) {
    if(!ok)throw new IllegalArgumentException(reason);
  }
  static boolean sha(String value) {
    return value!=null&&HASH.matcher(value).matches();
  }
  public static String transcript(String originalSha,long originalBytes,
      long actualPtsUs,int x0,int y0,int x1,int y1,
      String pixelSha,String normalizedInputSha,String modelSha) {
    require(sha(originalSha)&&sha(pixelSha)&&sha(normalizedInputSha)
        &&sha(modelSha),"source_or_crop_sha256_not_bound");
    require(originalBytes>=10_000_000L&&originalBytes<=240_000_000L,
        "untrusted_original_file_size");
    require(actualPtsUs>=0&&actualPtsUs<=300_000_000L,
        "physical_decoder_pts_outside_bound");
    require(x0>=0&&y0>=0&&x1>x0&&y1>y0&&
        x1<=3840&&y1<=2160,"roi_not_within_original_4k");
    int w=x1-x0,h=y1-y0;
    require(w>=64&&h>=120&&w*h<=262144&&
        (double)h/w>=1.25&& (double)h/w<=3.6,
        "cropping_roi_shape_invalid");
    String canonical=SCHEMA+"\n"
        +"source-original-sha256="+originalSha+"\n"
        +"source-original-bytes="+originalBytes+"\n"
        +"decoded-output-pts-us="+actualPtsUs+"\n"
        +"frame-width=3840\nframe-height=2160\n"
        +"roi-original-xyxy="+x0+","+y0+","+x1+","+y1+"\n"
        +"original-argb8888-ordered-pixels-sha256="+pixelSha+"\n"
        +"exact-nchw-normalized-model-input-sha256="+normalizedInputSha+"\n"
        +"pinned-onnx-model-sha256="+modelSha+"\n"
        +"no-identity-label=true\n";
    try {
      byte[] digest=MessageDigest.getInstance("SHA-256")
          .digest(canonical.getBytes(StandardCharsets.US_ASCII));
      StringBuilder b=new StringBuilder(64);
      for(byte v:digest)b.append(String.format(Locale.US,"%02x",v&255));
      return b.toString();
    }catch(Exception e){throw new IllegalStateException("sha256_unavailable",e);}
  }
  static String repeat(char c) {
    char[] x=new char[64];
    java.util.Arrays.fill(x,c);
    return new String(x);
  }
  static String synthetic(String source,long bytes,long pts,int x0,
                          String pixel,String input,String model) {
    return transcript(source,bytes,pts,x0,950,x0+128,1206,
                      pixel,input,model);
  }
  public static void main(String[] args) {
    require(args.length==1&&"--self-test".equals(args[0]),
            "synthetic_only_standalone_contract");
    String a=repeat('a'),b=repeat('b'),c=repeat('c'),d=repeat('d');
    String proof=synthetic(a,40_358_988L,2_009_033L,1810,b,c,d);
    require(sha(proof),"missing_sha_transcript");
    require(proof.equals(synthetic(a,40_358_988L,2_009_033L,1810,b,c,d)),
            "same_physical_frame_cannot_reproduce");
    int differences=0;
    for(String other:new String[]{
        synthetic(b,40_358_988L,2_009_033L,1810,b,c,d),
        synthetic(a,40_358_989L,2_009_033L,1810,b,c,d),
        synthetic(a,40_358_988L,2_042_355L,1810,b,c,d),
        synthetic(a,40_358_988L,2_009_033L,1812,b,c,d),
        synthetic(a,40_358_988L,2_009_033L,1810,a,c,d),
        synthetic(a,40_358_988L,2_009_033L,1810,b,a,d),
        synthetic(a,40_358_988L,2_009_033L,1810,b,c,a)
    }){
      require(!proof.equals(other),"changed_frame_input_or_model_not_separated");
      differences++;
    }
    int refusals=0;
    for(int i=0;i<5;i++){
      try{
        switch(i){
          case 0:transcript("n/a",40_358_988L,2_009_033L,1810,950,1938,1206,b,c,d);break;
          case 1:transcript(a,-1L,2_009_033L,1810,950,1938,1206,b,c,d);break;
          case 2:transcript(a,40_358_988L,-1L,1810,950,1938,1206,b,c,d);break;
          case 3:transcript(a,40_358_988L,2_009_033L,3800,950,3930,1206,b,c,d);break;
          default:transcript(a,40_358_988L,2_009_033L,1810,950,1938,1206,b,"missing",d);
        }
        throw new IllegalStateException("invalid_proof_accepted:"+i);
      }catch(IllegalArgumentException expected){refusals++;}
    }
    System.out.println("R768_PHYSICAL_CROP_TRANSCRIPT_SYNTHETIC_PASS"+
        " changed_input_proofs="+differences+
        " invalid_proofs_refused="+refusals+
        " identity_labels=0 automatic_people_filing=false");
  }
}
