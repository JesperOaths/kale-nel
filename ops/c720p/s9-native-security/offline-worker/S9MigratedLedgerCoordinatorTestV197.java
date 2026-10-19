package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

/** Entirely synthetic two-filesystem coordinator/crash test; no phone access. */
public final class S9MigratedLedgerCoordinatorTestV197 {
    private static final String NAME="synthetic_1792200000000.mp4";
    private static final String OTHER="synthetic_1792200000001.mp4";
    private static String rep(char c,int n){char[] a=new char[n];Arrays.fill(a,c);return new String(a);}
    private static final String SOURCE=rep('a',64),ZERO=rep('0',64);
    private static final byte[] SD="synthetic-sd-journal-key-v197-minimum-32bytes".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] APP="separate-app-private-checkpoint-key-v197-32".getBytes(StandardCharsets.US_ASCII);
    @FunctionalInterface interface Checked {void run()throws Exception;}
    private static void require(boolean ok,String name){if(!ok)throw new AssertionError(name);}
    private static void denied(Checked act,String label)throws Exception{
        boolean blocked=false;
        try{act.run();}catch(IOException expected){blocked=true;}
        require(blocked,label);
    }
    private static void preprovision(Path phone,Path sd)throws Exception {
        Files.createFile(phone.resolve("c720p-ledger-trusted-head-v196"));
        Files.createFile(phone.resolve(".c720p-ledger-trusted-head-v196.lock"));
        Files.createFile(phone.resolve(".c720p-migrated-dualstore-v197.lock"));
        Files.createFile(sd.resolve("actions-v193.log"));
        Files.createFile(sd.resolve(".actions-v193.lock"));
    }
    public static void main(String[] args)throws Exception {
        require(args.length==0,"host_only");
        Path root=Files.createTempDirectory("s9-v197-host-");
        Path phone=Files.createDirectory(root.resolve("app_private"));
        Path sd=Files.createDirectory(root.resolve("synthetic_sd"));
        preprovision(phone,sd);
        denied(()->new S9MigratedLedgerCoordinatorV197(phone.toFile(),sd.toFile(),SD,SD),
            "identical_keys_refused");
        denied(()->new S9MigratedLedgerCoordinatorV197(sd.toFile(),sd.toFile(),SD,APP),
            "same_storage_refused");
        // Unsigned genesis must never be treated as an authenticated state.
        try(S9MigratedLedgerCoordinatorV197 virgin=
            new S9MigratedLedgerCoordinatorV197(phone.toFile(),sd.toFile(),SD,APP)) {
            denied(()->virgin.latestVerified(NAME),"unsigned_genesis_read_refused");
            denied(()->virgin.commitMetadata("save",NAME,SOURCE,123456,rep('1',32)),
                "unsigned_genesis_write_refused");
        }
        // Separate synthetic-only one-time provisioner: this is NOT a live API.
        String savedHead;
        try(S9MigratedMetadataLedgerV193 journal=
                new S9MigratedMetadataLedgerV193(sd.toFile(),SD);
            S9MigratedLedgerTrustedCheckpointV196 checkpoint=
                new S9MigratedLedgerTrustedCheckpointV196(phone.toFile(),APP)) {
            journal.requireTrustedHead(0,ZERO);
            S9MigratedMetadataLedgerV193.Receipt first=journal.commit(
                "save",NAME,SOURCE,123456,rep('1',32));
            require(first.ledgerSequence==1 && !first.mayRemoveOriginal(),"saved_1");
            savedHead=first.ledgerHeadSha256;
            checkpoint.advance(0,ZERO,1,savedHead);
        }
        try(S9MigratedLedgerCoordinatorV197 wrong=
                new S9MigratedLedgerCoordinatorV197(phone.toFile(),sd.toFile(),
                    SD,new byte[32])) {
            denied(()->wrong.latestVerified(NAME),"wrong_checkpoint_key_refused");
        }
        try(S9MigratedLedgerCoordinatorV197 coordinated=
            new S9MigratedLedgerCoordinatorV197(phone.toFile(),sd.toFile(),SD,APP)) {
            require(coordinated.latestVerified(NAME).decision.isSaved(),"provisioned_save");
            S9MigratedMetadataLedgerV193.Receipt replay=coordinated.commitMetadata(
                "save",NAME,SOURCE,123456,rep('1',32));
            require(replay.ledgerSequence==1,"exact_retry");
            require(coordinated.latestVerified(NAME).independentHeadVerified,"anchored");
            S9MigratedMetadataLedgerV193.Receipt del=coordinated.commitMetadata(
                "delete",NAME,SOURCE,123456,rep('2',32));
            require(del.ledgerSequence==2,"tombstone_2");
            denied(()->coordinated.commitMetadata("save",NAME,SOURCE,123456,rep('1',32)),
                "stale_save_refused");
            S9MigratedMetadataLedgerV193.Receipt other=coordinated.commitMetadata(
                "save",OTHER,SOURCE,123456,rep('3',32));
            require(other.ledgerSequence==3,"other_save_3");
            require(coordinated.latestVerified(NAME).decision.isDeletedTombstone(),
                "unrelated_clip_does_not_hide_tombstone");
            require(!coordinated.latestVerified(OTHER).mayRemoveOriginal(),
                "never_authorize_retirement");
            require(!coordinated.latestVerified(OTHER).authorizesRemoteMutation(),
                "never_claim_endpoint");
        }
        try(S9MigratedLedgerCoordinatorV197 restarted=
                new S9MigratedLedgerCoordinatorV197(phone.toFile(),sd.toFile(),SD,APP)){
            require(restarted.latestVerified(NAME).decision.isDeletedTombstone(),
                "reopen_independently_authenticated");
        }
        Path log=sd.resolve("actions-v193.log");
        byte[] original=Files.readAllBytes(log);
        String body=new String(original,StandardCharsets.US_ASCII);
        int previous=body.lastIndexOf('\n',body.length()-2);
        require(previous>0,"three_valid_rows");
        Files.write(log,body.substring(0,previous+1).getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedLedgerCoordinatorV197 rolled=
            new S9MigratedLedgerCoordinatorV197(phone.toFile(),sd.toFile(),SD,APP)){
            denied(()->rolled.latestVerified(NAME),"valid_prefix_rollback_refused");
            denied(()->rolled.commitMetadata("save",OTHER,SOURCE,123456,rep('4',32)),
                "valid_prefix_rollback_no_new_receipt");
        }
        Files.write(log,original);
        // Emulate a power loss AFTER journal fsync, BEFORE private checkpoint:
        try(S9MigratedMetadataLedgerV193 direct=
            new S9MigratedMetadataLedgerV193(sd.toFile(),SD)) {
            require(direct.commit("save","synthetic_1792200000002.mp4",
                SOURCE,123456,rep('4',32)).ledgerSequence==4,"crash_window_append");
        }
        try(S9MigratedLedgerCoordinatorV197 crashed=
            new S9MigratedLedgerCoordinatorV197(phone.toFile(),sd.toFile(),SD,APP)){
            denied(()->crashed.latestVerified(NAME),"incomplete_dualstore_commit_refused");
            denied(()->crashed.commitMetadata("save",OTHER,SOURCE,123456,rep('5',32)),
                "incomplete_dualstore_writes_refused");
        }
        // No automatic repair/rollback of either filesystem.
        require(Files.readAllBytes(log).length>original.length,"unmodified_crash_tail");
        require(Files.size(phone.resolve("c720p-ledger-trusted-head-v196"))>0,
            "app_private_checkpoint_preserved");
        require(!ZERO.equals(savedHead),"real_hash_used");
        System.out.println("S9_DUALSTORE_COORDINATOR_V197_HOST_TESTS_OK");
    }
}
