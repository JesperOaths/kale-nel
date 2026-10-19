package nl.kalenel.s9offline;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/** Host-only, synthetic fixture for Java SecretKey HMAC compatibility. */
public final class S9MigratedKeystoreSignerTestV199 {
    private static String chars(char c,int n){char[] a=new char[n];Arrays.fill(a,c);return new String(a);}
    private static void require(boolean v,String reason){if(!v)throw new AssertionError(reason);}
    public static void main(String[] args)throws Exception {
        require(args.length==0,"fixture_only");
        Path root=Files.createTempDirectory("s9-key-compat-v199-");
        Path media=Files.createDirectory(root.resolve("synthetic_media"));
        Path internal=Files.createDirectory(root.resolve("synthetic_internal"));
        Files.createFile(media.resolve("actions-v193.log"));
        Files.createFile(media.resolve(".actions-v193.lock"));
        Files.createFile(internal.resolve("c720p-ledger-trusted-head-v196"));
        Files.createFile(internal.resolve(".c720p-ledger-trusted-head-v196.lock"));
        byte[] journalBytes=chars('j',48).getBytes(StandardCharsets.US_ASCII);
        byte[] checkpointBytes=chars('k',48).getBytes(StandardCharsets.US_ASCII);
        SecretKey signerA=new SecretKeySpec(journalBytes,"HmacSHA256");
        SecretKey signerB=new SecretKeySpec(checkpointBytes,"HmacSHA256");
        String expectedHead;
        try(S9MigratedMetadataLedgerV193 j=new S9MigratedMetadataLedgerV193(media.toFile(),signerA);
            S9MigratedLedgerTrustedCheckpointV196 c=new S9MigratedLedgerTrustedCheckpointV196(internal.toFile(),signerB)){
            S9MigratedMetadataLedgerV193.Receipt receipt=j.commit("save","synthetic_1792700000000.mp4",
                chars('a',64),123456,chars('1',32));
            expectedHead=receipt.ledgerHeadSha256;
            c.advance(0,chars('0',64),1,expectedHead);
            j.requireTrustedHead(1,expectedHead);
            require(!receipt.mayRemoveOriginal(),"no_file_retirement");
        }
        try(S9MigratedMetadataLedgerV193 old=new S9MigratedMetadataLedgerV193(media.toFile(),journalBytes);
            S9MigratedLedgerTrustedCheckpointV196 oldCheckpoint=new S9MigratedLedgerTrustedCheckpointV196(internal.toFile(),checkpointBytes)){
            old.requireTrustedHead(1,expectedHead);
            require(oldCheckpoint.read().sequence==1,"compatible_checkpoint");
        }
        try(S9MigratedMetadataLedgerV193 newer=new S9MigratedMetadataLedgerV193(media.toFile(),signerA);
            S9MigratedLedgerTrustedCheckpointV196 c=new S9MigratedLedgerTrustedCheckpointV196(internal.toFile(),signerB)){
            require(newer.verifiedCount()==1 && c.read().durableAnchorVerified,"secretkey_replay");
        }
        Arrays.fill(journalBytes,(byte)0);
        Arrays.fill(checkpointBytes,(byte)0);
        System.out.println("S9_SIGNER_V199_HOST_COMPATIBILITY_VERIFIED");
    }
}
