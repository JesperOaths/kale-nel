package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/** Fake local files and keys, zero phone/media/browser/real approvals. */
public final class S9MigratedPostcommitTestV232 {
    private static String hex(char c,int n){
        char[] a=new char[n];Arrays.fill(a,c);return new String(a);
    }
    private static final String NAME="synthetic_1792100000000.mp4";
    private static final String SHA=hex('a',64), ZERO=hex('0',64);
    private static final long NOW=1792600000000L;
    private static SecretKey key(String name){
        return new SecretKeySpec(
            ("host-synthetic-test-only-v232-"+name+"-long-secret").getBytes(
                StandardCharsets.US_ASCII),"HmacSHA256");
    }
    private static void ok(boolean passed,String why){
        if(!passed)throw new AssertionError(why);
    }
    @FunctionalInterface interface Checked {void run()throws Exception;}
    private static void deny(Checked r,String why)throws Exception {
        try{r.run();throw new AssertionError("unexpected_success_"+why);}
        catch(IOException correct){}
    }
    private static byte[] signed(
        S9MigratedSignedActionV198 verifier,String action,String nonce,long seq,
        String head)throws Exception {
        S9MigratedSignedActionV198.Request raw=
          new S9MigratedSignedActionV198.Request(
            "s9_c720p_migrated_action_auth_v198","s9-microsd-metadata-only",
            "POST","/c720p/migrated/action",action,NAME,SHA,123456,nonce,
            seq,head,NOW-1000,NOW+60000,null);
        String tag=verifier.signForHostTestOnly(raw);
        return ("schema="+raw.schema+"\n"+
            "audience="+raw.audience+"\n"+"method="+raw.method+"\n"+
            "route="+raw.route+"\n"+"action="+raw.action+"\n"+
            "name="+raw.name+"\n"+"source_sha256="+raw.sourceSha256+"\n"+
            "source_bytes="+raw.sourceBytes+"\n"+"nonce="+raw.nonce+"\n"+
            "expected_sequence="+raw.expectedSequence+"\n"+
            "expected_head_sha256="+raw.expectedHeadSha256+"\n"+
            "issued_at_ms="+raw.issuedAtMillis+"\n"+
            "expires_at_ms="+raw.expiresAtMillis+"\n"+
            "hmac_sha256="+tag+"\n").getBytes(StandardCharsets.US_ASCII);
    }
    public static void main(String[] args)throws Exception {
        ok(args.length==0,"no_host_args");
        Path root=Files.createTempDirectory("v232-synthetic");
        Path internal=Files.createDirectory(root.resolve("private"));
        Path sd=Files.createDirectory(root.resolve("fake-sd"));
        Files.createFile(internal.resolve("c720p-ledger-trusted-head-v196"));
        Files.createFile(internal.resolve(".c720p-ledger-trusted-head-v196.lock"));
        Files.createFile(internal.resolve(".c720p-dual-store-commit-v197.lock"));
        Files.createFile(sd.resolve("actions-v193.log"));
        Files.createFile(sd.resolve(".actions-v193.lock"));
        SecretKey anchor=key("checkpoint"),journalKey=key("journal");
        S9MigratedMetadataLedgerV193.Receipt first;
        // Only synthetic fixture may establish the initial trusted checkpoint.
        try(S9MigratedMetadataLedgerV193 ledger=
              new S9MigratedMetadataLedgerV193(sd.toFile(),journalKey);
            S9MigratedLedgerTrustedCheckpointV196 checkpoint=
              new S9MigratedLedgerTrustedCheckpointV196(
                internal.toFile(),anchor)) {
            first=ledger.commit("save",NAME,SHA,123456,hex('1',32));
            checkpoint.advance(0,ZERO,1,first.ledgerHeadSha256);
        }
        try(S9MigratedSignedActionV198 verifier=
              new S9MigratedSignedActionV198(key("intent"));
            S9MigratedDualStoreCommitV197 dual=
              new S9MigratedDualStoreCommitV197(
                internal.toFile(),sd.toFile(),anchor,journalKey)) {
            S9MigratedSignedCommitGateV201.IndependentUserApproval user=
              signed->"delete".equals(signed.action);
            S9MigratedDualStoreCommitV197.AuthorizedSource onPhone=
              (action,name,sha,size)->"delete".equals(action)&&
                NAME.equals(name)&&SHA.equals(sha)&&size==123456;
            S9MigratedSignedCommitGateV201 gate=
              new S9MigratedSignedCommitGateV201(
                verifier,dual,onPhone,user);
            S9MigratedPostcommitV232 backend=new S9MigratedPostcommitV232(
                gate,dual);
            byte[] valid=signed(verifier,"delete",hex('2',32),1,
                                first.ledgerHeadSha256);
            deny(()->backend.accept(valid,NOW+90000),"expired");
            byte[] unauthorized=signed(verifier,"save",hex('3',32),1,
                                first.ledgerHeadSha256);
            deny(()->backend.accept(unauthorized,NOW),"no_user_approval");
            ok(dual.currentDecision(NAME).isSaved(),"denials_no_mutation");
            byte[] corrupt=Arrays.copyOf(valid,valid.length);
            corrupt[8]=(byte)'X';
            deny(()->backend.accept(corrupt,NOW),"malformed_wire");
            S9MigratedPostcommitV232.Acknowledgement accepted=
                backend.accept(valid,NOW);
            ok(accepted.sequence==2 &&
               "deleted_tombstone".equals(accepted.state) &&
               accepted.headSha256.length()==64 &&
               !accepted.authorizesMediaRetirement() &&
               !accepted.modifiesOriginalVideo() &&
               !accepted.changesManualDecisions() &&
               !backend.hasListener()&&!backend.provisionsEnrollment(),
               "verified_two_store_readback_only");
            deny(()->backend.accept(valid,NOW),"replay_stale_head");
        }
        try(S9MigratedDualStoreCommitV197 reopened=
              new S9MigratedDualStoreCommitV197(
                internal.toFile(),sd.toFile(),anchor,journalKey)){
            ok(reopened.currentDecision(NAME).isDeletedTombstone(),
               "restart_preserves_latest_authenticated_decision");
        }
        System.out.println("S9_MIGRATED_POSTCOMMIT_V232_HOST_VERIFIED");
    }
}
