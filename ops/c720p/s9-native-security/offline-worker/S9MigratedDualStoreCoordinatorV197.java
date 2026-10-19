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
import java.util.Arrays;

/**
 * SOURCE-ONLY crash-fail-closed coordinator for the future S9+ action service.
 *
 * PRECONDITIONS of a future authenticated service (NOT provided here):
 *  - Exclusive authority: every journal writer must use this coordinator.
 *  - The calling service has independently authorized the human's action,
 *    verified the exact current MP4 SHA/length and source manifest on S9,
 *    and issued its own unique nonce (not caller-chosen).
 *  - A distinct key protects each preprovisioned store, and app-internal
 *    filesDir is not the SD card, public storage or caller-controlled.
 *  - The app-private coordinator lock is preprovisioned, never symlinked.
 *
 * Exactly one app-private lock covers journal consistency, journal fsync
 * append and independent checkpoint CAS/fsync. No success/receipt is emitted
 * until both storage domains match and independently verify. If power loss
 * occurs in the non-atomic two-filesystem interval, future transactions
 * REFUSE; they never auto-repair or truncate a valid journal suffix.
 *
 * There is NO listener, authentication token, APK installation, file deletion,
 * person review update, Camera2 integration, or local retirement here.
 */
public final class S9MigratedDualStoreCoordinatorV197 implements AutoCloseable {
    private static final String ZERO=repeat('0',64);
    private static final String LOCK=".c720p-migrated-dual-store-v197.lock";
    private final Path pairLock;
    private final S9MigratedMetadataLedgerV193 ledger;
    private final S9MigratedLedgerTrustedCheckpointV196 checkpoint;
    private boolean closed;

    public static final class State {
        public final long sequence;
        public final String headSha256;
        public final boolean trustedCheckpointVerified;
        State(long seq,String head,boolean verified) {
            sequence=seq;headSha256=head;trustedCheckpointVerified=verified;
        }
        public boolean authorizesRemoteMutation(){return false;}
        public boolean mayRemoveOriginal(){return false;}
    }

    public S9MigratedDualStoreCoordinatorV197(File appInternalDir,File phoneSdLedgerDir,
                                              byte[] journalKey,byte[] independentKey)
            throws IOException {
        if(appInternalDir==null || phoneSdLedgerDir==null || journalKey==null
                || independentKey==null || journalKey.length<32
                || independentKey.length<32
                || MessageDigest.isEqual(journalKey,independentKey))
            throw new IOException("dual_store_provisioning_invalid");
        Path dir=appInternalDir.toPath();
        if(Files.isSymbolicLink(dir) || !Files.isDirectory(dir,LinkOption.NOFOLLOW_LINKS))
            throw new IOException("dual_store_internal_directory_untrusted");
        pairLock=dir.resolve(LOCK);
        assertPrivateLock();
        S9MigratedLedgerTrustedCheckpointV196 cp=null;
        S9MigratedMetadataLedgerV193 sd=null;
        try {
            cp=new S9MigratedLedgerTrustedCheckpointV196(appInternalDir,independentKey);
            sd=new S9MigratedMetadataLedgerV193(phoneSdLedgerDir,journalKey);
        } catch(IOException failure) {
            if(cp!=null)cp.close();
            if(sd!=null)sd.close();
            throw failure;
        }
        checkpoint=cp;
        ledger=sd;
    }

    private void assertPrivateLock()throws IOException {
        if(Files.isSymbolicLink(pairLock)
                || !Files.isRegularFile(pairLock,LinkOption.NOFOLLOW_LINKS)
                || Files.size(pairLock)!=0)
            throw new IOException("preprovisioned_private_coordinator_lock_required");
    }
    private void checkOpen()throws IOException {
        if(closed)throw new IOException("dual_store_coordinator_closed");
    }
    private FileLock lock(FileChannel channel)throws IOException {
        try{
            FileLock held=channel.tryLock();
            if(held==null)throw new IOException("dual_store_coordinator_busy");
            return held;
        }catch(OverlappingFileLockException error){
            throw new IOException("dual_store_coordinator_busy",error);
        }
    }
    private State verifiedState()throws IOException {
        S9MigratedLedgerTrustedCheckpointV196.State prior=checkpoint.read();
        // An empty checkpoint is only a genesis marker, NOT an authenticated
        // success claim. Its SD journal MUST also be genuinely empty.
        if(prior.sequence==0){
            if(prior.durableAnchorVerified || !ZERO.equals(prior.headSha256))
                throw new IOException("untrusted_dual_store_genesis");
            ledger.requireTrustedHead(0,ZERO);
        }else{
            if(!prior.durableAnchorVerified)
                throw new IOException("missing_trusted_checkpoint");
            ledger.requireTrustedHead(prior.sequence,prior.headSha256);
        }
        return new State(prior.sequence,prior.headSha256,prior.durableAnchorVerified);
    }

    public synchronized State verifyReadOnly()throws IOException {
        checkOpen();
        assertPrivateLock();
        try(FileChannel channel=FileChannel.open(pairLock,StandardOpenOption.WRITE);
            FileLock held=lock(channel)){
            return verifiedState();
        }
    }

    /** Only metadata; no MP4/JPEG read or write, no real remote authorization. */
    public synchronized S9MigratedMetadataLedgerV193.Receipt commitVerifiedMetadata(
            String action,String name,String expectedSourceSha,long expectedBytes,
            String nonce)throws IOException {
        checkOpen();
        assertPrivateLock();
        try(FileChannel channel=FileChannel.open(pairLock,StandardOpenOption.WRITE);
            FileLock held=lock(channel)){
            State before=verifiedState();
            // Future service must source-verify/authenticate BEFORE calling us.
            // This class *cannot* confer that authority on its caller.
            S9MigratedMetadataLedgerV193.Receipt receipt=
                ledger.commit(action,name,expectedSourceSha,expectedBytes,nonce);
            if(receipt.ledgerSequence==before.sequence){
                // Exact retry of most recent global action only; reject a
                // signed historical receipt whose state has since advanced.
                if(!MessageDigest.isEqual(
                      receipt.ledgerHeadSha256.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                      before.headSha256.getBytes(java.nio.charset.StandardCharsets.US_ASCII)))
                    throw new IOException("dual_store_idempotence_not_latest_head");
            }else if(receipt.ledgerSequence==before.sequence+1){
                checkpoint.advance(before.sequence,before.headSha256,
                                   receipt.ledgerSequence,receipt.ledgerHeadSha256);
            }else{
                throw new IOException("dual_store_unexpected_receipt_position");
            }
            State after=verifiedState();
            if(after.sequence!=receipt.ledgerSequence
                    || !after.headSha256.equals(receipt.ledgerHeadSha256)
                    || !after.trustedCheckpointVerified)
                throw new IOException("dual_store_postcommit_verification_failed");
            return receipt;
        }
    }

    @Override public synchronized void close(){
        if(!closed){
            ledger.close();
            checkpoint.close();
            closed=true;
        }
    }
    private static String repeat(char c,int n){
        char[] b=new char[n];Arrays.fill(b,c);return new String(b);
    }
}
