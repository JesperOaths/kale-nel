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
 * SOURCE-ONLY two-store metadata coordinator for a future S9 authenticated
 * service. Not an API, Android Activity, camera worker, or media manager.
 *
 * microSD V193 journal commits FIRST, app-internal V196 checkpoint SECOND.
 * Both are flushed and read back before returning a signed V2 receipt.
 * Journal append succeeded + checkpoint failed => FAIL CLOSED on every next
 * request, including a nonce retry. Recovery must be separately authorized,
 * proven, and audited; never silently discard or fabricate the extra row.
 *
 * An independent authorized source verifier and authenticated request layer
 * MUST be implemented by the future S9 app service. No original can be
 * removed and a metadata "delete" is still only a tombstone.
 */
public final class S9MigratedDualStoreCommitV197 implements AutoCloseable {
    private static final String LOCK_NAME=".c720p-dual-store-commit-v197.lock";
    private static final String GENESIS=repeat('0',64);
    private final Path serviceLock;
    private final S9MigratedMetadataLedgerV193 journal;
    private final S9MigratedLedgerTrustedCheckpointV196 checkpoint;
    private final boolean syntheticGenesisOnly;
    private final AfterJournalHook afterJournalHook;
    private boolean closed;

    /** Caller must verify exact on-phone source SHA/size AND authorization. */
    public interface AuthorizedSource {
        boolean permits(String action,String recordingName,
                        String sourceSha256,long sourceBytes) throws IOException;
    }
    /** Test-only injection, no automatic repair of interrupted commits. */
    interface AfterJournalHook {
        void afterMicroSdSync() throws IOException;
    }
    public static final class Result {
        public final S9MigratedMetadataLedgerV193.Receipt receipt;
        public final long trustedSequence;
        public final String trustedHeadSha256;
        public final boolean bothStoresVerified=true;
        private Result(S9MigratedMetadataLedgerV193.Receipt committed,
                       S9MigratedLedgerTrustedCheckpointV196.State trusted) {
            receipt=committed;
            trustedSequence=trusted.sequence;
            trustedHeadSha256=trusted.headSha256;
        }
        public boolean mayRemoveOriginal(){return false;}
        public boolean actualMediaDeleted(){return false;}
        public boolean personReviewsModified(){return false;}
    }

    /** Normal callers CANNOT bootstrap an empty, unverified checkpoint. */
    public S9MigratedDualStoreCommitV197(File privateInternalDir,File microSdLedgerDir,
            byte[] independentInternalKey,byte[] microSdLedgerKey)throws IOException {
        this(privateInternalDir,microSdLedgerDir,independentInternalKey,
             microSdLedgerKey,false,null);
    }
    /**
     * Future Android-app-owned route: pass two distinct non-exportable
     * HmacSHA256 signing handles, never raw key bytes or browser credentials.
     * Keystore alias custody and app authentication belong to the caller.
     * Like the byte[] production constructor, genesis remains forbidden.
     */
    public S9MigratedDualStoreCommitV197(File privateInternalDir,File microSdLedgerDir,
            javax.crypto.SecretKey independentInternalKey,
            javax.crypto.SecretKey microSdLedgerKey)throws IOException {
        if (privateInternalDir==null || microSdLedgerDir==null ||
                independentInternalKey==null || microSdLedgerKey==null ||
                independentInternalKey==microSdLedgerKey ||
                independentInternalKey.equals(microSdLedgerKey) ||
                !"HmacSHA256".equalsIgnoreCase(independentInternalKey.getAlgorithm()) ||
                !"HmacSHA256".equalsIgnoreCase(microSdLedgerKey.getAlgorithm()))
            throw new IOException("independent_keystore_hmac_handles_required");
        Path internal=privateInternalDir.toPath();
        Path external=microSdLedgerDir.toPath();
        if (Files.isSymbolicLink(internal) || Files.isSymbolicLink(external)
                || !Files.isDirectory(internal,LinkOption.NOFOLLOW_LINKS)
                || !Files.isDirectory(external,LinkOption.NOFOLLOW_LINKS)
                || internal.toRealPath().equals(external.toRealPath()))
            throw new IOException("separate_trusted_store_directories_required");
        serviceLock=internal.resolve(LOCK_NAME);
        if (Files.isSymbolicLink(serviceLock)
                || !Files.isRegularFile(serviceLock,LinkOption.NOFOLLOW_LINKS)
                || Files.size(serviceLock)!=0)
            throw new IOException("preprovisioned_coordinator_lock_required");
        syntheticGenesisOnly=false;
        afterJournalHook=null;
        S9MigratedMetadataLedgerV193 j=null;
        S9MigratedLedgerTrustedCheckpointV196 c=null;
        try {
            j=new S9MigratedMetadataLedgerV193(microSdLedgerDir,microSdLedgerKey);
            c=new S9MigratedLedgerTrustedCheckpointV196(privateInternalDir,
                                                         independentInternalKey);
        } catch(IOException error) {
            if(j!=null)j.close();
            if(c!=null)c.close();
            throw error;
        }
        journal=j;
        checkpoint=c;
    }

