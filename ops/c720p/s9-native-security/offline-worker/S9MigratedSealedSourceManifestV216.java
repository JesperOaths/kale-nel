package nl.kalenel.s9offline;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

/**
 * Read-only, SOURCE-ONLY verification of an APP-PRIVATE HMAC-sealed list of
 * independently approved migrated MP4s for V198's real SHA source verifier.
 *
 * This does not create the manifest, provision its independent signing key,
 * authenticate a user, start an Android component, install an APK, access
 * Camera2, or grant Save/Delete. Any minimumGeneration MUST come from an
 * independently authenticated anti-rollback anchor, never a client request.
 *
 * Wire format (strict US-ASCII, LF-only, sorted unique source names):
 * S9-MIGRATED-MANIFEST-V216|<positive generation>|<number of rows>\n
 * FILE|<safe mp4 basename>|<sha256 lowercase hex>|<canonical byte count>|1\n
 * ...
 * HMAC|<lowercase hex HMAC-SHA256 of all preceding bytes, including LF>\n
 *
 * App-private file ownership / protected enrolment is a caller prerequisite.
 * A valid signature alone never proves actual on-phone MP4 bytes: V198 must
 * still rehash them under separate human authorization for EACH action.
 */
public final class S9MigratedSealedSourceManifestV216 {
    public static final String FILE_NAME="c720p-approved-source-manifest-v216.txt";
    private static final String HEAD="S9-MIGRATED-MANIFEST-V216";
    private static final Pattern MP4=Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,139}\\.mp4");
    private static final Pattern HEX=Pattern.compile("[a-f0-9]{64}");
    private static final Pattern NUMBER=Pattern.compile("[1-9][0-9]{0,17}");
    private static final int MAX_BYTES=1050000;
    private static final int MAX_ROWS=5000;

    public static final class Verified {
        public final long generation;
        public final Map<String,S9MigratedVerifiedSourceV198.Proof> sourceRows;
        private Verified(long value,Map<String,S9MigratedVerifiedSourceV198.Proof> rows) {
            generation=value;
            sourceRows=Collections.unmodifiableMap(new LinkedHashMap<>(rows));
        }
        public boolean grantsRemoteSaveDelete(){return false;}
        public boolean permitsLocalDeletion(){return false;}
        public boolean createsReviewAssignments(){return false;}
    }
    private S9MigratedSealedSourceManifestV216(){}

    private static long positive(String value,long maximum)throws IOException {
        if(value==null || !NUMBER.matcher(value).matches())
            throw new IOException("sealed_manifest_numeric_field_invalid");
        try {
            long n=Long.parseLong(value);
            if(n<1 || n>maximum)
                throw new IOException("sealed_manifest_numeric_bound_invalid");
            return n;
        } catch(NumberFormatException e) {
            throw new IOException("sealed_manifest_numeric_field_invalid");
        }
    }
    private static String hex(byte[] raw) {
        StringBuilder s=new StringBuilder(raw.length*2);
        for(byte v:raw) {
            s.append(Character.forDigit((v>>>4)&15,16));
            s.append(Character.forDigit(v&15,16));
        }
        return s.toString();
    }
    private static boolean equalSha(String a,String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.US_ASCII),
                                     b.getBytes(StandardCharsets.US_ASCII));
    }

    public static Verified verifyExisting(File privateInternalDir,SecretKey sourceManifestKey,
                                           long trustedMinimumGeneration)throws IOException {
        if(privateInternalDir==null || sourceManifestKey==null
                || !"HmacSHA256".equalsIgnoreCase(sourceManifestKey.getAlgorithm())
                || trustedMinimumGeneration<1)
            throw new IOException("sealed_manifest_private_provisioning_missing");
        Path directory=privateInternalDir.toPath();
        if(Files.isSymbolicLink(directory) ||
                !Files.isDirectory(directory,LinkOption.NOFOLLOW_LINKS))
            throw new IOException("sealed_manifest_app_directory_untrusted");
        Path path=directory.resolve(FILE_NAME);
        if(Files.isSymbolicLink(path) ||
                !Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS))
            throw new IOException("sealed_manifest_missing_or_replaced");
        BasicFileAttributes before=Files.readAttributes(path,BasicFileAttributes.class,
                                                        LinkOption.NOFOLLOW_LINKS);
        if(!before.isRegularFile() || before.size()<125 || before.size()>MAX_BYTES)
            throw new IOException("sealed_manifest_size_untrusted");
        // Open the already bounded file with NOFOLLOW as well; do not let a
        // racing replacement turn a stat-checked path into another file read.
        byte[] content;
        try(java.nio.channels.SeekableByteChannel input=Files.newByteChannel(
                path,new java.util.HashSet<java.nio.file.OpenOption>(
                    java.util.Arrays.<java.nio.file.OpenOption>asList(
                        java.nio.file.StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)));
            java.io.ByteArrayOutputStream buffer=new java.io.ByteArrayOutputStream(
                    (int)before.size())) {
            java.nio.ByteBuffer block=java.nio.ByteBuffer.allocate(32768);
            int seen=0;
            while(true){
                block.clear();
                int got=input.read(block);
                if(got<0)break;
                if(got==0 || seen+got>MAX_BYTES)
                    throw new IOException("sealed_manifest_bounded_read_failed");
                buffer.write(block.array(),0,got);
                seen+=got;
            }
            content=buffer.toByteArray();
        }
        BasicFileAttributes after=Files.readAttributes(path,BasicFileAttributes.class,
                                                        LinkOption.NOFOLLOW_LINKS);
        if(content.length!=before.size() || before.size()!=after.size()
                || !before.lastModifiedTime().equals(after.lastModifiedTime())
                || (before.fileKey()!=null && after.fileKey()!=null
                    && !before.fileKey().equals(after.fileKey())))
            throw new IOException("sealed_manifest_changed_during_read");
        for(byte b:content) {
            if((b&255)>127 || (b&255)==13 || (b&255)==0)
                throw new IOException("sealed_manifest_not_canonical_ascii");
        }
        String all=new String(content,StandardCharsets.US_ASCII);
        if(!all.endsWith("\n") || all.contains("\n\n"))
            throw new IOException("sealed_manifest_line_boundaries_untrusted");
        String[] lines=all.split("\n",-1);
        if(lines.length<4 || lines.length>MAX_ROWS+3 || !lines[lines.length-1].isEmpty())
            throw new IOException("sealed_manifest_row_count_invalid");
        String[] header=lines[0].split("\\|",-1);
        if(header.length!=3 || !HEAD.equals(header[0]))
            throw new IOException("sealed_manifest_header_invalid");
        long generation=positive(header[1],Long.MAX_VALUE);
        if(generation<trustedMinimumGeneration)
            throw new IOException("sealed_manifest_generation_rollback");
        int count=(int)positive(header[2],MAX_ROWS);
        if(lines.length!=count+3)
            throw new IOException("sealed_manifest_row_count_mismatch");
        String[] tail=lines[lines.length-2].split("\\|",-1);
        if(tail.length!=2 || !"HMAC".equals(tail[0]) || !HEX.matcher(tail[1]).matches())
            throw new IOException("sealed_manifest_signature_field_invalid");
        int end=all.lastIndexOf("HMAC|");
        if(end<0 || !all.substring(end).equals("HMAC|"+tail[1]+"\n"))
            throw new IOException("sealed_manifest_trailing_payload");
        String expected;
        try {
            Mac mac=Mac.getInstance("HmacSHA256");
            mac.init(sourceManifestKey);
            expected=hex(mac.doFinal(all.substring(0,end)
                    .getBytes(StandardCharsets.US_ASCII)));
        }catch(GeneralSecurityException e) {
            throw new IOException("sealed_manifest_signer_unavailable");
        }
        if(!equalSha(expected,tail[1]))
            throw new IOException("sealed_manifest_signature_mismatch");
        Map<String,S9MigratedVerifiedSourceV198.Proof> rows=new LinkedHashMap<>();
        String previous=null;
        for(int i=1;i<=count;i++) {
            String[] col=lines[i].split("\\|",-1);
            if(col.length!=5 || !"FILE".equals(col[0]) || !"1".equals(col[4])
                    || !MP4.matcher(col[1]).matches() || col[1].contains("..")
                    || !HEX.matcher(col[2]).matches())
                throw new IOException("sealed_manifest_record_invalid");
            long size=positive(col[3],900L*1024*1024);
            if(size<10000 || (previous!=null && previous.compareTo(col[1])>=0))
                throw new IOException("sealed_manifest_order_or_size_invalid");
            rows.put(col[1],new S9MigratedVerifiedSourceV198.Proof(
                    col[1],col[2],size,true));
            previous=col[1];
        }
        if(rows.size()!=count)
            throw new IOException("sealed_manifest_duplicate_record");
        return new Verified(generation,rows);
    }
}
