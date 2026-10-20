package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

public final class S9MigratedCoordinatorSecretKeyTestV200 {
    private static String n(char c,int count){char[] a=new char[count];Arrays.fill(a,c);return new String(a);}
    private static void check(boolean b,String why){if(!b)throw new AssertionError(why);}
    @FunctionalInterface interface Operation{void invoke()throws Exception;}
    private static void denied(Operation action,String name)throws Exception{
        try{action.invoke();throw new AssertionError("unallowed_"+name);}
        catch(IOException expected){}
    }
    static class Fixture {
        final Path internal,sd;
        Fixture()throws Exception {
            Path root=Files.createTempDirectory("s9-v200-host-");
            internal=Files.createDirectory(root.resolve("internal_test"));
            sd=Files.createDirectory(root.resolve("sd_test"));
            Files.createFile(sd.resolve("actions-v193.log"));
            Files.createFile(sd.resolve(".actions-v193.lock"));
            Files.createFile(internal.resolve("c720p-ledger-trusted-head-v196"));
            Files.createFile(internal.resolve(".c720p-ledger-trusted-head-v196.lock"));
            Files.createFile(internal.resolve(".c720p-dual-store-commit-v197.lock"));
        }
    }
    public static void main(String[] args)throws Exception {
        check(args.length==0,"host_only");
        Fixture f=new Fixture();
        SecretKey internal=new SecretKeySpec(n('t',48).getBytes(StandardCharsets.US_ASCII),"HmacSHA256");
        SecretKey sdKey=new SecretKeySpec(n('s',48).getBytes(StandardCharsets.US_ASCII),"HmacSHA256");
        String clip="synthetic_1792700000000.mp4",sha=n('a',64),head;
        // Setup represents an EXTERNALLY approved initial enrollment,
        // which is intentionally unavailable through the production coordinator.
        try(S9MigratedMetadataLedgerV193 journal=new S9MigratedMetadataLedgerV193(f.sd.toFile(),sdKey);
            S9MigratedLedgerTrustedCheckpointV196 trusted=
                new S9MigratedLedgerTrustedCheckpointV196(f.internal.toFile(),internal)) {
            S9MigratedMetadataLedgerV193.Receipt initial=
                journal.commit("save",clip,sha,123456,n('1',32));
            head=initial.ledgerHeadSha256;
            trusted.advance(0,n('0',64),1,head);
        }
        try(S9MigratedDualStoreCommitV197 coordinator=
             new S9MigratedDualStoreCommitV197(f.internal.toFile(),f.sd.toFile(),internal,sdKey)) {
            check(coordinator.currentDecision(clip).isSaved(),"read_provenance");
            S9MigratedDualStoreCommitV197.Result confirmed=
                coordinator.commitMetadataOnly("delete",clip,sha,123456,n('2',32),
                      1,head,(action,name,digest,bytes)->"delete".equals(action)
                          && clip.equals(name) && sha.equals(digest) && bytes==123456);
            check(confirmed.receipt.ledgerSequence==2 && confirmed.bothStoresVerified
                  && !confirmed.mayRemoveOriginal(),"both_stores_fsynchronized");
            check(coordinator.currentDecision(clip).isDeletedTombstone(),"no_resurrection");
            denied(()->coordinator.commitMetadataOnly("save",clip,sha,123456,n('3',32),
                   2,confirmed.trustedHeadSha256,(a,b,c,d)->false),"unapproved_action");
        }
        try(S9MigratedDualStoreCommitV197 reloaded=
                new S9MigratedDualStoreCommitV197(f.internal.toFile(),f.sd.toFile(),internal,sdKey)){
            check(reloaded.currentDecision(clip).isDeletedTombstone(),"reboot_consistency");
        }
        denied(()->new S9MigratedDualStoreCommitV197(
              f.internal.toFile(),f.sd.toFile(),internal,internal),"identical_signer_handles");
        SecretKey invalid=new SecretKeySpec(n('b',48).getBytes(StandardCharsets.US_ASCII),"AES");
        denied(()->new S9MigratedDualStoreCommitV197(
              f.internal.toFile(),f.sd.toFile(),invalid,sdKey),"wrong_signing_algorithm");
        Fixture virgin=new Fixture();
        try(S9MigratedDualStoreCommitV197 guarded=
             new S9MigratedDualStoreCommitV197(virgin.internal.toFile(),virgin.sd.toFile(),internal,sdKey)){
            denied(()->guarded.currentDecision(clip),"genesis_not_trusted");
        }
        check(Files.size(virgin.sd.resolve("actions-v193.log"))==0,"no_production_bootstrap");
        System.out.println("S9_DUALSTORE_SECRETKEY_V200_VERIFIED host_only=true remote_actions=false");
    }
}
