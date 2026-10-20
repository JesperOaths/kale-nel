package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** NO Android, no phone, no production source. Dummy fake HMAC provider only. */
public final class S9MigratedThreeKeyEnrollmentTestV227 {
    private static final String P=S9MigratedThreeKeyEnrollmentV227.PACKAGE;
    private static final String DIGEST=repeat('a',64);
    private static String repeat(char c,int n) {
        char[] s=new char[n];Arrays.fill(s,c);return new String(s);
    }
    private static void ok(boolean value,String why) {
        if(!value)throw new AssertionError(why);
    }
    @FunctionalInterface interface Work {void run()throws Exception;}
    private static void denied(Work w,String why)throws Exception {
        boolean blocked=false;
        try{w.run();}catch(IOException e){blocked=true;}
        ok(blocked,why);
    }
    private static final class Fake implements
          S9MigratedThreeKeyEnrollmentV227.KeyStoreOps {
        final Map<String,byte[]> keys=new HashMap<String,byte[]>();
        int createCount;
        int failAt;
        boolean sameKey;
        boolean nonExportable=true;
        @Override public boolean contains(String alias) {
            return keys.containsKey(alias);
        }
        @Override public void createNewHmac256(String alias)throws IOException {
            createCount++;
            if(keys.containsKey(alias))throw new IOException("duplicate_key");
            if(failAt>0 && createCount==failAt)
                throw new IOException("synthetic_keygen_interrupted");
            try {
                keys.put(alias,MessageDigest.getInstance("SHA-256").digest(
                     (sameKey?"all-identical":alias).getBytes(StandardCharsets.US_ASCII)));
            }catch(Exception error){throw new IOException("synthetic_digest_unavailable");}
        }
        @Override public boolean isNonExportableHmac256(String alias) {
            // Test double emulates AndroidKeyStore.getEncoded()==null.
            return nonExportable && keys.containsKey(alias);
        }
        @Override public byte[] sign(String alias,byte[] message)throws IOException {
            try {
                if(!keys.containsKey(alias))
                    throw new IOException("fake_missing_alias");
                Mac mac=Mac.getInstance("HmacSHA256");
                mac.init(new SecretKeySpec(keys.get(alias),"HmacSHA256"));
                return mac.doFinal(message);
            }catch(java.security.GeneralSecurityException error){
                throw new IOException("synthetic_hmac_unavailable");
            }
        }
    }
    private static S9MigratedThreeKeyEnrollmentV227.Receipt enroll(
             Path path,String digest,Fake keys)throws Exception {
        return S9MigratedThreeKeyEnrollmentV227.enrollOnce(
            path.toFile(),P,digest,(pkg,verified)->P.equals(pkg) &&
                 digest.equals(verified),keys);
    }
    public static void main(String[] args)throws Exception {
        ok(args.length==0,"synthetic_only");
        Path base=Files.createTempDirectory("s9-three-key-v227-synthetic-");
        Path successful=Files.createDirectory(base.resolve("success"));
        Fake good=new Fake();
        S9MigratedThreeKeyEnrollmentV227.Receipt receipt=
            enroll(successful,DIGEST,good);
        ok(receipt.completed && receipt.allKeyProofsVerified
           && DIGEST.equals(receipt.approvedManifestSha256)
           && !receipt.mayDeleteMedia() && !receipt.enablesRemoteActions()
           && !receipt.provisionsRelaySigningKey(),"successful_first_enrollment");
        ok(good.createCount==3 && good.keys.size()==3,"three_independent_keys_created");
        ok(Files.isRegularFile(successful.resolve(
           S9MigratedThreeKeyEnrollmentV227.INTENT)) &&
           Files.isRegularFile(successful.resolve(
           S9MigratedThreeKeyEnrollmentV227.COMPLETED)),
           "both_durable_private_markers_exist");
        ok(S9MigratedThreeKeyEnrollmentV227.verifyExisting(
           successful.toFile(),P,DIGEST,good).allKeyProofsVerified,
           "verified_after_restart");
        denied(()->enroll(successful,DIGEST,good),"second_enrollment_denied");
        denied(()->S9MigratedThreeKeyEnrollmentV227.verifyExisting(
           successful.toFile(),P,repeat('b',64),good),"wrong_approved_digest_denied");
        denied(()->S9MigratedThreeKeyEnrollmentV227.verifyExisting(
           successful.toFile(),"nl.kalenel.s9security",DIGEST,good),
           "wrong_camera_package_denied");

        Path deniedPath=Files.createDirectory(base.resolve("denied"));
        Fake blank=new Fake();
        denied(()->S9MigratedThreeKeyEnrollmentV227.enrollOnce(
           deniedPath.toFile(),P,DIGEST,(a,b)->false,blank),
           "no_external_authority_denied");
        ok(blank.createCount==0 && !Files.exists(deniedPath.resolve(
           S9MigratedThreeKeyEnrollmentV227.INTENT)),
           "denied_before_any_write");
        denied(()->S9MigratedThreeKeyEnrollmentV227.enrollOnce(
           deniedPath.toFile(),P,DIGEST,null,blank),
           "null_authority_denied");
        denied(()->S9MigratedThreeKeyEnrollmentV227.enrollOnce(
           deniedPath.toFile(),P,"wrong",(a,b)->true,blank),
           "bad_manifest_digest_denied");

        Path partial=Files.createDirectory(base.resolve("partial"));
        Fake interrupted=new Fake();interrupted.failAt=2;
        denied(()->enroll(partial,DIGEST,interrupted),
           "interrupted_keygen_refused");
        ok(interrupted.keys.size()==1 &&
           Files.exists(partial.resolve(S9MigratedThreeKeyEnrollmentV227.INTENT))
           && !Files.exists(partial.resolve(
             S9MigratedThreeKeyEnrollmentV227.COMPLETED)),
           "partial_key_left_a_permanent_admission_marker");
        denied(()->enroll(partial,DIGEST,interrupted),
           "partial_enrollment_never_silently_retried");
        ok(interrupted.createCount==2,"no_auto_rotation_or_retry");

        Path replaced=Files.createDirectory(base.resolve("replaced"));
        Fake preexisting=new Fake();
        preexisting.createNewHmac256(S9MigratedThreeKeyEnrollmentV227.CHECKPOINT);
        denied(()->enroll(replaced,DIGEST,preexisting),
           "preexisting_key_denied_even_without_markers");
        ok(!Files.exists(replaced.resolve(S9MigratedThreeKeyEnrollmentV227.INTENT)),
           "no_marker_created_over_an_unapproved_key");

        Path equivalent=Files.createDirectory(base.resolve("equivalent"));
        Fake identical=new Fake();identical.sameKey=true;
        denied(()->enroll(equivalent,DIGEST,identical),
           "distinct_aliases_cannot_share_same_actual_hmac_key");
        ok(!Files.exists(equivalent.resolve(S9MigratedThreeKeyEnrollmentV227.COMPLETED)),
           "no_success_receipt_for_identical_hmac");

        Path insecure=Files.createDirectory(base.resolve("insecure"));
        Fake exportable=new Fake();exportable.nonExportable=false;
        denied(()->enroll(insecure,DIGEST,exportable),
           "exportable_key_refused");
        ok(!Files.exists(insecure.resolve(S9MigratedThreeKeyEnrollmentV227.COMPLETED)),
           "no_success_receipt_for_exportable_key");

        Path complete=successful.resolve(S9MigratedThreeKeyEnrollmentV227.COMPLETED);
        byte[] original=Files.readAllBytes(complete);
        byte[] corrupt=Arrays.copyOf(original,original.length);
        corrupt[corrupt.length-8]=(byte)(corrupt[corrupt.length-8]=='a'?'b':'a');
        Files.write(complete,corrupt);
        denied(()->S9MigratedThreeKeyEnrollmentV227.verifyExisting(
           successful.toFile(),P,DIGEST,good),
           "tampered_completion_hmac_refused");
        Files.write(complete,original);
        ok(S9MigratedThreeKeyEnrollmentV227.verifyExisting(
           successful.toFile(),P,DIGEST,good).completed,
           "original_receipt_verified");
        good.keys.remove(S9MigratedThreeKeyEnrollmentV227.JOURNAL);
        denied(()->S9MigratedThreeKeyEnrollmentV227.verifyExisting(
           successful.toFile(),P,DIGEST,good),"lost_key_denied_no_regeneration");
        ok(good.createCount==3,"verification_did_not_generate_new_keys");

        Path symlink=base.resolve("symlink");
        Files.createSymbolicLink(symlink,successful);
        denied(()->enroll(symlink,DIGEST,new Fake()),
             "symlink_private_dir_refused");
        System.out.println("S9_THREE_KEY_ENROLLMENT_V227_SYNTHETIC_OK");
    }
}
