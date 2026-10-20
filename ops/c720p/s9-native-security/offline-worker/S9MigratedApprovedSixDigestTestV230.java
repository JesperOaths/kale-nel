package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import javax.crypto.spec.SecretKeySpec;

/** Host fake six-file metadata + authenticated synthetic V220 seal. No MP4s. */
public final class S9MigratedApprovedSixDigestTestV230 {
    private static String rep(char ch,int len){
        char[] chars=new char[len];Arrays.fill(chars,ch);return new String(chars);
    }
    private static void ok(boolean pass,String description){
        if(!pass)throw new AssertionError(description);
    }
    @FunctionalInterface interface Work {void run()throws Exception;}
    private static void denied(Work work,String reason)throws Exception {
        boolean failClosed=false;
        try{work.run();}catch(IOException expected){failClosed=true;}
        ok(failClosed,reason);
    }
    private static Map<String,S9MigratedVerifiedSourceV198.Proof> six() {
        Map<String,S9MigratedVerifiedSourceV198.Proof> result=
            new HashMap<String,S9MigratedVerifiedSourceV198.Proof>();
        for(int i=5;i>=0;i--){
            String name="synthetic"+(char)('a'+i)+".mp4";
            long bytes=i==5?64181934L:30000000L;
            result.put(name,new S9MigratedVerifiedSourceV198.Proof(
                 name,rep((char)('a'+i),64),bytes,true));
        }
        return result;
    }
    public static void main(String[] args)throws Exception {
        ok(args.length==0,"synthetic_only");
        Map<String,S9MigratedVerifiedSourceV198.Proof> originals=six();
        String trustedDigest=S9MigratedApprovedSixDigestV230.canonicalSha256(originals);
        ok(trustedDigest.matches("[a-f0-9]{64}"),"canonical_digest");
        Map<String,S9MigratedVerifiedSourceV198.Proof> scrambled=
            new HashMap<String,S9MigratedVerifiedSourceV198.Proof>();
        for(String name:new String[]{"synthetica.mp4","syntheticf.mp4",
                 "syntheticc.mp4","synthetice.mp4","syntheticb.mp4",
                 "syntheticd.mp4"})scrambled.put(name,originals.get(name));
        ok(trustedDigest.equals(
            S9MigratedApprovedSixDigestV230.canonicalSha256(scrambled)),
            "canonical_sorted_order_independent");

        Path directory=Files.createTempDirectory("s9-approved-v230-");
        byte[] hmac=rep('7',48).getBytes(StandardCharsets.US_ASCII);
        SecretKeySpec key=new SecretKeySpec(hmac,"HmacSHA256");
        S9MigratedSealedManifestEnrollmentV220.EnrollmentReceipt issued=
            S9MigratedSealedManifestEnrollmentV220.enrollFirstOnly(
              directory.toFile(),key,originals,(generation,proofs)->generation==1);
        ok(issued.privateReadbackVerified && issued.totalBytes==214181934L,
            "real_v220_initial_manifest_created");
        S9MigratedSealedSourceManifestV216.Verified manifest=
            S9MigratedSealedSourceManifestV216.verifyExisting(
             directory.toFile(),key,1L);
        S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(
           manifest,trustedDigest);
        denied(()->S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(
            manifest,rep('0',64)),"wrong_enrollment_digest_rejected");
        denied(()->S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(
            manifest,null),"missing_external_digest_rejected");
        denied(()->S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(
            manifest,"request-supplied-source-digest"),"malformed_digest_rejected");

        Map<String,S9MigratedVerifiedSourceV198.Proof> altered=six();
        String a="synthetica.mp4",z="syntheticf.mp4";
        S9MigratedVerifiedSourceV198.Proof first=altered.get(a);
        S9MigratedVerifiedSourceV198.Proof last=altered.get(z);
        altered.put(a,new S9MigratedVerifiedSourceV198.Proof(
            a,first.sha256,first.bytes+1,true));
        altered.put(z,new S9MigratedVerifiedSourceV198.Proof(
            z,last.sha256,last.bytes-1,true));
        String validButChanged=S9MigratedApprovedSixDigestV230.canonicalSha256(altered);
        ok(!trustedDigest.equals(validButChanged),
           "same_total_different_source_set_detected");
        Path swapped=Files.createTempDirectory("s9-approved-v230-swapped-");
        S9MigratedSealedManifestEnrollmentV220.enrollFirstOnly(
            swapped.toFile(),key,altered,(gen,proof)->gen==1);
        S9MigratedSealedSourceManifestV216.Verified changedSealed=
            S9MigratedSealedSourceManifestV216.verifyExisting(swapped.toFile(),key,1L);
        denied(()->S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(
            changedSealed,trustedDigest),
            "valid_hmac_of_different_six_files_must_not_boot");

        Map<String,S9MigratedVerifiedSourceV198.Proof> sizeWrong=six();
        sizeWrong.remove("syntheticf.mp4");
        denied(()->S9MigratedApprovedSixDigestV230.canonicalSha256(sizeWrong),
               "five_files_not_approved");
        sizeWrong=six();
        S9MigratedVerifiedSourceV198.Proof one=sizeWrong.get("synthetica.mp4");
        sizeWrong.put("synthetica.mp4",new S9MigratedVerifiedSourceV198.Proof(
            one.name,one.sha256,one.bytes-1,true));
        denied(()->S9MigratedApprovedSixDigestV230.canonicalSha256(sizeWrong),
               "wrong_total_not_approved");
        Map<String,S9MigratedVerifiedSourceV198.Proof> unindexed=six();
        S9MigratedVerifiedSourceV198.Proof existing=unindexed.get("synthetica.mp4");
        unindexed.put(existing.name,new S9MigratedVerifiedSourceV198.Proof(
            existing.name,existing.sha256,existing.bytes,false));
        denied(()->S9MigratedApprovedSixDigestV230.canonicalSha256(unindexed),
               "unindexed_source_not_approved");
        denied(()->S9MigratedSealedSourceManifestV216.verifyExisting(
             directory.toFile(),key,2L),
             "trusted_generation_rollback_still_enforced");
        ok(!S9MigratedApprovedSixDigestV230.installsAndroidApp()
            && !S9MigratedApprovedSixDigestV230.authorizesRemoteActions()
            && !S9MigratedApprovedSixDigestV230.validatesRealVideoBytes()
            && !S9MigratedApprovedSixDigestV230.authorizesC720pOriginalDeletion(),
            "read_only_source_enrollment_binding");
        System.out.println("S9_APPROVED_SIX_DIGEST_V230_SYNTHETIC_OK");
    }
}
