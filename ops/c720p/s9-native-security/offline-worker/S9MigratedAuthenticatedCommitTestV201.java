package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/** Host-only fake MP4 and fake independent stores; never calls a real phone. */
public final class S9MigratedAuthenticatedCommitTestV201 {
    private static String rep(char c,int n) {
        char[] chars=new char[n];Arrays.fill(chars,c);return new String(chars);
    }
    private static final String ZERO=rep('0',64);
    private static final String NAME="synthetic_1792500000000.mp4";
    private static final String INITIAL="synthetic_1792500000001.mp4";
    private static final byte[] JOURNAL_KEY="synthetic-v201-journal-key-unique-32-bytes".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] HEAD_KEY="synthetic-v201-internal-key-different-32-bytes".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] ACTION_KEY="synthetic-v201-relay-action-key-different-32bytes".getBytes(StandardCharsets.US_ASCII);
    private static final String N0=rep('0',32),N1=rep('1',32),N2=rep('2',32),N3=rep('3',32);
    private static final long NOW=1792500000000L;

    @FunctionalInterface interface Checked { void run() throws Exception; }
    private static void check(boolean b,String reason) {
        if(!b)throw new AssertionError(reason);
    }
    private static void denied(Checked task,String reason)throws Exception {
        boolean refused=false;
        try {task.run();} catch(IOException expected){refused=true;}
        check(refused,reason);
    }
    private static String digest(byte[] data)throws Exception {
        byte[] sha=MessageDigest.getInstance("SHA-256").digest(data);
        char[] hex="0123456789abcdef".toCharArray();
        StringBuilder s=new StringBuilder();
        for(byte b:sha)s.append(hex[(b>>4)&15]).append(hex[b&15]);
        return s.toString();
    }
    private static S9MigratedSignedActionV198.Request sign(
            S9MigratedSignedActionV198 signer,String action,String filename,
            String sha,long bytes,String nonce,long seq,String head,long issue,
            long expiry)throws Exception {
        S9MigratedSignedActionV198.Request unsigned=
            new S9MigratedSignedActionV198.Request(
                "s9_c720p_migrated_action_auth_v198",
                "s9-microsd-metadata-only","POST","/c720p/migrated/action",
                action,filename,sha,bytes,nonce,seq,head,issue,expiry,ZERO);
        return new S9MigratedSignedActionV198.Request(
            unsigned.schema,unsigned.audience,unsigned.method,unsigned.route,
            unsigned.action,unsigned.name,unsigned.sourceSha256,
            unsigned.sourceBytes,unsigned.nonce,unsigned.expectedSequence,
            unsigned.expectedHeadSha256,unsigned.issuedAtMillis,
            unsigned.expiresAtMillis,signer.signForHostTestOnly(unsigned));
    }
    public static void main(String[] args)throws Exception {
        check(args.length==0,"host_synthetic_only");
        Path root=Files.createTempDirectory("s9-v201-synthetic-");
        Path internal=Files.createDirectory(root.resolve("phone_internal"));
        Path sd=Files.createDirectory(root.resolve("micro_sd"));
        Path ledgerDir=Files.createDirectory(sd.resolve("ledger"));
        Path media=Files.createDirectory(sd.resolve("originals"));
        Files.createFile(internal.resolve("c720p-ledger-trusted-head-v196"));
        Files.createFile(internal.resolve(".c720p-ledger-trusted-head-v196.lock"));
        Files.createFile(internal.resolve(".c720p-dual-store-commit-v197.lock"));
        Files.createFile(ledgerDir.resolve("actions-v193.log"));
        Files.createFile(ledgerDir.resolve(".actions-v193.lock"));
        byte[] bytes=new byte[16384];
        for(int i=0;i<bytes.length;i++)bytes[i]=(byte)((i*7)%251);
        Path clip=media.resolve(NAME);
        Files.write(clip,bytes);
        String sha=digest(bytes);
        Map<String,S9MigratedVerifiedSourceV198.Proof> approved=
            new HashMap<String,S9MigratedVerifiedSourceV198.Proof>();
        approved.put(NAME,new S9MigratedVerifiedSourceV198.Proof(NAME,sha,
            bytes.length,true));
        AtomicBoolean allow=new AtomicBoolean(true);
        AtomicLong now=new AtomicLong(NOW);

        // Separate, synthetic-only trusted enrollment: no live bootstrap.
        String initialHead;
        try(S9MigratedMetadataLedgerV193 journal=
                new S9MigratedMetadataLedgerV193(ledgerDir.toFile(),JOURNAL_KEY);
            S9MigratedLedgerTrustedCheckpointV196 checkpoint=
                new S9MigratedLedgerTrustedCheckpointV196(internal.toFile(),HEAD_KEY)) {
            journal.requireTrustedHead(0,ZERO);
            S9MigratedMetadataLedgerV193.Receipt existing=
                journal.commit("save",INITIAL,rep('a',64),123456,N0);
            initialHead=existing.ledgerHeadSha256;
            checkpoint.advance(0,ZERO,1,initialHead);
        }
        try(S9MigratedSignedActionV198 verifier=
                new S9MigratedSignedActionV198(ACTION_KEY);
            S9MigratedDualStoreCommitV197 durable=
                new S9MigratedDualStoreCommitV197(internal.toFile(),
                    ledgerDir.toFile(),HEAD_KEY,JOURNAL_KEY);
            S9MigratedAuthenticatedCommitV201 bridge=
                new S9MigratedAuthenticatedCommitV201(verifier,
                    new S9MigratedVerifiedSourceV198(media.toFile(),approved,
                        (action,name,hash,length)->allow.get()),
                    durable,()->now.get())) {

            S9MigratedSignedActionV198.Request save=
                sign(verifier,"save",NAME,sha,bytes.length,N1,1,initialHead,
                     NOW-1000,NOW+60000);
            denied(()->bridge.commitMetadataOnly(
                new S9MigratedSignedActionV198.Request(
                    save.schema,save.audience,save.method,save.route,save.action,
                    save.name,save.sourceSha256,save.sourceBytes,save.nonce,
                    save.expectedSequence,save.expectedHeadSha256,
                    save.issuedAtMillis,save.expiresAtMillis,rep('e',64))),
                "forged_hmac_refused");
            check(durable.currentDecision(NAME)==null,"forgery_did_not_append");
            now.set(NOW+120000);
            denied(()->bridge.commitMetadataOnly(save),"expired_action_refused");
            now.set(NOW);
            allow.set(false);
            denied(()->bridge.commitMetadataOnly(save),
                "explicit_user_action_denied");
            allow.set(true);
            byte[] changed=Arrays.copyOf(bytes,bytes.length);
            changed[changed.length/2]^=7;
            Files.write(clip,changed);
            denied(()->bridge.commitMetadataOnly(save),
                "same_size_modified_source_sha_refused");
            Files.write(clip,bytes);
            check(durable.currentDecision(NAME)==null,
                "denied_cases_did_not_commit");
            S9MigratedAuthenticatedCommitV201.VerifiedMetadataResult saved=
                bridge.commitMetadataOnly(save);
            check(saved.receipt.ledgerSequence==2 && saved.signedActionVerified
                && saved.sourceAndUserActionVerified
                && saved.independentDurableStoresVerified
                && !saved.mayRemoveOriginal()
                && !saved.liveRemoteEndpointEnabled(),"save_fully_verified_metadata");
            check(durable.currentDecision(NAME).isSaved(),"save_state");
            denied(()->bridge.commitMetadataOnly(save),
                "old_expected_head_stale_on_retry");
            S9MigratedSignedActionV198.Request deletion=
                sign(verifier,"delete",NAME,sha,bytes.length,N2,2,
                     saved.trustedHeadSha256,NOW-1000,NOW+60000);
            allow.set(false);
            denied(()->bridge.commitMetadataOnly(deletion),
                "delete_requires_separate_explicit_approval");
            allow.set(true);
            S9MigratedAuthenticatedCommitV201.VerifiedMetadataResult deleted=
                bridge.commitMetadataOnly(deletion);
            check(deleted.receipt.ledgerSequence==3
                && durable.currentDecision(NAME).isDeletedTombstone(),
                "metadata_delete_is_tombstone_only");
            check(Files.isRegularFile(clip) &&
                  MessageDigest.isEqual(Files.readAllBytes(clip),bytes),
                  "synthetic_mp4_unchanged_after_delete");
            denied(()->bridge.commitMetadataOnly(save),
                "stale_signed_save_never_resurrects");
            bridge.close();
            denied(()->bridge.commitMetadataOnly(deletion),"closed_refused");
        }
        System.out.println("S9_AUTHENTICATED_COMMIT_V201_SYNTHETIC_OK");
    }
}
