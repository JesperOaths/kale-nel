package nl.kalenel.s9offline;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Isolated S9+ microSD Save/Delete METADATA ledger (no server/CLI endpoint).
 *
 * This library is NOT installed by CI and never touches original MP4/JPEG
 * bytes, playback, person-review state or Camera2. It is only callable by a
 * future separately authenticated and source-SHA-verified S9 service.
 *
 * The provisioner MUST first create an owner-private directory containing
 * empty, fsync'd "actions-v193.log" and ".actions-v193.lock" in the phone's
 * private microSD metadata area, and keep a unique secret outside that area.
 * Appending to existing files + FileDescriptor.sync is the commit barrier.
 *
 * A successful commit only persists a reversible decision/tombstone. "delete"
 * NEVER deletes the referenced media. Actual media retirement needs
 * independent catalog, rollback, on-phone SHA and offline-fallback proofs.
 */
public final class S9MigratedMetadataLedgerV193 implements AutoCloseable {
    private static final Pattern CLIP = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,139}\\.mp4");
    private static final Pattern HEX64 = Pattern.compile("[a-f0-9]{64}");
    private static final Pattern HEX32 = Pattern.compile("[a-f0-9]{32}");
    private static final String ZERO = repeat('0', 64);
    private static final String LEDGER_NAME = "actions-v193.log";
    private static final String LOCK_NAME = ".actions-v193.lock";
    private static final int MAX_ROWS = 5000;
    private static final long MAX_LOG_BYTES = 2_000_000L;
    private final Path ledger;
    private final Path lockFile;
    private final byte[] key;
    private boolean closed;

    public static final class Receipt {
        public final String action, name, nonce, sourceSha256, ledgerHeadSha256, hmacSha256;
        public final long sourceBytes, ledgerSequence;
        public final boolean durable = true;
        private Receipt(Row r, String signature) {
            action = r.action; name = r.name; nonce = r.nonce;
            sourceSha256 = r.sourceHash; sourceBytes = r.bytes;
            ledgerSequence = r.sequence; ledgerHeadSha256 = r.head;
            hmacSha256 = signature;
        }
        public String schema() { return "s9_c720p_migrated_action_v2"; }
        public String status() { return "s9_committed"; }
        public String source() { return "s9_microsd"; }
        // Deliberately no media-deletion capability or success claim.
        public boolean mayRemoveOriginal() { return false; }
        public boolean personReviewsModified() { return false; }
    }

    private static final class Row {
        long sequence, bytes;
        String previous, nonce, action, name, sourceHash, head, mac;
    }

    public S9MigratedMetadataLedgerV193(File privateMetadataDirectory, byte[] suppliedKey)
            throws IOException {
        if (suppliedKey == null || suppliedKey.length < 32)
            throw new IOException("ledger_key_missing");
        if (privateMetadataDirectory == null)
            throw new IOException("private_ledger_directory_missing");
        Path dir = privateMetadataDirectory.toPath();
        if (Files.isSymbolicLink(dir) || !Files.isDirectory(dir, LinkOption.NOFOLLOW_LINKS))
            throw new IOException("private_ledger_directory_untrusted");
        ledger = dir.resolve(LEDGER_NAME);
        lockFile = dir.resolve(LOCK_NAME);
        ensureFile(ledger); ensureFile(lockFile);
        if (Files.size(ledger) > MAX_LOG_BYTES || Files.size(lockFile) != 0)
            throw new IOException("ledger_storage_untrusted");
        key = Arrays.copyOf(suppliedKey, suppliedKey.length);
    }

    private static void ensureFile(Path file) throws IOException {
        if (Files.isSymbolicLink(file)
                || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS))
            throw new IOException("preprovisioned_private_ledger_required");
    }

    public synchronized Receipt commit(String action, String name,
            String sourceSha256, long sourceBytes, String nonce) throws IOException {
        if (closed) throw new IOException("ledger_closed");
        if (!"save".equals(action) && !"delete".equals(action))
            throw new IOException("action_invalid");
        if (name == null || !CLIP.matcher(name).matches() || name.contains("..")
                || sourceSha256 == null || !HEX64.matcher(sourceSha256).matches()
                || sourceBytes < 10_000 || sourceBytes > 900L * 1024 * 1024
                || nonce == null || !HEX32.matcher(nonce).matches())
            throw new IOException("source_or_nonce_untrusted");
        ensureFile(ledger); ensureFile(lockFile);
        try (FileChannel lockChannel = FileChannel.open(lockFile, StandardOpenOption.WRITE);
             FileLock held = lockChannel.lock()) {
            List<Row> current = readVerified();
            for (Row row : current) {
                if (row.nonce.equals(nonce)) {
                    if (!row.action.equals(action) || !row.name.equals(name)
                            || !row.sourceHash.equals(sourceSha256)
                            || row.bytes != sourceBytes)
                        throw new IOException("nonce_replay_conflict");
                    // A previously valid Save receipt is not a claim about
                    // the CURRENT state after a subsequent Delete (or another
                    // state transition). This caller cannot resurrect a
                    // superseded action by replaying its old nonce. Compare
                    // against the latest action for this clip under the lock.
                    for (int j=current.size()-1;j>=0;j--) {
                        Row latest=current.get(j);
                        if (!latest.name.equals(name))continue;
                        if (latest.sequence!=row.sequence)
                            throw new IOException("superseded_receipt_no_longer_current");
                        break;
                    }
                    return receipt(row); // current exact idempotent retry
                }
                if (row.name.equals(name) && row.action.equals("delete"))
                    throw new IOException("deleted_metadata_requires_explicit_restore");
            }
            if (current.size() >= MAX_ROWS)
                throw new IOException("ledger_capacity_exceeded");
            Row row = new Row();
            row.sequence = current.size() + 1L;
            row.previous = current.isEmpty() ? ZERO : current.get(current.size()-1).head;
            row.nonce = nonce; row.action = action; row.name = name;
            row.sourceHash = sourceSha256; row.bytes = sourceBytes;
            String prefix = fields(row);
            row.head = sha256("chain-v193|" + prefix);
            row.mac = hmac("auth-v193|" + prefix + "|" + row.head);
            byte[] line = (prefix + "|" + row.head + "|" + row.mac + "\n")
                    .getBytes(StandardCharsets.US_ASCII);
            if (Files.size(ledger) + line.length > MAX_LOG_BYTES)
                throw new IOException("ledger_capacity_exceeded");
            try (FileOutputStream stream = new FileOutputStream(ledger.toFile(), true)) {
                stream.write(line);
                stream.flush();
                stream.getFD().sync(); // no receipt until on-phone append is synced
            }
            List<Row> verified = readVerified();
            if (verified.size() != row.sequence
                    || !verified.get(verified.size()-1).head.equals(row.head))
                throw new IOException("durable_ledger_readback_failed");
            return receipt(row);
        } catch (GeneralSecurityException error) {
            throw new IOException("ledger_crypto_unavailable") ;
        }
    }

    public synchronized int verifiedCount() throws IOException {
        if (closed) throw new IOException("ledger_closed");
        ensureFile(ledger);
        try {
            return readVerified().size();
        } catch (GeneralSecurityException error) {
            throw new IOException("ledger_crypto_unavailable");
        }
    }

    private List<Row> readVerified() throws IOException, GeneralSecurityException {
        if (Files.size(ledger) > MAX_LOG_BYTES)
            throw new IOException("ledger_oversized");
        byte[] bytes = Files.readAllBytes(ledger);
        if (bytes.length > 0 && bytes[bytes.length-1] != '\n')
            throw new IOException("partial_ledger_record");
        String text = new String(bytes, StandardCharsets.US_ASCII);
        List<Row> result = new ArrayList<Row>();
        String previous = ZERO;
        java.util.HashSet<String> seenNonces = new java.util.HashSet<String>();
        java.util.HashSet<String> tombstones = new java.util.HashSet<String>();
        if (text.isEmpty()) return result;
        String[] lines = text.split("\n", -1);
        for (int lineNumber=0;lineNumber<lines.length-1;lineNumber++) {
            String line = lines[lineNumber];
            if (line.isEmpty()) throw new IOException("empty_ledger_record");
            String[] fields = line.split("\\|", -1);
            if (fields.length != 9 || result.size() >= MAX_ROWS)
                throw new IOException("ledger_record_untrusted");
            Row row = new Row();
            try {
                row.sequence = Long.parseLong(fields[0]);
                row.bytes = Long.parseLong(fields[6]);
            } catch (NumberFormatException error) {
                throw new IOException("ledger_record_untrusted");
            }
            row.previous=fields[1];row.nonce=fields[2];
            row.action=fields[3];row.name=fields[4];
            row.sourceHash=fields[5];row.head=fields[7];row.mac=fields[8];
            if (row.sequence != result.size()+1L || row.bytes < 10_000
                    || row.bytes > 900L*1024*1024 || !previous.equals(row.previous)
                    || !HEX64.matcher(row.previous).matches()
                    || !HEX64.matcher(row.sourceHash).matches()
                    || !HEX64.matcher(row.head).matches()
                    || !HEX64.matcher(row.mac).matches()
                    || !HEX32.matcher(row.nonce).matches()
                    || !CLIP.matcher(row.name).matches() || row.name.contains("..")
                    || (!"save".equals(row.action) && !"delete".equals(row.action))
                    || !seenNonces.add(row.nonce)
                    || tombstones.contains(row.name))
                throw new IOException("ledger_chain_or_replay_invalid");
            String prefix = fields(row);
            if (!constantEquals(row.head, sha256("chain-v193|" + prefix))
                    || !constantEquals(row.mac, hmac("auth-v193|" + prefix + "|" + row.head)))
                throw new IOException("ledger_integrity_failed");
            if ("delete".equals(row.action)) tombstones.add(row.name);
            previous = row.head;
            result.add(row);
        }
        return result;
    }

    private static String fields(Row row) {
        return row.sequence+"|"+row.previous+"|"+row.nonce+"|"+row.action
                +"|"+row.name+"|"+row.sourceHash+"|"+row.bytes;
    }

    private Receipt receipt(Row row) throws GeneralSecurityException {
        // Lexicographic JSON keys must match Python canonical_receipt(v2).
        String canonical = "{\"action\":\""+row.action+"\",\"bytes\":"+row.bytes
            +",\"durable\":true,\"ledger_head_sha256\":\""+row.head
            +"\",\"ledger_sequence\":"+row.sequence
            +",\"name\":\""+row.name+"\",\"nonce\":\""+row.nonce
            +"\",\"schema\":\"s9_c720p_migrated_action_v2\""
            +",\"sha256\":\""+row.sourceHash
            +"\",\"source\":\"s9_microsd\",\"status\":\"s9_committed\"}";
        return new Receipt(row, hmac(canonical));
    }

    private static boolean constantEquals(String a,String b) {
        return MessageDigest.isEqual(
                a.getBytes(StandardCharsets.US_ASCII),
                b.getBytes(StandardCharsets.US_ASCII));
    }
    private String hmac(String data) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return hex(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
    }
    private static String sha256(String data) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            return hex(sha.digest(data.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("SHA256_unavailable");
        }
    }
    private static String hex(byte[] bytes) {
        char[] alphabet = "0123456789abcdef".toCharArray();
        char[] out = new char[bytes.length*2];
        for (int i=0;i<bytes.length;i++) {
            out[i*2]=alphabet[(bytes[i]>>4)&15];
            out[i*2+1]=alphabet[bytes[i]&15];
        }
        return new String(out);
    }
    private static String repeat(char c,int count) {
        char[] out=new char[count];Arrays.fill(out,c);return new String(out);
    }
    @Override public synchronized void close() {
        Arrays.fill(key,(byte)0);closed=true;
    }
}
