package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;

/**
 * Source-only backend composition, NOT an Android service or authorization.
 * Caller must independently establish app identity, approved first enrollment,
 * a trusted phone clock, human consent and distinct non-exportable keys.
 * V231 parses, V198 verifies signed intent, V201 checks independent approval
 * and on-phone source, V197 commits both stores; this rechecks the actual
 * durable result, not a browser-provided claim of success.
 */
public final class S9MigratedPostcommitV232 {
    private final S9MigratedSignedCommitGateV201 approvalGate;
    private final S9MigratedDualStoreCommitV197 journal;

    public static final class Acknowledgement {
        public final long sequence;
        public final String headSha256;
        public final String state;
        private Acknowledgement(S9MigratedDualStoreCommitV197.Result r,String s){
            sequence=r.trustedSequence;headSha256=r.trustedHeadSha256;state=s;
        }
        public boolean authorizesMediaRetirement(){return false;}
        public boolean modifiesOriginalVideo(){return false;}
        public boolean changesManualDecisions(){return false;}
    }
    public S9MigratedPostcommitV232(
            S9MigratedSignedCommitGateV201 independentlyAuthorizedAction,
            S9MigratedDualStoreCommitV197 appPrivateTwoStoreJournal)
            throws IOException {
        if(independentlyAuthorizedAction==null || appPrivateTwoStoreJournal==null)
            throw new IOException("trusted_action_and_journal_required");
        approvalGate=independentlyAuthorizedAction;
        journal=appPrivateTwoStoreJournal;
    }
    public synchronized Acknowledgement accept(byte[] actionWire,
            long trustedPhoneMillis) throws IOException {
        S9MigratedSignedActionV198.Request request=
            S9MigratedActionWireV231.decode(actionWire);
        S9MigratedDualStoreCommitV197.Result receipt=
            approvalGate.commit(request,trustedPhoneMillis);
        S9MigratedDualStoreCommitV197.TrustedSnapshot snapshot=
            journal.currentDecisions(Collections.singletonList(request.name));
        if(!receipt.bothStoresVerified ||
           receipt.receipt.ledgerSequence!=receipt.trustedSequence ||
           !sameHash(receipt.receipt.ledgerHeadSha256,receipt.trustedHeadSha256) ||
           snapshot.trustedSequence!=receipt.trustedSequence ||
           !sameHash(snapshot.trustedHeadSha256,receipt.trustedHeadSha256))
            throw new IOException("postcommit_checkpoint_mismatch");
        S9MigratedMetadataLedgerV193.CurrentDecision decision=
            snapshot.decisions.get(request.name);
        if(decision==null)
            throw new IOException("postcommit_recording_not_current");
        String status;
        if("save".equals(request.action) && decision.isSaved())
            status="saved_metadata";
        else if("delete".equals(request.action) && decision.isDeletedTombstone())
            status="deleted_tombstone";
        else throw new IOException("postcommit_action_state_mismatch");
        return new Acknowledgement(receipt,status);
    }
    private static boolean sameHash(String a,String b){
        if(a==null || b==null)return false;
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.US_ASCII),
                                     b.getBytes(StandardCharsets.US_ASCII));
    }
    public boolean hasListener(){return false;}
    public boolean provisionsEnrollment(){return false;}
    public boolean grantsSourceRetirement(){return false;}
}
