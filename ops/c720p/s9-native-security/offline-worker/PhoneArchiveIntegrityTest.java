package nl.kalenel.s9security;

import java.io.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import org.json.JSONObject;

/** Standalone JVM regressions; no camera, network or original user media. */
public final class PhoneArchiveIntegrityTest {
 static final String NAME="motion_1792000000000.mp4";
 static void require(boolean condition,String msg){if(!condition)throw new AssertionError(msg);}
 static String sha(byte[] data)throws Exception{
  byte[] digest=MessageDigest.getInstance("SHA-256").digest(data);
  StringBuilder b=new StringBuilder();
  for(byte c:digest)b.append(String.format("%02x",c&255));
  return b.toString();
 }
 static File[] fakeArchive()throws Exception{
  File root=Files.createTempDirectory("s9-hash-contract").toFile();
  byte[] video=new byte[160001];Arrays.fill(video,(byte)21);
  File mp4=new File(root,NAME);
  try(FileOutputStream out=new FileOutputStream(mp4)){out.write(video);}
  JSONObject manifest=new JSONObject().put("name",NAME).put("bytes",mp4.length())
    .put("width",3840).put("height",2160).put("sha256",sha(video));
  File sidecar=new File(root,NAME+".verified.json");
  try(FileOutputStream out=new FileOutputStream(sidecar)){
   out.write(manifest.toString().getBytes("UTF-8"));
  }
  return new File[]{root,mp4,sidecar};
 }
 static void cleanup(File[] files){
  files[1].delete();files[2].delete();files[0].delete();
 }
 public static void main(String[] args)throws Exception{
  File[] files=fakeArchive();
  try{
   PhoneArchiveIntegrity.Gate open=()->true;
   JSONObject ok=PhoneArchiveIntegrity.audit(files[0],NAME,open);
   require(ok.getBoolean("ok")&&ok.getBoolean("sha256_matches_verified_manifest"),
       "verified digest should match");
   require(!ok.getBoolean("media_deleted_or_quarantined"),"cannot alter retention state");
   require(files[1].isFile()&&files[2].isFile(),"original and sidecar must remain");
   try(RandomAccessFile rw=new RandomAccessFile(files[1],"rw")){
    rw.seek(100);rw.write(123);
   }
   JSONObject mismatch=PhoneArchiveIntegrity.audit(files[0],NAME,open);
   require(!mismatch.getBoolean("sha256_matches_verified_manifest"),"tampering must be reported");
   require(files[1].isFile(),"never delete an anomalous original");
   boolean cancelled=false;
   try{PhoneArchiveIntegrity.audit(files[0],NAME,()->false);}
   catch(InterruptedIOException expected){cancelled=true;}
   require(cancelled,"camera activity should cancel hashing");
   ByteArrayOutputStream invalid=new ByteArrayOutputStream();
   require(PhoneArchiveIntegrity.handle(invalid,"GET /archive/integrity?clip=../x.mp4 HTTP/1.1",
       files[0],open),"bad route must be claimed by integrity handler");
   require(invalid.toString("UTF-8").startsWith("HTTP/1.1 400"),"reject traversal");
   ByteArrayOutputStream blocked=new ByteArrayOutputStream();
   require(PhoneArchiveIntegrity.handle(blocked,"GET /archive/integrity?clip="+NAME+" HTTP/1.1",
       files[0],()->false),"blocked request recognized");
   require(blocked.toString("UTF-8").startsWith("HTTP/1.1 503"),"fail closed under capture priority");
   require(files[1].isFile()&&files[2].isFile(),"review never changes user files");
  }finally{cleanup(files);}
  System.out.println("S9_ORIGINAL_INTEGRITY_READONLY_PASS");
 }
}
