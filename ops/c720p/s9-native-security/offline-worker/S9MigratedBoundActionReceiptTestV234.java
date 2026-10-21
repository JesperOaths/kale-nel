package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/** Strictly synthetic host fake files, signed fixture bytes and manual approval. */
public final class S9MigratedBoundActionReceiptTestV234 {
    private static String repeat(char c,int n) {
        char[] chars=new char[n];Arrays.fill(chars,c);return new String(chars);
    }
    private static final String ZERO=repeat('0',64);
    private static final String SHA=repeat('a',64);
    private static final String[] NAMES={
        "synthetic_1792600000000.mp4",
        "synthetic_1792600001000.mp4",
        "synthetic_1792600002000.mp4",
        "synthetic_1792600003000.mp4",
        "synthetic_1792600004000.mp4",
        "synthetic_1792600005000.mp4"
    };
    private static final long NOW=1792700000000L;
    private static final byte[] ANCHOR=
        "synthetic-anchor-V234-no-production-use-key".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] JOURNAL=
        "synthetic-journal-V234-no-production-use-key".getBytes(StandardCharsets.US_ASCII);
    private static final SecretKey MANIFEST=new SecretKeySpec(
        "synthetic-manifest-V234-no-production-use-key".getBytes(StandardCharsets.US_ASCII),
        "HmacSHA256");
    private static final SecretKey INTENT=new SecretKeySpec(
        "synthetic-intent-V234-no-production-use-key".getBytes(StandardCharsets.US_ASCII),
        "HmacSHA256");

    private static void ok(boolean yes,String why) {
        if(!yes)throw new AssertionError(why);
    }
    @FunctionalInterface private interface Checked {void run()throws Exception;}
    private static void denied(Checked work,String why)throws Exception{
        try{work.run();throw new AssertionError("unjustified_success_"+why);}
        catch(IOException expected){}
    }
    private static String hex(byte[] bytes){
        StringBuilder s=new StringBuilder();
        for(byte b:bytes){
            s.append(Character.forDigit((b>>>4)&15,16));
            s.append(Character.forDigit(b&15,16));
        }
        return s.toString();
    }
    private static long size(int i) {
        return i==5?214121934L:12000L;
    }
    private static void writeSyntheticSealedManifest(Path internal)throws Exception {
        StringBuilder content=new StringBuilder("S9-MIGRATED-MANIFEST-V216|1|6\n");
        for(int i=0;i<6;i++) {
            content.append("FILE|").append(NAMES[i]).append('|')
                .append(SHA).append('|').append(size(i)).append("|1\n");
        }
        Mac mac=Mac.getInstance("HmacSHA256");
        mac.init(MANIFEST);
        byte[] h=mac.doFinal(content.toString().getBytes(StandardCharsets.US_ASCII));
        content.append("HMAC|").append(hex(h)).append('\n');
        Files.write(internal.resolve(
            S9MigratedSealedSourceManifestV216.FILE_NAME),
            content.toString().getBytes(StandardCharsets.US_ASCII));
    }
    private static final class Env {
        final Path privateApp,sd;
        Env() throws Exception {
            Path root=Files.createTempDirectory("s9-bound-v234-synthetic-");
            privateApp=Files.createDirectory(root.resolve("fake_app_internal"));
            sd=Files.createDirectory(root.resolve("fake_micro_sd"));
            Files.createFile(privateApp.resolve("c720p-ledger-trusted-head-v196"));
            Files.createFile(privateApp.resolve(".c720p-ledger-trusted-head-v196.lock"));
            Files.createFile(privateApp.resolve(".c720p-dual-store-commit-v197.lock"));
            Files.createFile(sd.resolve("actions-v193.log"));
            Files.createFile(sd.resolve(".actions-v193.lock"));
            writeSyntheticSealedManifest(privateApp);
        }
        S9MigratedSealedSourceManifestV216.Verified sources()throws Exception {
            return S9MigratedSealedSourceManifestV216.verifyExisting(
                privateApp.toFile(),MANIFEST,1L);
        }
        S9MigratedDualStoreCommitV197 genesis()throws Exception{
            return new S9MigratedDualStoreCommitV197(
                privateApp.toFile(),sd.toFile(),ANCHOR,JOURNAL,true,null);
        }
        S9MigratedDualStoreCommitV197 reopen()throws Exception{
            return new S9MigratedDualStoreCommitV197(
                privateApp.toFile(),sd.toFile(),ANCHOR,JOURNAL);
        }
    }
    private static byte[] signAction(S9MigratedSignedActionV198 signer,
            String action,String name,String sha,long bytes,
            String nonce,long sequence,String head)throws Exception {
        S9MigratedSignedActionV198.Request raw=
            new S9MigratedSignedActionV198.Request(
                "s9_c720p_migrated_action_auth_v198","s9-microsd-metadata-only",
                "POST","/c720p/migrated/action",action,name,sha,bytes,nonce,
                sequence,head,NOW-1000,NOW+30000,null);
        String hmac=signer.signForHostTestOnly(raw);
        return ("schema="+raw.schema+"\n"+
            "audience="+raw.audience+"\n"+
            "method="+raw.method+"\n"+
            "route="+raw.route+"\n"+
            "action="+raw.action+"\n"+
            "name="+raw.name+"\n"+
            "source_sha256="+raw.sourceSha256+"\n"+
            "source_bytes="+raw.sourceBytes+"\n"+
            "nonce="+raw.nonce+"\n"+
            "expected_sequence="+raw.expectedSequence+"\n"+
            "expected_head_sha256="+raw.expectedHeadSha256+"\n"+
            "issued_at_ms="+raw.issuedAtMillis+"\n"+
            "expires_at_ms="+raw.expiresAtMillis+"\n"+
            "hmac_sha256="+hmac+"\n").getBytes(StandardCharsets.US_ASCII);
    }
    public static void main(String[] args)throws Exception {
        ok(args.length==0,"no_live_phone");
        Env env=new Env();
        S9MigratedSealedSourceManifestV216.Verified sources=env.sources();
        String trustedDigest=S9MigratedApprovedSixDigestV230.canonicalSha256(
            sources.sourceRows);
        AtomicInteger approved=new AtomicInteger();
        AtomicInteger currentSourceChecks=new AtomicInteger();
        S9MigratedDualStoreCommitV197.AuthorizedSource phoneProof=
            (action,name,sha,bytes)->{
                currentSourceChecks.incrementAndGet();
                return "delete".equals(action) && NAMES[0].equals(name) &&
                    SHA.equals(sha)&&bytes==size(0);
            };
        String priorHead;
        try(S9MigratedDualStoreCommitV197 initial=env.genesis()){
            S9MigratedDualStoreCommitV197.Result saved=
                initial.commitMetadataOnly("save",NAMES[0],SHA,size(0),
                    repeat('1',32),0,ZERO,
                    (act,name,sha,bytes)->NAMES[0].equals(name)&&
                                             SHA.equals(sha)&&bytes==size(0));
            priorHead=saved.trustedHeadSha256;
        }
        try(S9MigratedSignedActionV198 signer=
                new S9MigratedSignedActionV198(INTENT);
            S9MigratedDualStoreCommitV197 existing=env.reopen()){
            S9MigratedSignedCommitGateV201 gate=
                new S9MigratedSignedCommitGateV201(
                    signer,existing,phoneProof,req->{
                        approved.incrementAndGet();return "delete".equals(req.action);
                    });
            S9MigratedPostcommitV232 postcommit=
                new S9MigratedPostcommitV232(gate,existing);
            byte[] valid=signAction(signer,"delete",NAMES[0],SHA,size(0),
                repeat('2',32),1,priorHead);
            String challenge=repeat('c',32);
            denied(()->S9MigratedBoundActionReceiptV234
                    .executeAfterIndependentAuthentication(
                     valid,NOW,"invalid-challenge",sources,trustedDigest,
                     postcommit,existing),"invalid_challenge_precommit");
            denied(()->S9MigratedBoundActionReceiptV234
                    .executeAfterIndependentAuthentication(
                     valid,NOW,challenge,sources,repeat('f',64),
                     postcommit,existing),"wrong_external_digest_precommit");
            byte[] other=signAction(signer,"delete",NAMES[1],SHA,size(1),
                    repeat('3',32),1,priorHead);
            denied(()->S9MigratedBoundActionReceiptV234
                    .executeAfterIndependentAuthentication(
                     other,NOW,challenge,sources,trustedDigest,
                     postcommit,existing),"unapproved_source_refused");
            byte[] wrongSha=signAction(signer,"delete",NAMES[0],
                     repeat('e',64),size(0),repeat('4',32),1,priorHead);
            denied(()->S9MigratedBoundActionReceiptV234
                    .executeAfterIndependentAuthentication(
                     wrongSha,NOW,challenge,sources,trustedDigest,
                     postcommit,existing),"source_sha_mismatch");
            byte[] wrongSize=signAction(signer,"delete",NAMES[0],SHA,
                     size(0)+1,repeat('5',32),1,priorHead);
            denied(()->S9MigratedBoundActionReceiptV234
                    .executeAfterIndependentAuthentication(
                     wrongSize,NOW,challenge,sources,trustedDigest,
                     postcommit,existing),"source_bytes_mismatch");
            ok(approved.get()==0&&currentSourceChecks.get()==0 &&
               existing.currentDecision(NAMES[0]).isSaved(),
               "precommit_denials_did_not_invoke_authority");
            byte[] output=S9MigratedBoundActionReceiptV234
                    .executeAfterIndependentAuthentication(
                     valid,NOW,challenge,sources,trustedDigest,
                     postcommit,existing);
            String payload=new String(output,StandardCharsets.US_ASCII);
            ok(payload.contains("\"schema\":\"s9_c720p_migrated_bound_action_v234\"")
              && payload.contains("\"sourceName\":\""+NAMES[0]+"\"")
              && payload.contains("\"sourceSha256\":\""+SHA+"\"")
              && payload.contains("\"sourceBytes\":"+size(0))
              && payload.contains("\"manifestGeneration\":1")
              && payload.contains("\"journalSequence\":2")
              && payload.contains("\"state\":\"deleted_tombstone\"")
              && payload.contains("\"allowsOriginalRemoval\":false")
              && payload.contains("\"provesHumanViewedMedia\":false")
              && payload.contains("\"provesOriginalAvailable\":false")
              && approved.get()==1 && currentSourceChecks.get()==1,
              "source_qualified_metadata_only_receipt");
            denied(()->S9MigratedBoundActionReceiptV234
                    .executeAfterIndependentAuthentication(
                     valid,NOW,challenge,sources,trustedDigest,
                     postcommit,existing),"signed_nonce_replay_refused");
        }
        try(S9MigratedDualStoreCommitV197 restart=env.reopen()){
            ok(restart.currentDecision(NAMES[0]).isDeletedTombstone(),
                    "restart_trusted_tombstone_survives");
        }
        ok(!S9MigratedBoundActionReceiptV234.hasNetworkListener() &&
           !S9MigratedBoundActionReceiptV234.provisionsFirstEnrollment() &&
           !S9MigratedBoundActionReceiptV234.grantsMediaRetirement() &&
           !S9MigratedBoundActionReceiptV234.provesHumanViewing(),
           "no_network_enrollment_retirement_or_viewing_claim");
        System.out.println("S9_MIGRATED_BOUND_RECEIPT_V234_HOST_VERIFIED");
    }
}
