package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicInteger;

/** Host-JVM fake files only. No Android phone, actual clips or real keys. */
public final class S9MigratedDualStoreCommitTestV197 {
    private static final String NAME="synthetic_1792300000000.mp4";
    private static final String OTHER="synthetic_1792300001000.mp4";
    private static final String SHA=repeat('a',64);
    private static final String ZERO=repeat('0',64);
    private static final byte[] JOURNAL_KEY="host-only-microsd-key-for-synthetic-v197".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] ANCHOR_KEY="separate-host-internal-checkpoint-key-v197".getBytes(StandardCharsets.US_ASCII);
    private static final String N1=repeat('1',32),N2=repeat('2',32),N3=repeat('3',32);
    private static String repeat(char c,int count) {
        char[] chars=new char[count];Arrays.fill(chars,c);return new String(chars);
    }
    private static void ok(boolean value,String code) {
        if(!value)throw new AssertionError(code);
    }
    @FunctionalInterface interface Checked {void run()throws Exception;}
    private static void denies(Checked task,String code)throws Exception {
        try{task.run();throw new AssertionError("unexpected_success_"+code);}
        catch(IOException expected){}
    }
    private static final class Fixture {
        final Path internal,sd;
        Fixture()throws IOException {
            Path root=Files.createTempDirectory("s9-two-store-v197-host-");
            internal=Files.createDirectory(root.resolve("internal_test"));
            sd=Files.createDirectory(root.resolve("sd_test"));
            Files.createFile(internal.resolve("c720p-ledger-trusted-head-v196"));
            Files.createFile(internal.resolve(".c720p-ledger-trusted-head-v196.lock"));
            Files.createFile(internal.resolve(".c720p-dual-store-commit-v197.lock"));
            Files.createFile(sd.resolve("actions-v193.log"));
            Files.createFile(sd.resolve(".actions-v193.lock"));
        }
        S9MigratedDualStoreCommitV197 synthetic(
                S9MigratedDualStoreCommitV197.AfterJournalHook hook)throws IOException {
            return new S9MigratedDualStoreCommitV197(internal.toFile(),sd.toFile(),
                ANCHOR_KEY,JOURNAL_KEY,true,hook);
        }
        S9MigratedDualStoreCommitV197 normal()throws IOException {
            return new S9MigratedDualStoreCommitV197(internal.toFile(),sd.toFile(),
                ANCHOR_KEY,JOURNAL_KEY);
        }
    }
    private static final S9MigratedDualStoreCommitV197.AuthorizedSource TRUSTED_TEST =
        (action,name,sha,bytes)->(action.equals("save")||action.equals("delete"))
            && (NAME.equals(name)||OTHER.equals(name))
            && SHA.equals(sha) && bytes==123456;

    private static void proveSuccessfulPair()throws Exception {
        Fixture f=new Fixture();
        try(S9MigratedDualStoreCommitV197 unprovisioned=f.normal()) {
            denies(()->unprovisioned.commitMetadataOnly("save",NAME,SHA,123456,
                N1,0,ZERO,TRUSTED_TEST),"public_genesis_not_authorized");
            ok(Files.size(f.sd.resolve("actions-v193.log"))==0,
                "public_genesis_did_not_touch_journal");
        }
        S9MigratedMetadataLedgerV193.Receipt first;
        try(S9MigratedDualStoreCommitV197 c=f.synthetic(null)) {
            ok(c.currentDecision(NAME)==null,"synthetic_genesis_read");
            AtomicInteger admitted=new AtomicInteger();
            S9MigratedDualStoreCommitV197.AuthorizedSource auth=(a,n,s,b)->{
                admitted.incrementAndGet();return TRUSTED_TEST.permits(a,n,s,b);
            };
            denies(()->c.commitMetadataOnly("save",NAME,SHA,123456,N1,
                0,ZERO,null),"missing_trusted_source");
            denies(()->c.commitMetadataOnly("save",NAME,SHA,123456,N1,
                0,ZERO,(a,n,s,b)->false),"untrusted_source_denied");
            denies(()->c.commitMetadataOnly("save",NAME,SHA,123456,N1,
                0,repeat('e',64),auth),"stale_head_before_source_auth");
            ok(admitted.get()==0,"stale_head_aborted_before_authorization");
            S9MigratedDualStoreCommitV197.Result saved=c.commitMetadataOnly(
                "save",NAME,SHA,123456,N1,0,ZERO,auth);
            first=saved.receipt;
            ok(saved.bothStoresVerified&&saved.trustedSequence==1
               &&saved.trustedHeadSha256.equals(first.ledgerHeadSha256)
               &&!saved.mayRemoveOriginal()&&!saved.actualMediaDeleted()
               &&!saved.personReviewsModified(),"save_verified_both_stores");
            long size=Files.size(f.sd.resolve("actions-v193.log"));
            S9MigratedDualStoreCommitV197.Result retry=c.commitMetadataOnly(
                "save",NAME,SHA,123456,N1,1,first.ledgerHeadSha256,auth);
            ok(retry.receipt.hmacSha256.equals(first.hmacSha256)
               &&Files.size(f.sd.resolve("actions-v193.log"))==size,
               "same_nonce_current_action_idempotent");
            denies(()->c.commitMetadataOnly("delete",NAME,SHA,123456,N2,
                0,ZERO,auth),"stale_checkpoint_cannot_write");
            S9MigratedDualStoreCommitV197.Result deleted=c.commitMetadataOnly(
                "delete",NAME,SHA,123456,N2,1,first.ledgerHeadSha256,auth);
            ok(deleted.trustedSequence==2
               &&c.currentDecision(NAME).isDeletedTombstone(),
               "delete_is_current_metadata_tombstone");
            denies(()->c.commitMetadataOnly("save",NAME,SHA,123456,N1,
                2,deleted.trustedHeadSha256,auth),"old_save_nonce_cannot_resurrect");
            // Future caller retries only the CURRENT tombstone.
            S9MigratedDualStoreCommitV197.Result current=c.commitMetadataOnly(
                "delete",NAME,SHA,123456,N2,2,deleted.trustedHeadSha256,auth);
            ok(current.trustedSequence==2
                &&current.receipt.hmacSha256.equals(deleted.receipt.hmacSha256),
                "current_tombstone_idempotent");
        }
        try(S9MigratedDualStoreCommitV197 reopened=f.normal()){
            ok(reopened.currentDecision(NAME).isDeletedTombstone(),
               "host_restart_recovers_current_delete");
        }
        // A complete signed microSD record is dropped after restart.
        Path log=f.sd.resolve("actions-v193.log");
        String good=new String(Files.readAllBytes(log),StandardCharsets.US_ASCII);
        int pos=good.lastIndexOf('\n',good.length()-2);
        ok(pos>0,"two_record_test_fixture");
        Files.write(log,good.substring(0,pos+1).getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedDualStoreCommitV197 rolledBack=f.normal()){
            denies(()->rolledBack.currentDecision(NAME),
                   "independent_checkpoint_rejects_complete_delete_rollback");
            denies(()->rolledBack.commitMetadataOnly("save",NAME,SHA,123456,
                N3,2,repeat('e',64),TRUSTED_TEST),
                "cannot_write_during_valid_hmac_prefix_rollback");
        }
        Files.write(log,good.getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedDualStoreCommitV197 restored=f.normal()){
            ok(restored.currentDecision(NAME).isDeletedTombstone(),
               "restored_host_fixture_consistency");
        }
    }

    private static void proveCrashGapNeverReceipted()throws Exception {
        Fixture f=new Fixture();
        AtomicInteger postSyncCalls=new AtomicInteger();
        try(S9MigratedDualStoreCommitV197 interrupted=f.synthetic(()->{
            postSyncCalls.incrementAndGet();
            throw new IOException("host_test_injected_after_micro_sd_sync");
        })) {
            denies(()->interrupted.commitMetadataOnly("save",NAME,SHA,
                   123456,N1,0,ZERO,TRUSTED_TEST),
                   "injected_crash_after_sd_append");
            ok(postSyncCalls.get()==1,"one_injected_gap_only");
        }
        try(S9MigratedMetadataLedgerV193 raw=
                new S9MigratedMetadataLedgerV193(f.sd.toFile(),JOURNAL_KEY);
            S9MigratedLedgerTrustedCheckpointV196 anchor=
                new S9MigratedLedgerTrustedCheckpointV196(
                    f.internal.toFile(),ANCHOR_KEY)) {
            ok(raw.verifiedCount()==1 && anchor.read().sequence==0,
                "physical_gap_simulated_after_micro_sd_only");
        }
        try(S9MigratedDualStoreCommitV197 retried=f.synthetic(null)){
            denies(()->retried.currentDecision(NAME),
                   "journal_ahead_blocks_read");
            denies(()->retried.commitMetadataOnly("save",NAME,SHA,123456,
                    N1,0,ZERO,TRUSTED_TEST),
                   "retry_cannot_hide_unanchored_action");
        }
    }

    private static void proveConcurrentLockAndIndependentSecrets()throws Exception {
        Fixture f=new Fixture();
        denies(()->new S9MigratedDualStoreCommitV197(f.internal.toFile(),
            f.sd.toFile(),ANCHOR_KEY,ANCHOR_KEY),
            "independent_keys_must_differ");
        try(S9MigratedDualStoreCommitV197 coordinator=f.synthetic(null);
            FileChannel competitor=FileChannel.open(
                f.internal.resolve(".c720p-dual-store-commit-v197.lock"),
                StandardOpenOption.WRITE);
            FileLock held=competitor.lock()) {
            denies(()->coordinator.commitMetadataOnly("save",NAME,SHA,
                123456,N1,0,ZERO,TRUSTED_TEST),"coordinator_mutex_refuses_overlap");
            denies(()->coordinator.currentDecision(NAME),
                   "read_refuses_racing_writer");
            ok(Files.size(f.sd.resolve("actions-v193.log"))==0,
               "mutex_conflict_makes_no_journal_change");
        }
        Files.delete(f.internal.resolve(".c720p-dual-store-commit-v197.lock"));
        denies(()->f.normal(),"preprovisioned_mutex_missing");
    }
    private static void provePostConstructionLockReplacementRejected()
            throws Exception {
        Fixture f=new Fixture();
        Path lock=f.internal.resolve(".c720p-dual-store-commit-v197.lock");
        try(S9MigratedDualStoreCommitV197 instance=f.normal()) {
            Files.delete(lock);
            Files.createSymbolicLink(lock,
                f.internal.resolve("c720p-ledger-trusted-head-v196"));
            try {instance.currentDecision(NAME);
                 throw new AssertionError("post_ctor_symlink_read_allowed");}
            catch(IOException expected) {
                ok("preprovisioned_coordinator_lock_required".equals(
                    expected.getMessage()),"post_ctor_symlink_read_blocked");
            }
            try {instance.commitMetadataOnly("save",NAME,SHA,123456,
                     N1,0,ZERO,TRUSTED_TEST);
                 throw new AssertionError("post_ctor_symlink_write_allowed");}
            catch(IOException expected) {
                ok("preprovisioned_coordinator_lock_required".equals(
                    expected.getMessage()),"post_ctor_symlink_write_blocked");
            }
        }
        ok(Files.size(f.sd.resolve("actions-v193.log"))==0,
           "symlink_replacement_never_committed");
        Files.delete(lock);
        Files.createFile(lock);
        try(S9MigratedDualStoreCommitV197 instance=f.normal()) {
            Files.write(lock,new byte[]{1});
            try {instance.currentDecision(NAME);
                 throw new AssertionError("nonempty_replaced_lock_allowed");}
            catch(IOException expected) {
                ok("preprovisioned_coordinator_lock_required".equals(
                    expected.getMessage()),"nonempty_replaced_lock_blocked");
            }
        }
        ok(Files.size(f.sd.resolve("actions-v193.log"))==0,
           "nonempty_lock_never_committed");
    }

    public static void main(String[] args)throws Exception {
        ok(args.length==0,"host_only_no_phone");
        proveSuccessfulPair();
        proveCrashGapNeverReceipted();
        proveConcurrentLockAndIndependentSecrets();
        provePostConstructionLockReplacementRejected();
        System.out.println("S9_DUAL_STORE_COMMIT_V197_HOST_TESTS_OK");
    }
}
