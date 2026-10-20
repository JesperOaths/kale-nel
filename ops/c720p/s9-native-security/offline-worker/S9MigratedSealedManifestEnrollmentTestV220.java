package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/** Synthetic local tempfiles only. No Android package, media or secrets. */
public final class S9MigratedSealedManifestEnrollmentTestV220 {
    private static final SecretKey SIGNER=new SecretKeySpec(
        "synthetic-source-sealer-keystore-test-only-v220-123456"
            .getBytes(StandardCharsets.US_ASCII),"HmacSHA256");
    private static final String HASH="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final String NAME=S9MigratedSealedSourceManifestV216.FILE_NAME;
    private static final S9MigratedSealedManifestEnrollmentV220.IndependentFirstEnrollment YES=
        (generation,rows)-> generation==1L && rows.size()==6;
    private static void require(boolean ok,String name){
        if(!ok)throw new AssertionError(name);
    }
    @FunctionalInterface private interface Unsafe {void run()throws Exception;}
    private static void denied(Unsafe call,String reason)throws Exception{
        try{call.run();throw new AssertionError("unexpected_enrolment_"+reason);}
        catch(IOException accepted) { }
    }
    private static Map<String,S9MigratedVerifiedSourceV198.Proof> six(){
        Map<String,S9MigratedVerifiedSourceV198.Proof> map=new LinkedHashMap<>();
        for(int i=0;i<6;i++){
            String name=String.format(java.util.Locale.ROOT,"synthetic_%02d.mp4",i);
            long size=i==5?64181934L:30000000L;
            map.put(name,new S9MigratedVerifiedSourceV198.Proof(
                 name,HASH,size,true));
        }
        return map;
    }
    public static void main(String[] args)throws Exception{
        require(args.length==0,"host_only");
        Path root=Files.createTempDirectory("s9-first-enrollment-v220-");
        Map<String,S9MigratedVerifiedSourceV198.Proof> entries=six();
        Path target=root.resolve(NAME);
        denied(()->S9MigratedSealedManifestEnrollmentV220.enrollFirstOnly(
           root.toFile(),SIGNER,entries,(generation,rows)->false),
           "user_approval_required");
        require(!Files.exists(target),"denial_did_not_write");
        Map<String,S9MigratedVerifiedSourceV198.Proof> bad=six();
        String first=bad.keySet().iterator().next();
        S9MigratedVerifiedSourceV198.Proof entry=bad.get(first);
        bad.put(first,new S9MigratedVerifiedSourceV198.Proof(
            first,HASH,entry.bytes+1,true));
        denied(()->S9MigratedSealedManifestEnrollmentV220.enrollFirstOnly(
           root.toFile(),SIGNER,bad,YES),"wrong_aggregate_bytes");
        require(!Files.exists(target),"invalid_sum_did_not_write");
        Map<String,S9MigratedVerifiedSourceV198.Proof> unindexed=six();
        unindexed.put(first,new S9MigratedVerifiedSourceV198.Proof(
           first,HASH,30000000L,false));
        denied(()->S9MigratedSealedManifestEnrollmentV220.enrollFirstOnly(
           root.toFile(),SIGNER,unindexed,YES),"missing_import_proof");
        require(!Files.exists(target),"bad_provenance_did_not_write");
        S9MigratedSealedManifestEnrollmentV220.EnrollmentReceipt receipt=
            S9MigratedSealedManifestEnrollmentV220.enrollFirstOnly(
                root.toFile(),SIGNER,entries,YES);
        require(receipt.privateReadbackVerified&&receipt.generation==1L &&
           receipt.entries==6 && receipt.totalBytes==214181934L,
           "signed_first_enrollment_committed");
        require(!receipt.permitsOriginalDeletion() &&
           !receipt.enablesLiveSaveDelete() &&
           !receipt.changesPersonReviews(),"metadata_only");
        S9MigratedSealedSourceManifestV216.Verified verified=
             S9MigratedSealedSourceManifestV216.verifyExisting(root.toFile(),SIGNER,1L);
        require(verified.sourceRows.size()==6,"readback_entries");
        byte[] approved=Files.readAllBytes(target);
        denied(()->S9MigratedSealedManifestEnrollmentV220.enrollFirstOnly(
           root.toFile(),SIGNER,entries,YES),"existing_manifest_never_overwritten");
        require(java.util.Arrays.equals(approved,Files.readAllBytes(target)),
           "duplicate_attempt_preserved");
        denied(()->S9MigratedSealedSourceManifestV216.verifyExisting(
           root.toFile(),SIGNER,2L),"generation_rollback_detected");
        byte[] changed=approved.clone();
        int pos=0;
        while(pos<changed.length && changed[pos]!='b')pos++;
        require(pos<changed.length,"valid_hmac_fixture");
        changed[pos]='a';
        Files.write(target,changed);
        denied(()->S9MigratedSealedSourceManifestV216.verifyExisting(
           root.toFile(),SIGNER,1L),"tampering_refused");
        Files.write(target,approved);
        Path symbolic=root.resolve("competing-private-link");
        Files.createSymbolicLink(symbolic,root);
        denied(()->S9MigratedSealedManifestEnrollmentV220.enrollFirstOnly(
           symbolic.toFile(),SIGNER,entries,YES),"symlink_dir_refused");
        require(java.util.Arrays.equals(approved,Files.readAllBytes(target)),
           "original_protected");
        require(!S9MigratedSealedManifestEnrollmentV220.liveEndpointInstalled()
           && !S9MigratedSealedManifestEnrollmentV220.canRemoveLegacyMedia(),
           "no_production_authority");
        System.out.println("S9_INITIAL_SEALED_ENROLLMENT_V220_SYNTHETIC_OK");
    }
}
