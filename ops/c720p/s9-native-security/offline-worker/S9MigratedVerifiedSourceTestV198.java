package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/** Synthetic bytes only. No real MP4, phone, HTTP, account, or keys. */
public final class S9MigratedVerifiedSourceTestV198 {
    private static final String NAME="synthetic_1792400000001.mp4";
    private static final int SIZE=12431;
    private static final char[] HEX="0123456789abcdef".toCharArray();
    @FunctionalInterface private interface Operation {void execute()throws Exception;}
    private static void require(boolean condition,String msg){
        if(!condition)throw new AssertionError(msg);
    }
    private static void refused(Operation fn,String code)throws Exception {
        try{fn.execute();throw new AssertionError("incorrectly_granted_"+code);}
        catch(IOException e) {
            if(!e.getMessage().contains(code))
                throw new AssertionError("different_error_than_"+code,e);
        }
    }
    private static String sha(byte[] data)throws Exception{
        byte[] dig=MessageDigest.getInstance("SHA-256").digest(data);
        char[] dst=new char[dig.length*2];
        for(int i=0;i<dig.length;i++){
            dst[i*2]=HEX[(dig[i]>>4)&15];dst[i*2+1]=HEX[dig[i]&15];
        }
        return new String(dst);
    }
    private static byte[] bytes(int n){
        byte[] b=new byte[n];
        for(int i=0;i<n;i++)b[i]=(byte)((i*17+31)%251);
        return b;
    }
    public static void main(String[] args)throws Exception {
        require(args.length==0,"synthetic_host_only");
        Path root=Files.createTempDirectory("s9-migrated-proof-v198-");
        byte[] content=bytes(SIZE);
        String digest=sha(content);
        Path file=root.resolve(NAME);
        Files.write(file,content);
        Map<String,S9MigratedVerifiedSourceV198.Proof> p=
             new HashMap<String,S9MigratedVerifiedSourceV198.Proof>();
        p.put(NAME,new S9MigratedVerifiedSourceV198.Proof(NAME,digest,SIZE,true));
        S9MigratedVerifiedSourceV198.TrustedUserAuthorization approved=
             (action,name,sha,len)-> "save".equals(action) && NAME.equals(name) &&
              digest.equals(sha) && len==SIZE;
        S9MigratedVerifiedSourceV198 verified=new S9MigratedVerifiedSourceV198(
             root.toFile(),p,approved);
        require(verified.permits("save",NAME,digest,SIZE),"on_disk_digest_validated");
        require(!verified.authorizesOriginalDeletion() && !verified.mutatesMedia() &&
                !verified.liveServiceInstalled(),"not_a_production_media_mutator");
        refused(()->verified.permits("delete",NAME,digest,SIZE),
                "separate_action_authorization_refused");
        refused(()->verified.permits("save",NAME,digest,SIZE+1),
                "source_not_in_approved_private_import");
        refused(()->verified.permits("save","../../leak.mp4",digest,SIZE),
                "untrusted_recording_identity");
        refused(()->verified.permits("save",NAME,
                  "b"+digest.substring(1),SIZE),
                "source_not_in_approved_private_import");
        S9MigratedVerifiedSourceV198.TrustedUserAuthorization denied=(a,n,h,b)->false;
        S9MigratedVerifiedSourceV198 noAuth=new S9MigratedVerifiedSourceV198(
             root.toFile(),p,denied);
        refused(()->noAuth.permits("save",NAME,digest,SIZE),
                "separate_action_authorization_refused");
        byte[] changed=content.clone();changed[100]^=127;
        Files.write(file,changed);
        refused(()->verified.permits("save",NAME,digest,SIZE),
                "qualified_source_sha256_mismatch");
        Files.write(file,content);
        Files.delete(file);
        Files.createSymbolicLink(file,root.resolve("another.mp4"));
        refused(()->verified.permits("save",NAME,digest,SIZE),
                "qualified_source_file_not_regular");
        Files.delete(file);
        Files.write(file,content);
        Map<String,S9MigratedVerifiedSourceV198.Proof> notIndexed=
             Collections.singletonMap(NAME,
               new S9MigratedVerifiedSourceV198.Proof(NAME,digest,SIZE,false));
        refused(()->new S9MigratedVerifiedSourceV198(
                  root.toFile(),notIndexed,approved),
                "private_import_manifest_entry_unverified");
        refused(()->new S9MigratedVerifiedSourceV198(
                  root.toFile(),p,null),
                "trusted_source_provenance_or_auth_missing");
        Path link=Files.createTempDirectory("s9-source-v198-links-").resolve("link");
        Files.createSymbolicLink(link,root);
        refused(()->new S9MigratedVerifiedSourceV198(
                    link.toFile(),p,approved),
                "trusted_micro_sd_source_directory_unavailable");
        require(Files.size(file)==SIZE &&
            MessageDigest.isEqual(sha(Files.readAllBytes(file)).getBytes(
                      StandardCharsets.US_ASCII),
                       digest.getBytes(StandardCharsets.US_ASCII)),
            "source_original_restored_after_fixture_only");
        System.out.println("S9_MIGRATED_SHA_SOURCE_V198_HOST_ONLY_PASSED");
    }
}
