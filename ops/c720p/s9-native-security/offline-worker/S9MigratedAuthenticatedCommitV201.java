package nl.kalenel.s9offline;

import java.io.IOException;

/**
 * SOURCE ONLY: future privileged, phone-local Save/Delete METADATA transaction.
 * No HTTP listener, JSON parser, Android component, Camera2 dependency or APK.
 *
 * A future authenticated service must obtain a genuinely trusted phone clock,
 * strict signed-request parser, privately qualified S9 source manifest and
 * independently authorized user-action callback. The browser may provide the
 * signed intent, but NOT the trusted clock, private manifest, action callback
 * or two durable signing-key handles.
 *
 * Existing V198 verifies the exact signed POST, source SHA and explicit user
 * authorization. V197 then verifies current journal/independent checkpoint,
 * fsyncs both before returning the receipt, and refuses crash-gap rollback.
 *
 * A metadata DELETE is a reversible tombstone: no MP4/JPEG removal is allowed.
 * Legacy browser Save/Delete still requires outage/fallback testing.
 */
public final class S9MigratedAuthenticatedCommitV201 implements AutoCloseable {
    public interface TrustedPhoneClock {
        /** Verified clock with safe relay/phone synchronization, not request time. */
        long verifiedEpochMillis() throws IOException;
    }

    public static final class VerifiedMetadataResult {
        public final S9MigratedMetadataLedgerV193.Receipt receipt;
        public final long trustedSequence;
        public final String trustedHeadSha256;
        public final boolean signedActionVerified = true;
        public final boolean sourceAndUserActionVerified = true;
        public final boolean independentDurableStoresVerified = true;

        private VerifiedMetadataResult(S9MigratedDualStoreCommitV197.Result value) {
            receipt=value.receipt;
            trustedSequence=value.trustedSequence;
            trustedHeadSha256=value.trustedHeadSha256;
        }
        public boolean mayRemoveOriginal(){return false;}
        public boolean actualVideoDeleted(){return false;}
        public boolean changesPersonReviews(){return false;}
        public boolean liveRemoteEndpointEnabled(){return false;}
    }

    private final S9MigratedSignedActionV198 signed;
    private final S9MigratedVerifiedSourceV198 qualifiedSource;
    private final S9MigratedDualStoreCommitV197 durable;
    private final TrustedPhoneClock trustedClock;
    private boolean closed;

    public S9MigratedAuthenticatedCommitV201(
            S9MigratedSignedActionV198 signedVerifier,
            S9MigratedVerifiedSourceV198 verifiedSource,
            S9MigratedDualStoreCommitV197 durableMetadata,
            TrustedPhoneClock timeSource) throws IOException {
        if(signedVerifier==null || verifiedSource==null
                || durableMetadata==null || timeSource==null)
            throw new IOException("authenticated_commit_dependencies_missing");
        signed=signedVerifier;
        qualifiedSource=verifiedSource;
        durable=durableMetadata;
        trustedClock=timeSource;
    }

    /**
     * Exact request sequence: valid HMAC + trusted clock -> expected durable
     * head under app-private lock -> source SHA + user approval -> both fsyncs.
     * Caller must not treat an exception as evidence the journal was unchanged:
     * a crash between the two fsyncs intentionally fails closed afterwards.
     */
    public synchronized VerifiedMetadataResult commitMetadataOnly(
            S9MigratedSignedActionV198.Request request) throws IOException {
        if(closed)throw new IOException("authenticated_commit_closed");
        long now=trustedClock.verifiedEpochMillis();
        if(now<=0)throw new IOException("trusted_phone_clock_unavailable");
        S9MigratedSignedActionV198.Verified intent=signed.verify(request,now);
        S9MigratedDualStoreCommitV197.Result persisted=
            durable.commitMetadataOnly(intent.action,intent.name,
                intent.sourceSha256,intent.sourceBytes,intent.nonce,
                intent.expectedSequence,intent.expectedHeadSha256,
                qualifiedSource);
        // Recheck latest per-clip state against independent store after commit.
        // Never surface success if a separate writer superseded this decision.
        S9MigratedMetadataLedgerV193.CurrentDecision latest=
            durable.currentDecision(intent.name);
        if(latest==null || !latest.action.equals(intent.action)
                || !latest.name.equals(intent.name)
                || !latest.sourceSha256.equals(intent.sourceSha256)
                || latest.sourceBytes!=intent.sourceBytes
                || latest.ledgerSequence!=persisted.receipt.ledgerSequence
                || !latest.ledgerHeadSha256.equals(
                    persisted.receipt.ledgerHeadSha256))
            throw new IOException("authenticated_commit_no_longer_current");
        return new VerifiedMetadataResult(persisted);
    }

    @Override public synchronized void close(){closed=true;}
}
