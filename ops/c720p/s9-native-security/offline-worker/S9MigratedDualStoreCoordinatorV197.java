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
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * SOURCE ONLY, NO API: fail-closed coordination of S9's separate fsynced
 * microSD journal and authenticated phone-INTERNAL checkpoint.
 *
 * The future authenticated S9 service must be the ONLY writer of both stores,
 * serialize callers through its own app-private service lock, attest the
 * physical MP4 SHA-256 immediately before calling, and provision two keys in
 * separate security domains. Do not expose this class to browser requests.
 * A gap caused by power loss is never repaired silently; fail closed.
 * No remote Save/Delete endpoint, media removal, Camera2 or person change.
 */
public final class S9MigratedDualStoreCoordinatorV197 implements AutoCloseable {
    private final S9MigratedMetadataLedgerV193 journal;
    private final S9MigratedLedgerTrustedCheckpointV196 checkpoint;
    private final Path serviceLock;
    private final boolean allowFirstEnrollment;
    private boolean closed;

    /**
     * This constructor NEVER creates files. Provision an app-private empty
     * lock, journal, checkpoint and two independent keys externally.
     * allowFirstEnrollment is only for a separately authorized, verified
     * EMPTY-store initial enrollment, NEVER for ordinary remote requests.
     */
    public S9MigratedDualStoreCoordinatorV197(
            S9MigratedMetadataLedgerV193 journal,
            S9MigratedLedgerTrustedCheckpointV196 checkpoint,
            File preprovisionedInternalLock,
            boolean allowFirstEnrollment) throws IOException {
        if (journal == null || checkpoint == null ||
                preprovisionedInternalLock == null)
            throw new IOException("dual_store_preprovisioning_required");
        serviceLock = preprovisionedInternalLock.toPath();
        requireLock();
        this.journal = journal;
        this.checkpoint = checkpoint;
        this.allowFirstEnrollment = allowFirstEnrollment;
    }

    private void requireLock() throws IOException {
        if (Files.isSymbolicLink(serviceLock) ||
                !Files.isRegularFile(serviceLock, LinkOption.NOFOLLOW_LINKS)
                || Files.size(serviceLock) != 0)
            throw new IOException("app_internal_service_lock_untrusted");
        String resolved = serviceLock.toRealPath(LinkOption.NOFOLLOW_LINKS).toString();
        if (resolved.startsWith("/storage/") || resolved.startsWith("/sdcard/")
                || resolved.startsWith("/mnt/media_rw/"))
            throw new IOException("app_internal_lock_cannot_use_sdcard");
    }

    /**
     * App-only commit barrier. Only return a durable metadata receipt if:
     * (1) both trusted heads matched BEFORE the request; (2) microSD commit
     * has fsynced and read back; (3) independent checkpoint has fsynced,
     * directory-fsynced and read back; (4) both heads still match.
     *
     * An interrupted gap, valid-prefix rollback or checkpoint corruption
     * raises IOException. It does NOT truncate/repair the journal, retry
     * with a new nonce, rewrite a checkpoint, or delete media. Future
     * recovery is deliberately a separate manual supervised process.
     */
    public synchronized S9MigratedMetadataLedgerV193.Receipt commitMetadata(
            String action, String name, String verifiedSourceSha256,
            long verifiedSourceBytes, String nonce) throws IOException {
        if (closed)throw new IOException("dual_store_closed");
        requireLock();
        try(FileChannel channel = FileChannel.open(serviceLock, StandardOpenOption.WRITE);
            FileLock exclusive = channel.lock()) {
            S9MigratedLedgerTrustedCheckpointV196.State previous = checkpoint.read();
            if (previous.sequence == 0 && !previous.durableAnchorVerified &&
                    !allowFirstEnrollment)
                throw new IOException("unanchored_genesis_requires_explicit_enrollment");
            // This catches an SD journal whose last complete signed Delete
            // or Save row disappeared, even though remaining rows authenticate.
            journal.requireTrustedHead(previous.sequence, previous.headSha256);
            S9MigratedMetadataLedgerV193.Receipt row = journal.commit(
                action,name,verifiedSourceSha256,verifiedSourceBytes,nonce);
            if (row.ledgerSequence == previous.sequence) {
                // Only an exact global-head retry is idempotent.
                if (!constantEquals(row.ledgerHeadSha256,previous.headSha256))
                    throw new IOException("previous_receipt_not_current_global_head");
                journal.requireTrustedHead(previous.sequence,previous.headSha256);
                return row;
            }
            if (row.ledgerSequence != previous.sequence + 1)
                throw new IOException("historical_receipt_not_current_global_head");
            S9MigratedLedgerTrustedCheckpointV196.State now = checkpoint.advance(
                previous.sequence,previous.headSha256,
                row.ledgerSequence,row.ledgerHeadSha256);
            if (now.sequence != row.ledgerSequence ||
                    !now.durableAnchorVerified ||
                    !constantEquals(now.headSha256,row.ledgerHeadSha256))
                throw new IOException("independent_checkpoint_readback_invalid");
            journal.requireTrustedHead(now.sequence,now.headSha256);
            return row;
        } catch(OverlappingFileLockException error) {
            throw new IOException("dual_store_exclusive_lock_busy",error);
        }
    }

    /** Read only: no stale or unanchored state escapes a divergent pair. */
    public synchronized S9MigratedMetadataLedgerV193.CurrentDecision currentState(
            String name) throws IOException {
        if (closed)throw new IOException("dual_store_closed");
        requireLock();
        try(FileChannel channel=FileChannel.open(serviceLock,StandardOpenOption.WRITE);
            FileLock exclusive=channel.lock()) {
            S9MigratedLedgerTrustedCheckpointV196.State trusted=checkpoint.read();
            if (!trusted.durableAnchorVerified)
                throw new IOException("current_state_requires_signed_checkpoint");
            journal.requireTrustedHead(trusted.sequence,trusted.headSha256);
            S9MigratedMetadataLedgerV193.CurrentDecision current =
                journal.latestDecision(name);
            journal.requireTrustedHead(trusted.sequence,trusted.headSha256);
            return current;
        } catch(OverlappingFileLockException error) {
            throw new IOException("dual_store_exclusive_lock_busy",error);
        }
    }

    private static boolean constantEquals(String a,String b) {
        if(a==null || b==null)return false;
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.US_ASCII),
                                      b.getBytes(StandardCharsets.US_ASCII));
    }

    /** Intentionally never closes callers' separately owned key contexts. */
    @Override public synchronized void close() { closed=true; }

    public boolean mayRemoveOriginal() { return false; }
    public boolean authorizesRemoteMutation() { return false; }
    public boolean liveServiceInstalled() { return false; }
}
