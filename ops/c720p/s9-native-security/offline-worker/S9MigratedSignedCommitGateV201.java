package nl.kalenel.s9offline;

import java.io.IOException;

/**
 * SOURCE ONLY: a narrow, non-network bridge between a HMAC-authenticated
 * Save/Delete intent, independent user approval, independent proof of on-phone
 * source bytes, and the existing fsynced two-store metadata coordinator.
 *
 * Nothing here binds an HTTP port, installs an APK, provisions keys, changes
 * the camera, deletes media, or reads biometric/person-review information.
 *
 * The future privileged Android owner MUST supply these dependencies from a
 * separately authenticated, app-private service context. In particular the
 * verifier alone is not user identity; neither a matching MP4 hash nor an
 * apparently valid browser-issued token substitutes for independent approval.
 */
public final class S9MigratedSignedCommitGateV201 {
    /**
     * Must be implemented by the trusted app-side authorization boundary.
     * Do not implement by simply returning true or trusting browser claims.
     */
    public interface IndependentUserApproval {
        boolean permits(S9MigratedSignedActionV198.Verified signedIntent)
                throws IOException;
    }

    private final S9MigratedSignedActionV198 signedVerifier;
    private final S9MigratedDualStoreCommitV197 metadata;
    private final S9MigratedDualStoreCommitV197.AuthorizedSource sourceProof;
    private final IndependentUserApproval separateApproval;

    public S9MigratedSignedCommitGateV201(
            S9MigratedSignedActionV198 signedVerifier,
            S9MigratedDualStoreCommitV197 metadata,
            S9MigratedDualStoreCommitV197.AuthorizedSource trustedOnPhoneSource,
            IndependentUserApproval separatelyAuthenticatedUser)
            throws IOException {
        if (signedVerifier == null || metadata == null ||
                trustedOnPhoneSource == null || separatelyAuthenticatedUser == null)
            throw new IOException("authenticated_signed_commit_dependencies_required");
        this.signedVerifier=signedVerifier;
        this.metadata=metadata;
        this.sourceProof=trustedOnPhoneSource;
        this.separateApproval=separatelyAuthenticatedUser;
    }

    /**
     * trustedPhoneMillis must come from checked phone wall-clock health, NOT
     * signed request JSON or a browser-supplied timestamp. The signed field
     * tuple is always the exact same tuple sent into the metadata commit.
     * A failed signature/expiry, user authorization, on-phone source SHA,
     * current checkpoint, journal fsync or checkpoint fsync refuses success.
     * A metadata "delete" is only a durable tombstone, not an MP4 deletion.
     */
    public synchronized S9MigratedDualStoreCommitV197.Result commit(
            S9MigratedSignedActionV198.Request raw,
            long trustedPhoneMillis) throws IOException {
        S9MigratedSignedActionV198.Verified approved =
                signedVerifier.verify(raw,trustedPhoneMillis);
        if (!separateApproval.permits(approved))
            throw new IOException("signed_intent_lacks_independent_user_approval");
        return metadata.commitMetadataOnly(approved.action,approved.name,
                approved.sourceSha256,approved.sourceBytes,approved.nonce,
                approved.expectedSequence,approved.expectedHeadSha256,
                sourceProof);
    }

    public boolean hasLiveTransport(){return false;}
    public boolean authorizesMediaDeletion(){return false;}
    public boolean authorizesPersonReviewChange(){return false;}
    public boolean mayRemoveOriginal(){return false;}
}
