package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

/** Synthetic, host-only; no phone, media, credentials or real state. */
public final class S9MigratedDualStoreCoordinatorTestV197 {
    private static String repeat(char c,int n) {
        char[] x=new char[n];Arrays.fill(x,c);return new String(x);
    }
    private static final String CLIP="synthetic_1792600000000.mp4";
    private static final String OTHER="synthetic_1792600001000.mp4";
    private static final String SHA=repeat('a',64);
    private static final String ZERO=repeat('0',64);
    private static final byte[] SD_KEY=repeat('k',48).getBytes(StandardCharsets.US_ASCII);
    private static final byte[] INTERNAL_KEY=repeat('s',48).getBytes(StandardCharsets.US_ASCII);
    @FunctionalInterface interface Op { void run() throws Exception; }
    private static void require(boolean condition,String why) {
        if(!condition)throw new AssertionError(why);
    }
    private static void denied(Op operation,String why)throws Exception {
        try{operation.run();throw new AssertionError("unexpected_success_"+why);}
        catch(IOException expected){}
    }
    static final class Fixture {
        final Path root,sd,internal,log,checkpoint;
        Fixture()throws Exception {
            root=Files.createTempDirectory("s9-dual-store-v197-");
            sd=Files.createDirectory(root.resolve("simulated_microsd"));
            internal=Files.createDirectory(root.resolve("simulated_app_private"));
            log=Files.createFile(sd.resolve("actions-v193.log"));
            Files.createFile(sd.resolve(".actions-v193.lock"));
            checkpoint=Files.createFile(internal.resolve("c720p-ledger-trusted-head-v196"));
            Files.createFile(internal.resolve(".c720p-ledger-trusted-head-v196.lock"));
            Files.createFile(internal.resolve(".c720p-migrated-dual-store-v197.lock"));
        }
        S9MigratedDualStoreCoordinatorV197 open()throws IOException {
            return new S9MigratedDualStoreCoordinatorV197(internal.toFile(),sd.toFile(),
                                                          SD_KEY,INTERNAL_KEY);
        }
    }

    private static void happyAndIdempotence()throws Exception {
        Fixture f=new Fixture();
        String last;
        try(S9MigratedDualStoreCoordinatorV197 service=f.open()) {
            S9MigratedDualStoreCoordinatorV197.State genesis=service.verifyReadOnly();
            require(genesis.sequence==0&&!genesis.trustedCheckpointVerified,
                    "genesis_requires_verified_empty_sd");
            require(!genesis.mayRemoveOriginal()&&!genesis.authorizesRemoteMutation(),
                    "no_remote_action_authority");
            S9MigratedMetadataLedgerV193.Receipt save=service.commitVerifiedMetadata(
                "save",CLIP,SHA,123456,repeat('1',32));
            require(save.ledgerSequence==1 && !save.mayRemoveOriginal(),"fsynced_save");
            S9MigratedMetadataLedgerV193.Receipt retry=service.commitVerifiedMetadata(
                "save",CLIP,SHA,123456,repeat('1',32));
            require(retry.ledgerHeadSha256.equals(save.ledgerHeadSha256),"last_receipt_replay");
            require(service.verifyReadOnly().sequence==1,"commit_checkpoint_advanced");
            service.commitVerifiedMetadata("save",OTHER,SHA,123456,repeat('3',32));
            denied(()->service.commitVerifiedMetadata(
                "save",CLIP,SHA,123456,repeat('1',32)),"stale_global_save_receipt");
            S9MigratedMetadataLedgerV193.Receipt deleted=service.commitVerifiedMetadata(
                "delete",CLIP,SHA,123456,repeat('2',32));
            require(deleted.ledgerSequence==3 && !deleted.personReviewsModified(),"delete_tombstone");
            denied(()->service.commitVerifiedMetadata(
                "save",CLIP,SHA,123456,repeat('4',32)),"cannot_restore_deleted_without_protocol");
            last=deleted.ledgerHeadSha256;
            require(service.verifyReadOnly().sequence==3,"delete_and_checkpoint_match");
        }
        try(S9MigratedDualStoreCoordinatorV197 reopened=f.open();
            S9MigratedMetadataLedgerV193 journal=new S9MigratedMetadataLedgerV193(
                f.sd.toFile(),SD_KEY)) {
            require(reopened.verifyReadOnly().sequence==3,"restart_verified");
            journal.requireTrustedHead(3,last);
            require(journal.latestDecision(CLIP).isDeletedTombstone(),"no_delete_resurrection");
        }
    }

