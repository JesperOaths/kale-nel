package nl.kalenel.s9offline;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.StandardOpenOption;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

/** Host-JVM synthetic regression only, not an Android task or a real receipt. */
public final class S9MigratedMetadataLedgerTestV193 {
    private static final String A = "motion_1792200000000.mp4";
    private static final String B = "motion_1792200010000.mp4";
    private static final String SOURCE_A = repeat('a',64);
    private static final String SOURCE_B = repeat('b',64);
    private static final String N1 = repeat('1',32);
    private static final String N2 = repeat('2',32);
    private static final String N3 = repeat('3',32);
    private static final byte[] KEY =
        "synthetic-test-only-s9-migrated-ledger-32-byte-secret".getBytes(StandardCharsets.US_ASCII);

    private static String repeat(char c,int length) {
        char[] buf=new char[length];Arrays.fill(buf,c);return new String(buf);
    }
    private static void ok(boolean value,String why) {
        if (!value)throw new AssertionError(why);
    }
    private static void denied(CheckedTask task,String why) throws Exception {
        try {task.run();throw new AssertionError("unexpected_success_"+why);}
        catch (IOException expected) { /* explicit fail-closed refusal */ }
    }
    @FunctionalInterface interface CheckedTask {void run()throws Exception;}
    private static Path provision(Path parent) throws IOException {
        Path dir=Files.createDirectory(parent.resolve("isolated-private-metadata"));
        Files.createFile(dir.resolve("actions-v193.log"));
        Files.createFile(dir.resolve(".actions-v193.lock"));
        return dir;
    }
    private static String json(S9MigratedMetadataLedgerV193.Receipt r) {
        return "{\"schema\":\""+r.schema()+"\",\"source\":\""+r.source()+"\""
            +",\"status\":\""+r.status()+"\",\"durable\":"+r.durable
            +",\"action\":\""+r.action+"\",\"nonce\":\""+r.nonce
            +"\",\"ledger_sequence\":"+r.ledgerSequence
            +",\"ledger_head_sha256\":\""+r.ledgerHeadSha256
            +"\",\"hmac_sha256\":\""+r.hmacSha256+"\"}";
    }
    public static void main(String[] args)throws Exception {
        ok(args.length==0,"host_selftest_only");
        Path root=Files.createTempDirectory("s9-migrated-metadata-test-v193-");
        Path dir=provision(root);
        Path file=dir.resolve("actions-v193.log");
        S9MigratedMetadataLedgerV193.Receipt synthetic;
        try(S9MigratedMetadataLedgerV193 ledger=
              new S9MigratedMetadataLedgerV193(dir.toFile(),KEY)){
            ok(ledger.verifiedCount()==0,"uninitialized_count");
            ok(ledger.latestDecision(A)==null,"untracked_clip_has_no_authority");
            denied(()->ledger.latestDecision("../unsafe.mp4"),"current_state_traversal");
            synthetic=ledger.commit("save",A,SOURCE_A,123456,N1);
            ok(synthetic.ledgerSequence==1 && synthetic.durable,"first_commit");
            S9MigratedMetadataLedgerV193.CurrentDecision saved=ledger.latestDecision(A);
            ok(saved!=null&&saved.isSaved()&&!saved.isDeletedTombstone()
              &&saved.ledgerSequence==1&&!saved.mayRemoveOriginal()
              &&SOURCE_A.equals(saved.sourceSha256),"current_save_visible_without_write");
            ok(!synthetic.mayRemoveOriginal() && !synthetic.personReviewsModified(),"metadata_only");
            long firstSize=Files.size(file);
            S9MigratedMetadataLedgerV193.Receipt duplicate=
                ledger.commit("save",A,SOURCE_A,123456,N1);
            ok(duplicate.ledgerSequence==1 && Files.size(file)==firstSize
               && duplicate.hmacSha256.equals(synthetic.hmacSha256),"idempotent_retry");
            denied(()->ledger.commit("delete",A,SOURCE_A,123456,N1),"nonce_changed_action");
            denied(()->ledger.commit("save",B,SOURCE_B,789012,N1),"nonce_changed_clip");
            denied(()->ledger.commit("save",A,SOURCE_A,123457,N1),"nonce_changed_size");
            denied(()->ledger.commit("save","../bad.mp4",SOURCE_A,123456,N2),"traversal");
            denied(()->ledger.commit("save",A,"z"+SOURCE_A,123456,N2),"sha_invalid");
            denied(()->ledger.commit("save",A,SOURCE_A,123456,"badnonce"),"nonce_invalid");
            denied(()->ledger.commit("purge",A,SOURCE_A,123456,N2),"action_invalid");
            S9MigratedMetadataLedgerV193.Receipt tombstone=
                ledger.commit("delete",A,SOURCE_A,123456,N2);
            ok(tombstone.ledgerSequence==2 && ledger.verifiedCount()==2,"durable_tombstone");
            S9MigratedMetadataLedgerV193.CurrentDecision deleted=ledger.latestDecision(A);
            ok(deleted!=null&&deleted.isDeletedTombstone()&&!deleted.isSaved()
               &&deleted.ledgerSequence==2&&!deleted.mayRemoveOriginal(),
               "latest_delete_not_historical_save");
            denied(()->ledger.commit("save",A,SOURCE_A,123456,N3),"explicit_restore_required");
            // An old Save receipt must not masquerade as a current Saved
            // decision once Delete's tombstone has been durably committed.
            denied(()->ledger.commit("save",A,SOURCE_A,123456,N1),
                   "superseded_save_nonce_after_delete");
            S9MigratedMetadataLedgerV193.Receipt repeatedDelete=
                ledger.commit("delete",A,SOURCE_A,123456,N2);
            ok(repeatedDelete.hmacSha256.equals(tombstone.hmacSha256),
               "latest_tombstone_still_idempotent");
            // A temporary same-JVM writer lock must never let a reader
            // report a stale state, partial row, or unchecked exception.
            try(FileChannel competitor=FileChannel.open(
                   dir.resolve(".actions-v193.lock"),StandardOpenOption.WRITE);
                FileLock held=competitor.lock()) {
                denied(()->ledger.latestDecision(A),"overlapping_read_lock_refused");
                denied(()->ledger.verifiedCount(),"overlapping_count_lock_refused");
                denied(()->ledger.commit("save",B,SOURCE_B,789012,N3),
                       "overlapping_commit_lock_refused");
            }
            // B is independent of A's tombstone; no A/B source mixing.
            S9MigratedMetadataLedgerV193.Receipt separate=
                ledger.commit("save",B,SOURCE_B,789012,N3);
            ok(separate.ledgerSequence==3,"third_action");
            ok(ledger.latestDecision(A).isDeletedTombstone()&&
               ledger.latestDecision(B).isSaved()&&
               ledger.latestDecision(B).ledgerSequence==3,
               "independent_clip_latest_state_kept");
        }
        try(S9MigratedMetadataLedgerV193 reloaded=
              new S9MigratedMetadataLedgerV193(dir.toFile(),KEY)){
            ok(reloaded.verifiedCount()==3,"restart_reads_durable_records");
            ok(reloaded.latestDecision(A).isDeletedTombstone()
               &&reloaded.latestDecision(B).isSaved()
               &&reloaded.latestDecision(B).sourceBytes==789012,
               "latest_state_recovered_after_restart");
            // Historical Save may still be cryptographically authentic,
            // but replay after a newer tombstone is not an active receipt.
            denied(()->reloaded.commit("save",A,SOURCE_A,123456,N1),
                   "restart_rejects_superseded_save");
            S9MigratedMetadataLedgerV193.Receipt repeated=
                reloaded.commit("delete",A,SOURCE_A,123456,N2);
            ok(repeated.action.equals("delete")&&repeated.ledgerSequence==2,
               "restart_idempotent_latest_delete");
        }
        // Private ledger key authenticates each record. Changed metadata must
        // not become authoritative after an in-place disk mutation.
        String good=new String(Files.readAllBytes(file),StandardCharsets.US_ASCII);
        String corrupted=good.replace("|save|"+B+"|","|save|"+A+"|");
        ok(!corrupted.equals(good),"tamper_test_construction");
        Files.write(file,corrupted.getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedMetadataLedgerV193 bad=
              new S9MigratedMetadataLedgerV193(dir.toFile(),KEY)){
            denied(()->bad.verifiedCount(),"tampered_chain");
            denied(()->bad.latestDecision(A),"tampered_current_state_not_authoritative");
        }
        Files.write(file,good.substring(0,good.length()-1).getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedMetadataLedgerV193 cut=
              new S9MigratedMetadataLedgerV193(dir.toFile(),KEY)){
            denied(()->cut.verifiedCount(),"partial_crash_record");
            denied(()->cut.latestDecision(A),"partial_record_state_not_authoritative");
        }
        Files.write(file,good.getBytes(StandardCharsets.US_ASCII));
        byte[] wrong="different-synthetic-ledger-key-with-safe-minimum-length".getBytes(
            StandardCharsets.US_ASCII);
        try(S9MigratedMetadataLedgerV193 wrongKey=
              new S9MigratedMetadataLedgerV193(dir.toFile(),wrong)){
            denied(()->wrongKey.verifiedCount(),"wrong_key");
            denied(()->wrongKey.latestDecision(A),"wrong_key_state");
        }
        // Refuse symlink substitution and unprovisioned files.
        Path alias=root.resolve("symlink");
        Files.createSymbolicLink(alias,dir);
        denied(()->new S9MigratedMetadataLedgerV193(alias.toFile(),KEY),"dir_symlink");
        Files.delete(dir.resolve(".actions-v193.lock"));
        denied(()->new S9MigratedMetadataLedgerV193(dir.toFile(),KEY),"lock_missing");
        System.out.println("S9_LEDGER_V193_SYNTHETIC_RECEIPT "+json(synthetic));
        System.out.println("S9_LEDGER_V193_SYNTHETIC_TESTS_OK");
    }
}
