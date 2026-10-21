package nl.kalenel.s9offline;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Binder;
import android.os.Process;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Source-only Android 10, dedicated-app-UID composition of already-enrolled
 * and already-authenticated read-only migrated media metadata.
 *
 * This is NOT an Activity, Provider, Binder Service, web route, localhost
 * HTTP listener, owner-login implementation or device provisioning code.
 * NO new key generation, manifest enrollment, original-byte reading,
 * media mutation, Camera2 interaction or permission grant.
 *
 * A future in-app authenticated owner UI must construct the two independent
 * authority implementations; neither can be supplied by a browser/relay.
 * The app-private anchor must have been independently bound to the exact
 * six MP4 digests by the separately authorized initial enrollment.
 */
public final class S9MigratedAndroidOwnerReadGatewayV235 {
    private static final String PACKAGE="nl.kalenel.s9migrated";
    private static final Pattern HEX=Pattern.compile("[a-f0-9]{64}");
    private static final Pattern CHALLENGE=Pattern.compile("(?:[a-f0-9]{32}|[a-f0-9]{64})");

    /**
     * Must be a separately protected anti-rollback/owner-enrollment authority.
     * Its implementation and its protected root-of-trust MUST NOT be supplied
     * by this gateway's input, caller, untrusted microSD or web session.
     * Never construct a dummy always-true implementation in production.
     */
    public interface IndependentlyAnchoredEnrollment {
        String approvedSixOriginalPreimageSha256() throws IOException;
        long minimumSourceGeneration() throws IOException;
    }

    /**
     * Owner authentication must be established by a real device-local user
     * identity/session mechanism, separate from the browser/relay HMAC action.
     * Possession of the challenge by itself proves NOTHING; challenge is only
     * a caller-correlated response value. This callback MUST fail closed.
     */
    public interface AuthenticatedInAppOwner {
        boolean authorizesExistingStateRead(
            String companionPackage,int appUid,String exactChallenge)
            throws IOException;
    }

    private S9MigratedAndroidOwnerReadGatewayV235(){}

    private static void require(boolean ok,String reason)throws IOException{
        if(!ok)throw new IOException(reason);
    }
    private static boolean same(String a,String b){
        return a!=null && b!=null &&
             MessageDigest.isEqual(a.getBytes(StandardCharsets.US_ASCII),
                                  b.getBytes(StandardCharsets.US_ASCII));
    }
    private static Context requireTrustedAppUid(Context caller)throws IOException {
        require(caller!=null && caller.getApplicationContext()!=null,
                "read_gateway_app_context_required");
        Context app=caller.getApplicationContext();
        ApplicationInfo info=app.getApplicationInfo();
        require(PACKAGE.equals(app.getPackageName()) && info!=null &&
                info.uid==Process.myUid() && info.uid>Process.SHELL_UID &&
                Binder.getCallingUid()==info.uid,
                "read_gateway_external_uid_or_companion_identity_refused");
        // The local app UID alone is not sufficient to authorize a human.
        // An independent owner auth callback is additionally mandatory.
        return app;
    }

