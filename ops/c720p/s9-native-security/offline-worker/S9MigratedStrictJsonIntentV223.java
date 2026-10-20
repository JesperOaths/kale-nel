package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** SOURCE ONLY: strict, bounded, flat ASCII JSON for future Save/Delete intent.
 * Parsing is NOT authentication. Always call V198.verify() with trusted time,
 * then separately verify source SHA and user approval before V197 commits.
 * No HTTP listener, crypto key creation, camera, media or filesystem changes.
 */
public final class S9MigratedStrictJsonIntentV223 {
    private static final int MAX_BYTES=4096;
    private static final String[] TEXT={
        "schema","audience","method","route","action","name",
        "sourceSha256","nonce","expectedHeadSha256","hmacSha256"};
    private static final String[] NUMBERS={
        "sourceBytes","expectedSequence","issuedAtMillis","expiresAtMillis"};
    private static final Set<String> NAMES=new HashSet<String>();
    private static final Set<String> NUMERIC=new HashSet<String>();
    static {
        for(String item:TEXT)NAMES.add(item);
        for(String item:NUMBERS){NAMES.add(item);NUMERIC.add(item);}
    }
    private final byte[] input;
    private int offset;
    private final Map<String,String> values=new HashMap<String,String>();
    private S9MigratedStrictJsonIntentV223(byte[] bytes){input=bytes;}

    public static S9MigratedSignedActionV198.Request parse(
            byte[] body,String contentType)throws IOException {
        if(body==null || body.length<2 || body.length>MAX_BYTES ||
                !"application/json".equals(contentType))
            throw new IOException("signed_json_content_rejected");
        for(byte raw:body) {
            int value=raw&255;
            if(value>126 || (value<32 && value!=9 && value!=10 && value!=13))
                throw new IOException("signed_json_non_ascii");
        }
        return new S9MigratedStrictJsonIntentV223(body).decode();
    }
    private void white() {
        while(offset<input.length) {
            int c=input[offset]&255;
            if(c==32 || c==9 || c==10 || c==13)offset++;
            else break;
        }
    }
    private void expect(int expected)throws IOException {
        white();
        if(offset>=input.length || (input[offset]&255)!=expected)
            throw new IOException("signed_json_syntax_rejected");
        offset++;
    }
    private String text(int max)throws IOException {
        expect('"');
        int start=offset;
        while(offset<input.length && input[offset]!='"') {
            int c=input[offset]&255;
            // All signed metadata is unescaped, printable ASCII without spaces.
            if(c<33 || c>126 || c=='\\')
                throw new IOException("signed_json_escape_or_string_rejected");
            offset++;
            if(offset-start>max)throw new IOException("signed_json_string_oversize");
        }
        if(offset==start || offset>=input.length)
            throw new IOException("signed_json_string_truncated");
        String value=new String(input,start,offset-start,StandardCharsets.US_ASCII);
        offset++;
        return value;
    }
    private String number()throws IOException {
        white();
        int start=offset;
        while(offset<input.length) {
            int c=input[offset]&255;
            if(c<48 || c>57)break;
            offset++;
            if(offset-start>19)throw new IOException("signed_json_number_oversize");
        }
        if(start==offset || (offset-start>1 && input[start]=='0'))
            throw new IOException("signed_json_noncanonical_number");
        String value=new String(input,start,offset-start,StandardCharsets.US_ASCII);
        try{Long.parseLong(value);}
        catch(NumberFormatException error) {
            throw new IOException("signed_json_number_overflow");
        }
        return value;
    }
    private long longValue(String key)throws IOException {
        try{return Long.parseLong(values.get(key));}
        catch(NumberFormatException error){
            throw new IOException("signed_json_numeric_field_invalid");
        }
    }
    private S9MigratedSignedActionV198.Request decode()throws IOException {
        expect('{');
        while(true) {
            String key=text(32);
            if(!NAMES.contains(key) || values.containsKey(key))
                throw new IOException("signed_json_unknown_or_duplicate_field");
            expect(':');
            String value=NUMERIC.contains(key)?number():text(180);
            values.put(key,value);
            white();
            if(offset>=input.length)throw new IOException("signed_json_truncated");
            int terminator=input[offset++]&255;
            if(terminator=='}')break;
            if(terminator!=',')throw new IOException("signed_json_delimiter_invalid");
        }
        white();
        if(offset!=input.length || values.size()!=NAMES.size())
            throw new IOException("signed_json_missing_or_trailing_fields");
        return new S9MigratedSignedActionV198.Request(
            values.get("schema"),values.get("audience"),
            values.get("method"),values.get("route"),
            values.get("action"),values.get("name"),
            values.get("sourceSha256"),longValue("sourceBytes"),
            values.get("nonce"),longValue("expectedSequence"),
            values.get("expectedHeadSha256"),longValue("issuedAtMillis"),
            longValue("expiresAtMillis"),values.get("hmacSha256"));
    }
}
