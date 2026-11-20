package nl.kalenel.s9offline;

import java.util.Arrays;
import java.util.Locale;

/** R793: prove rank-only RRF cannot be a valid open-set acceptance score.
 *
 * Synthetic-only 512D. Uses the R790 mathematical implementation.
 * No real person data, gallery, face image, source video or thresholds.
 *
 * Known and orthogonal unknown queries each have a first ranked candidate
 * in BOTH ranking systems, so both get MAX RRF of 2/(60+1), despite very
 * different absolute CSLS and template z evidence.
 *
 * A candidate is only eligible for future open-set assessment if BOTH
 * absolute score families exceed their separately independently-calibrated
 * unknown-source thresholds AND a stable candidate wins rank fusion.
 * Until such calibration exists, NONE of the methods can auto-file people.
 */
public final class S9SyntheticRankFusionUnknownGuardV793 {
  private S9SyntheticRankFusionUnknownGuardV793(){}
  static void need(boolean ok,String why){
    if(!ok)throw new IllegalArgumentException(why);
  }
  static double max(double[] a){
    double v=-Double.MAX_VALUE;
    for(double x:a){need(Double.isFinite(x),"nonfinite_fusion");v=Math.max(v,x);}
    return v;
  }
  static int first(double[] scores){
    return S9SyntheticHubnessCalibrationV790.rank(scores)[0];
  }
  static boolean gate(double[] fused,double[] csls,double[] z,
                      Double thresholdCsls,Double thresholdZ){
    // Null calibration is an explicit abstention; none of these are
    // allowed to use raw cosine thresholds or final-test scores.
    if(thresholdCsls==null||thresholdZ==null)return false;
    need(Double.isFinite(thresholdCsls)&&Double.isFinite(thresholdZ),
         "untrusted_calibration_threshold");
    int candidate=first(fused);
    return csls[candidate]>thresholdCsls &&
           z[candidate]>thresholdZ;
  }
  static void run(){
    float[][] ref=S9SyntheticHubnessCalibrationV790.references();
    float[][] cohort=S9SyntheticHubnessCalibrationV790.background();
    float[] syntheticKnown=S9SyntheticHubnessCalibrationV790.axis(1);
    float[] syntheticUnknown=S9SyntheticHubnessCalibrationV790.axis(255);
    double[] knownCsls=S9SyntheticHubnessCalibrationV790.csls(
        syntheticKnown,ref,cohort);
    double[] unknownCsls=S9SyntheticHubnessCalibrationV790.csls(
        syntheticUnknown,ref,cohort);
    double[] knownZ=S9SyntheticHubnessCalibrationV790.templateZ(
        syntheticKnown,ref,cohort);
    double[] unknownZ=S9SyntheticHubnessCalibrationV790.templateZ(
        syntheticUnknown,ref,cohort);
    double[] knownFused=S9SyntheticHubnessCalibrationV790.rrf(
        knownCsls,knownZ);
    double[] unknownFused=S9SyntheticHubnessCalibrationV790.rrf(
        unknownCsls,unknownZ);
    int knownIndex=first(knownFused),unknownIndex=first(unknownFused);
    need(knownIndex==1,"synthetic_known_not_expected_reference");
    need(unknownIndex!=knownIndex,"orthogonal_unknown_not_distinguishable");
    need(Math.abs(max(knownFused)-2.0/61)<1e-12,
         "expected_agreed_ranks_for_synthetic_known");
    need(Math.abs(max(unknownFused)-2.0/61)<1e-12,
         "expected_agreed_ranks_for_synthetic_unknown");
    need(Math.abs(max(knownFused)-max(unknownFused))<1e-12,
         "rank_only_known_unknown_tie_was_not_exposed");
    need(knownCsls[knownIndex]>unknownCsls[unknownIndex]+0.5,
         "absolute_csls_would_not_separate_toy_queries");
    need(knownZ[knownIndex]>unknownZ[unknownIndex]+1,
         "absolute_template_z_would_not_separate_toy_queries");
    need(!gate(knownFused,knownCsls,knownZ,null,null) &&
         !gate(unknownFused,unknownCsls,unknownZ,null,null),
         "missing_real_unknown_calibration_must_abstain");
    // Arbitrary toy gates ONLY exercise the AND logic. NEVER promote
    // these uncalibrated constants to any real person recognition code.
    need(gate(knownFused,knownCsls,knownZ,0.1,1.0),
         "synthetic_known_toy_gate_refused");
    need(!gate(unknownFused,unknownCsls,unknownZ,0.1,1.0),
         "synthetic_unknown_toy_gate_not_refused");
    double[] nan={Double.NaN,0};
    try{max(nan);throw new AssertionError("nonfinite_rejected");}
    catch(IllegalArgumentException expected){}
    try{gate(knownFused,knownCsls,knownZ,Double.NaN,1.0);
        throw new AssertionError("nonfinite_threshold_rejected");}
    catch(IllegalArgumentException expected){}
    System.out.println(String.format(Locale.US,
        "R793_RANK_FUSION_UNKNOWN_COLLISION_SYNTHETIC_PASS "+
        "{\"known_rrf_top\":%.12f,\"unknown_rrf_top\":%.12f,"+
        "\"identical_rrf_max_for_known_and_unknown\":true,"+
        "\"known_top_abs_csls\":%.6f,\"unknown_top_abs_csls\":%.6f,"+
        "\"known_top_z\":%.6f,\"unknown_top_z\":%.6f,"+
        "\"two_independent_real_unknown_thresholds_exist\":false,"+
        "\"rank_only_acceptance_forbidden\":true,"+
        "\"real_person_data_read\":0,"+
        "\"production_people_folder_filing_authorized\":false}",
        max(knownFused),max(unknownFused),
        knownCsls[knownIndex],unknownCsls[unknownIndex],
        knownZ[knownIndex],unknownZ[unknownIndex]));
  }
  public static void main(String[] args){
    need(args.length==1&&"--synthetic-only".equals(args[0]),
         "rank_fusion_test_only_synthetic");
    run();
  }
}
