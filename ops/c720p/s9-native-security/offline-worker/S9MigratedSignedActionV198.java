package nl.kalenel.s9offline;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/**
 * SOURCE-ONLY cryptographic gate for a FUTURE separately authenticated action
 * service. No listener, JSON parser, production key, Camera2/HA route or file IO.
 *
 * The trusted C720P relay must FIRST authorize the logged-in human intent and
 * sign the exact metadata-only request with a dedicated server-held key.
 * The phone must then independently prove its on-phone source manifest SHA
 * before asking V197 to update S9 journal + internal anchor.
 *
 * Nonce and current anchor provide durable replay/stale protection in V197.
 * Time checks are an additional guard and FAIL CLOSED if S9/relay clocks are
 * not sufficiently synchronized. Signing alone does NOT prove on-phone media.
 */
public final class S9MigratedSignedActionV198 implements AutoCloseable {
    private static final String SCHEMA="s9_c720p_migrated_action_auth_v198";
    private static final String AUDIENCE="s9-microsd-metadata-only";
    private static final String ROUTE="/c720p/migrated/action";
    private static final String METHOD="POST";
    private static final long MAX_LIFETIME_MS=120_000L;
    private static final long FUTURE_SKEW_MS=30_000L;
    private static final Pattern NAME=Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,139}\\.mp4");
    private static final Pattern HEX64=Pattern.compile("[a-f0-9]{64}");
    private static final Pattern HEX32=Pattern.compile("[a-f0-9]{32}");
    private final byte[] secret;
    private final SecretKey signingKey;
    private boolean closed;

    /** Immutable parsed request; parser MUST reject duplicate/unknown fields. */
    public static final class Request {
        public final String schema,audience,method,route,action,name;
        public final String sourceSha256,nonce,expectedHeadSha256,hmacSha256;
        public final long sourceBytes,expectedSequence,issuedAtMillis,expiresAtMillis;

        public Request(String schema,String audience,String method,String route,
                String action,String name,String sha,long bytes,String nonce,
                long expectedSequence,String expectedHead,long issued,long expires,
                String hmac) {
            this.schema=schema;this.audience=audience;this.method=method;
            this.route=route;this.action=action;this.name=name;
            this.sourceSha256=sha;this.sourceBytes=bytes;this.nonce=nonce;
            this.expectedSequence=expectedSequence;
            this.expectedHeadSha256=expectedHead;
            this.issuedAtMillis=issued;this.expiresAtMillis=expires;
            this.hmacSha256=hmac;
        }
    }

    /** Only returned after exact constant-time tag and time window checks. */
    public static final class Verified {
        public final String action,name,sourceSha256,nonce,expectedHeadSha256;
        public final long sourceBytes,expectedSequence;
        private Verified(Request r) {
            action=r.action;name=r.name;sourceSha256=r.sourceSha256;
            nonce=r.nonce;expectedHeadSha256=r.expectedHeadSha256;
            sourceBytes=r.sourceBytes;expectedSequence=r.expectedSequence;
        }
        public boolean mayRemoveOriginal(){return false;}
        public boolean isActualMediaSourceVerified(){return false;}
        public boolean createsPersonAssignment(){return false;}
    }

    public S9MigratedSignedActionV198(byte[] key)throws IOException {
        if (key==null || key.length<32)
            throw new IOException("authenticated_relay_action_key_missing");
        secret=Arrays.copyOf(key,key.length);
        signingKey=new SecretKeySpec(secret,"HmacSHA256");
    }

    /**
     * Future app-private Android Keystore signer. Never export raw HMAC key
     * bytes. The owning service must separately enforce caller identity,
     * stable wall-clock confidence, authority and key-domain separation.
     * No key is provisioned, installed or exposed by this class.
     */
    public S9MigratedSignedActionV198(SecretKey key)throws IOException {
        if(key==null || !"HmacSHA256".equalsIgnoreCase(key.getAlgorithm()))
            throw new IOException("authenticated_relay_keystore_hmac_required");
        secret=null;
        signingKey=key;
    }

    public synchronized Verified verify(Request r,long trustedPhoneMillis)
            throws IOException {
        if(closed)throw new IOException("action_verifier_closed");
        if(r==null || !SCHEMA.equals(r.schema) || !AUDIENCE.equals(r.audience)
                || !METHOD.equals(r.method) || !ROUTE.equals(r.route)
                || (!"save".equals(r.action) && !"delete".equals(r.action))
                || r.name==null || !NAME.matcher(r.name).matches()
                || r.name.contains("..") || !isHex64(r.sourceSha256)
                || r.sourceBytes<10_000 || r.sourceBytes>900L*1024*1024
                || r.nonce==null || !HEX32.matcher(r.nonce).matches()
                || r.expectedSequence<0 || r.expectedSequence>5000
                || !isHex64(r.expectedHeadSha256) || !isHex64(r.hmacSha256))
            throw new IOException("signed_action_fields_untrusted");
        if (trustedPhoneMillis<=0 || r.issuedAtMillis<=0
                || r.expiresAtMillis<=r.issuedAtMillis
                || r.expiresAtMillis-r.issuedAtMillis>MAX_LIFETIME_MS
                || r.issuedAtMillis>trustedPhoneMillis+FUTURE_SKEW_MS
                || trustedPhoneMillis>r.expiresAtMillis)
            throw new IOException("signed_action_expired_or_phone_clock_untrusted");
        String calculated;
        try {calculated=signBody(r);} catch(GeneralSecurityException e) {
            throw new IOException("action_crypto_unavailable");
        }
        if (!MessageDigest.isEqual(calculated.getBytes(StandardCharsets.US_ASCII),
                r.hmacSha256.getBytes(StandardCharsets.US_ASCII)))
            throw new IOException("signed_action_hmac_invalid");
        return new Verified(r);
    }

    private static boolean isHex64(String v) {
        return v!=null && HEX64.matcher(v).matches();
    }
    /** No attacker-controlled separator survives the strict field validators. */
    private static String canonical(Request r) {
        return SCHEMA+"|"+AUDIENCE+"|"+METHOD+"|"+ROUTE+"|"
          +r.action+"|"+r.name+"|"+r.sourceSha256+"|"+r.sourceBytes
          +"|"+r.nonce+"|"+r.expectedSequence+"|"+r.expectedHeadSha256
          +"|"+r.issuedAtMillis+"|"+r.expiresAtMillis;
    }
    private String signBody(Request r)throws GeneralSecurityException {
        Mac h=Mac.getInstance("HmacSHA256");
        h.init(signingKey);
        byte[] raw=h.doFinal(canonical(r).getBytes(StandardCharsets.US_ASCII));
        char[] alphabet="0123456789abcdef".toCharArray();
        char[] chars=new char[raw.length*2];
        for(int i=0;i<raw.length;i++) {
            chars[i*2]=alphabet[(raw[i]>>4)&15];
            chars[i*2+1]=alphabet[raw[i]&15];
        }
        return new String(chars);
    }
    /** Test-only fixture signer. No public production signing API. */
    synchronized String signForHostTestOnly(Request request)throws Exception {
        return signBody(request);
    }
    @Override public synchronized void close() {
        if(secret!=null)Arrays.fill(secret,(byte)0);
        closed=true;
    }
}
