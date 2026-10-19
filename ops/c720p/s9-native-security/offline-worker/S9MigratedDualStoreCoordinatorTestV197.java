package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

/** Host-only, synthetic files. No S9 device, media, HTTP, or real keys. */
public final class S9MigratedDualStoreCoordinatorTestV197 {
    private static final String ZERO=repeat('0',64);
    private static final String HASH=repeat('a',64);
    private static final String ONE="synth_cam_1792200000010.mp4";
    private static final String TWO="synth_cam_1792200000020.mp4";
    private static final byte[] SD_KEY="synthetic-journal-key-32-bytes-0011223344"
        .getBytes(StandardCharsets.US_ASCII);
    private static final byte[] INTERNAL_KEY="independent-private-anchor-key-001122334455"
        .getBytes(StandardCharsets.US_ASCII);
    @FunctionalInterface private interface Checked {void run()throws Exception;}
    private static String repeat(char a,int n){
        char[] c=new char[n];Arrays.fill(c,a);return new String(c);
    }
    private static void expect(boolean ok,String reason){
        if(!ok)throw new AssertionError(reason);
    }
    private static void denied(Checked action,String expected){
        try {action.run();throw new AssertionError("incorrectly_accepted_"+expected);}
        catch(IOException e) {
            if(!e.getMessage().contains(expected))
                throw new AssertionError("wrong_refusal_code_"+expected,e);
        } catch(Exception e){throw new AssertionError("unexpected_test_failure",e);}
    }
    private static void setup(Path root)throws IOException{
        Path sd=Files.createDirectory(root.resolve("synthetic_micro_sd"));
        Files.createFile(sd.resolve("actions-v193.log"));
        Files.createFile(sd.resolve(".actions-v193.lock"));
        Path internal=Files.createDirectory(root.resolve("synthetic_private_phone"));
        Files.createFile(internal.resolve("c720p-ledger-trusted-head-v196"));
        Files.createFile(internal.resolve(".c720p-ledger-trusted-head-v196.lock"));
        Files.createFile(internal.resolve(".dual-store-service.lock"));
    }
    private static Path sd(Path root){return root.resolve("synthetic_micro_sd");}
    private static Path internal(Path root){return root.resolve("synthetic_private_phone");}
    private static S9MigratedMetadataLedgerV193 journal(Path root)throws IOException {
        return new S9MigratedMetadataLedgerV193(sd(root).toFile(),SD_KEY);
    }
    private static S9MigratedLedgerTrustedCheckpointV196 trusted(Path root)throws IOException {
        return new S9MigratedLedgerTrustedCheckpointV196(internal(root).toFile(),INTERNAL_KEY);
    }
    private static S9MigratedDualStoreCoordinatorV197 coord(Path root,
            S9MigratedMetadataLedgerV193 j,S9MigratedLedgerTrustedCheckpointV196 t,
            boolean enrollment)throws IOException {
        return new S9MigratedDualStoreCoordinatorV197(
            j,t,internal(root).resolve(".dual-store-service.lock").toFile(),enrollment);
    }
    public static void main(String[] args)throws Exception{
        expect(args.length==0,"host_only");
        Path root=Files.createTempDirectory("s9-dual-v197-synthetic-");
        setup(root);
        try(S9MigratedMetadataLedgerV193 j=journal(root);
            S9MigratedLedgerTrustedCheckpointV196 t=trusted(root);
            S9MigratedDualStoreCoordinatorV197 defaultMode=coord(root,j,t,false);
            S9MigratedDualStoreCoordinatorV197 enrolling=coord(root,j,t,true)){
            denied(()->defaultMode.commitMetadata("save",ONE,HASH,90000,repeat('1',32)),
                "unanchored_genesis_requires_explicit_enrollment");
            denied(()->defaultMode.currentState(ONE),
                "current_state_requires_signed_checkpoint");
            expect(j.verifiedCount()==0,"no_initial_writes");
            S9MigratedMetadataLedgerV193.Receipt saved=enrolling.commitMetadata(
                "save",ONE,HASH,90000,repeat('1',32));
            expect(saved.ledgerSequence==1&&!saved.mayRemoveOriginal(),"save_committed");
            expect(t.read().durableAnchorVerified&&t.read().sequence==1,
                "internal_checkpoint_fsynced");
            expect(defaultMode.currentState(ONE).isSaved(),"verified_current_save");
            expect(defaultMode.commitMetadata("save",ONE,HASH,90000,repeat('1',32))
                    .ledgerSequence==1,"exact_head_retry_is_idempotent");
            S9MigratedMetadataLedgerV193.Receipt deleted=defaultMode.commitMetadata(
                "delete",ONE,HASH,90000,repeat('2',32));
            expect(deleted.ledgerSequence==2,"delete_tombstone_committed");
            expect(defaultMode.currentState(ONE).isDeletedTombstone(),
                "current_deleted_not_saved");
            expect(!defaultMode.mayRemoveOriginal()&&
                   !defaultMode.authorizesRemoteMutation()&&
                   !defaultMode.liveServiceInstalled(),
                "no_production_authority");
            denied(()->defaultMode.commitMetadata("save",ONE,HASH,90000,repeat('1',32)),
                "superseded_receipt_no_longer_current");
            // Simulate a crash after the SD fsync but BEFORE app-internal CAS
            // checkpoint. Direct low-level commit is test-only, never a
            // production repair strategy.
            j.commit("save",TWO,HASH,90001,repeat('3',32));
            expect(j.verifiedCount()==3&&t.read().sequence==2,"crash_gap_created");
            denied(()->defaultMode.currentState(TWO),
                "ledger_head_diverged_from_trusted_checkpoint");
            denied(()->defaultMode.commitMetadata("delete",TWO,HASH,90001,repeat('4',32)),
                "ledger_head_diverged_from_trusted_checkpoint");
            expect(j.verifiedCount()==3&&t.read().sequence==2,
                "crash_gap_did_not_autorepair");
        }
        // Restoring the last synthetic row by removing it manually is a
        // FIXTURE action ONLY, never something the coordinator is allowed to
        // do. After that, simulate valid-prefix *Delete* rollback.
        Path log=sd(root).resolve("actions-v193.log");
        String complete=new String(Files.readAllBytes(log),StandardCharsets.US_ASCII);
        String[] lines=complete.split("\n",-1);
        expect(lines.length==4,"three_synthetic_commits");
        Files.write(log,(lines[0]+"\n"+lines[1]+"\n")
            .getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedMetadataLedgerV193 j=journal(root);
            S9MigratedLedgerTrustedCheckpointV196 t=trusted(root);
            S9MigratedDualStoreCoordinatorV197 restarted=coord(root,j,t,false)) {
            expect(restarted.currentState(ONE).isDeletedTombstone(),
                "read_after_separate_jvm_style_reopen");
        }
        Files.write(log,(lines[0]+"\n").getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedMetadataLedgerV193 j=journal(root);
            S9MigratedLedgerTrustedCheckpointV196 t=trusted(root);
            S9MigratedDualStoreCoordinatorV197 rolledBack=coord(root,j,t,false)) {
            denied(()->rolledBack.currentState(ONE),
                "ledger_head_diverged_from_trusted_checkpoint");
            expect(t.read().sequence==2&&j.verifiedCount()==1,
                "valid_prefix_rollback_still_denied");
        }
        // Missing, non-private or symlinked lock never authorizes a caller.
        Path link=internal(root).resolve(".linked-service-lock");
        Files.createSymbolicLink(link,internal(root).resolve(".dual-store-service.lock"));
        try(S9MigratedMetadataLedgerV193 j=journal(root);
            S9MigratedLedgerTrustedCheckpointV196 t=trusted(root)) {
            denied(()->new S9MigratedDualStoreCoordinatorV197(
                j,t,link.toFile(),false),"app_internal_service_lock_untrusted");
        }
        Arrays.fill(SD_KEY,(byte)0);Arrays.fill(INTERNAL_KEY,(byte)0);
        System.out.println("S9_DUAL_STORE_COORDINATOR_V197_HOST_TESTS_OK");
    }
}