    /** Synthetic host-only provisioning / fault injection; not a live route. */
    S9MigratedDualStoreCommitV197(File privateInternalDir,File microSdLedgerDir,
            byte[] independentInternalKey,byte[] microSdLedgerKey,
            boolean allowSyntheticGenesis,AfterJournalHook syntheticFault)throws IOException {
        if (privateInternalDir==null || microSdLedgerDir==null ||
                independentInternalKey==null || microSdLedgerKey==null ||
                independentInternalKey.length<32 || microSdLedgerKey.length<32 ||
                MessageDigest.isEqual(independentInternalKey,microSdLedgerKey))
            throw new IOException("independent_ledger_keys_required");
        Path internal=privateInternalDir.toPath();
        Path external=microSdLedgerDir.toPath();
        if (Files.isSymbolicLink(internal) || Files.isSymbolicLink(external)
                || !Files.isDirectory(internal,LinkOption.NOFOLLOW_LINKS)
                || !Files.isDirectory(external,LinkOption.NOFOLLOW_LINKS)
                || internal.toRealPath().equals(external.toRealPath()))
            throw new IOException("separate_trusted_store_directories_required");
        serviceLock=internal.resolve(LOCK_NAME);
        if (Files.isSymbolicLink(serviceLock)
                || !Files.isRegularFile(serviceLock,LinkOption.NOFOLLOW_LINKS)
                || Files.size(serviceLock)!=0)
            throw new IOException("preprovisioned_coordinator_lock_required");
        syntheticGenesisOnly=allowSyntheticGenesis;
        afterJournalHook=syntheticFault;
        S9MigratedMetadataLedgerV193 j=null;
        S9MigratedLedgerTrustedCheckpointV196 c=null;
        try {
            j=new S9MigratedMetadataLedgerV193(microSdLedgerDir,microSdLedgerKey);
            c=new S9MigratedLedgerTrustedCheckpointV196(privateInternalDir,
                                                         independentInternalKey);
        } catch(IOException error) {
            if(j!=null)j.close();
            if(c!=null)c.close();
            throw error;
        }
        journal=j;checkpoint=c;
    }

    private static String repeat(char c,int n) {
        char[] chars=new char[n];
        java.util.Arrays.fill(chars,c);
        return new String(chars);
    }
    private void requireOpen()throws IOException {
        if(closed)throw new IOException("dual_store_coordinator_closed");
    }
    /**
     * A preprovisioned lock is checked again for every operation: another
     * actor might have replaced it after construction. NOFOLLOW_LINKS also
     * blocks a symlink swapped between the check and channel.open.
     */
    private FileChannel openTrustedServiceLock() throws IOException {
        if(Files.isSymbolicLink(serviceLock)
                || !Files.isRegularFile(serviceLock,LinkOption.NOFOLLOW_LINKS)
                || Files.size(serviceLock)!=0)
            throw new IOException("preprovisioned_coordinator_lock_required");
        return FileChannel.open(serviceLock,StandardOpenOption.WRITE,
                                LinkOption.NOFOLLOW_LINKS);
    }
    private FileLock takeLock(FileChannel channel)throws IOException {
        try{return channel.lock();}
        catch(OverlappingFileLockException e){
            throw new IOException("dual_store_coordinator_busy",e);
        }
    }
    private S9MigratedLedgerTrustedCheckpointV196.State verifyBothStores()
            throws IOException {
        S9MigratedLedgerTrustedCheckpointV196.State head=checkpoint.read();
        // Production bootstrapping is NOT permitted by this library. The
        // real service needs separately authenticated first-use enrollment.
        if (head.sequence==0 && !head.durableAnchorVerified &&
                !syntheticGenesisOnly)
            throw new IOException("unverified_genesis_requires_secure_provisioning");
        journal.requireTrustedHead(head.sequence,head.headSha256);
        return head;
    }

