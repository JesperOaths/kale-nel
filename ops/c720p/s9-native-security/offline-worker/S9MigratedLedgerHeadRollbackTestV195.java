package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

/** Synthetic host-only trusted-checkpoint comparison, no phone/media access. */
public final class S9MigratedLedgerHeadRollbackTestV195 {
    private static String n(char c,int length) {
        char[] a=new char[length];Arrays.fill(a,c);return new String(a);
    }
    private static final String FAKE="synthetic_1792200000000.mp4";
    private static final byte[] KEY = "synthetic-checkpoint-test-key-never-provisioned-phone"
            .getBytes(StandardCharsets.US_ASCII);
    @FunctionalInterface private interface Task { void run() throws Exception; }
    private static void expectRefusal(Task task,String name) throws Exception {
        boolean refused=false;
        try {task.run();} catch(IOException expected) { refused=true; }
        if (!refused)throw new AssertionError("unexpected_success_"+name);
    }
    public static void main(String[] args) throws Exception {
        if (args.length!=0)throw new IllegalArgumentException("host_test_only");
        Path dir=Files.createTempDirectory("s9-rollback-v195-");
        Files.createFile(dir.resolve("actions-v193.log"));
        Files.createFile(dir.resolve(".actions-v193.lock"));
        String finalHead;
        try (S9MigratedMetadataLedgerV193 ledger =
                 new S9MigratedMetadataLedgerV193(dir.toFile(),KEY)) {
            ledger.requireTrustedHead(0,n('0',64));
            S9MigratedMetadataLedgerV193.Receipt a =
                ledger.commit("save",FAKE,n('a',64),123456,n('1',32));
            ledger.requireTrustedHead(1,a.ledgerHeadSha256);
            S9MigratedMetadataLedgerV193.Receipt b =
                ledger.commit("delete",FAKE,n('a',64),123456,n('2',32));
            finalHead=b.ledgerHeadSha256;
            ledger.requireTrustedHead(2,finalHead);
            expectRefusal(()->ledger.requireTrustedHead(2,n('e',64)),
                          "wrong_trusted_head");
            expectRefusal(()->ledger.requireTrustedHead(1,finalHead),
                          "wrong_trusted_sequence");
            expectRefusal(()->ledger.requireTrustedHead(-1,finalHead),
                          "negative_sequence");
            expectRefusal(()->ledger.requireTrustedHead(2,"not-a-digest"),
                          "untrusted_hash_format");
            if (!ledger.latestDecision(FAKE).isDeletedTombstone())
                throw new AssertionError("latest_tombstone_not_current");
        }
        // A complete trailing row can be silently truncated while leaving
        // a cryptographically valid prefix. The EXTERNAL checkpoint catches
        // this even though internal HMAC prefix verification still passes.
        Path file=dir.resolve("actions-v193.log");
        String original=new String(Files.readAllBytes(file),StandardCharsets.US_ASCII);
        int previousEnd=original.lastIndexOf('\n',original.length()-2);
        if (previousEnd<=0 || previousEnd==original.length()-1)
            throw new AssertionError("bad_prefix_test_fixture");
        String validPrefix=original.substring(0,previousEnd+1);
        Files.write(file,validPrefix.getBytes(StandardCharsets.US_ASCII));
        try (S9MigratedMetadataLedgerV193 rolledBack =
                new S9MigratedMetadataLedgerV193(dir.toFile(),KEY)) {
            if (rolledBack.verifiedCount()!=1)
                throw new AssertionError("prefix_not_crypto_valid");
            expectRefusal(()->rolledBack.requireTrustedHead(2,finalHead),
                          "complete_record_rollback_not_detected");
            // The attacker-held shorter ledger head is not an independent
            // trusted anchor, so a match to itself MUST NOT be considered
            // a real proof of durability or rollback protection.
        }
        Files.write(file,original.getBytes(StandardCharsets.US_ASCII));
        try (S9MigratedMetadataLedgerV193 recovered =
                new S9MigratedMetadataLedgerV193(dir.toFile(),KEY)) {
            recovered.requireTrustedHead(2,finalHead);
        }
        Arrays.fill(KEY,(byte)0);
        System.out.println("S9_LEDGER_EXTERNAL_HEAD_V195_HOST_TESTS_OK");
    }
}
