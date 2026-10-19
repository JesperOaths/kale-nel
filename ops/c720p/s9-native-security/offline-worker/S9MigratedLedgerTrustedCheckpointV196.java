package nl.kalenel.s9offline;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * SOURCE-ONLY durable checkpoint for a future authenticated S9 Save/Delete
 * service. NOT wired to Camera2, the phone, HTTP or person-review state.
 *
 * Caller MUST supply an app-internal, separately protected filesDir, NOT
 * the recording microSD or a caller-selected path. An independent trusted key
 * must come from app-private / Android Keystore context; no key is provisioned
 * or logged here. The future service must update the journal FIRST, then the
 * checkpoint under a serialized service lock, and give NO receipt until both
 * fsyncs succeed. If interrupted between writes, it MUST fail closed; this
 * class intentionally does not repair or discard unmatched journal records.
 *
 * This checkpoint protects against a single SD-card valid-prefix rollback;
 * it cannot prove protection against compromise of BOTH trusted stores.
 */
public final class S9MigratedLedgerTrustedCheckpointV196 implements AutoCloseable {
    private static final Pattern HEX=Pattern.compile("[a-f0-9]{64}");
    private static final String ZERO=repeat('0',64);
    private static final String DOC="c720p-ledger-trusted-head-v196";
    private static final String LOCK=".c720p-ledger-trusted-head-v196.lock";
    private static final String SCHEMA="s9_c720p_trusted_checkpoint_v196";
    private final Path dir, target, lockFile;
    private final byte[] key;
    private boolean closed;

    public static final class State {
        public final long sequence;
        public final String headSha256;
        public final boolean durableAnchorVerified;
        private State(long sequence,String head,boolean verified) {
            this.sequence=sequence;headSha256=head;
            durableAnchorVerified=verified;
        }
        public boolean mayRemoveOriginal() {return false;}
        public boolean authorizesRemoteMutation() {return false;}
    }

    public S9MigratedLedgerTrustedCheckpointV196(File appInternalDirectory,byte[] secret)
            throws IOException {
        if (appInternalDirectory==null || secret==null || secret.length<32)
            throw new IOException("trusted_checkpoint_setup_invalid");
        dir=appInternalDirectory.toPath();
        if (Files.isSymbolicLink(dir)
                || !Files.isDirectory(dir,LinkOption.NOFOLLOW_LINKS))
            throw new IOException("trusted_checkpoint_directory_untrusted");
        String resolved=dir.toRealPath(LinkOption.NOFOLLOW_LINKS).toString();
        if (resolved.startsWith("/storage/") || resolved.startsWith("/sdcard/")
                || resolved.startsWith("/mnt/media_rw/"))
            throw new IOException("trusted_checkpoint_must_not_be_on_micro_sd");
        target=dir.resolve(DOC);lockFile=dir.resolve(LOCK);
        requireRegular(target);requireRegular(lockFile);
        if (Files.size(target)>350 || Files.size(lockFile)!=0)
            throw new IOException("trusted_checkpoint_files_untrusted");
        key=Arrays.copyOf(secret,secret.length);
    }

