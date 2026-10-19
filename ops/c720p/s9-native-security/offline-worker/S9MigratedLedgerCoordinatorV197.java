package nl.kalenel.s9offline;

import java.io.File;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;

/**
 * SOURCE ONLY: serialize metadata journal + independently keyed internal head.
 * This is NOT an authenticated HTTP service, production provisioner, or media
 * Save/Delete implementation. Does not open, remove or change any MP4/JPEG.
 *
 * Future privileged service MUST provide authenticated, manifest-qualified
 * clip/source metadata; preprovision the exclusive lock in Android app-private
 * filesDir; supply distinct protected keys; and use this coordinator for EVERY
 * journal writer. The external user interface remains shadow-only.
 *
 * Commit order: verify BOTH stores -> fsync journal append -> fsync independent
 * checkpoint -> reverify BOTH. Any interruption leaves a mismatch and MUST
 * be escalated for manual recovery; NEVER truncate a valid journal to fix it.
 */
public final class S9MigratedLedgerCoordinatorV197 implements AutoCloseable {
    private static final String GATE = ".c720p-migrated-dualstore-v197.lock";
    private final Path gateFile;
    private final S9MigratedMetadataLedgerV193 journal;
    private final S9MigratedLedgerTrustedCheckpointV196 anchor;
    private boolean closed;

    public static final class VerifiedView {
        public final S9MigratedMetadataLedgerV193.CurrentDecision decision;
        public final long trustedSequence;
        public final String trustedHeadSha256;
        public final boolean independentHeadVerified;
        private VerifiedView(S9MigratedMetadataLedgerV193.CurrentDecision d,
                             S9MigratedLedgerTrustedCheckpointV196.State a) {
            decision=d;trustedSequence=a.sequence;trustedHeadSha256=a.headSha256;
            independentHeadVerified=a.durableAnchorVerified;
        }
        public boolean mayRemoveOriginal(){return false;}
        public boolean authorizesRemoteMutation(){return false;}
    }

    public S9MigratedLedgerCoordinatorV197(File privateInternalDir, File privateSdDir,
            byte[] journalKey, byte[] independentCheckpointKey) throws IOException {
        if (privateInternalDir==null || privateSdDir==null || journalKey==null
                || independentCheckpointKey==null || journalKey.length<32
                || independentCheckpointKey.length<32
                || MessageDigest.isEqual(journalKey,independentCheckpointKey))
            throw new IOException("dualstore_keys_or_roots_invalid");
        Path internal=privateInternalDir.toPath();
        Path sd=privateSdDir.toPath();
        if(Files.isSymbolicLink(internal) || Files.isSymbolicLink(sd)
                || !Files.isDirectory(internal,LinkOption.NOFOLLOW_LINKS)
                || !Files.isDirectory(sd,LinkOption.NOFOLLOW_LINKS)
                || internal.toRealPath().equals(sd.toRealPath()))
            throw new IOException("dualstore_roots_not_independent");
        gateFile=internal.resolve(GATE);
        requireGate();
        if(Files.size(gateFile)!=0)
            throw new IOException("dualstore_gate_must_be_empty");
        S9MigratedMetadataLedgerV193 j=null;
        S9MigratedLedgerTrustedCheckpointV196 a=null;
        try {
            j=new S9MigratedMetadataLedgerV193(privateSdDir,journalKey);
            a=new S9MigratedLedgerTrustedCheckpointV196(
                    privateInternalDir,independentCheckpointKey);
        } catch(IOException error) {
            if(j!=null)j.close();
            if(a!=null)a.close();
            throw error;
        }
        journal=j;anchor=a;
    }

    private void requireGate() throws IOException {
        if(Files.isSymbolicLink(gateFile)
                || !Files.isRegularFile(gateFile,LinkOption.NOFOLLOW_LINKS))
            throw new IOException("preprovisioned_private_dualstore_gate_required");
    }
    private void ensureOpen() throws IOException {
        if(closed)throw new IOException("dualstore_closed");
        requireGate();
    }

    /** Fail closed on any crash window, prefix rollback or uncoordinated write. */
    private S9MigratedLedgerTrustedCheckpointV196.State verified()
            throws IOException {
        S9MigratedLedgerTrustedCheckpointV196.State state=anchor.read();
        journal.requireTrustedHead(state.sequence,state.headSha256);
        return state;
    }

    /**
     * Only persists metadata/tombstones. Source SHA, bytes and nonce MUST have
     * been independently established by the future authenticated caller.
     * Returns a receipt ONLY once both durable stores have verified.
     */
    public synchronized S9MigratedMetadataLedgerV193.Receipt commitMetadata(
            String action,String name,String sourceSha256,long sourceBytes,
            String nonce) throws IOException {
        ensureOpen();
        try(FileChannel channel=FileChannel.open(gateFile,StandardOpenOption.WRITE);
            FileLock held=channel.lock()) {
            S9MigratedLedgerTrustedCheckpointV196.State before=verified();
            S9MigratedMetadataLedgerV193.Receipt receipt=
                    journal.commit(action,name,sourceSha256,sourceBytes,nonce);
            if(receipt.ledgerSequence==before.sequence+1) {
                anchor.advance(before.sequence,before.headSha256,
                        receipt.ledgerSequence,receipt.ledgerHeadSha256);
            } else if(receipt.ledgerSequence>before.sequence
                    || receipt.ledgerSequence<=0) {
                throw new IOException("dualstore_unexpected_receipt_sequence");
            }
            // Older exact-nonce retries remain possible only if STILL current
            // for the same clip. Recheck independently verified global head.
            S9MigratedLedgerTrustedCheckpointV196.State after=verified();
            S9MigratedMetadataLedgerV193.CurrentDecision current=
                    journal.latestDecision(name);
            if(current==null || !current.action.equals(receipt.action)
                    || !current.name.equals(receipt.name)
                    || !current.sourceSha256.equals(receipt.sourceSha256)
                    || current.sourceBytes!=receipt.sourceBytes
                    || current.ledgerSequence!=receipt.ledgerSequence
                    || !current.ledgerHeadSha256.equals(receipt.ledgerHeadSha256)
                    || after.sequence<receipt.ledgerSequence)
                throw new IOException("dualstore_receipt_not_current");
            // No promise that source bytes exist or that local copy may retire.
            return receipt;
        } catch(OverlappingFileLockException error) {
            throw new IOException("dualstore_exclusive_lock_busy",error);
        }
    }

    public synchronized VerifiedView latestVerified(String name)
            throws IOException {
        ensureOpen();
        try(FileChannel channel=FileChannel.open(gateFile,StandardOpenOption.WRITE);
            FileLock held=channel.lock()) {
            S9MigratedLedgerTrustedCheckpointV196.State before=verified();
            S9MigratedMetadataLedgerV193.CurrentDecision decision=
                    journal.latestDecision(name);
            S9MigratedLedgerTrustedCheckpointV196.State after=verified();
            if(before.sequence!=after.sequence
                    || !MessageDigest.isEqual(
                       before.headSha256.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                       after.headSha256.getBytes(java.nio.charset.StandardCharsets.US_ASCII)))
                throw new IOException("dualstore_read_race");
            return new VerifiedView(decision,after);
        } catch(OverlappingFileLockException error) {
            throw new IOException("dualstore_exclusive_lock_busy",error);
        }
    }

    @Override public synchronized void close() {
        if(!closed){anchor.close();journal.close();closed=true;}
    }
}
