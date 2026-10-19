package nl.kalenel.s9offline;

import java.util.Arrays;

/**
 * Stateless phone-side appearance-only similarity calculations.
 *
 * Deliberately separate from the recording APK, archive files and review state.
 * A score is NOT an identity probability or an automatic folder assignment.
 * Missing features cannot be replaced by zero vectors or stale-model data.
 */
public final class PhoneOfflineSimilarity {
    public static final int DIM = 512;
    public static final String VERSION = "s9_offline_multivector_v1";

    private PhoneOfflineSimilarity() {}

    public static final class Evidence {
        public final float[] visual;
        public final float[] structural;
        public final String visualModelSha;
        public final String structuralModelSha;
        public final Float colorScore;
        public final boolean structuralAligned;
        public Evidence(float[] v, float[] s, String vm, String sm, Float color, boolean aligned) {
            visual = v == null ? null : v.clone();
            structural = s == null ? null : s.clone();
            visualModelSha = vm == null ? "" : vm;
            structuralModelSha = sm == null ? "" : sm;
            colorScore = color;
            structuralAligned = aligned;
        }
    }

    public static final class Result {
        public final float cosineScore;
        public final float displayPercent;
        public final String method;
        public final boolean humanReviewRequired = true;
        public final boolean verifiedSamePerson = false;
        private Result(float score, String rule) {
            cosineScore = score;
            // Reporting only: a clipped similarity percentage is not a calibrated
            // probability of common identity. Preserve raw cosine in metadata.
            displayPercent = 100f * Math.min(1f, Math.max(0f, score));
            method = rule;
        }
    }

    public static float cosine(float[] a, float[] b) {
        if (a == null || b == null || a.length != DIM || b.length != DIM) {
            throw new IllegalArgumentException("missing or wrong feature dimension");
        }
        double dot=0d, sumA=0d, sumB=0d;
        for (int i=0; i<DIM; i++) {
            if (!Float.isFinite(a[i]) || !Float.isFinite(b[i])) {
                throw new IllegalArgumentException("nonfinite feature");
            }
            dot+=(double)a[i]*b[i];
            sumA+=(double)a[i]*a[i]; sumB+=(double)b[i]*b[i];
        }
        if (sumA<1e-12 || sumB<1e-12) {
            throw new IllegalArgumentException("empty embedding");
        }
        return (float)Math.max(-1d, Math.min(1d, dot/Math.sqrt(sumA*sumB)));
    }

    private static boolean comparable(String first, String second) {
        return first != null && !first.isEmpty() && first.equals(second);
    }

    /**
     * Exact requested weighting, conditioned on compatible feature spaces.
     * Structural ArcFace is only usable on a verified aligned face, NEVER the
     * arbitrary upper quarter of a bounding box.
     */
    public static Result compare(Evidence a, Evidence b) {
        if (a == null || b == null
            || !comparable(a.visualModelSha,b.visualModelSha)) return null;
        float visual;
        try { visual=cosine(a.visual,b.visual); }
        catch (IllegalArgumentException invalid) { return null; }

        if (a.structuralAligned && b.structuralAligned
            && comparable(a.structuralModelSha,b.structuralModelSha)
            && a.structural != null && b.structural != null) {
            try {
                float structural=cosine(a.structural,b.structural);
                return new Result(.70f*structural+.30f*visual,
                                  "structural_70_visual_30");
            } catch (IllegalArgumentException invalid) {
                // The structural model is unavailable on this pair; try the
                // declared colour fallback rather than inventing features.
            }
        }
        if (a.colorScore==null || b.colorScore==null
            || !Float.isFinite(a.colorScore) || !Float.isFinite(b.colorScore)
            || a.colorScore<0f || a.colorScore>1f
            || b.colorScore<0f || b.colorScore>1f) return null;
        // Colour score belongs to a pair, not to an individual sample.
        // Caller passes its independently measured pair score in both objects.
        if (Math.abs(a.colorScore-b.colorScore)>0.0001f) return null;
        return new Result(.75f*visual+.25f*a.colorScore,"visual_75_color_25");
    }
}
