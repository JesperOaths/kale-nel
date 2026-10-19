package nl.kalenel.s9offline;

/** No camera, identity samples, data files or model artifacts required. */
public final class PhoneOfflineSimilarityTest {
    static void expect(boolean pass, String label) {
        if (!pass) throw new AssertionError(label);
    }

    static float[] vec(int i) {
        float[] output=new float[512]; output[i]=1f; return output;
    }

    static PhoneOfflineSimilarity.Evidence e(float[] visual, float[] upper, Float color,
                                              boolean aligned, String vm, String sm) {
        return new PhoneOfflineSimilarity.Evidence(visual,upper,vm,sm,color,aligned);
    }

    public static void main(String[] args) {
        float[] a=vec(0), b=vec(1);
        PhoneOfflineSimilarity.Evidence one=e(a,a,1f,true,"visual-sha","face-sha");
        PhoneOfflineSimilarity.Evidence two=e(b,a,1f,true,"visual-sha","face-sha");
        PhoneOfflineSimilarity.Result combined=PhoneOfflineSimilarity.compare(one,two);
        expect(combined!=null,"two compatible vectors must match");
        expect("structural_70_visual_30".equals(combined.method),"primary formula");
        expect(Math.abs(combined.cosineScore-.70f)<1e-6f,"0.70 structural + 0.30 visual");
        expect(Math.abs(combined.displayPercent-70f)<1e-5f,"displayed score");
        expect(combined.humanReviewRequired&&!combined.verifiedSamePerson,"no identity inference");

        PhoneOfflineSimilarity.Evidence unaligned=e(a,a,.4f,false,"visual-sha","face-sha");
        PhoneOfflineSimilarity.Evidence visualMatch=e(a,null,.4f,false,"visual-sha","");
        PhoneOfflineSimilarity.Result fallback=PhoneOfflineSimilarity.compare(unaligned,visualMatch);
        expect(fallback!=null,"unaligned face must only fall back");
        expect("visual_75_color_25".equals(fallback.method),"fallback formula");
        expect(Math.abs(fallback.cosineScore-.85f)<1e-6f,"0.75 visual + 0.25 colour");

        expect(PhoneOfflineSimilarity.compare(
            e(a,a,.4f,true,"visual-sha","face-sha"),
            e(a,a,.4f,true,"visual-sha","different-sha")
        ).method.equals("visual_75_color_25"),"different model version cannot compare");

        expect(PhoneOfflineSimilarity.compare(
            e(a,null,.4f,false,"visual-sha",""),
            e(a,null,.4f,false,"different-visual-sha",""))==null,
            "visual versions must match");

        expect(PhoneOfflineSimilarity.compare(
            e(a,null,null,false,"visual-sha",""),
            e(a,null,null,false,"visual-sha",""))==null,
            "missing fallback must not imply similarity");

        expect(PhoneOfflineSimilarity.compare(
            e(a,null,.2f,false,"visual-sha",""),
            e(a,null,.4f,false,"visual-sha",""))==null,
            "pairwise colour must be consistent");

        float[] invalid=vec(0); invalid[1]=Float.NaN;
        expect(PhoneOfflineSimilarity.compare(
            e(invalid,null,.2f,false,"visual-sha",""),
            e(a,null,.2f,false,"visual-sha",""))==null,
            "nonfinite vectors cannot rank");

        float[] zero=new float[512];
        expect(PhoneOfflineSimilarity.compare(
            e(zero,null,.2f,false,"visual-sha",""),
            e(a,null,.2f,false,"visual-sha",""))==null,
            "zero vectors cannot rank");

        float[] negative=vec(0);negative[0]=-1f;
        PhoneOfflineSimilarity.Result nonprob=PhoneOfflineSimilarity.compare(
            e(negative,null,.2f,false,"visual-sha",""),
            e(a,null,.2f,false,"visual-sha",""));
        expect(nonprob!=null&&nonprob.cosineScore<0&&nonprob.displayPercent==0f,
            "raw cosine retained; display clipped without identity claim");

        System.out.println("S9_PHONE_MULTIVECTOR_SCORE_TEST_PASS");
    }
}
