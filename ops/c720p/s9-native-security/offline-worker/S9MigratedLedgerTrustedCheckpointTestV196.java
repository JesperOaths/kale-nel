package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

/** Host-only test of independent local-filesystem checkpoint vs SD journal. */
public final class S9MigratedLedgerTrustedCheckpointTestV196 {
    private static String repeat(char c,int n){
        char[] a=new char[n];Arrays.fill(a,c);return new String(a);
    }
    private static final String ZERO=repeat('0',64);
    private static final String SOURCE=repeat('a',64);
    private static final String CLIP="synthetic_1792200000000.mp4";
    private static final byte[] SD_KEY="synthetic-sd-ledger-key-for-v196-host-only--"
          .getBytes(StandardCharsets.US_ASCII);
    private static final byte[] INTERNAL_KEY="independent-phone-internal-checkpoint-key-test"
          .getBytes(StandardCharsets.US_ASCII);
    @FunctionalInterface interface Op {void run()throws Exception;}
    private static void require(boolean b,String description){
        if(!b)throw new AssertionError(description);
    }
    private static void denied(Op op,String reason)throws Exception{
        try {op.run();throw new AssertionError("unexpected_success_"+reason);}
        catch(IOException expected){}
    }
    public static void main(String[] args)throws Exception {
        require(args.length==0,"host_synthetic_only");
        Path root=Files.createTempDirectory("s9-checkpoint-v196-");
        // Deliberately separate roots: future caller MUST supply a real phone
        // app-internal filesDir distinct from SD media. No auth service here.
        Path phoneInternal=Files.createDirectory(root.resolve("phone_internal"));
        Files.createFile(phoneInternal.resolve("c720p-ledger-trusted-head-v196"));
        Files.createFile(phoneInternal.resolve(".c720p-ledger-trusted-head-v196.lock"));
        Path sd=Files.createDirectory(root.resolve("synthetic_micro_sd"));
        Path sdLog=Files.createFile(sd.resolve("actions-v193.log"));
        Files.createFile(sd.resolve(".actions-v193.lock"));
        String headSave,headDelete;
        try (S9MigratedLedgerTrustedCheckpointV196 trusted=
                    new S9MigratedLedgerTrustedCheckpointV196(
                        phoneInternal.toFile(),INTERNAL_KEY);
             S9MigratedMetadataLedgerV193 ledger=
                    new S9MigratedMetadataLedgerV193(sd.toFile(),SD_KEY)) {
            S9MigratedLedgerTrustedCheckpointV196.State genesis=trusted.read();
            require(genesis.sequence==0&&!genesis.durableAnchorVerified
                &&!genesis.mayRemoveOriginal(),"empty_anchor_has_no_durable_authority");
            ledger.requireTrustedHead(0,ZERO);
            S9MigratedMetadataLedgerV193.Receipt a=
                ledger.commit("save",CLIP,SOURCE,123456,repeat('1',32));
            headSave=a.ledgerHeadSha256;
            S9MigratedLedgerTrustedCheckpointV196.State saved=
                trusted.advance(0,ZERO,1,headSave);
            require(saved.sequence==1 && saved.durableAnchorVerified
                &&!saved.mayRemoveOriginal()
                &&!saved.authorizesRemoteMutation(),"signed_save_checkpoint");
            ledger.requireTrustedHead(saved.sequence,saved.headSha256);
            denied(()->trusted.advance(0,ZERO,1,headSave),"replay_genesis");
            denied(()->trusted.advance(1,headSave,3,repeat('d',64)),
                   "skip_monotonic_sequence");
            S9MigratedMetadataLedgerV193.Receipt b=
                ledger.commit("delete",CLIP,SOURCE,123456,repeat('2',32));
            headDelete=b.ledgerHeadSha256;
            S9MigratedLedgerTrustedCheckpointV196.State deleted=
                trusted.advance(1,headSave,2,headDelete);
            ledger.requireTrustedHead(deleted.sequence,deleted.headSha256);
            require(ledger.latestDecision(CLIP).isDeletedTombstone(),
                    "no_live_delete_produced");
        }
        try(S9MigratedLedgerTrustedCheckpointV196 trusted=
             new S9MigratedLedgerTrustedCheckpointV196(
                 phoneInternal.toFile(),INTERNAL_KEY);
            S9MigratedMetadataLedgerV193 ledger=
             new S9MigratedMetadataLedgerV193(sd.toFile(),SD_KEY)){
            S9MigratedLedgerTrustedCheckpointV196.State rest=trusted.read();
            require(rest.sequence==2 && rest.headSha256.equals(headDelete)
                    &&rest.durableAnchorVerified,"restart_anchor_state");
            ledger.requireTrustedHead(rest.sequence,rest.headSha256);
        }
        String whole=new String(Files.readAllBytes(sdLog),StandardCharsets.US_ASCII);
        int prev=whole.lastIndexOf('\n',whole.length()-2);
        require(prev>0,"test_has_multiple_rows");
        Files.write(sdLog,whole.substring(0,prev+1).getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedLedgerTrustedCheckpointV196 trusted=
             new S9MigratedLedgerTrustedCheckpointV196(
                 phoneInternal.toFile(),INTERNAL_KEY);
            S9MigratedMetadataLedgerV193 rolledBack=
             new S9MigratedMetadataLedgerV193(sd.toFile(),SD_KEY)){
            require(rolledBack.verifiedCount()==1,"prefix_hmac_alone_not_sufficient");
            S9MigratedLedgerTrustedCheckpointV196.State independent=trusted.read();
            require(independent.sequence==2,"internal_anchor_did_not_roll_back");
            denied(()->rolledBack.requireTrustedHead(
                 independent.sequence,independent.headSha256),
                 "complete_delete_tombstone_missing");
        }
        Files.write(sdLog,whole.getBytes(StandardCharsets.US_ASCII));
        Path anchor=phoneInternal.resolve("c720p-ledger-trusted-head-v196");
        String valid=new String(Files.readAllBytes(anchor),StandardCharsets.US_ASCII);
        Files.write(anchor,valid.replace("2|","1|")
                     .getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedLedgerTrustedCheckpointV196 corrupted=
                new S9MigratedLedgerTrustedCheckpointV196(
                      phoneInternal.toFile(),INTERNAL_KEY)) {
            denied(()->corrupted.read(),"tampered_internal_checkpoint_hmac");
        }
        Files.write(anchor,valid.getBytes(StandardCharsets.US_ASCII));
        try(S9MigratedLedgerTrustedCheckpointV196 wrongKey=
                new S9MigratedLedgerTrustedCheckpointV196(
                  phoneInternal.toFile(),
                  "wrong-host-checkpoint-key-with-32-bytes".getBytes(
                       StandardCharsets.US_ASCII))) {
            denied(()->wrongKey.read(),"wrong_checkpoint_key");
        }
        Path linked=root.resolve("symlink_internal");
        Files.createSymbolicLink(linked,phoneInternal);
        denied(()->new S9MigratedLedgerTrustedCheckpointV196(
                        linked.toFile(),INTERNAL_KEY),"symlink_directory");
        Arrays.fill(SD_KEY,(byte)0);
        Arrays.fill(INTERNAL_KEY,(byte)0);
        System.out.println("S9_INTERNAL_LEDGER_CHECKPOINT_V196_HOST_TESTS_OK");
    }
}
