package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.SecureRandom;
import java.util.Arrays;

/**
 * One isolated phone-side durability smoke. It NEVER opens a real MP4/JPEG,
 * Camera2, a review, or the migrated clips directory. Its literal directory
 * is a uniquely named sibling reserved for an expendable synthetic test.
 *
 * This class is not an authenticated service and is never installed in APK.
 * Caller must ensure camera thermal/recording admission and worker exclusion.
 */
public final class S9MigratedLedgerMicroSdSmokeV194 {
    private static final Path ROOT = Paths.get(
        "/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/"
        + "C720PMigratedLedgerSyntheticV194");
    private static final String CLIP = "synthetic_test_only_1792200000000.mp4";
    private static final String SHA = repeat('a',64);
    private static final String SAVE_NONCE = repeat('1',32);
    private static final String DELETE_NONCE = repeat('2',32);
    private static final String DIFFERENT_NONCE = repeat('3',32);
    private S9MigratedLedgerMicroSdSmokeV194() {}
    private static String repeat(char c,int n) {
        char[] array = new char[n]; Arrays.fill(array,c); return new String(array);
    }
    private static void check(boolean valid,String code) throws IOException {
        if (!valid)throw new IOException(code);
    }
    public static void main(String[] args) {
        if (args.length!=1 || !"--synthetic-microsd-once".equals(args[0])) {
            System.err.println("S9_LEDGER_V194_INVALID_INVOCATION");
            System.exit(3);
        }
        byte[] key = new byte[48];
        String stage="preflight";
        try {
            Path parent = ROOT.getParent();
            check(parent!=null && Files.isDirectory(parent,LinkOption.NOFOLLOW_LINKS)
                  && !Files.isSymbolicLink(parent),"scope_missing");
            // Never reuse a previous test directory: repeated runs fail closed.
            check(!Files.exists(ROOT,LinkOption.NOFOLLOW_LINKS),
                  "previous_synthetic_test_present");
            stage="synthetic_directory";
            Files.createDirectory(ROOT);
            check(Files.isDirectory(ROOT,LinkOption.NOFOLLOW_LINKS)
                  && !Files.isSymbolicLink(ROOT),"scope_untrusted");
            Files.createFile(ROOT.resolve("actions-v193.log"));
            Files.createFile(ROOT.resolve(".actions-v193.lock"));
            new SecureRandom().nextBytes(key);
            stage="micro_sd_commit";
            S9MigratedMetadataLedgerV193.Receipt saved;
            S9MigratedMetadataLedgerV193.Receipt deleted;
            try (S9MigratedMetadataLedgerV193 ledger =
                    new S9MigratedMetadataLedgerV193(ROOT.toFile(),key)) {
                saved = ledger.commit("save",CLIP,SHA,123456,SAVE_NONCE);
                check(saved.ledgerSequence==1 && saved.durable
                    && !saved.mayRemoveOriginal() && !saved.personReviewsModified(),
                    "synthetic_save_receipt_invalid");
                S9MigratedMetadataLedgerV193.Receipt retry =
                    ledger.commit("save",CLIP,SHA,123456,SAVE_NONCE);
                check(retry.ledgerSequence==1
                    && saved.hmacSha256.equals(retry.hmacSha256),
                    "nonce_retry_not_idempotent");
                boolean rejected=false;
                try { ledger.commit("delete",CLIP,SHA,123456,SAVE_NONCE); }
                catch(IOException expected) {rejected=true;}
                check(rejected,"nonce_replay_accepted");
                deleted=ledger.commit("delete",CLIP,SHA,123456,DELETE_NONCE);
                check(deleted.ledgerSequence==2 && ledger.verifiedCount()==2,
                    "synthetic_tombstone_not_persisted");
                rejected=false;
                try { ledger.commit("save",CLIP,SHA,123456,DIFFERENT_NONCE); }
                catch(IOException expected) {rejected=true;}
                check(rejected,"synthetic_restore_not_blocked");
            }
            stage="micro_sd_readback";
            try (S9MigratedMetadataLedgerV193 reopened =
                    new S9MigratedMetadataLedgerV193(ROOT.toFile(),key)) {
                check(reopened.verifiedCount()==2,
                      "journal_reload_mismatch");
                S9MigratedMetadataLedgerV193.Receipt repeat =
                    reopened.commit("delete",CLIP,SHA,123456,DELETE_NONCE);
                check(deleted.hmacSha256.equals(repeat.hmacSha256),
                      "journal_latest_tombstone_retry_drift");
                // PR #1029: superseded Save nonce cannot restore older state.
                boolean staleRejected=false;
                try { reopened.commit("save",CLIP,SHA,123456,SAVE_NONCE); }
                catch(IOException expected) {staleRejected=true;}
                check(staleRejected,"superseded_save_nonce_accepted");
            }
            long bytes=Files.size(ROOT.resolve("actions-v193.log"));
            check(bytes>300 && bytes<2000
                  && Files.size(ROOT.resolve(".actions-v193.lock"))==0,
                  "journal_files_unbounded");
            System.out.println(
                "S9_MICROSD_SYNTHETIC_LEDGER_V194 "
                + "{\"status\":\"micro_sd_two_decisions_reloaded\","
                + "\"real_clips_opened\":0,\"actual_person_reviews_modified\":false,"
                + "\"real_save_delete_enabled\":false,\"metadata_actions\":2,"
                + "\"nonce_replay_refused\":true,\"superseded_save_refused\":true,\"delete_is_only_tombstone\":true,"
                + "\"journal_readback_verified\":true,\"only_synthetic_directory_written\":true,"
                + "\"synthetic_key_persisted\":false,"
                + "\"originals_removed\":0,\"camera_apk_modified\":false}");
        } catch (Exception error) {
            // Never print stack trace, raw SD paths, nonce, secret or file data.
            System.out.println("S9_MICROSD_SYNTHETIC_LEDGER_V194 "
                + "{\"status\":\"deferred_or_failed\",\"stage\":\""+stage+"\","
                + "\"real_clips_opened\":0,\"real_save_delete_enabled\":false,"
                + "\"originals_removed\":0,\"camera_apk_modified\":false}");
            System.exit(2);
        } finally {
            Arrays.fill(key,(byte)0);
        }
    }
}
