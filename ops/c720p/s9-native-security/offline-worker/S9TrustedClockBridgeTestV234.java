package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Host-only cross-language fixture, not a production signer or HTTP server. */
public final class S9TrustedClockBridgeTestV234 {
    private static String repeat(char c,int n){
        char[] chars=new char[n];java.util.Arrays.fill(chars,c);return new String(chars);
    }
    private static S9MigratedSignedActionV198.Request candidate(
            long issued,long expires,String mac) {
        return new S9MigratedSignedActionV198.Request(
          "s9_c720p_migrated_action_auth_v198",
          "s9-microsd-metadata-only","POST","/c720p/migrated/action",
          "save","synthetic_1792600000000.mp4",repeat('a',64),123456,
          repeat('1',32),1L,repeat('b',64),issued,expires,mac);
    }
    private static void require(boolean ok,String reason){
        if(!ok)throw new AssertionError(reason);
    }
    public static void main(String[] args)throws Exception {
        require(args.length==1 && args[0].matches("[0-9]{13}"),
                "host_only_trusted_utc_sample_required");
        long witnessed=Long.parseLong(args[0]);
        byte[] secret="host-fixture-key-never-used-in-live-authorization-v234"
                .getBytes(StandardCharsets.US_ASCII);
        try(S9MigratedSignedActionV198 v=new S9MigratedSignedActionV198(secret)) {
            S9MigratedSignedActionV198.Request unsigned=candidate(
                     witnessed,witnessed+30000,null);
            S9MigratedSignedActionV198.Request signed=candidate(
                     witnessed,witnessed+30000,v.signForHostTestOnly(unsigned));
            S9MigratedSignedActionV198.Verified ok=v.verify(signed,witnessed+2000);
            require(ok.action.equals("save") && !ok.mayRemoveOriginal()
                && !ok.isActualMediaSourceVerified(),
                "trusted_time_never_authorizes_real_media");
            // A token issued from a hub ~92 seconds slow with 30-second TTL
            // fails V198; time witness only supplies UTC, never a bypass.
            S9MigratedSignedActionV198.Request old=candidate(
                 witnessed-92000,witnessed-62000,null);
            S9MigratedSignedActionV198.Request late=candidate(
                 witnessed-92000,witnessed-62000,v.signForHostTestOnly(old));
            boolean blocked=false;
            try {v.verify(late,witnessed+2000);}
            catch(IOException expected){blocked=true;}
            require(blocked,"stale_clock_hub_token_must_fail");
            S9MigratedSignedActionV198.Request forged=candidate(
                 witnessed,witnessed+30000,repeat('f',64));
            blocked=false;
            try{v.verify(forged,witnessed+2000);}
            catch(IOException expected){blocked=true;}
            require(blocked,"forged_mac_must_fail");
        }
        java.util.Arrays.fill(secret,(byte)0);
        System.out.println("S9_TIME_WITNESS_V234_JAVA_SIGNATURE_PARITY_OK");
    }
}
