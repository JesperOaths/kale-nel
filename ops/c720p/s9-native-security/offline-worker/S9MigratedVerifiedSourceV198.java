package nl.kalenel.s9offline;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * SOURCE ONLY: independently prove that a future S9-only metadata action
 * refers to the exact SHA-256-qualified original on S9 microSD, not a clip
 * name/size/hash supplied by an untrusted web client.
 *
 * The future privileged service MUST create this with an independently
 * authenticated, immutable private manifest, and inject a separate trusted
 * user/action authorization. A user/browser must NEVER supply the manifest
 * or authorization callback. No camera APK, network listener, Save/Delete
 * route, recording deletion, person labels, or media decoding is here.
 */
public final class S9MigratedVerifiedSourceV198
        implements S9MigratedDualStoreCommitV197.AuthorizedSource {
    private static final Pattern NAME=Pattern.compile(
        "[A-Za-z0-9][A-Za-z0-9._-]{0,139}\\.mp4");
    private static final Pattern SHA=Pattern.compile("[a-f0-9]{64}");
    private final Path root;
    private final Map<String,Proof> trusted;
    private final TrustedUserAuthorization authorization;

    public interface TrustedUserAuthorization {
        boolean allows(String action,String recordingName,
                       String sourceSha256,long sourceBytes) throws IOException;
    }
    public static final class Proof {
        public final String name, sha256;
        public final long bytes;
        public final boolean copiedAndIndexed;
        public Proof(String name,String sha256,long bytes,boolean copiedAndIndexed) {
            this.name=name;this.sha256=sha256;
            this.bytes=bytes;this.copiedAndIndexed=copiedAndIndexed;
        }
    }

    public S9MigratedVerifiedSourceV198(File trustedMicroSdMediaDirectory,
            Map<String,Proof> independentlyVerifiedPrivateManifest,
            TrustedUserAuthorization separateAuthorization) throws IOException {
        if (trustedMicroSdMediaDirectory==null ||
            independentlyVerifiedPrivateManifest==null ||
            separateAuthorization==null ||
            independentlyVerifiedPrivateManifest.isEmpty() ||
            independentlyVerifiedPrivateManifest.size()>5000)
            throw new IOException("trusted_source_provenance_or_auth_missing");
        root=trustedMicroSdMediaDirectory.toPath();
        checkRoot();
        Map<String,Proof> copied=new HashMap<String,Proof>();
        for(Map.Entry<String,Proof> entry:independentlyVerifiedPrivateManifest.entrySet()){
            Proof p=entry.getValue();
            if(p==null || !validName(entry.getKey()) ||
               !entry.getKey().equals(p.name) ||
               p.sha256==null || !SHA.matcher(p.sha256).matches() ||
               p.bytes<10000 || p.bytes>900L*1024*1024 ||
               !p.copiedAndIndexed)
                throw new IOException("private_import_manifest_entry_unverified");
            copied.put(p.name,new Proof(p.name,p.sha256,p.bytes,true));
        }
        trusted=Collections.unmodifiableMap(copied);
        authorization=separateAuthorization;
    }

    private static boolean validName(String n) {
        return n!=null && NAME.matcher(n).matches() && !n.contains("..");
    }

    private void checkRoot() throws IOException {
        if(Files.isSymbolicLink(root) ||
           !Files.isDirectory(root,LinkOption.NOFOLLOW_LINKS))
            throw new IOException("trusted_micro_sd_source_directory_unavailable");
    }

    @Override public boolean permits(String action,String name,String sha256,long bytes)
            throws IOException {
        if(!"save".equals(action) && !"delete".equals(action))
            throw new IOException("invalid_source_action");
        if(!validName(name) || sha256==null || !SHA.matcher(sha256).matches())
            throw new IOException("untrusted_recording_identity");
        Proof expected=trusted.get(name);
        if(expected==null || bytes!=expected.bytes ||
           !MessageDigest.isEqual(expected.sha256.getBytes(
                   java.nio.charset.StandardCharsets.US_ASCII),
                   sha256.getBytes(java.nio.charset.StandardCharsets.US_ASCII)))
            throw new IOException("source_not_in_approved_private_import");
        // Caller must provide independently authenticated user approval;
        // hash equivalence must never grant a user permission by itself.
        if(!authorization.allows(action,name,sha256,bytes))
            throw new IOException("separate_action_authorization_refused");
        checkRoot();
        Path file=root.resolve(name);
        if(!file.normalize().getParent().equals(root.normalize()) ||
           Files.isSymbolicLink(file) ||
           !Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS))
            throw new IOException("qualified_source_file_not_regular");
        BasicFileAttributes start=Files.readAttributes(file,BasicFileAttributes.class,
                         LinkOption.NOFOLLOW_LINKS);
        if(!start.isRegularFile() || start.size()!=expected.bytes)
            throw new IOException("qualified_source_size_changed");
        final MessageDigest sha;
        try {sha=MessageDigest.getInstance("SHA-256");}
        catch(GeneralSecurityException e){throw new IOException("sha256_unavailable");}
        HashSet<java.nio.file.OpenOption> modes=new HashSet<java.nio.file.OpenOption>();
        modes.add(StandardOpenOption.READ);
        modes.add(LinkOption.NOFOLLOW_LINKS);
        long seen=0;
        try(SeekableByteChannel input=Files.newByteChannel(file,modes)) {
            ByteBuffer block=ByteBuffer.allocate(65536);
            while(input.read(block)!=-1) {
                block.flip();
                int count=block.remaining();
                seen+=count;
                if(seen>expected.bytes)
                    throw new IOException("qualified_source_unbounded");
                sha.update(block);
                block.clear();
            }
        }
        BasicFileAttributes end=Files.readAttributes(file,BasicFileAttributes.class,
                         LinkOption.NOFOLLOW_LINKS);
        if(seen!=expected.bytes || end.size()!=start.size() ||
           !end.lastModifiedTime().equals(start.lastModifiedTime()) ||
           !end.isRegularFile() ||
           (start.fileKey()!=null && end.fileKey()!=null &&
              !start.fileKey().equals(end.fileKey())))
            throw new IOException("qualified_source_changed_during_sha");
        byte[] digest=sha.digest();
        byte[] expectedDigest=new byte[32];
        for(int i=0;i<32;i++){
            expectedDigest[i]=(byte)Integer.parseInt(
                 expected.sha256.substring(i*2,i*2+2),16);
        }
        boolean valid=MessageDigest.isEqual(digest,expectedDigest);
        Arrays.fill(expectedDigest,(byte)0);
        Arrays.fill(digest,(byte)0);
        if(!valid)throw new IOException("qualified_source_sha256_mismatch");
        return true; // only provenance AND separately approved action
    }

    public boolean authorizesOriginalDeletion(){return false;}
    public boolean mutatesMedia(){return false;}
    public boolean liveServiceInstalled(){return false;}
}
