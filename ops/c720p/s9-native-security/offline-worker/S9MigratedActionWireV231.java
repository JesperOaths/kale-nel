package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Source-only, transport-neutral decoder for a future authenticated S9+ service.
 *
 * This does NOT listen, authenticate a human, check a source, sign, enroll,
 * commit a journal, own a phone UID, delete media or install an APK. Callers
 * MUST additionally perform Android-UID/route authorization, V198 cryptographic
 * verification, V201 independent human approval and V197 source-qualified
 * durable journal/checkpoint commit. Body bytes alone grant NOTHING.
 *
 * Format: exactly 14 fixed-ordered ASCII key=value lines with final LF.
 * There is deliberately no JSON coercion, duplicate-key choice, URI decoding,
 * browser-controlled clock, default value or unknown-field tolerance.
 */
public final class S9MigratedActionWireV231 {
    private static final int MAX_BYTES=3072;
    private static final String[] KEYS=new String[]{
        "schema","audience","method","route","action","name",
        "source_sha256","source_bytes","nonce","expected_sequence",
        "expected_head_sha256","issued_at_ms","expires_at_ms","hmac_sha256"
    };
    private S9MigratedActionWireV231(){}

    private static long exactUnsigned(String raw,String label)throws IOException {
        if(raw==null || raw.length()<1 || raw.length()>18)
            throw new IOException("wire_number_untrusted_"+label);
        for(int i=0;i<raw.length();i++)
            if(raw.charAt(i)<'0' || raw.charAt(i)>'9')
                throw new IOException("wire_number_untrusted_"+label);
        try{return Long.parseLong(raw);}
        catch(NumberFormatException error){
            throw new IOException("wire_number_overflow_"+label);
        }
    }

    public static S9MigratedSignedActionV198.Request decode(byte[] body)
            throws IOException {
        if(body==null || body.length<150 || body.length>MAX_BYTES)
            throw new IOException("wire_action_body_size_invalid");
        for(byte b:body){
            int value=b&255;
            if(value!=10 && (value<33 || value>126))
                throw new IOException("wire_ascii_or_control_character_invalid");
        }
        if(body[body.length-1]!=10)
            throw new IOException("wire_missing_terminal_lf");
        String raw=new String(body,StandardCharsets.US_ASCII);
        String[] lines=raw.substring(0,raw.length()-1).split("\n",-1);
        if(lines.length!=KEYS.length)
            throw new IOException("wire_fields_count_invalid");
        String[] values=new String[KEYS.length];
        for(int i=0;i<KEYS.length;i++){
            String expected=KEYS[i]+"=";
            if(!lines[i].startsWith(expected) ||
                    lines[i].length()==expected.length() ||
                    lines[i].indexOf('=',expected.length())!=-1)
                throw new IOException("wire_field_order_or_value_invalid");
            values[i]=lines[i].substring(expected.length());
        }
        return new S9MigratedSignedActionV198.Request(
            values[0],values[1],values[2],values[3],values[4],values[5],
            values[6],exactUnsigned(values[7],"source_bytes"),values[8],
            exactUnsigned(values[9],"sequence"),values[10],
            exactUnsigned(values[11],"issued_at"),
            exactUnsigned(values[12],"expires_at"),values[13]);
    }
    public static boolean enablesNetworkTransport(){return false;}
    public static boolean mayRemoveMedia(){return false;}
    public static boolean approvesUser(){return false;}
    public static boolean createsKeys(){return false;}
}