    /**
     * READ ONLY. Every invocation re-opens existing AndroidKeyStore aliases,
     * checks non-exportable triple-key enrollment V227, verifies the sealed
     * source against the independently approved V230 digest, reads the V197
     * microSD journal plus app-internal anchor and builds V229's bounded
     * read-only six-row envelope.
     *
     * Missing approvals, stale heads, concurrent writer changes, unrelated
     * UID, absent journal/keys/manifest and invalid caller challenge are hard
     * failures, NOT empty/unsaved responses.
     */
    public static byte[] readExistingOnly(
            Context caller,
            File existingScopedMicroSdMetadataDirectory,
            String exactChallenge,
            IndependentlyAnchoredEnrollment trustedEnrollment,
            AuthenticatedInAppOwner ownerSession) throws IOException {
        Context app=requireTrustedAppUid(caller);
        require(existingScopedMicroSdMetadataDirectory!=null &&
                trustedEnrollment!=null && ownerSession!=null &&
                exactChallenge!=null && CHALLENGE.matcher(exactChallenge).matches(),
                "read_gateway_independent_prerequisites_missing");
        // The callback MUST authenticate a user separately from same-app UID.
        require(ownerSession.authorizesExistingStateRead(
                PACKAGE,Process.myUid(),exactChallenge),
                "read_gateway_independent_owner_auth_denied");
        String approvedDigest=trustedEnrollment.approvedSixOriginalPreimageSha256();
        long minimumGeneration=trustedEnrollment.minimumSourceGeneration();
        require(approvedDigest!=null && HEX.matcher(approvedDigest).matches() &&
                minimumGeneration==1L,
                "read_gateway_approved_generation_missing_or_invalid");

        S9MigratedCompanionBootReadinessV229.Assessment boot=
            S9MigratedCompanionBootReadinessV229.inspectExistingOnly(
                app,existingScopedMicroSdMetadataDirectory,
                minimumGeneration,approvedDigest);
        require(boot.approvedSourceCount==6 &&
                boot.trustedSourceGeneration==minimumGeneration &&
                boot.trustedLedgerSequence>=0L &&
                boot.trustedLedgerHeadSha256!=null &&
                HEX.matcher(boot.trustedLedgerHeadSha256).matches(),
                "read_gateway_existing_boot_not_approved");

        // Both V227 methods ONLY open existing aliases. They do not enroll.
        S9MigratedManifestKeyCustodyV227.Existing keys=
            S9MigratedManifestKeyCustodyV227.openExisting(app);
        S9MigratedSealedSourceManifestV216.Verified sources=
            keys.verifyAlreadyEnrolled(minimumGeneration);
        S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(
            sources,approvedDigest);
        require(sources.generation==1L && sources.sourceRows.size()==6,
                "read_gateway_six_originals_generation_required");

        try(S9MigratedDualStoreCommitV197 journal=
            new S9MigratedDualStoreCommitV197(
               keys.privateFilesDir,existingScopedMicroSdMetadataDirectory,
               keys.internalCheckpoint,keys.microSdJournal)){
            S9MigratedReadOnlyStateV225.Snapshot snapshot=
                S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(
                    sources,journal);
            require(snapshot.rows.size()==6 &&
                    snapshot.manifestGeneration==boot.trustedSourceGeneration &&
                    snapshot.journalSequence==boot.trustedLedgerSequence &&
                    same(snapshot.journalHeadSha256,boot.trustedLedgerHeadSha256),
                    "read_gateway_readback_diverged_from_boot");
            int saved=0,deleted=0,unknown=0;
            for(Map.Entry<String,S9MigratedReadOnlyStateV225.Row> entry:
                    snapshot.rows.entrySet()){
                S9MigratedReadOnlyStateV225.Row row=entry.getValue();
                require(row!=null && entry.getKey().equals(row.name),
                        "read_gateway_row_name_invalid");
                if("saved_metadata".equals(row.status))saved++;
                else if("deleted_tombstone".equals(row.status))deleted++;
                else if("no_remote_decision".equals(row.status))unknown++;
                else throw new IOException("read_gateway_unknown_remote_state");
            }
            require(saved==boot.savedMetadataCount &&
                    deleted==boot.deletedTombstoneCount &&
                    unknown==boot.withoutRemoteDecisionCount &&
                    saved+deleted+unknown==6,
                    "read_gateway_counts_changed_during_read");
            return S9MigratedReadOnlyStateEnvelopeV229.encodeVerified(
                snapshot,exactChallenge);
        }
    }

    public static boolean hasExportedComponent(){return false;}
    public static boolean hasHttpTransport(){return false;}
    public static boolean provisionsKeysOrEnrollment(){return false;}
    public static boolean authorizesSignedMutations(){return false;}
    public static boolean provesMediaAvailableOrViewed(){return false;}
    public static boolean permitsLocalOriginalRetirement(){return false;}
}
