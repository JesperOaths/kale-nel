package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

public final class S9MigratedStrictJsonIntentTestV223 {
    private static final String GOOD="{"
      +"\"schema\":\"s9_c720p_migrated_action_auth_v198\","
      +"\"audience\":\"s9-microsd-metadata-only\","
      +"\"method\":\"POST\","
      +"\"route\":\"/c720p/migrated/action\","
      +"\"action\":\"save\","
      +"\"name\":\"synthetic_1792700000000.mp4\","
      +"\"sourceSha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\","
      +"\"sourceBytes\":16384,"
      +"\"nonce\":\"11111111111111111111111111111111\","
      +"\"expectedSequence\":0,"
      +"\"expectedHeadSha256\":\"0000000000000000000000000000000000000000000000000000000000000000\","
      +"\"issuedAtMillis\":1792700000000,"
      +"\"expiresAtMillis\":1792700060000,"
      +"\"hmacSha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}";
    private static void ok(boolean yes,String name) {
        if(!yes)throw new AssertionError(name);
    }
    private static S9MigratedSignedActionV198.Request read(String body)
            throws IOException {
        return S9MigratedStrictJsonIntentV223.parse(
            body.getBytes(StandardCharsets.US_ASCII),"application/json");
    }
    private static void denied(String body,String label)throws Exception {
        boolean blocked=false;
        try{read(body);}catch(IOException expected){blocked=true;}
        ok(blocked,label);
    }
    public static void main(String[] args)throws Exception {
        ok(args.length==0,"host_only");
        S9MigratedSignedActionV198.Request parsed=read(GOOD);
        ok(parsed.sourceBytes==16384 && parsed.expectedSequence==0
           && parsed.name.equals("synthetic_1792700000000.mp4"),
           "typed_success");
        read(GOOD.replace("\"sourceBytes\":16384"," \"sourceBytes\" : 16384 "));
        denied(GOOD.replace("\"action\":\"save\",",
            "\"action\":\"save\",\"action\":\"delete\","),
            "duplicate_key");
        denied(GOOD.replace("\"action\":\"save\",",
            "\"action\":\"save\",\"evil\":\"value\","),
            "unknown_key");
        denied(GOOD.replace("\"action\":\"save\",",""),
            "missing_key");
        denied(GOOD.replace("\"sourceBytes\":16384",
            "\"sourceBytes\":\"16384\""),"quoted_number");
        denied(GOOD.replace("\"sourceBytes\":16384",
            "\"sourceBytes\":016384"),"leading_zero");
        denied(GOOD.replace("\"sourceBytes\":16384",
            "\"sourceBytes\":-1"),"negative_number");
        denied(GOOD.replace("\"sourceBytes\":16384",
            "\"sourceBytes\":1e4"),"exponential_number");
        denied(GOOD.replace("\"sourceBytes\":16384",
            "\"sourceBytes\":18446744073709551616"),"overflow");
        denied(GOOD.replace("\"action\":\"save\"",
            "\"action\":\"s\\u0061ve\""),"escaped_unicode");
        denied(GOOD.replace("\"action\":\"save\"",
            "\"action\":null"),"null");
        denied(GOOD.substring(0,GOOD.length()-1)+",}",
            "trailing_comma");
        denied(GOOD+"{}", "extra_object");
        denied("["+GOOD+"]", "array_root");
        denied(GOOD+new String(new char[4096]).replace('\0',' '),
            "body_oversize");
        byte[] nonascii=GOOD.getBytes(StandardCharsets.US_ASCII);
        nonascii[1]=(byte)0xc2;
        boolean nonasciiRefused=false;
        try{S9MigratedStrictJsonIntentV223.parse(nonascii,"application/json");}
        catch(IOException expected){nonasciiRefused=true;}
        ok(nonasciiRefused,"non_ascii");
        boolean badMediaType=false;
        try{S9MigratedStrictJsonIntentV223.parse(
          GOOD.getBytes(StandardCharsets.US_ASCII),"text/plain");}
        catch(IOException expected){badMediaType=true;}
        ok(badMediaType,"wrong_media_type");
        System.out.println("S9_STRICT_SIGNED_JSON_V223_HOST_OK");
    }
}