    private static void crashBetweenStoresMustFailClosed()throws Exception {
        Fixture f=new Fixture();
        // Simulate a hard crash after SD FileDescriptor.sync, before independent
        // app-private CAS/fsync; deliberate bypass solely in synthetic fixture.
        try(S9MigratedMetadataLedgerV193 sd=new S9MigratedMetadataLedgerV193(
                  f.sd.toFile(),SD_KEY)) {
            sd.commit("save",CLIP,SHA,123456,repeat('1',32));
        }
        try(S9MigratedDualStoreCoordinatorV197 attempted=f.open()) {
            denied(()->attempted.verifyReadOnly(),"incomplete_two_store_commit");
            denied(()->attempted.commitVerifiedMetadata(
                  "delete",CLIP,SHA,123456,repeat('2',32)),"no_implicit_recovery");
        }
        require(Files.size(f.log)>0 && Files.size(f.checkpoint)==0,
                "refused_to_repair_or_truncate");
    }

    private static void validPrefixRollbackMustFailClosed()throws Exception {
        Fixture f=new Fixture();
        try(S9MigratedDualStoreCoordinatorV197 writer=f.open()) {
            writer.commitVerifiedMetadata("save",CLIP,SHA,123456,repeat('1',32));
            writer.commitVerifiedMetadata("delete",CLIP,SHA,123456,repeat('2',32));
        }
        String complete=new String(Files.readAllBytes(f.log),StandardCharsets.US_ASCII);
        int previous=complete.lastIndexOf('\n',complete.length()-2);
        require(previous>0,"two_complete_rows_required");
        Files.write(f.log,complete.substring(0,previous+1).getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedDualStoreCoordinatorV197 reopened=f.open()) {
            denied(()->reopened.verifyReadOnly(),"valid_hmac_prefix_rollback");
            denied(()->reopened.commitVerifiedMetadata(
                  "save",OTHER,SHA,123456,repeat('3',32)),"rollback_blocks_new_commit");
        }
        require(Files.readAllBytes(f.log).length<complete.length(),
                "no_silent_journal_repair");
    }

    private static void tamperAndMissingFilesMustFailClosed()throws Exception {
        Fixture f=new Fixture();
        try(S9MigratedDualStoreCoordinatorV197 coordinator=f.open()) {
            coordinator.commitVerifiedMetadata("save",CLIP,SHA,123456,repeat('1',32));
        }
        String recorded=new String(Files.readAllBytes(f.checkpoint),StandardCharsets.US_ASCII);
        Files.write(f.checkpoint,recorded.replace("|1|","|2|")
                       .getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedDualStoreCoordinatorV197 reopened=f.open()) {
            denied(()->reopened.verifyReadOnly(),"trusted_checkpoint_tamper");
        }
        Files.write(f.checkpoint,recorded.getBytes(StandardCharsets.US_ASCII));
        Path lock=f.internal.resolve(".c720p-migrated-dual-store-v197.lock");
        Files.delete(lock);
        denied(()->f.open(),"unprovisioned_service_lock");
        Files.createSymbolicLink(lock,f.checkpoint);
        denied(()->f.open(),"symlink_pair_lock");
        Files.delete(lock);
        Files.createFile(lock);
        denied(()->new S9MigratedDualStoreCoordinatorV197(
                  f.internal.toFile(),f.sd.toFile(),SD_KEY,SD_KEY),
               "shared_checkpoint_and_journal_key");
    }

    private static void crossProcessLockBlocksWithoutWriting()throws Exception {
        Fixture f=new Fixture();
        try(S9MigratedDualStoreCoordinatorV197 writer=f.open();
            java.nio.channels.FileChannel channel=java.nio.channels.FileChannel.open(
                f.internal.resolve(".c720p-migrated-dual-store-v197.lock"),
                java.nio.file.StandardOpenOption.WRITE);
            java.nio.channels.FileLock lock=channel.lock()) {
            denied(()->writer.verifyReadOnly(),"external_pair_lock_busy");
            denied(()->writer.commitVerifiedMetadata(
                 "save",CLIP,SHA,123456,repeat('1',32)),"external_lock_blocks_writes");
            require(Files.size(f.log)==0 && Files.size(f.checkpoint)==0,
                    "no_partial_write_with_busy_lock");
        }
    }

    public static void main(String[] args)throws Exception {
        require(args.length==0,"synthetic_host_only");
        happyAndIdempotence();
        crashBetweenStoresMustFailClosed();
        validPrefixRollbackMustFailClosed();
        tamperAndMissingFilesMustFailClosed();
        crossProcessLockBlocksWithoutWriting();
        System.out.println("S9_DUAL_STORE_V197_HOST_VERIFIED source_only=true real_actions=false originals_deleted=false");
    }
}
