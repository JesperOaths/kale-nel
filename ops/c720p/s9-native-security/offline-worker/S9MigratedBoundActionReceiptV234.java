package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.regex.Pattern;

/**
 * SOURCE ONLY: bind a genuinely accepted V232 metadata-only action to a
 * separately approved six-original manifest and a fresh V225 dual-store
 * readback. Never expose this without independent authenticated caller
 * authorization, separate human approval and V201 phone source hashing.
 *
 * No network transport, Android installation, enrollment, auto-approval,
 * camera control, original deletion, key generation or timestamp extension.
 * The caller MUST supply the protected digest obtained at first enrollment,
 * never a value from the HTTP request or microSD media.
 */
public final class S9MigratedBoundActionReceiptV234 {
    private static final String SCHEMA="s9_c720p_migrated_bound_action_v234";
    private static final Pattern SHA=Pattern.compile("[a-f0-9]{64}");
    private static final Pattern NONCE=Pattern.compile("(?:[a-f0-9]{32}|[a-f0-9]{64})");
    private static final Pattern NAME=Pattern.compile(
        "[A-Za-z0-9][A-Za-z0-9._-]{0,139}\\.mp4");
    private static final int MAX_OUTPUT=1200;
    private S9MigratedBoundActionReceiptV234(){}

    private static void require(boolean condition,String error)throws IOException {
        if(!condition)throw new IOException(error);
    }
    private static boolean same(String a,String b){
        return a!=null&&b!=null&&MessageDigest.isEqual(
            a.getBytes(StandardCharsets.US_ASCII),
            b.getBytes(StandardCharsets.US_ASCII));
    }

    public static byte[] executeAfterIndependentAuthentication(
            byte[] signedActionWire,
            long independentlyTrustedPhoneClockMillis,
            String correlationChallenge,
            S9MigratedSealedSourceManifestV216.Verified existingSealedSources,
            String protectedFirstEnrollmentApprovedDigest,
            S9MigratedPostcommitV232 independentlyAuthorizedAction,
            S9MigratedDualStoreCommitV197 existingDualStore)
            throws IOException {
        require(signedActionWire!=null && existingSealedSources!=null &&
            independentlyAuthorizedAction!=null && existingDualStore!=null &&
            correlationChallenge!=null && NONCE.matcher(correlationChallenge).matches(),
            "bound_receipt_trusted_dependencies_missing");
        require(protectedFirstEnrollmentApprovedDigest!=null &&
            SHA.matcher(protectedFirstEnrollmentApprovedDigest).matches(),
            "bound_receipt_external_approved_source_digest_required");
        // Verify the six-record source preimage against an independent, durable,
        // out-of-band enrollment authority BEFORE performing any action.
        S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(
            existingSealedSources,protectedFirstEnrollmentApprovedDigest);
        S9MigratedSignedActionV198.Request request=
            S9MigratedActionWireV231.decode(signedActionWire);
        require(request.name!=null && NAME.matcher(request.name).matches() &&
                !request.name.contains("..") && request.sourceSha256!=null &&
                SHA.matcher(request.sourceSha256).matches() &&
                request.sourceBytes>=10000L,
                "bound_receipt_request_source_invalid");
        S9MigratedVerifiedSourceV198.Proof known=
            existingSealedSources.sourceRows.get(request.name);
        require(known!=null && known.copiedAndIndexed &&
                request.sourceBytes==known.bytes &&
                same(request.sourceSha256,known.sha256),
                "bound_receipt_source_differs_from_approved_manifest");

        // V232 passes V198 cryptographic/time verification, V201 separate
        // human+original source authorization, V197 journal + checkpoint fsync
        // and postcommit head validation. We intentionally do not reproduce
        // or bypass those gates here.
        S9MigratedPostcommitV232.Acknowledgement committed=
            independentlyAuthorizedAction.accept(
                signedActionWire,independentlyTrustedPhoneClockMillis);

        S9MigratedReadOnlyStateV225.Snapshot fresh=
            S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(
                existingSealedSources,existingDualStore);
        S9MigratedReadOnlyStateV225.Row row=fresh.rows.get(request.name);
        require(fresh.manifestGeneration==existingSealedSources.generation &&
                fresh.manifestGeneration==1L &&
                fresh.rows.size()==6 &&
                fresh.journalSequence==committed.sequence &&
                same(fresh.journalHeadSha256,committed.headSha256) &&
                row!=null && request.name.equals(row.name) &&
                row.decisionSequence==committed.sequence &&
                row.sourceBytes==request.sourceBytes &&
                same(row.sourceSha256,request.sourceSha256) &&
                committed.sequence>0L &&
                ("saved_metadata".equals(row.status) ||
                 "deleted_tombstone".equals(row.status)) &&
                committed.state.equals(row.status) &&
                (("save".equals(request.action) &&
                  "saved_metadata".equals(row.status)) ||
                 ("delete".equals(request.action) &&
                  "deleted_tombstone".equals(row.status))),
                "bound_receipt_new_head_or_source_not_current");

        // An acknowledgement asserts exactly durable metadata state, nothing
        // about physical video playback, viewer attention, human review
        // revision, permission to unlink local copies or even media recovery.
        String body="{\"schema\":\""+SCHEMA+"\""+
            ",\"challenge\":\""+correlationChallenge+"\""+
            ",\"sourceName\":\""+request.name+"\""+
            ",\"sourceSha256\":\""+request.sourceSha256+"\""+
            ",\"sourceBytes\":"+request.sourceBytes+
            ",\"manifestGeneration\":"+fresh.manifestGeneration+
            ",\"journalSequence\":"+fresh.journalSequence+
            ",\"journalHeadSha256\":\""+fresh.journalHeadSha256+"\""+
            ",\"state\":\""+row.status+"\""+
            ",\"metadataOnly\":true"+
            ",\"allowsOriginalRemoval\":false"+
            ",\"provesHumanViewedMedia\":false"+
            ",\"provesOriginalAvailable\":false}";
        byte[] output=body.getBytes(StandardCharsets.US_ASCII);
        require(output.length<=MAX_OUTPUT,"bound_receipt_response_too_large");
        return output;
    }
    public static boolean hasNetworkListener(){return false;}
    public static boolean provisionsFirstEnrollment(){return false;}
    public static boolean grantsMediaRetirement(){return false;}
    public static boolean provesHumanViewing(){return false;}
}
