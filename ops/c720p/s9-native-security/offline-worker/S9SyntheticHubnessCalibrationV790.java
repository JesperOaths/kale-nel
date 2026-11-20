package nl.kalenel.s9offline;

import java.util.Arrays;
import java.util.Locale;

/**
 * R790: cohort-based local scaling and hubness correction for strictly
 * SYNTHETIC 512D vectors. There is no APK runtime integration, People
 * folder access, face embedding, query video, identity map or auto-file.
 *
 * CSLS(q, r) = 2 cos(q,r) - mean_k cos(q,reference) -
 *              mean_k cos(r, background_queries).
 * Reference-specific z normalization uses a disjoint synthetic background
 * cohort. Query-side t-norm is demonstrated as rank-invariant.
 * RRF combines synthetic CSLS and z-normalized ranks without inventing a
 * calibrated acceptance threshold for real people.
 */
public final class S9SyntheticHubnessCalibrationV790 {
  private S9SyntheticHubnessCalibrationV790(){}
  static final int DIM=512;
  static final int K=3;
  static final int RRF_OFFSET=60;
  static void need(boolean v,String why){
    if(!v)throw new IllegalArgumentException(why);
  }

  static float[] unit(float[] vector){
    need(vector!=null&&vector.length==DIM,"bad_vector_shape");
    double norm2=0;
    for(float v:vector){
      need(Float.isFinite(v),"nonfinite_embedding_rejected");
      norm2+=(double)v*v;
    }
    need(norm2>1e-12&&Double.isFinite(norm2),"zero_or_infinite_vector");
    float[] normalized=vector.clone();
    double norm=Math.sqrt(norm2);
    for(int j=0;j<DIM;j++)normalized[j]=(float)(normalized[j]/norm);
    return normalized;
  }
  static float[] xy(float x,float y){
    float[] v=new float[DIM];v[0]=x;v[1]=y;return unit(v);
  }
  static float[] axis(int index){
    need(index>=0&&index<DIM,"bad_axis");
    float[] v=new float[DIM];v[index]=1f;return v;
  }
  static double cosine(float[] a,float[] b){
    need(a!=null&&b!=null&&a.length==DIM&&b.length==DIM,
         "bad_similarity_vector_shape");
    double dot=0,na=0,nb=0;
    for(int j=0;j<DIM;j++){
      need(Float.isFinite(a[j])&&Float.isFinite(b[j]),
           "nonfinite_cosine_vector");
      dot+=(double)a[j]*b[j];na+=(double)a[j]*a[j];
      nb+=(double)b[j]*b[j];
    }
    need(na>1e-12&&nb>1e-12,"zero_vector_cosine");
    double v=dot/Math.sqrt(na*nb);
    need(Double.isFinite(v),"nonfinite_cosine");
    return Math.max(-1.0,Math.min(1.0,v));
  }
  static void disjoint(float[][] ref,float[][] background){
    need(ref!=null&&background!=null&&ref.length>=3&&
         background.length>=K+1,"insufficient_cohort");
    for(float[] r:ref)for(float[] bg:background){
      // No duplicate vectors even in this toy corpus. Real R769
      // demands independent source/person episodes beyond this check.
      need(!Arrays.equals(r,bg),"identical_reference_cohort_vector_leakage");
    }
  }
  static double meanTopK(float[] q,float[][] set,int k){
    need(set!=null&&k>=1&&k<=set.length,"invalid_knn_cohort_k");
    double[] sims=new double[set.length];
    for(int i=0;i<set.length;i++)sims[i]=cosine(q,set[i]);
    Arrays.sort(sims);
    double sum=0;
    for(int i=0;i<k;i++)sum+=sims[sims.length-1-i];
    return sum/k;
  }
  static double[] raw(float[] query,float[][] ref){
    double[] out=new double[ref.length];
    for(int i=0;i<ref.length;i++)out[i]=cosine(query,ref[i]);
    return out;
  }
  static double[] csls(float[] query,float[][] ref,float[][] background){
    disjoint(ref,background);
    double qr=meanTopK(query,ref,K);
    double[] out=new double[ref.length];
    for(int i=0;i<ref.length;i++){
      double rq=meanTopK(ref[i],background,K);
      out[i]=2*cosine(query,ref[i])-qr-rq;
    }
    return out;
  }
  static double[] templateZ(float[] query,float[][] ref,float[][] background){
    disjoint(ref,background);
    double[] out=new double[ref.length];
    for(int i=0;i<ref.length;i++){
      double[] sims=new double[background.length];
      double mean=0;
      for(int j=0;j<background.length;j++){
        sims[j]=cosine(ref[i],background[j]);mean+=sims[j];
      }
      mean/=background.length;
      double var=0;
      for(double v:sims)var+=(v-mean)*(v-mean);
      var/=background.length;
      // Conservative floor avoids making a tiny cohort SD an
      // astronomically large "confidence" score.
      double sd=Math.max(Math.sqrt(var),0.05);
      out[i]=(cosine(query,ref[i])-mean)/sd;
    }
    return out;
  }
  static double[] queryTNorm(float[] query,float[][] ref){
    double[] cosine=raw(query,ref);
    double mean=0,var=0;
    for(double c:cosine)mean+=c;
    mean/=cosine.length;
    for(double c:cosine)var+=(c-mean)*(c-mean);
    double sd=Math.max(Math.sqrt(var/cosine.length),0.05);
    double[] ret=new double[cosine.length];
    for(int i=0;i<ret.length;i++)ret[i]=(cosine[i]-mean)/sd;
    return ret;
  }
  static int[] rank(double[] scores){
    Integer[] ids=new Integer[scores.length];
    for(int i=0;i<ids.length;i++){
      need(Double.isFinite(scores[i]),"nonfinite_score_rejected");
      ids[i]=i;
    }
    Arrays.sort(ids,(a,b)->{
      int c=Double.compare(scores[b],scores[a]);
      return c!=0?c:Integer.compare(a,b);
    });
    int[] ret=new int[ids.length];
    for(int i=0;i<ids.length;i++)ret[i]=ids[i];
    return ret;
  }
  static int[] rankPositions(int[] ranked){
    int[] positions=new int[ranked.length];
    for(int i=0;i<ranked.length;i++){
      need(ranked[i]>=0&&ranked[i]<ranked.length,
           "rank_out_of_range");
      positions[ranked[i]]=i+1;
    }
    return positions;
  }
  static double[] rrf(double[] csls,double[] z){
    need(csls.length==z.length,"fusion_rank_dimension_mismatch");
    int[] a=rankPositions(rank(csls)),b=rankPositions(rank(z));
    double[] out=new double[a.length];
    for(int i=0;i<out.length;i++)
      out[i]=1.0/(RRF_OFFSET+a[i])+1.0/(RRF_OFFSET+b[i]);
    return out;
  }
  static void rejects(Runnable task,String id){
    try{task.run();}
    catch(IllegalArgumentException expected){return;}
    throw new IllegalStateException("synthetic_invalid_input_accepted_"+id);
  }
  static float[][] background(){
    float[][] ret=new float[12][];
    // A deliberately hub-heavy unlabeled synthetic background. This
    // contrived fixture is NOT a valid person-ID performance evaluation.
    for(int i=0;i<ret.length;i++)
      ret[i]=xy(1f,(i+1)*0.025f);
    return ret;
  }
  static float[][] references(){
    return new float[][] {
      axis(0), // synthetic background hub
      axis(1), // rare synthetic template
      axis(2),
      axis(3),
      axis(4),
      axis(5)
    };
  }
  static void test(){
    float[][] ref=references(),bg=background();
    float[] q=xy(0.76f,0.65f);
    double[] baseline=raw(q,ref);
    double[] cs=csls(q,ref,bg);
    double[] z=templateZ(q,ref,bg);
    double[] tn=queryTNorm(q,ref);
    double[] f=rrf(cs,z);
    need(rank(baseline)[0]==0,"synthetic_hub_was_not_raw_top1");
    need(rank(cs)[0]==1,"csls_did_not_penalize_synthetic_hub");
    need(rank(z)[0]==1,"z_normalization_did_not_penalize_synthetic_hub");
    need(rank(f)[0]==1,"rrf_did_not_reconcile_synthetic_hub");
    need(Arrays.equals(rank(baseline),rank(tn)),
         "query_t_norm_illegally_changed_cosine_rank");
    need(cosine(axis(1),axis(1))>0.99999 &&
         Math.abs(cosine(axis(1),axis(0)))<1e-9,
         "cosine_basic_sanity");
    int negatives=0;
    rejects(()->unit(new float[3]),"dimension");negatives++;
    rejects(()->unit(new float[DIM]),"zero");negatives++;
    float[] nan=axis(1);nan[2]=Float.NaN;
    rejects(()->unit(nan),"nan");negatives++;
    rejects(()->cosine(axis(1),new float[16]),"cos_dimension");negatives++;
    rejects(()->meanTopK(q,ref,ref.length+1),"knn_overrun");negatives++;
    float[][] leakage=background();leakage[1]=axis(0);
    rejects(()->csls(q,ref,leakage),"identical_cohort");negatives++;
    rejects(()->rrf(new double[]{1,2},new double[]{3}),
            "fusion_mismatched");negatives++;
    rejects(()->rank(new double[]{1.0,Double.NaN}),"nonfinite_rank");negatives++;
    // Synthetic unknown-to-person confidence calibration does not
    // exist. Never emit an automatic identity threshold.
    System.out.println(String.format(Locale.US,
      "R790_SYNTHETIC_HUBNESS_CORRECTION_PASS "+
      "{\"vector_dim\":%d,\"reference_vectors\":%d,\"background_vectors\":%d,"+
      "\"synthetic_raw_top_index\":%d,\"synthetic_csls_top_index\":%d,"+
      "\"synthetic_znorm_top_index\":%d,\"synthetic_rank_fusion_top_index\":%d,"+
      "\"raw_hub_score\":%.6f,\"csls_hub_score\":%.6f,"+
      "\"raw_rare_score\":%.6f,\"csls_rare_score\":%.6f,"+
      "\"query_t_norm_rank_invariant\":true,\"negative_tests\":%d,"+
      "\"real_video_decoded\":0,\"real_person_embeddings_used\":0,"+
      "\"automatic_folder_filing_authorized\":false,"+
      "\"unknown_person_calibration_available\":false}",
      DIM,ref.length,bg.length,rank(baseline)[0],rank(cs)[0],
      rank(z)[0],rank(f)[0],
      baseline[0],cs[0],baseline[1],cs[1],negatives));
  }
  public static void main(String[] args){
    need(args.length==1&&"--synthetic-only-self-test".equals(args[0]),
         "only_synthetic_no_real_identity_inputs_allowed");
    test();
  }
}
