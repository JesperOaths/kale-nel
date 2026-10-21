package nl.kalenel.s9offline;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Binder;
import android.os.Process;
import java.io.File;
import java.io.IOException;
import java.security.Key;
import java.security.KeyStore;
import java.util.regex.Pattern;
import javax.crypto.SecretKey;

/**
 * SOURCE ONLY. Compose existing V227/V229 owner-enrollment checks, V231/V198
 * signed metadata action, V201 separate verified human consent and real phone
 * original SHA verification, V197 two-store commit, V232 and V234 source-bound
 * latest-head acknowledgement behind the dedicated Android app UID.
 *
 * No Android component, listener, transport, owner-login, clock trust provider,
 * key importer, enrollment, camera change, physical MP4 deletion or install.
 * A trusted implementation MUST provide these authorities from app-private
 * code; no browser, relay payload or microSD JSON may provide them.
 */
public final class S9MigratedAndroidOwnerWriteGatewayV236 {
    private static final String PACKAGE="nl.kalenel.s9migrated";
    /**
     * Separately provisioned transport authentication credential; NEVER
     * repurpose any of V227's three journal/source/anchor HMAC keys.
     * The public alias name is fixed; the secret is never generated here.
     * Provisioning this key with C720P relay parity requires an authorized,
     * audited external release procedure, not this read-only opener.
     */
    private static final String ACTION_ALIAS=
        "nl.kalenel.s9migrated.relay_action_verifier.hmac.v236";
    private static final Pattern CHALLENGE=
        Pattern.compile("(?:[a-f0-9]{32}|[a-f0-9]{64})");
    private static final Pattern SHA=Pattern.compile("[a-f0-9]{64}");

    /**
     * Protected outside the microSD, network and browser; in particular an
     * HTTP field is NOT an antirollback generation or first-use approval.
     */
    public interface IndependentlyAnchoredEnrollment {
        String approvedSixOriginalPreimageSha256() throws IOException;
        long minimumSourceGeneration() throws IOException;
    }
    /**
     * Authentic device-local owner authentication, then exact signed-action
     * consent. A browser HMAC by itself MUST NOT satisfy either method.
     * Never implement either method as an unconditional true in production.
     */
    public interface AuthenticatedInAppOwner {
        boolean authenticatesOwnerSession(
            String companionPackage,int processUid,String challenge)
            throws IOException;
        boolean explicitlyPermitsSignedMetadataAction(
            S9MigratedSignedActionV198.Verified verified) throws IOException;
    }
    /**
     * Physically re-hash or otherwise independently attest the CURRENT phone
     * original by name+SHA+bytes under a trusted recorder-safe source path.
     * Never trust an index, transfer ticket or externally supplied digest alone.
     */
    public interface LiveOriginalVerifier {
        boolean checksCurrentPhoneOriginal(
            String action,String name,String originalSha256,long originalBytes)
            throws IOException;
    }
    /**
     * A separately verified phone clock/NTP or authorized UTC witness with
     * valid freshness/confidence. Caller-supplied issued/expires fields or
     * browser-provided current_time MUST NOT implement this provider.
     */
    public interface IndependentlyTrustedPhoneClock {
        long currentTrustedMillis() throws IOException;
    }

    private S9MigratedAndroidOwnerWriteGatewayV236(){}
    private static void require(boolean condition,String reason)throws IOException {
        if(!condition)throw new IOException(reason);
    }

    private static Context requireSameAppUid(Context supplied)throws IOException {
        require(supplied!=null && supplied.getApplicationContext()!=null,
                "write_gateway_trusted_context_required");
        Context app=supplied.getApplicationContext();
        ApplicationInfo info=app.getApplicationInfo();
        require(PACKAGE.equals(app.getPackageName()) && info!=null &&
                info.uid==Process.myUid() && info.uid>Process.SHELL_UID &&
                Binder.getCallingUid()==info.uid,
                "write_gateway_foreign_or_shell_uid_denied");
        return app;
    }

    /**
     * Opens ONLY an existing non-exportable Keystore key under a separate,
     * immutable action alias. No generation, fallback, imported Java byte[]
     * key, rotation or automatic repair. Release must prove independent
     * relay-side signer correspondence before any live action can be accepted.
     */
    private static SecretKey openExistingActionVerifierOnly()throws IOException {
        try {
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if(!store.containsAlias(ACTION_ALIAS))
                throw new IOException("write_gateway_relay_credential_missing");
            Key key=store.getKey(ACTION_ALIAS,null);
            if(!(key instanceof SecretKey))
                throw new IOException("write_gateway_action_key_type_invalid");
            SecretKey secret=(SecretKey)key;
            if(!"HmacSHA256".equalsIgnoreCase(secret.getAlgorithm()) ||
               secret.getEncoded()!=null)
                throw new IOException("write_gateway_action_key_not_nonexportable");
            return secret;
        }catch(IOException e){throw e;}
        catch(Exception e){
            throw new IOException("write_gateway_action_keystore_read_failed");
        }
    }

