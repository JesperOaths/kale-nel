package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Only synthetic host strings, never human intent or production credentials. */
public final class S9MigratedActionWireTestV231 {
    static String zeros(char c,int count){
        char[] a=new char[count];Arrays.fill(a,c);return new String(a);
    }
    static final String CLIP="synthetic_1792100000000.mp4";
    static final String HASH=zeros('a',64);
    static final String HEAD=zeros('0',64);
    static final String NONCE=zeros('1',32);
    static final long NOW=1792600000000L;
    static final byte[] AUTH="synthetic-transport-wire-only-hmac-test-2026".getBytes(StandardCharsets.US_ASCII);
    static void check(boolean value,String message){
        if(!value)throw new AssertionError(message);
    }
    @FunctionalInterface interface Checked{void run()throws Exception;}
    static void deny(Checked job,String message)throws Exception {
        try{job.run();throw new AssertionError("unexpected_acceptance_"+message);}
        catch(IOException expected){}
    }
    static String wire(S9MigratedSignedActionV198.Request r){
        return "schema="+r.schema+"\n"+
            "audience="+r.audience+"\n"+
            "method="+r.method+"\n"+
            "route="+r.route+"\n"+
            "action="+r.action+"\n"+
            "name="+r.name+"\n"+
            "source_sha256="+r.sourceSha256+"\n"+
            "source_bytes="+r.sourceBytes+"\n"+
            "nonce="+r.nonce+"\n"+
            "expected_sequence="+r.expectedSequence+"\n"+
            "expected_head_sha256="+r.expectedHeadSha256+"\n"+
            "issued_at_ms="+r.issuedAtMillis+"\n"+
            "expires_at_ms="+r.expiresAtMillis+"\n"+
            "hmac_sha256="+r.hmacSha256+"\n";
    }
    static byte[] b(String value){return value.getBytes(StandardCharsets.US_ASCII);}
    public static void main(String[] args)throws Exception {
        check(args.length==0,"host_only");
        try(S9MigratedSignedActionV198 verifier=new S9MigratedSignedActionV198(AUTH)){
            S9MigratedSignedActionV198.Request unsigned=
              new S9MigratedSignedActionV198.Request(
                "s9_c720p_migrated_action_auth_v198",
                "s9-microsd-metadata-only","POST","/c720p/migrated/action",
                "save",CLIP,HASH,123456,NONCE,0,HEAD,NOW-1000,NOW+60000,null);
            String tag=verifier.signForHostTestOnly(unsigned);
            S9MigratedSignedActionV198.Request signed=
              new S9MigratedSignedActionV198.Request(
                unsigned.schema,unsigned.audience,unsigned.method,unsigned.route,
                unsigned.action,unsigned.name,unsigned.sourceSha256,
                unsigned.sourceBytes,unsigned.nonce,unsigned.expectedSequence,
                unsigned.expectedHeadSha256,unsigned.issuedAtMillis,
                unsigned.expiresAtMillis,tag);
            String canonical=wire(signed);
            S9MigratedSignedActionV198.Request parsed=
                 S9MigratedActionWireV231.decode(b(canonical));
            check("save".equals(verifier.verify(parsed,NOW).action),
                  "valid_canonical_tuple_survives_to_crypto");
            check(!S9MigratedActionWireV231.approvesUser() &&
                  !S9MigratedActionWireV231.enablesNetworkTransport() &&
                  !S9MigratedActionWireV231.createsKeys() &&
                  !S9MigratedActionWireV231.mayRemoveMedia(),
                  "parser_grants_no_authority");
            deny(()->S9MigratedActionWireV231.decode(null),"null_refused");
            deny(()->S9MigratedActionWireV231.decode(new byte[5000]),
                 "oversize_refused");
            deny(()->S9MigratedActionWireV231.decode(
                  b(canonical.substring(0,canonical.length()-1))),
                 "missing_newline_refused");
            deny(()->S9MigratedActionWireV231.decode(
                  b(canonical.replace("source_bytes=123456\n",
                          "source_bytes=123456\nsource_bytes=123456\n"))),
                 "duplicate_key_refused");
            deny(()->S9MigratedActionWireV231.decode(
                  b(canonical.replace("method=POST\n","method=POST\r\n"))),
                 "carriage_return_refused");
            String changed=canonical.replace("action=save\n","action=delete\n");
            S9MigratedSignedActionV198.Request tampered=
                 S9MigratedActionWireV231.decode(b(changed));
            deny(()->verifier.verify(tampered,NOW),"tampered_action_rejected_by_crypto");
            deny(()->S9MigratedActionWireV231.decode(
                  b(canonical.replace("issued_at_ms="+(NOW-1000),
                          "issued_at_ms=99999999999999999999"))),
                 "overflow_time_refused");
            deny(()->S9MigratedActionWireV231.decode(
                  b(canonical.replace("expected_sequence=0",
                          "expected_sequence=-1"))),
                 "negative_sequence_refused");
            // All FOUR numeric fields must have one canonical decimal spelling.
            // A signed tuple with padded zeros must fail in the *wire parser*,
            // rather than normalizing into an otherwise valid HMAC request.
            String[] numericFields={"source_bytes","expected_sequence",
                                    "issued_at_ms","expires_at_ms"};
            for(String field:numericFields) {
                String[] lines=canonical.split("\\n");
                String unpadded=null;
                for(String line:lines) {
                    if(line.startsWith(field+"=")) {
                        unpadded=line.substring(field.length()+1);
                        break;
                    }
                }
                check(unpadded!=null,"canonical_field_present_"+field);
                final String alias=canonical.replace(
                    field+"="+unpadded+"\\n",field+"=0"+unpadded+"\\n");
                check(!alias.equals(canonical),"numerical_alias_really_modified");
                deny(()->S9MigratedActionWireV231.decode(b(alias)),
                     "leading_zero_numeric_field_rejected_"+field);
            }

            deny(()->S9MigratedActionWireV231.decode(
                  b(canonical.replace("source_sha256="+HASH+"\n",
                          "unexpected_field=x\nsource_sha256="+HASH+"\n"))),
                 "unknown_field_refused");
            byte[] nonAscii=b(canonical);
            nonAscii[10]=(byte)255;
            deny(()->S9MigratedActionWireV231.decode(nonAscii),
                 "non_ascii_refused");
            deny(()->verifier.verify(parsed,NOW+90000),
                 "expired_transport_intent_refused");
        }
        System.out.println("S9_MIGRATED_ACTION_WIRE_V231_SYNTHETIC_OK");
    }
}
