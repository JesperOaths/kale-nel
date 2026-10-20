package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * SOURCE ONLY: canonical, bounded read-only representation of an already
 * app-authenticated V225, independent-journal-head-verified snapshot.
 *
 * This class is NOT an HTTP endpoint, authenticates nobody, holds no secret,
 * mints no Save/Delete intent, and must never authorize local media removal.
 * A future authenticated S9 companion service must require a fresh user/session
 * before calling it; an untrusted browser cannot instantiate the V225 result.
 *
 * A client-provided hexadecimal challenge is ONLY response correlation, not
 * authentication or an anti-rollback anchor. The independent journal head is
 * the only state version. A stale response must not overwrite newer UI state.
 *
 * Missing phone action is "no_remote_decision" and MUST NOT be translated
 * into a local "unsaved" state by Home Assistant. Physical video availability
 * and successful Save/Delete are NEVER asserted by this representation.
 */
public final class S9MigratedReadOnlyStateEnvelopeV229 {
    private static final String SCHEMA="s9_c720p_migrated_readonly_state_v229";
    private static final Pattern CHALLENGE=Pattern.compile("(?:[a-f0-9]{32}|[a-f0-9]{64})");
    private static final Pattern SHA=Pattern.compile("[a-f0-9]{64}");
    private static final Pattern MP4=Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,139}\\.mp4");
    private static final int MAX_ROWS=5000;
    private static final int MAX_OUTPUT_BYTES=1024*1024;
    private S9MigratedReadOnlyStateEnvelopeV229(){}

    private static void require(boolean ok,String code)throws IOException{
        if(!ok)throw new IOException(code);
    }

    public static byte[] encodeVerified(
            S9MigratedReadOnlyStateV225.Snapshot verified,String clientChallenge)
            throws IOException {
        require(verified!=null && clientChallenge!=null &&
                CHALLENGE.matcher(clientChallenge).matches(),
                "read_only_state_challenge_invalid");
        require(verified.manifestGeneration>=1L && verified.journalSequence>=0L &&
                verified.journalHeadSha256!=null &&
                SHA.matcher(verified.journalHeadSha256).matches() &&
                verified.rows!=null && !verified.rows.isEmpty() &&
                verified.rows.size()<=MAX_ROWS,
                "read_only_state_not_verified");

        List<String> names=new ArrayList<String>(verified.rows.keySet());
        Collections.sort(names);
        StringBuilder json=new StringBuilder(512+names.size()*128);
        json.append("{\"schema\":\"").append(SCHEMA)
            .append("\",\"challenge\":\"").append(clientChallenge)
            .append("\",\"manifestGeneration\":").append(verified.manifestGeneration)
            .append(",\"journalSequence\":").append(verified.journalSequence)
            .append(",\"journalHeadSha256\":\"").append(verified.journalHeadSha256)
            .append("\",\"readOnly\":true,\"remoteMetadataOnly\":true")
            .append(",\"allowsSaveDelete\":false")
            .append(",\"allowsOriginalRemoval\":false")
            .append(",\"provesVideoAvailability\":false,\"rows\":[");
        for(int i=0;i<names.size();i++){
            String name=names.get(i);
            S9MigratedReadOnlyStateV225.Row row=verified.rows.get(name);
            require(name!=null && MP4.matcher(name).matches() &&
                    !name.contains("..") && row!=null && name.equals(row.name) &&
                    row.sourceBytes>0L &&
                    row.sourceSha256!=null && SHA.matcher(row.sourceSha256).matches() &&
                    row.decisionSequence>=0L &&
                    row.decisionSequence<=verified.journalSequence,
                    "read_only_state_row_untrusted");
            String status=row.status;
            require("saved_metadata".equals(status) ||
                    "deleted_tombstone".equals(status) ||
                    "no_remote_decision".equals(status),
                    "read_only_state_action_untrusted");
            require(("no_remote_decision".equals(status))==
                    (row.decisionSequence==0L),
                    "read_only_state_missing_decision_mismatch");
            if(i>0)json.append(',');
            json.append("{\"name\":\"").append(name).append("\",\"state\":\"")
                .append(status).append("\",\"decisionSequence\":")
                .append(row.decisionSequence).append('}');
            require(json.length()<MAX_OUTPUT_BYTES,
                    "read_only_state_output_exceeds_bound");
        }
        json.append("]}");
        byte[] bytes=json.toString().getBytes(StandardCharsets.US_ASCII);
        require(bytes.length<=MAX_OUTPUT_BYTES,"read_only_state_output_exceeds_bound");
        return bytes;
    }

    public static boolean hasNetworkListener(){return false;}
    public static boolean canMutateSavedState(){return false;}
    public static boolean canRemoveOriginal(){return false;}
}