    /**
     * Never accepts a remote-supplied anchor, time witness, media-source
     * proof or owner session. All four authority implementations must be
     * constructed inside the dedicated companion process by independent
     * audited code, not a dynamically loaded request handler.
     */
    public static byte[] commitExistingOnly(
            Context callingContext,
            File preprovisionedAppScopedMicroSdLedger,
            byte[] untrustedSignedActionWire,
            String responseCorrelationChallenge,
            IndependentlyAnchoredEnrollment protectedEnrollment,
            AuthenticatedInAppOwner deviceLocalOwner,
            LiveOriginalVerifier actualOnPhoneSource,
            IndependentlyTrustedPhoneClock trustedClock) throws IOException {
        Context app=requireSameAppUid(callingContext);
        require(preprovisionedAppScopedMicroSdLedger!=null &&
                untrustedSignedActionWire!=null &&
                untrustedSignedActionWire.length>0 &&
                untrustedSignedActionWire.length<=3072 &&
                responseCorrelationChallenge!=null &&
                CHALLENGE.matcher(responseCorrelationChallenge).matches() &&
                protectedEnrollment!=null && deviceLocalOwner!=null &&
                actualOnPhoneSource!=null && trustedClock!=null,
                "write_gateway_independent_dependencies_missing");
        int uid=Process.myUid();
        // Do not read journal, key material, source rows or owner action details
        // until an actual in-app authenticated human session exists.
        require(deviceLocalOwner.authenticatesOwnerSession(
                PACKAGE,uid,responseCorrelationChallenge),
                "write_gateway_independent_owner_session_denied");

        String approved=protectedEnrollment.approvedSixOriginalPreimageSha256();
        long minimum=protectedEnrollment.minimumSourceGeneration();
        require(approved!=null && SHA.matcher(approved).matches() && minimum==1L,
                "write_gateway_enrollment_anchor_untrusted");

        // V229 is an independent app-scope and startup consistency guard.
        // No lazy first-use enrollment is permitted.
        S9MigratedCompanionBootReadinessV229.Assessment boot=
            S9MigratedCompanionBootReadinessV229.inspectExistingOnly(
                app,preprovisionedAppScopedMicroSdLedger,minimum,approved);
        require(boot.approvedSourceCount==6 &&
                boot.trustedSourceGeneration==1L &&
                boot.trustedLedgerSequence>=0 &&
                boot.trustedLedgerHeadSha256!=null &&
                SHA.matcher(boot.trustedLedgerHeadSha256).matches(),
                "write_gateway_existing_state_not_ready");

        S9MigratedManifestKeyCustodyV227.Existing keys=
            S9MigratedManifestKeyCustodyV227.openExisting(app);
        S9MigratedSealedSourceManifestV216.Verified sources=
            keys.verifyAlreadyEnrolled(minimum);
        S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(
            sources,approved);

        // Time witness is checked immediately before signature verification;
        // expired actions, invalid HMAC and stale journal heads remain V198/
        // V197 hard failures. Never extend the signed time window.
        long phoneNow=trustedClock.currentTrustedMillis();
        require(phoneNow>0L,"write_gateway_phone_clock_untrusted");
        SecretKey actionKey=openExistingActionVerifierOnly();
        try(S9MigratedSignedActionV198 verifier=
                new S9MigratedSignedActionV198(actionKey);
            S9MigratedDualStoreCommitV197 journal=
                new S9MigratedDualStoreCommitV197(
                    keys.privateFilesDir,preprovisionedAppScopedMicroSdLedger,
                    keys.internalCheckpoint,keys.microSdJournal)) {
            S9MigratedDualStoreCommitV197.TrustedSnapshot before=
                journal.currentDecisions(
                    new java.util.ArrayList<String>(sources.sourceRows.keySet()));
            require(before.trustedSequence==boot.trustedLedgerSequence &&
                    before.trustedHeadSha256.equals(boot.trustedLedgerHeadSha256),
                    "write_gateway_boot_head_changed");
            S9MigratedSignedCommitGateV201 gate=
                new S9MigratedSignedCommitGateV201(
                    verifier,journal,
                    (action,name,sha,bytes)->
                        actualOnPhoneSource.checksCurrentPhoneOriginal(
                            action,name,sha,bytes),
                    verified->
                        deviceLocalOwner.explicitlyPermitsSignedMetadataAction(
                            verified));
            S9MigratedPostcommitV232 postcommit=
                new S9MigratedPostcommitV232(gate,journal);
            return S9MigratedBoundActionReceiptV234
                .executeAfterIndependentAuthentication(
                    untrustedSignedActionWire,phoneNow,
                    responseCorrelationChallenge,sources,
                    approved,postcommit,journal);
        }
    }
    public static boolean hasExportedTransport(){return false;}
    public static boolean installsOrGeneratesCredentials(){return false;}
    public static boolean deletesAnyOriginalMedia(){return false;}
    public static boolean treatsSignatureAsHumanConsent(){return false;}
    public static boolean provesHumanPlayback(){return false;}
}
