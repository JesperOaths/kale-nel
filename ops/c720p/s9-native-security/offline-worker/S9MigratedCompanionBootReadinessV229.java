package nl.kalenel.s9offline;

import android.content.Context;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Map;

/**
 * SOURCE-ONLY, read-only startup admission for a future isolated S9+ app.
 *
 * No Android component, APK, HTTP listener, boot receiver or background
 * process is registered. This routine cannot enroll keys, mutate a journal,
 * approve a person, operate Camera2, or delete media. A green assessment
 * ONLY means protected metadata was internally self-consistent at this
 * read; it is NOT authentication, permission to Save/Delete, actual MP4
 * byte validation, offline readiness or authority to retire C720P copies.
 */
public final class S9MigratedCompanionBootReadinessV229 {
    public static final String LEDGER_DIR_NAME="c720p-migrated-metadata";

    public static final class Assessment {
        public final long trustedSourceGeneration, trustedLedgerSequence;
        public final String trustedLedgerHeadSha256;
        public final int approvedSourceCount, savedMetadataCount,
                         deletedTombstoneCount, withoutRemoteDecisionCount;
        private Assessment(S9MigratedSealedSourceManifestV216.Verified sources,
                  S9MigratedReadOnlyStateV225.Snapshot state,
                  int saved,int deleted,int unknown){
            trustedSourceGeneration=sources.generation;
            trustedLedgerSequence=state.journalSequence;
            trustedLedgerHeadSha256=state.journalHeadSha256;
            approvedSourceCount=sources.sourceRows.size();
            savedMetadataCount=saved;deletedTombstoneCount=deleted;
            withoutRemoteDecisionCount=unknown;
        }
        public boolean remoteServiceInstalled(){return false;}
        public boolean acceptsSignedActions(){return false;}
        public boolean authorizesLocalClipRetirement(){return false;}
        public boolean confirmsOriginalMediaBytes(){return false;}
        public boolean changesPersonReviews(){return false;}
    }
    private S9MigratedCompanionBootReadinessV229(){}

    private static void requireAppScopedLedger(Context app,File metadataDir)
            throws IOException{
        if(app==null || metadataDir==null ||
             Files.isSymbolicLink(metadataDir.toPath()) ||
             !Files.isDirectory(metadataDir.toPath(),LinkOption.NOFOLLOW_LINKS))
            throw new IOException("companion_ledger_directory_missing_or_untrusted");
        Path target=metadataDir.toPath().toRealPath(LinkOption.NOFOLLOW_LINKS);
        if(!LEDGER_DIR_NAME.equals(target.getFileName().toString()))
            throw new IOException("companion_ledger_directory_must_be_app_scoped");
        File[] appExternal=app.getExternalFilesDirs(null);
        boolean owned=false;
        if(appExternal!=null)for(File candidate:appExternal){
            if(candidate==null || Files.isSymbolicLink(candidate.toPath()) ||
                    !Files.isDirectory(candidate.toPath(),LinkOption.NOFOLLOW_LINKS))
                continue;
            Path root=candidate.toPath().toRealPath(LinkOption.NOFOLLOW_LINKS);
            if(root.equals(target.getParent())){
                owned=true;break;
            }
        }
        if(!owned)throw new IOException("companion_external_metadata_not_app_owned");
        // All ledger and lock files must already exist under this scoped dir.
        // V197/V193/V196 reject missing, symlinked or diverged state.
    }

    /**
     * trustedMinimumGeneration must come from independent, app-private
     * anti-rollback storage, NEVER a remote request or browser-supplied
     * header. This class does NOT supply or create that anchor.
     */
    public static Assessment inspectExistingOnly(Context context,
               File preprovisionedCompanionMicroSdLedger,
               long trustedMinimumGeneration)throws IOException {
        if(context==null || context.getApplicationContext()==null ||
             trustedMinimumGeneration<1)
            throw new IOException("companion_start_requires_trusted_generation");
        Context app=context.getApplicationContext();
        requireAppScopedLedger(app,preprovisionedCompanionMicroSdLedger);
        S9MigratedManifestKeyCustodyV227.Existing keys=
            S9MigratedManifestKeyCustodyV227.openExisting(app);
        S9MigratedSealedSourceManifestV216.Verified sources=
            keys.verifyAlreadyEnrolled(trustedMinimumGeneration);
        if(sources.sourceRows.size()!=6)
            throw new IOException("companion_six_source_manifest_required");
        long total=0;
        for(S9MigratedVerifiedSourceV198.Proof proof:sources.sourceRows.values()){
            if(proof==null || !proof.copiedAndIndexed ||
                    proof.bytes<10000 ||
                    Long.MAX_VALUE-total<proof.bytes)
                throw new IOException("companion_source_provenance_untrusted");
            total+=proof.bytes;
        }
        if(total!=214181934L)
            throw new IOException("companion_historical_source_total_invalid");

        try(S9MigratedDualStoreCommitV197 coordinator=
              new S9MigratedDualStoreCommitV197(
                keys.privateFilesDir,preprovisionedCompanionMicroSdLedger,
                keys.internalCheckpoint,keys.microSdJournal)){
            // V225 obtains all six decisions against ONE verified journal
            // head and checks each against the sealed source metadata.
            S9MigratedReadOnlyStateV225.Snapshot snapshot=
                S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(
                    sources,coordinator);
            if(snapshot.rows.size()!=6 ||
                  snapshot.manifestGeneration!=sources.generation ||
                  snapshot.journalSequence<0)
                throw new IOException("companion_trusted_state_shape_invalid");
            int saved=0,deleted=0,unknown=0;
            for(Map.Entry<String,S9MigratedReadOnlyStateV225.Row> e:
                    snapshot.rows.entrySet()){
                S9MigratedReadOnlyStateV225.Row row=e.getValue();
                if(row==null || !e.getKey().equals(row.name))
                    throw new IOException("companion_state_row_untrusted");
                if("saved_metadata".equals(row.status))saved++;
                else if("deleted_tombstone".equals(row.status))deleted++;
                else if("no_remote_decision".equals(row.status))unknown++;
                else throw new IOException("companion_state_unknown_status");
            }
            if(saved+deleted+unknown!=6)
                throw new IOException("companion_state_count_mismatch");
            return new Assessment(sources,snapshot,saved,deleted,unknown);
        }
    }

    public static boolean installsCompanionApp(){return false;}
    public static boolean provisionsProductionHmacKeys(){return false;}
    public static boolean operatesCamera2(){return false;}
    public static boolean removesOriginalVideos(){return false;}
}
