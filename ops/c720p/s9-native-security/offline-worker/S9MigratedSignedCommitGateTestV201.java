package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicInteger;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/** Host-only fake file roots, private keys and intents. Never accesses S9. */
public final class S9MigratedSignedCommitGateTestV201 {
    private static final String CLIP="synthetic_1792900000000.mp4";
    private static final String HASH=repeat('a',64),ZERO=repeat('0',64);
    private static final long NOW=1793200000000L;
    private static final byte[] SD_BYTES=
        "synthetic-journal-host-v201-source-only-key-001122".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] INTERNAL_BYTES=
        "synthetic-internal-host-v201-source-only-key-334455".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] AUTH_BYTES=
        "synthetic-auth-intent-host-v201-independent-key-7788".getBytes(StandardCharsets.US_ASCII);
    private static String repeat(char c,int n){
        char[] a=new char[n];Arrays.fill(a,c);return new String(a);
    }
    private static void check(boolean ok,String why){
        if(!ok)throw new AssertionError(why);
    }
    @FunctionalInterface private interface Check{void run()throws Exception;}
    private static void reject(Check op,String reason)throws Exception{
        try{op.run();throw new AssertionError("unexpected_success_"+reason);}
        catch(IOException expected) {}
    }
    private static final class Fixture {
        final Path internal,sd;
        Fixture()throws Exception {
            Path root=Files.createTempDirectory("s9-v201-host-synthetic-");
            internal=Files.createDirectory(root.resolve("private_phone_test"));
            sd=Files.createDirectory(root.resolve("sd_card_test"));
            Files.createFile(internal.resolve("c720p-ledger-trusted-head-v196"));
            Files.createFile(internal.resolve(".c720p-ledger-trusted-head-v196.lock"));
            Files.createFile(internal.resolve(".c720p-dual-store-commit-v197.lock"));
            Files.createFile(sd.resolve("actions-v193.log"));
            Files.createFile(sd.resolve(".actions-v193.lock"));
        }
    }
    private static S9MigratedSignedActionV198.Request request(String method,
            String action,String name,String sha,long bytes,String nonce,long seq,
            String head,long issued,long expires,String tag) {
        return new S9MigratedSignedActionV198.Request(
          "s9_c720p_migrated_action_auth_v198","s9-microsd-metadata-only",
          method,"/c720p/migrated/action",action,name,sha,bytes,nonce,seq,head,
          issued,expires,tag);
    }
    private static S9MigratedSignedActionV198.Request signed(
            S9MigratedSignedActionV198 signer,String method,
            String action,String name,String sha,long bytes,String nonce,long seq,
            String head,long issued,long expires)throws Exception{
        S9MigratedSignedActionV198.Request unsigned=
            request(method,action,name,sha,bytes,nonce,seq,head,issued,expires,null);
        String tag=signer.signForHostTestOnly(unsigned); // HOST FIXTURES only
        return request(method,action,name,sha,bytes,nonce,seq,head,issued,expires,tag);
    }
    public static void main(String[] args)throws Exception{
        check(args.length==0,"synthetic_only");
        Fixture f=new Fixture();
        SecretKey internal=new SecretKeySpec(INTERNAL_BYTES,"HmacSHA256");
        SecretKey sdKey=new SecretKeySpec(SD_BYTES,"HmacSHA256");
        SecretKey auth=new SecretKeySpec(AUTH_BYTES,"HmacSHA256");
        String savedHead;
        // The fixture simulates an INDEPENDENTLY authorized genesis action.
        // The real production coordinator correctly has no bootstrap route.
        try(S9MigratedMetadataLedgerV193 ledger=
             new S9MigratedMetadataLedgerV193(f.sd.toFile(),sdKey);
            S9MigratedLedgerTrustedCheckpointV196 checkpoint=
             new S9MigratedLedgerTrustedCheckpointV196(f.internal.toFile(),internal)){
            S9MigratedMetadataLedgerV193.Receipt row=
                ledger.commit("save",CLIP,HASH,123456,repeat('1',32));
            savedHead=row.ledgerHeadSha256;
            checkpoint.advance(0,ZERO,1,savedHead);
        }
        AtomicInteger sourceChecks=new AtomicInteger();
        S9MigratedDualStoreCommitV197.AuthorizedSource independentSource=
            (action,name,sha,bytes)->{
                sourceChecks.incrementAndGet();
                return "delete".equals(action)&&CLIP.equals(name)&&HASH.equals(sha)
                    && bytes==123456;
            };
        AtomicInteger approvals=new AtomicInteger();
        S9MigratedSignedCommitGateV201.IndependentUserApproval approved=
            v->{approvals.incrementAndGet();return "delete".equals(v.action);};
        try(S9MigratedSignedActionV198 verifier=new S9MigratedSignedActionV198(auth);
            S9MigratedDualStoreCommitV197 coordinator=
                 new S9MigratedDualStoreCommitV197(
                     f.internal.toFile(),f.sd.toFile(),internal,sdKey)){
            S9MigratedSignedCommitGateV201 bridge=
               new S9MigratedSignedCommitGateV201(verifier,coordinator,
                                                   independentSource,approved);
            check(!bridge.hasLiveTransport()&&!bridge.authorizesMediaDeletion()
                  &&!bridge.authorizesPersonReviewChange()
                  &&!bridge.mayRemoveOriginal(),"metadata_only");
            S9MigratedSignedActionV198.Request valid=signed(verifier,
                "POST","delete",CLIP,HASH,123456,repeat('2',32),1,savedHead,
                NOW-1000,NOW+45000);
            S9MigratedSignedActionV198.Request deniedMethod=signed(verifier,
                "PUT","delete",CLIP,HASH,123456,repeat('3',32),1,savedHead,
                NOW-1000,NOW+45000);
            reject(()->bridge.commit(deniedMethod,NOW),"valid_signed_put_refused");
            reject(()->bridge.commit(valid,NOW+50000),"expired_signed_intent");
            reject(()->bridge.commit(valid,0),"untrusted_phone_clock");
            check(sourceChecks.get()==0&&approvals.get()==0,
                  "signature_and_time_checked_before_authorization");
            S9MigratedSignedActionV198.Request forged=request("POST","delete",
                 CLIP,HASH,123456,repeat('2',32),1,savedHead,
                 NOW-1000,NOW+45000,repeat('f',64));
            reject(()->bridge.commit(forged,NOW),"forged_signed_intent");
            check(sourceChecks.get()==0,"forgery_never_touches_source");
            S9MigratedSignedActionV198.Request wrongBytes=signed(verifier,
                "POST","delete",CLIP,HASH,123457,repeat('4',32),1,savedHead,
                NOW-1000,NOW+45000);
            reject(()->bridge.commit(wrongBytes,NOW),"independent_source_refused");
            check(coordinator.currentDecision(CLIP).isSaved(),
                  "no_write_after_wrong_source");
            S9MigratedSignedCommitGateV201 deniedUser=
                 new S9MigratedSignedCommitGateV201(
                      verifier,coordinator,independentSource,v->false);
            int sourceBefore=sourceChecks.get();
            reject(()->deniedUser.commit(valid,NOW),"independent_user_refused");
            check(sourceChecks.get()==sourceBefore,"denial_before_phone_hash");
            S9MigratedDualStoreCommitV197.Result committed=bridge.commit(valid,NOW);
            check(committed.receipt.ledgerSequence==2&&committed.bothStoresVerified
                &&coordinator.currentDecision(CLIP).isDeletedTombstone(),
                 "durable_tombstone_in_both_stores");
            reject(()->bridge.commit(valid,NOW),"stale_expected_head_refused");
            check(coordinator.currentDecision(CLIP).isDeletedTombstone(),
                  "stale_retry_cannot_recreate_save");
        }
        // A restarted Keystore-handle coordinator reads the independently
        // fsynced checkpoint and the microSD journal; no key extraction.
        try(S9MigratedDualStoreCommitV197 restored=
             new S9MigratedDualStoreCommitV197(
                  f.internal.toFile(),f.sd.toFile(),internal,sdKey)){
            check(restored.currentDecision(CLIP).isDeletedTombstone(),
                   "restart_restores_tombstone");
        }
        reject(()->new S9MigratedSignedActionV198(
             new SecretKeySpec(AUTH_BYTES,"AES")),"non_hmac_key_denied");
        check(approvals.get()>0&&sourceChecks.get()>0,
              "separate_gates_exercised");
        Arrays.fill(SD_BYTES,(byte)0);Arrays.fill(INTERNAL_BYTES,(byte)0);
        Arrays.fill(AUTH_BYTES,(byte)0);
        System.out.println("S9_SIGNED_COMMIT_GATE_V201_HOST_PARITY_OK");
    }
}