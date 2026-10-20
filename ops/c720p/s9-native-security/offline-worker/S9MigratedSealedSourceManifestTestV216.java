package nl.kalenel.s9offline;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.crypto.*;
import javax.crypto.spec.SecretKeySpec;
public final class S9MigratedSealedSourceManifestTestV216 {
 static String many(char x,int n){char[] a=new char[n];Arrays.fill(a,x);return new String(a);}
 static SecretKey key=new SecretKeySpec(many('k',48).getBytes(StandardCharsets.US_ASCII),"HmacSHA256");
 static String a="motion_1792800000000.mp4",b="motion_1792800001000.mp4";
 static String body(int generation){return "S9-MIGRATED-MANIFEST-V216|"+generation+"|2\n"+
  "FILE|"+a+"|"+many('a',64)+"|12000|1\n"+
  "FILE|"+b+"|"+many('b',64)+"|13000|1\n";}
 static String sign(String payload)throws Exception{
  Mac h=Mac.getInstance("HmacSHA256");h.init(key);
  StringBuilder out=new StringBuilder();
  for(byte c:h.doFinal(payload.getBytes(StandardCharsets.US_ASCII)))
   out.append(Character.forDigit((c>>>4)&15,16)).append(Character.forDigit(c&15,16));
  return payload+"HMAC|"+out+"\n";
 }
 static void check(boolean b)throws Exception{if(!b)throw new Exception("host_regression_failure");}
 static void denied(Path root,SecretKey signer,long generation)throws Exception{
  try{S9MigratedSealedSourceManifestV216.verifyExisting(root.toFile(),signer,generation);
   throw new Exception("unexpected_validity");}
  catch(java.io.IOException accepted){}
 }
 public static void main(String[] args)throws Exception{
  check(args.length==0);
  Path root=Files.createTempDirectory("s9-source-manifest-host-");
  Path file=root.resolve(S9MigratedSealedSourceManifestV216.FILE_NAME);
  String valid=sign(body(8));
  Files.write(file,valid.getBytes(StandardCharsets.US_ASCII));
  S9MigratedSealedSourceManifestV216.Verified checked=
   S9MigratedSealedSourceManifestV216.verifyExisting(root.toFile(),key,8);
  check(checked.generation==8 && checked.sourceRows.size()==2);
  check(checked.sourceRows.get(a).bytes==12000 && checked.sourceRows.get(b).copiedAndIndexed);
  check(!checked.permitsLocalDeletion() && !checked.grantsRemoteSaveDelete());
  denied(root,key,9);
  Files.write(file,valid.replace("|12000|","|12001|").getBytes(StandardCharsets.US_ASCII));
  denied(root,key,8);
  Files.write(file,sign(body(8).replace("|13000|","|0|")).getBytes(StandardCharsets.US_ASCII));
  denied(root,key,8);
  SecretKey other=new SecretKeySpec(many('x',48).getBytes(StandardCharsets.US_ASCII),"HmacSHA256");
  Files.write(file,valid.getBytes(StandardCharsets.US_ASCII));
  denied(root,other,8);
  System.out.println("S9_SEALED_MANIFEST_V216_HOST_VERIFIED");
 }
}
