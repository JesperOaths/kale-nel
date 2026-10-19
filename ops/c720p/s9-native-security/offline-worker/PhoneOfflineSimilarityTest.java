package nl.kalenel.s9offline;

/** No camera, identity samples, data files or model artifacts required. */
public final class PhoneOfflineSimilarityTest {
    static void expect(boolean pass,String label){
        if(!pass)throw new AssertionError(label);
    }
    static float[] vec(int i){
        float[] output=new float[512];output[i]=1f;return output;
    }
    static PhoneOfflineSimilarity.Evidence e(float[] visual,float[] upper,
                                              boolean aligned,String vm,String sm){
        return new PhoneOfflineSimilarity.Evidence(visual,upper,vm,sm,aligned);
    }
    public static void main(String[] args){
        float[] a=vec(0),b=vec(1);
        PhoneOfflineSimilarity.Evidence one=e(a,a,true,"visual-sha","face-sha");
        PhoneOfflineSimilarity.Evidence two=e(b,a,true,"visual-sha","face-sha");
        PhoneOfflineSimilarity.Result combined=PhoneOfflineSimilarity.compare(one,two,null);
        expect(combined!=null,"compatible dual vectors must score without colour");
        expect("structural_70_visual_30".equals(combined.method),"primary formula");
        expect(Math.abs(combined.cosineScore-.70f)<1e-6f,"0.70 upper + 0.30 visual");
        expect(Math.abs(combined.displayPercent-70f)<1e-5f,"display score");
        expect(combined.humanReviewRequired&&!combined.verifiedSamePerson,"human review required");

        PhoneOfflineSimilarity.Evidence unaligned=e(a,a,false,"visual-sha","face-sha");
        PhoneOfflineSimilarity.Evidence visualMatch=e(a,null,false,"visual-sha","");
        PhoneOfflineSimilarity.Result fallback=PhoneOfflineSimilarity.compare(unaligned,visualMatch,.4f);
        expect(fallback!=null,"unaligned face must fall back");
        expect("visual_75_color_25".equals(fallback.method),"fallback formula");
        expect(Math.abs(fallback.cosineScore-.85f)<1e-6f,"0.75 visual + 0.25 pairwise colour");

        expect(PhoneOfflineSimilarity.compare(
            e(a,a,true,"visual-sha","face-sha"),
            e(a,a,true,"visual-sha","different-sha"),.4f
        ).method.equals("visual_75_color_25"),"model version isolation");

        expect(PhoneOfflineSimilarity.compare(
            e(a,null,false,"visual-sha",""),
            e(a,null,false,"different-visual-sha",""),.4f)==null,
            "visual version mismatch must refuse");

        expect(PhoneOfflineSimilarity.compare(
            e(a,null,false,"visual-sha",""),
            e(a,null,false,"visual-sha",""),null)==null,
            "missing histogram score must refuse fallback");

        for(Float color:new Float[]{-.2f,Float.NaN,Float.POSITIVE_INFINITY,1.2f}){
            expect(PhoneOfflineSimilarity.compare(
                e(a,null,false,"visual-sha",""),
                e(a,null,false,"visual-sha",""),color)==null,
                "invalid pairwise colour must refuse");
        }

        float[] invalid=vec(0);invalid[1]=Float.NaN;
        expect(PhoneOfflineSimilarity.compare(
            e(invalid,null,false,"visual-sha",""),
            e(a,null,false,"visual-sha",""),.2f)==null,"nonfinite vector");

        float[] zero=new float[512];
        expect(PhoneOfflineSimilarity.compare(
            e(zero,null,false,"visual-sha",""),
            e(a,null,false,"visual-sha",""),.2f)==null,"zero vector");

        float[] negative=vec(0);negative[0]=-1f;
        PhoneOfflineSimilarity.Result nonprob=PhoneOfflineSimilarity.compare(
            e(negative,null,false,"visual-sha",""),
            e(a,null,false,"visual-sha",""),.2f);
        expect(nonprob!=null&&nonprob.cosineScore<0&&nonprob.displayPercent==0f,
               "retain signed cosine but clip displayed percent");

        System.out.println("S9_PHONE_MULTIVECTOR_SCORE_TEST_PASS");
    }
}
