package nl.kalenel.s9offline;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Host-only parity oracle: use the exact production V230 canonical generator
 * on six purely synthetic rows. No source file, Android phone or signing key.
 */
public final class S9MigratedCrosscheckParityTestV235 {
    private static String repeat(char c,int n) {
        char[] a=new char[n];
        java.util.Arrays.fill(a,c);
        return new String(a);
    }
    public static void main(String[] args)throws Exception {
        if(args.length!=0)throw new IllegalArgumentException("synthetic_only");
        Map<String,S9MigratedVerifiedSourceV198.Proof> rows=
             new LinkedHashMap<String,S9MigratedVerifiedSourceV198.Proof>();
        for(int i=0;i<6;i++){
            String name="synthetic_179280000"+i+"000.mp4";
            long bytes=i==5?214121934L:12000L;
            rows.put(name,new S9MigratedVerifiedSourceV198.Proof(
                 name,repeat('a',64),bytes,true));
        }
        System.out.println(S9MigratedApprovedSixDigestV230.canonicalSha256(rows));
    }
}
