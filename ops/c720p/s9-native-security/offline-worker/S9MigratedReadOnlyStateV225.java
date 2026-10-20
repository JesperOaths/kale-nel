package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SOURCE ONLY: authenticated-owner-internal state projection.
 * It is not an HTTP endpoint and does NOT accept a client-provided manifest.
 * Call only after a V216 HMAC-sealed, independently anchored manifest was
 * verified by the app UID and access to state was separately authenticated.
 *
 * A journal row must match the immutable source name/SHA/length exactly.
 * A "delete" is a metadata tombstone, NEVER a physical MP4 removal.
 * A missing row is "no_remote_decision", not "not saved locally".
 */
public final class S9MigratedReadOnlyStateV225 {
    public static final class Row {
        public final String name,status;
        public final long sourceBytes,decisionSequence;
        public final String sourceSha256;
        private Row(String name,String status,long size,String sha,long sequence) {
            this.name=name;this.status=status;sourceBytes=size;
            sourceSha256=sha;decisionSequence=sequence;
        }
        public boolean permitsMediaRemoval(){return false;}
        public boolean authorizesNewAction(){return false;}
    }
    public static final class Snapshot {
        public final long manifestGeneration,journalSequence;
        public final String journalHeadSha256;
        public final Map<String,Row> rows;
        private Snapshot(long generation,
                S9MigratedDualStoreCommitV197.TrustedSnapshot journal,
                Map<String,Row> rows) {
            manifestGeneration=generation;
            journalSequence=journal.trustedSequence;
            journalHeadSha256=journal.trustedHeadSha256;
            this.rows=Collections.unmodifiableMap(new LinkedHashMap<String,Row>(rows));
        }
        public boolean grantsRemoteMutation(){return false;}
        public boolean permitsOriginalRetirement(){return false;}
        public boolean provesMediaAvailability(){return false;}
    }
    private S9MigratedReadOnlyStateV225(){}
    private static boolean shaEqual(String x,String y) {
        return MessageDigest.isEqual(x.getBytes(StandardCharsets.US_ASCII),
                                     y.getBytes(StandardCharsets.US_ASCII));
    }

    public static Snapshot readForAuthenticatedOwner(
            S9MigratedSealedSourceManifestV216.Verified approved,
            S9MigratedDualStoreCommitV197 coordinator) throws IOException {
        if(approved==null || coordinator==null || approved.generation<1 ||
                approved.sourceRows.isEmpty() || approved.sourceRows.size()>5000)
            throw new IOException("remote_state_requires_private_manifest_and_coordinator");
        List<String> names=new ArrayList<String>(approved.sourceRows.keySet());
        S9MigratedDualStoreCommitV197.TrustedSnapshot state=
                coordinator.currentDecisions(names);
        if(state.decisions.size()!=names.size())
            throw new IOException("remote_state_missing_provenance");
        Map<String,Row> rows=new LinkedHashMap<String,Row>();
        for(String name:names) {
            S9MigratedVerifiedSourceV198.Proof approvedSource=approved.sourceRows.get(name);
            if(approvedSource==null || !approvedSource.copiedAndIndexed ||
                    !name.equals(approvedSource.name))
                throw new IOException("remote_state_source_not_approved");
            S9MigratedMetadataLedgerV193.CurrentDecision decision=state.decisions.get(name);
            String status="no_remote_decision";
            long sequence=0L;
            if(decision!=null) {
                if(!name.equals(decision.name) ||
                        !shaEqual(approvedSource.sha256,decision.sourceSha256) ||
                        approvedSource.bytes!=decision.sourceBytes ||
                        decision.ledgerSequence>state.trustedSequence ||
                        !decision.ledgerIntegrityVerified)
                    throw new IOException("remote_state_recording_provenance_diverged");
                if(decision.isSaved()) status="saved_metadata";
                else if(decision.isDeletedTombstone())status="deleted_tombstone";
                else throw new IOException("remote_state_action_unrecognized");
                sequence=decision.ledgerSequence;
            }
            rows.put(name,new Row(name,status,approvedSource.bytes,
                                 approvedSource.sha256,sequence));
        }
        return new Snapshot(approved.generation,state,rows);
    }
}