    private static void requireRegular(Path file) throws IOException {
        if (Files.isSymbolicLink(file)
                || !Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS))
            throw new IOException("private_preprovisioned_checkpoint_files_required");
    }

    public synchronized State read() throws IOException {
        checkOpen();
        requireRegular(target);requireRegular(lockFile);
        try(FileChannel channel=FileChannel.open(lockFile,StandardOpenOption.WRITE);
            FileLock locked=channel.lock()) {
            return readSigned();
        } catch(java.nio.channels.OverlappingFileLockException error) {
            throw new IOException("trusted_checkpoint_lock_busy",error);
        } catch(GeneralSecurityException error) {
            throw new IOException("trusted_checkpoint_crypto_unavailable");
        }
    }

    /** Source-qualified CAS advance. Never accepts a rolled-back prior head. */
    public synchronized State advance(long priorSequence,String priorHead,
            long nextSequence,String nextHead) throws IOException {
        checkOpen();
        if (priorSequence<0 || priorSequence>=5000 || nextSequence!=priorSequence+1
                || !isHex(priorHead) || !isHex(nextHead))
            throw new IOException("trusted_checkpoint_transition_invalid");
        requireRegular(target);requireRegular(lockFile);
        try(FileChannel channel=FileChannel.open(lockFile,StandardOpenOption.WRITE);
            FileLock locked=channel.lock()) {
            State before=readSigned();
            if (before.sequence!=priorSequence
                    || !equal(before.headSha256,priorHead))
                throw new IOException("trusted_checkpoint_cas_conflict");
            // An empty anchor is a genesis marker ONLY; the caller must have
            // independently verified the external microSD journal is empty.
            String payload=SCHEMA+"|"+nextSequence+"|"+nextHead;
            String serialized=payload+"|"+mac(payload)+"\n";
            byte[] encoded=serialized.getBytes(StandardCharsets.US_ASCII);
            if (encoded.length>350)throw new IOException("checkpoint_oversized");
            Path staging=Files.createTempFile(dir,".c720p-anchor-",".pending");
            boolean promoted=false;
            try {
                try(FileOutputStream stream=new FileOutputStream(staging.toFile(),false)) {
                    stream.write(encoded);stream.flush();stream.getFD().sync();
                }
                if (Files.isSymbolicLink(target))
                    throw new IOException("trusted_checkpoint_symlink_swapped");
                try {
                    Files.move(staging,target,StandardCopyOption.ATOMIC_MOVE,
                            StandardCopyOption.REPLACE_EXISTING);
                } catch(AtomicMoveNotSupportedException error) {
                    throw new IOException("trusted_checkpoint_atomic_move_unavailable");
                }
                promoted=true;
                // Durably persist directory entry, not merely the file data.
                try(FileChannel root=FileChannel.open(dir,StandardOpenOption.READ)) {
                    root.force(true);
                }
                State after=readSigned();
                if (after.sequence!=nextSequence || !equal(after.headSha256,nextHead))
                    throw new IOException("trusted_checkpoint_readback_mismatch");
                return after;
            } finally {
                if (!promoted)Files.deleteIfExists(staging); // own pending file only
            }
        } catch(java.nio.channels.OverlappingFileLockException error) {
            throw new IOException("trusted_checkpoint_lock_busy",error);
        } catch(GeneralSecurityException error) {
            throw new IOException("trusted_checkpoint_crypto_unavailable");
        }
    }

    private State readSigned() throws IOException,GeneralSecurityException {
        if (Files.size(target)>350)throw new IOException("trusted_checkpoint_oversized");
        byte[] bytes=Files.readAllBytes(target);
        if (bytes.length==0)return new State(0,ZERO,false);
        if (bytes[bytes.length-1]!='\n')
            throw new IOException("trusted_checkpoint_partial_record");
        String s=new String(bytes,StandardCharsets.US_ASCII);
        String[] columns=s.substring(0,s.length()-1).split("\\|",-1);
        if (columns.length!=4 || !SCHEMA.equals(columns[0])
                || !isHex(columns[2]) || !isHex(columns[3]))
            throw new IOException("trusted_checkpoint_invalid_record");
        long seq;
        try { seq=Long.parseLong(columns[1]); }
        catch(NumberFormatException e) {
            throw new IOException("trusted_checkpoint_invalid_sequence");
        }
        if (seq<=0 || seq>5000 || !equal(mac(columns[0]+"|"+columns[1]+"|"+columns[2]),
                                         columns[3]))
            throw new IOException("trusted_checkpoint_integrity_failed");
        return new State(seq,columns[2],true);
    }

    private static boolean isHex(String value) {
        return value!=null && HEX.matcher(value).matches();
    }
    private static boolean equal(String a,String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.US_ASCII),
                                     b.getBytes(StandardCharsets.US_ASCII));
    }
    private String mac(String payload) throws GeneralSecurityException {
        Mac h=Mac.getInstance("HmacSHA256");
        h.init(new SecretKeySpec(key,"HmacSHA256"));
        byte[] signed=h.doFinal(payload.getBytes(StandardCharsets.US_ASCII));
        char[] alphabet="0123456789abcdef".toCharArray();
        char[] result=new char[signed.length*2];
        for(int i=0;i<signed.length;i++){
            result[2*i]=alphabet[(signed[i]>>4)&15];
            result[2*i+1]=alphabet[signed[i]&15];
        }
        return new String(result);
    }
    private void checkOpen()throws IOException {
        if(closed)throw new IOException("trusted_checkpoint_closed");
    }
    private static String repeat(char c,int size){
        char[] b=new char[size];Arrays.fill(b,c);return new String(b);
    }
    @Override public synchronized void close(){
        Arrays.fill(key,(byte)0);closed=true;
    }
}