    /** Read only an internally anchored, HMAC-verified latest decision. */
    public synchronized S9MigratedMetadataLedgerV193.CurrentDecision
            currentDecision(String name)throws IOException {
        requireOpen();
        try(FileChannel channel=openTrustedServiceLock();
            FileLock held=takeLock(channel)) {
            S9MigratedLedgerTrustedCheckpointV196.State before=verifyBothStores();
            S9MigratedMetadataLedgerV193.CurrentDecision decision=
                journal.latestDecision(name);
            // A separate, uncoordinated writer must not make this per-clip
            // projection silently stale while the read is being assembled.
            S9MigratedLedgerTrustedCheckpointV196.State after=verifyBothStores();
            if(before.sequence!=after.sequence
                    || !MessageDigest.isEqual(before.headSha256.getBytes(
                        java.nio.charset.StandardCharsets.US_ASCII),
                        after.headSha256.getBytes(
                        java.nio.charset.StandardCharsets.US_ASCII)))
                throw new IOException("dual_store_changed_during_state_read");
            return decision;
        }
    }

    /**
     * Always requires *fresh* checkpoint sequence/head from trusted server
     * context and a separate exact-source authorization check. Never accept
     * request-origin assertions as identity/authentication or source proof.
     *
     * Idempotent latest nonce retries are possible only if caller supplies
     * the CURRENT authenticated checkpoint expected state.
     */
    public synchronized Result commitMetadataOnly(String action,String name,
            String sha256,long bytes,String nonce,long expectedSequence,
            String expectedHeadSha256,AuthorizedSource trustedSource)throws IOException {
        requireOpen();
        if(trustedSource==null)
            throw new IOException("authenticated_source_verifier_required");
        try(FileChannel channel=openTrustedServiceLock();
            FileLock held=takeLock(channel)) {
            S9MigratedLedgerTrustedCheckpointV196.State before=verifyBothStores();
            if(before.sequence!=expectedSequence || expectedHeadSha256==null ||
                    !MessageDigest.isEqual(before.headSha256.getBytes(
                        java.nio.charset.StandardCharsets.US_ASCII),
                        expectedHeadSha256.getBytes(
                        java.nio.charset.StandardCharsets.US_ASCII)))
                throw new IOException("stale_expected_commit_head");
            if(!trustedSource.permits(action,name,sha256,bytes))
                throw new IOException("source_or_action_not_authorized");
            // The journal independently validates clip, hash, nonce, action.
            S9MigratedMetadataLedgerV193.Receipt item=
                journal.commit(action,name,sha256,bytes,nonce);
            S9MigratedLedgerTrustedCheckpointV196.State after;
            if(item.ledgerSequence==before.sequence &&
                    before.headSha256.equals(item.ledgerHeadSha256)){
                // Latest-idempotent retry: no journal append and no checkpoint
                // modification. Still revalidate both stores.
                after=before;
            } else if(item.ledgerSequence==before.sequence+1) {
                if(afterJournalHook!=null)afterJournalHook.afterMicroSdSync();
                // Failure HERE intentionally leaves the journal ahead:
                // future calls detect mismatch and refuse to issue receipts.
                after=checkpoint.advance(before.sequence,before.headSha256,
                                         item.ledgerSequence,item.ledgerHeadSha256);
            } else {
                throw new IOException("unexpected_ledger_commit_sequence");
            }
            journal.requireTrustedHead(after.sequence,after.headSha256);
            S9MigratedLedgerTrustedCheckpointV196.State reloaded=checkpoint.read();
            if (reloaded.sequence!=item.ledgerSequence ||
                    !reloaded.headSha256.equals(item.ledgerHeadSha256))
                throw new IOException("dual_store_postcommit_readback_failed");
            return new Result(item,reloaded);
        }
    }

    @Override public synchronized void close() {
        if(!closed){
            closed=true;
            journal.close();
            checkpoint.close();
        }
    }
}
