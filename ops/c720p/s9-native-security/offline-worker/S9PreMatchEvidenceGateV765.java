package nl.kalenel.s9offline;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * R765 negative-only source/crop admission for future phone Re-ID research.
 * This code NEVER performs a similarity comparison, never reads identity
 * labels, and cannot authorize automatic People-folder filing.
 *
 * Attestation booleans here are input declarations, not cryptographic
 * proof on their own. Release stays disabled until an independently
 * trusted S9 crop producer supplies verified actual MediaCodec PTS,
 * SHA-bound original and crop hashes, and independent evaluation labels.
 */
public final class S9PreMatchEvidenceGateV765 {
  private S9PreMatchEvidenceGateV765() {}
  static final String CANDIDATE_MODEL_SHA =
      "e7adf72649332d97c613be93db17a047e526bf55fc8b7240f14a1da67390b7af";
  static final String FULL_SHA="[a-f0-9]{64}";
  public static final class Evidence {
    public String originalSha,originalVersion,cropSha,modelSha;
    public long decodedPtsUs,requestedSeekUs;
    public int frameWidth,frameHeight;
    public int x0,y0,x1,y1;
    public int outputDimensions,personsInsideCrop;
    public boolean sourceVerifiedBeforeAndAfterOnS9;
    public boolean exactPixelRegionBoundToActualPts;
    public boolean modelInputTensorShaVerifiedOnS9;
    public boolean singleUnambiguousTrack;
    public boolean sourceVersionCurrentInLedger;
    public boolean strictUprightCropQuality;
    public double personDetectorConfidence;
  }
  public static final class Verdict {
    public final String status;
    public final String[] reasons;
    public final boolean canScoreForIndependentResearch;
    public final boolean canAutomaticallyFilePeople;
    Verdict(List<String> reasons){
      this.reasons=reasons.toArray(new String[0]);
      this.canScoreForIndependentResearch=reasons.isEmpty();
      this.canAutomaticallyFilePeople=false;
      this.status=reasons.isEmpty()?
          "RESEARCH_SCORING_INPUT_ELIGIBLE_ONLY":
          "ABSTAIN_UNVERIFIED_SOURCE_OR_CROP";
    }
  }
  static boolean sha(String v){
    return v!=null&&v.matches(FULL_SHA);
  }
  public static Verdict inspect(Evidence x) {
    ArrayList<String> fail=new ArrayList<>();
    if(x==null){
      fail.add("missing_evidence");
      return new Verdict(fail);
    }
    if(!sha(x.originalSha)||!sha(x.originalVersion)||
       !sha(x.cropSha))fail.add("source_crop_sha_or_version_missing");
    if(!CANDIDATE_MODEL_SHA.equals(x.modelSha)||
       x.outputDimensions!=512)fail.add("wrong_candidate_model_lineage");
    if(!x.sourceVerifiedBeforeAndAfterOnS9||
       !x.sourceVersionCurrentInLedger)
      fail.add("original_source_sha_version_not_current");
    if(x.decodedPtsUs<0||x.requestedSeekUs<0||
       x.decodedPtsUs<x.requestedSeekUs-1000L||
       x.decodedPtsUs>x.requestedSeekUs+500000L||
       !x.exactPixelRegionBoundToActualPts)
      fail.add("actual_decoder_output_pts_and_pixel_region_unverified");
    if(!x.modelInputTensorShaVerifiedOnS9)
      fail.add("exact_onphone_model_input_not_verified");
    if(x.frameWidth!=3840||x.frameHeight!=2160 ||
       x.x0<0||x.y0<0||x.x1<=x.x0||x.y1<=x.y0||
       x.x1>3840||x.y1>2160)
      fail.add("invalid_original_4k_crop_coordinates");
    else{
      int w=x.x1-x.x0,h=x.y1-x.y0;
      double hToW=(double)h/w;
      if(w<64||h<120||hToW<1.25||hToW>3.6||
         (long)w*h>262144L)
        fail.add("crop_outside_strict_upright_geometry");
    }
    if(!x.strictUprightCropQuality||x.personsInsideCrop!=1||
       !x.singleUnambiguousTrack||
       !Double.isFinite(x.personDetectorConfidence)||
       x.personDetectorConfidence<0.80 ||
       x.personDetectorConfidence>1.0)
      fail.add("single_person_and_detector_quality_not_independently_proven");
    return new Verdict(fail);
  }
  static Evidence syntheticGood(){
    Evidence x=new Evidence();
    x.originalSha=repeat('a');x.originalVersion=repeat('b');
    x.cropSha=repeat('c');x.modelSha=CANDIDATE_MODEL_SHA;
    x.outputDimensions=512;
    x.frameWidth=3840;x.frameHeight=2160;
    x.x0=1800;x.y0=900;x.x1=1928;x.y1=1156;
    x.decodedPtsUs=2009033L;x.requestedSeekUs=2000000L;
    x.sourceVerifiedBeforeAndAfterOnS9=true;
    x.exactPixelRegionBoundToActualPts=true;
    x.modelInputTensorShaVerifiedOnS9=true;
    x.singleUnambiguousTrack=true;
    x.sourceVersionCurrentInLedger=true;
    x.strictUprightCropQuality=true;
    x.personsInsideCrop=1;x.personDetectorConfidence=0.93;
    return x;
  }
  static String repeat(char c){
    char[] s=new char[64];java.util.Arrays.fill(s,c);
    return new String(s);
  }
  static void require(boolean x,String message){
    if(!x)throw new IllegalStateException(message);
  }
  public static void main(String[] args) {
    require(args.length==1&&"--self-test".equals(args[0]),
            "only_synthetic_self_test_supported");
    Evidence good=syntheticGood();
    Verdict pass=inspect(good);
    require(pass.canScoreForIndependentResearch &&
            !pass.canAutomaticallyFilePeople,"research_scope_violation");
    int checks=0;
    java.util.function.BiConsumer<Evidence,String> fail=(v,reason)->{
      Verdict result=inspect(v);
      require(!result.canScoreForIndependentResearch &&
              !result.canAutomaticallyFilePeople,
              "bad_evidence_accepted:"+reason);
      require(java.util.Arrays.asList(result.reasons).contains(reason),
              "wrong_refusal_reason:"+reason);
    };
    Evidence x;
    x=syntheticGood();x.modelSha=repeat('d');
    fail.accept(x,"wrong_candidate_model_lineage");checks++;
    x=syntheticGood();x.outputDimensions=256;
    fail.accept(x,"wrong_candidate_model_lineage");checks++;
    x=syntheticGood();x.sourceVerifiedBeforeAndAfterOnS9=false;
    fail.accept(x,"original_source_sha_version_not_current");checks++;
    x=syntheticGood();x.sourceVersionCurrentInLedger=false;
    fail.accept(x,"original_source_sha_version_not_current");checks++;
    x=syntheticGood();x.decodedPtsUs=-1;
    fail.accept(x,"actual_decoder_output_pts_and_pixel_region_unverified");checks++;
    x=syntheticGood();x.decodedPtsUs=3000000L;
    fail.accept(x,"actual_decoder_output_pts_and_pixel_region_unverified");checks++;
    x=syntheticGood();x.exactPixelRegionBoundToActualPts=false;
    fail.accept(x,"actual_decoder_output_pts_and_pixel_region_unverified");checks++;
    x=syntheticGood();x.modelInputTensorShaVerifiedOnS9=false;
    fail.accept(x,"exact_onphone_model_input_not_verified");checks++;
    x=syntheticGood();x.x1=4200;
    fail.accept(x,"invalid_original_4k_crop_coordinates");checks++;
    x=syntheticGood();x.x1=2440;
    fail.accept(x,"crop_outside_strict_upright_geometry");checks++;
    x=syntheticGood();x.personsInsideCrop=2;
    fail.accept(x,"single_person_and_detector_quality_not_independently_proven");checks++;
    x=syntheticGood();x.personDetectorConfidence=0.5;
    fail.accept(x,"single_person_and_detector_quality_not_independently_proven");checks++;
    x=syntheticGood();x.originalSha="invalid";
    fail.accept(x,"source_crop_sha_or_version_missing");checks++;
    x=syntheticGood();x.singleUnambiguousTrack=false;
    fail.accept(x,"single_person_and_detector_quality_not_independently_proven");checks++;
    fail.accept(null,"missing_evidence");checks++;
    System.out.println("R765_PHONE_PREMATCH_EVIDENCE_SYNTHETIC_PASS "+
        "refusals="+checks+" auto_people_filing=false identity_scores=0");
  }
}
