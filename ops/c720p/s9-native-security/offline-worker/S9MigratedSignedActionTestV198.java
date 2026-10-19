package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Host-only fake request signatures; no S9 phone, images or network. */
public final class S9MigratedSignedActionTestV198 {
    private static final String SCHEMA="s9_c720p_migrated_action_auth_v198";
    private static final String AUDIENCE="s9-microsd-metadata-only";
    private static final String ROUTE="/c720p/migrated/action";
    private static final String NAME="synthetic_1792300000000.mp4";
    private static final byte[] KEY="synthetic-relay-action-secret-only-for-host-unit-v198"
            .getBytes(StandardCharsets.US_ASCII);
    private static final long NOW=1792450000000L;
    private static String repeat(char c,int n) {
        char[] chars=new char[n];Arrays.fill(chars,c);return new String(chars);
    }
    private static void ok(boolean b,String why) {
        if(!b)throw new AssertionError(why);
    }
    @FunctionalInterface interface Checked{void run()throws Exception;}
    private static void denied(Checked c,String why)throws Exception {
        try{c.run();throw new AssertionError("unexpected_success_"+why);}
        catch(IOException expected){}
    }
    private static S9MigratedSignedActionV198.Request raw(
        String schema,String audience,String method,String route,
        String action,String name,String sha,long bytes,String nonce,
        long sequence,String head,long issued,long expires,String hmac) {
        return new S9MigratedSignedActionV198.Request(
                schema,audience,method,route,action,name,sha,bytes,
                nonce,sequence,head,issued,expires,hmac);
    }
    private static S9MigratedSignedActionV198.Request valid(String hmac) {
        return raw(SCHEMA,AUDIENCE,"POST",ROUTE,"save",NAME,
            repeat('a',64),123456,repeat('1',32),2,repeat('b',64),
            NOW-5000,NOW+45000,hmac);
    }
    private static S9MigratedSignedActionV198.Request withField(
        S9MigratedSignedActionV198.Request r,String key,Object value) {
        return raw(
            key.equals("schema")?(String)value:r.schema,
            key.equals("audience")?(String)value:r.audience,
            key.equals("method")?(String)value:r.method,
            key.equals("route")?(String)value:r.route,
            key.equals("action")?(String)value:r.action,
            key.equals("name")?(String)value:r.name,
            key.equals("sha")?(String)value:r.sourceSha256,
            key.equals("bytes")?(Long)value:r.sourceBytes,
            key.equals("nonce")?(String)value:r.nonce,
            key.equals("sequence")?(Long)value:r.expectedSequence,
            key.equals("head")?(String)value:r.expectedHeadSha256,
            key.equals("issued")?(Long)value:r.issuedAtMillis,
            key.equals("expires")?(Long)value:r.expiresAtMillis,
            key.equals("hmac")?(String)value:r.hmacSha256);
    }
    public static void main(String[] args)throws Exception {
        ok(args.length==0,"offline_fixture_only");
        try(S9MigratedSignedActionV198 verifier=new S9MigratedSignedActionV198(KEY)) {
            S9MigratedSignedActionV198.Request unsigned=valid(null);
            String signature=verifier.signForHostTestOnly(unsigned);
            S9MigratedSignedActionV198.Request proper=valid(signature);
            S9MigratedSignedActionV198.Verified binding=verifier.verify(proper,NOW);
            ok(binding.action.equals("save")&&binding.name.equals(NAME)
                &&binding.expectedSequence==2&&binding.sourceBytes==123456
                &&binding.expectedHeadSha256.equals(repeat('b',64))
                &&!binding.mayRemoveOriginal()
                &&!binding.isActualMediaSourceVerified()
                &&!binding.createsPersonAssignment(),"exact_authorized_scope");
            // Change ANY security-significant field without re-signing.
            String[] keys={"schema","audience","method","route","action",
                "name","sha","bytes","nonce","sequence","head","issued",
                "expires","hmac"};
            Object[] changed={"s9_c720p_migrated_action_auth_v197",
                "camera-admin","GET","/status","delete",
                "other_synthetic.mp4",repeat('c',64),123457L,
                repeat('2',32),3L,repeat('d',64),NOW-1000L,NOW+30000L,
                repeat('f',64)};
            for(int i=0;i<keys.length;i++) {
                final String which=keys[i];
                final Object different=changed[i];
                denied(()->verifier.verify(withField(proper,which,different),NOW),
                    "tampered_field_"+which);
            }
            denied(()->verifier.verify(proper,NOW+70000),
                    "expired_request");
            denied(()->verifier.verify(proper,NOW-40000),
                    "future_clock_skew");
            denied(()->verifier.verify(proper,0),
                    "unknown_phone_wall_clock");
            denied(()->verifier.verify(withField(proper,"nonce",
                    "../invalid"),NOW),"nonce_cannot_have_path");
            denied(()->verifier.verify(withField(proper,"name",
                    "../private.mp4"),NOW),"recording_traversal");
            denied(()->verifier.verify(withField(proper,"sequence",
                    -1L),NOW),"negative_expected_head_seq");
            S9MigratedSignedActionV198.Request overlong=
                withField(proper,"expires",NOW+500000L);
            String overlongSig=verifier.signForHostTestOnly(overlong);
            denied(()->verifier.verify(withField(overlong,"hmac",
                    overlongSig),NOW),"overlong_signed_lifetime");
            S9MigratedSignedActionV198.Request unsignedWrongMethod=
                withField(proper,"method","PUT");
            String wrongMethodSignature=verifier.signForHostTestOnly(unsignedWrongMethod);
            denied(()->verifier.verify(
                 withField(unsignedWrongMethod,"hmac",wrongMethodSignature),NOW),
                 "even_valid_signature_cannot_authorize_put");
            try(S9MigratedSignedActionV198 wrongKey=
                    new S9MigratedSignedActionV198(
                       "another-synthetic-key-for-test-v198-very-long"
                       .getBytes(StandardCharsets.US_ASCII))){
                denied(()->wrongKey.verify(proper,NOW),"independent_wrong_key");
            }
        }
        Arrays.fill(KEY,(byte)0);
        System.out.println("S9_SIGNED_ACTION_V198_HOST_TESTS_OK");
    }
}
