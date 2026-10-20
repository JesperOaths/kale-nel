package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/** 6 synthetic records, no phone/media, no production credentials. */
public final class S9MigratedReadOnlyStateTestV225 {
    private static String rep(char x,int n){
        char[] b=new char[n];Arrays.fill(b,x);return new String(b);
    }
    private static final byte[] SD=rep('k',48).getBytes(StandardCharsets.US_ASCII);
    private static final byte[] ANCHOR=rep('a',48).getBytes(StandardCharsets.US_ASCII);
    private static final SecretKey MAN=new SecretKeySpec(
            rep('m',48).getBytes(StandardCharsets.US_ASCII),"HmacSHA256");
    private static final String SHA=rep('f',64),ZERO=rep('0',64);
    private static final String[] NAMES={
        "synthetic_1792900000000.mp4","synthetic_1792900001000.mp4",
        "synthetic_1792900002000.mp4","synthetic_1792900003000.mp4",
        "synthetic_1792900004000.mp4","synthetic_1792900005000.mp4"
    };
    private static void ok(boolean b,String why){if(!b)throw new AssertionError(why);}
    @FunctionalInterface interface Task{void run()throws Exception;}
    private static void denied(Task t,String name)throws Exception{
        try{t.run();throw new AssertionError("unexpected_success_"+name);}
        catch(IOException expected){}
    }
    private static String hex(byte[] raw){
        StringBuilder s=new StringBuilder();
        for(byte b:raw)
            s.append(Character.forDigit((b>>>4)&15,16))
             .append(Character.forDigit(b&15,16));
        return s.toString();
    }
    private static void writeManifest(Path app,String hash)throws Exception{
        StringBuilder body=new StringBuilder("S9-MIGRATED-MANIFEST-V216|1|6\n");
        for(String name:NAMES)
            body.append("FILE|").append(name).append('|')
                .append(hash).append("|12000|1\n");
        Mac mac=Mac.getInstance("HmacSHA256");mac.init(MAN);
        String full=body+"HMAC|"+hex(mac.doFinal(
                body.toString().getBytes(StandardCharsets.US_ASCII)))+"\n";
        Files.write(app.resolve(S9MigratedSealedSourceManifestV216.FILE_NAME),
                    full.getBytes(StandardCharsets.US_ASCII));
    }
    static class Env {
        final Path app,sd;
        Env()throws Exception{
            Path dir=Files.createTempDirectory("s9-readonly-state-v225-");
            app=Files.createDirectory(dir.resolve("app_private"));
            sd=Files.createDirectory(dir.resolve("synthetic_sd"));
            Files.createFile(app.resolve("c720p-ledger-trusted-head-v196"));
            Files.createFile(app.resolve(".c720p-ledger-trusted-head-v196.lock"));
            Files.createFile(app.resolve(".c720p-dual-store-commit-v197.lock"));
            Files.createFile(sd.resolve("actions-v193.log"));
            Files.createFile(sd.resolve(".actions-v193.lock"));
            writeManifest(app,SHA);
        }
        S9MigratedSealedSourceManifestV216.Verified source()throws Exception{
            return S9MigratedSealedSourceManifestV216.verifyExisting(
                app.toFile(),MAN,1L);
        }
        S9MigratedDualStoreCommitV197 first()throws Exception{
            return new S9MigratedDualStoreCommitV197(
                app.toFile(),sd.toFile(),ANCHOR,SD,true,null);
        }
        S9MigratedDualStoreCommitV197 existing()throws Exception{
            return new S9MigratedDualStoreCommitV197(
                app.toFile(),sd.toFile(),ANCHOR,SD);
        }
    }
    private static final S9MigratedDualStoreCommitV197.AuthorizedSource TEST=
        (action,name,sha,bytes)->name.equals(NAMES[0]) || name.equals(NAMES[1]);
    public static void main(String[] args)throws Exception{
        ok(args.length==0,"synthetic_only");
        Env env=new Env();
        try(S9MigratedDualStoreCommitV197 initial=env.first()){
            S9MigratedReadOnlyStateV225.Snapshot zero=
                S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(env.source(),initial);
            ok(zero.rows.size()==6 && zero.journalSequence==0 &&
               zero.rows.get(NAMES[0]).status.equals("no_remote_decision"),
               "zero_state_not_presumed_saved");
            ok(!zero.permitsOriginalRetirement()&&!zero.provesMediaAvailability(),
               "snapshot_no_original_retirement");
            S9MigratedDualStoreCommitV197.Result saved=initial.commitMetadataOnly(
                "save",NAMES[0],SHA,12000,rep('1',32),0,ZERO,TEST);
            S9MigratedReadOnlyStateV225.Snapshot first=
                S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(env.source(),initial);
            ok(first.journalSequence==1 &&
               first.journalHeadSha256.equals(saved.trustedHeadSha256) &&
               first.rows.get(NAMES[0]).status.equals("saved_metadata") &&
               first.rows.get(NAMES[1]).status.equals("no_remote_decision"),
               "one_save_and_other_missing");
            S9MigratedDualStoreCommitV197.Result deleted=initial.commitMetadataOnly(
                "delete",NAMES[0],SHA,12000,rep('2',32),1,
                saved.trustedHeadSha256,TEST);
            S9MigratedReadOnlyStateV225.Snapshot afterDelete=
                S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(env.source(),initial);
            ok(afterDelete.journalSequence==2 &&
               afterDelete.journalHeadSha256.equals(deleted.trustedHeadSha256) &&
               afterDelete.rows.get(NAMES[0]).status.equals("deleted_tombstone"),
               "latest_delete_not_historical_save");
            try {
                afterDelete.rows.clear();
                throw new AssertionError("snapshot_map_mutable");
            }catch(UnsupportedOperationException correct){}
        }
        try(S9MigratedDualStoreCommitV197 reopened=env.existing()){
            ok(S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(
                env.source(),reopened).rows.get(NAMES[0]).status.equals("deleted_tombstone"),
                "restart_deleted_still_current");
            writeManifest(env.app,rep('b',64));
            denied(()->S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(
                env.source(),reopened),"different_manifest_sha");
        }
        Path log=env.sd.resolve("actions-v193.log");
        String complete=Files.readString(log);
        int earlier=complete.lastIndexOf('\n',complete.length()-2);
        ok(earlier>0,"test_two_rows");
        Files.write(log,complete.substring(0,earlier+1)
                .getBytes(StandardCharsets.US_ASCII));
        writeManifest(env.app,SHA);
        try(S9MigratedDualStoreCommitV197 corrupt=env.existing()){
            denied(()->S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(
                env.source(),corrupt),"tombstone_rollback_refused");
        }
        System.out.println("S9_READONLY_STATE_V225_HOST_VERIFIED"+
            " source_only=true files_deleted=false browser_write_authority=false");
    }
}
