#!/usr/bin/env python3
"""Host-only Android UID/owner/anchor fail-closed orchestration verification.

JVM test stubs replace Android and metadata dependencies ONLY in this fixture.
A separate real Android SDK compile test covers the actual library ABI. This
test cannot attest production AndroidKeyStore, media, caller sessions or phone.
"""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
ANDROID = {
"android/content/pm/ApplicationInfo.java": """package android.content.pm;
public class ApplicationInfo { public int uid; }""",
"android/content/Context.java": """package android.content;
import android.content.pm.ApplicationInfo;
public class Context {
 public final ApplicationInfo info=new ApplicationInfo();
 public String name="nl.kalenel.s9migrated";
 public Context getApplicationContext(){return this;}
 public ApplicationInfo getApplicationInfo(){return info;}
 public String getPackageName(){return name;}
}""",
"android/os/Process.java": """package android.os;
public class Process {
 public static final int SHELL_UID=2000;
 public static int uid=4000;
 public static int myUid(){return uid;}
}""",
"android/os/Binder.java": """package android.os;
public class Binder {
 public static int calling=4000;
 public static int getCallingUid(){return calling;}
}""",
}

FAKES = r"""
package nl.kalenel.s9offline;
import android.content.Context;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

class S9MigratedVerifiedSourceV198 {
 public static class Proof {}
}
class S9MigratedSealedSourceManifestV216 {
 public static class Verified {
  public long generation=1L;
  public Map<String,S9MigratedVerifiedSourceV198.Proof> sourceRows=
      new LinkedHashMap<String,S9MigratedVerifiedSourceV198.Proof>();
  public Verified(){
   for(int i=0;i<6;i++)
    sourceRows.put("synthetic_"+i+".mp4",new S9MigratedVerifiedSourceV198.Proof());
  }
 }
}
class S9MigratedCompanionBootReadinessV229 {
 public static int calls;
 public static class Assessment {
  public long trustedSourceGeneration=1L;
  public long trustedLedgerSequence=0L;
  public String trustedLedgerHeadSha256=Fixture.rep('b',64);
  public int approvedSourceCount=6,savedMetadataCount=0;
  public int deletedTombstoneCount=0,withoutRemoteDecisionCount=6;
 }
 public static Assessment inspectExistingOnly(Context c,File f,long generation,
       String digest)throws IOException{
   calls++;
   if(generation!=1L || !digest.equals(Fixture.rep('a',64)))
    throw new IOException("fake_boot_rejected");
   return new Assessment();
 }
}
class S9MigratedManifestKeyCustodyV227 {
 public static int calls;
 public static class Existing {
  public final File privateFilesDir=new File("/synthetic/private");
  public final Object internalCheckpoint=new Object(),microSdJournal=new Object();
  public S9MigratedSealedSourceManifestV216.Verified
     verifyAlreadyEnrolled(long generation)throws IOException{
   if(generation!=1L)throw new IOException("bad_generation");
   return new S9MigratedSealedSourceManifestV216.Verified();
  }
 }
 public static Existing openExisting(Context context)throws IOException{
  calls++;
  return new Existing();
 }
}
class S9MigratedApprovedSixDigestV230 {
 public static int calls;
 public static void requireSealedManifestEqualsEnrollment(
   S9MigratedSealedSourceManifestV216.Verified src,String digest)throws IOException {
   calls++;
   if(src.generation!=1L || !digest.equals(Fixture.rep('a',64)))
    throw new IOException("independent_anchor_mismatch");
 }
}
class S9MigratedDualStoreCommitV197 implements AutoCloseable {
 public static int openings;
 public S9MigratedDualStoreCommitV197(File app,File sd,Object checkpoint,Object journal)
         throws IOException {openings++;}
 public void close(){}
}
class S9MigratedReadOnlyStateV225 {
 public static boolean forceHeadChange=false;
 public static int reads;
 public static class Row {
  public String name,status;
  public Row(String n,String state){name=n;status=state;}
 }
 public static class Snapshot {
  public long manifestGeneration=1L,journalSequence=0L;
  public String journalHeadSha256=Fixture.rep('b',64);
  public Map<String,Row> rows=new LinkedHashMap<String,Row>();
 }
 public static Snapshot readForAuthenticatedOwner(
     S9MigratedSealedSourceManifestV216.Verified src,
     S9MigratedDualStoreCommitV197 journal)throws IOException{
  reads++;
  Snapshot snap=new Snapshot();
  for(String n:src.sourceRows.keySet())snap.rows.put(n,new Row(n,"no_remote_decision"));
  if(forceHeadChange)snap.journalHeadSha256=Fixture.rep('c',64);
  return snap;
 }
}
class S9MigratedReadOnlyStateEnvelopeV229 {
 public static int encoded;
 public static byte[] encodeVerified(S9MigratedReadOnlyStateV225.Snapshot snap,
                         String challenge)throws IOException {
  encoded++;
  if(snap.rows.size()!=6)throw new IOException("wrong_rows");
  return ("synthetic_read_only_challenge="+challenge).getBytes(StandardCharsets.US_ASCII);
 }
}
public final class Fixture {
 public static String rep(char c,int len){
  char[] b=new char[len];java.util.Arrays.fill(b,c);return new String(b);
 }
 private static int authCalls;
 private static int anchorCalls;
 private static int minimumCalls;
 @FunctionalInterface interface Action {void call()throws Exception;}
 static void refuse(Action action,String reason)throws Exception{
  try{action.call();throw new AssertionError("FAIL_OPEN_"+reason);}
  catch(IOException expected){}
 }
 private static S9MigratedAndroidOwnerReadGatewayV235.IndependentlyAnchoredEnrollment
 trusted(){
  return new S9MigratedAndroidOwnerReadGatewayV235.IndependentlyAnchoredEnrollment(){
   public String approvedSixOriginalPreimageSha256(){anchorCalls++;return rep('a',64);}
   public long minimumSourceGeneration(){minimumCalls++;return 1L;}
  };
 }
 public static void main(String[] args)throws Exception {
  if(args.length!=0)throw new AssertionError("unexpected_args");
  final android.content.Context app=new android.content.Context();
  app.info.uid=4000;
  final File dummySd=new File("/synthetic/microsd/c720p-migrated-metadata");
  final String challenge=rep('d',32);
  final S9MigratedAndroidOwnerReadGatewayV235 gateway=null;
  final S9MigratedAndroidOwnerReadGatewayV235.AuthenticatedInAppOwner owner=
     (p,uid,c)->{authCalls++;return uid==4000 && p.equals("nl.kalenel.s9migrated")
                                      && challenge.equals(c);};

  android.os.Binder.calling=4444;
  refuse(()->S9MigratedAndroidOwnerReadGatewayV235.readExistingOnly(
    app,dummySd,challenge,trusted(),owner),"foreign_binder_uid");
  if(authCalls!=0||anchorCalls!=0||
     S9MigratedCompanionBootReadinessV229.calls!=0)
    throw new AssertionError("foreign_uid_reached_authority");

  android.os.Binder.calling=4000;
  app.name="nl.kalenel.s9security";
  refuse(()->S9MigratedAndroidOwnerReadGatewayV235.readExistingOnly(
    app,dummySd,challenge,trusted(),owner),"wrong_camera2_app");
  app.name="nl.kalenel.s9migrated";
  android.os.Process.uid=2000;app.info.uid=2000;
  android.os.Binder.calling=2000;
  refuse(()->S9MigratedAndroidOwnerReadGatewayV235.readExistingOnly(
    app,dummySd,challenge,trusted(),owner),"shell_uid");
  android.os.Process.uid=4000;app.info.uid=4000;
  android.os.Binder.calling=4000;

  refuse(()->S9MigratedAndroidOwnerReadGatewayV235.readExistingOnly(
    app,dummySd,"browser_not_hex",trusted(),owner),"untrusted_challenge");
  refuse(()->S9MigratedAndroidOwnerReadGatewayV235.readExistingOnly(
    app,dummySd,challenge,trusted(),(p,u,c)->false),"owner_denied");
  if(anchorCalls!=0 || S9MigratedCompanionBootReadinessV229.calls!=0)
    throw new AssertionError("owner_denial_reached_boot_or_digest");

  final S9MigratedAndroidOwnerReadGatewayV235.IndependentlyAnchoredEnrollment
    malformed=new S9MigratedAndroidOwnerReadGatewayV235.IndependentlyAnchoredEnrollment(){
      public String approvedSixOriginalPreimageSha256(){return "not-a-digest";}
      public long minimumSourceGeneration(){return 1L;}
    };
  refuse(()->S9MigratedAndroidOwnerReadGatewayV235.readExistingOnly(
     app,dummySd,challenge,malformed,owner),"bad_trust_anchor");
  if(S9MigratedCompanionBootReadinessV229.calls!=0)
    throw new AssertionError("invalid_anchor_reached_journal");

  S9MigratedReadOnlyStateV225.forceHeadChange=true;
  refuse(()->S9MigratedAndroidOwnerReadGatewayV235.readExistingOnly(
     app,dummySd,challenge,trusted(),owner),"head_changed_after_boot");
  if(S9MigratedReadOnlyStateEnvelopeV229.encoded!=0)
    throw new AssertionError("changed_head_emitted_trusted_envelope");
  S9MigratedReadOnlyStateV225.forceHeadChange=false;
  byte[] body=S9MigratedAndroidOwnerReadGatewayV235.readExistingOnly(
    app,dummySd,challenge,trusted(),owner);
  if(!new String(body,StandardCharsets.US_ASCII).equals(
       "synthetic_read_only_challenge="+challenge) ||
       S9MigratedReadOnlyStateEnvelopeV229.encoded!=1 ||
       S9MigratedManifestKeyCustodyV227.calls!=2 ||
       S9MigratedApprovedSixDigestV230.calls!=2)
    throw new AssertionError("fake_enrolled_read_gateway_not_composed");
  System.out.println("S9_V235_OWNER_UID_ANCHOR_HEAD_DENIAL_TEST_OK"+
       " synthetic_android_only=true original_media_untouched=true");
 }
}
"""

class Tests(unittest.TestCase):
 def test_independent_owner_denials(self):
  with tempfile.TemporaryDirectory(prefix="s9-owner-gateway-v235-fake-") as tmp:
   temp=pathlib.Path(tmp)
   sources=[]
   for name,source in ANDROID.items():
    target=temp/name
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(source)
    sources.append(str(target))
   fake=temp/"nl/kalenel/s9offline/Fixture.java"
   fake.parent.mkdir(parents=True,exist_ok=True)
   fake.write_text(FAKES)
   sources.append(str(fake))
   sources.append(str(ROOT/"S9MigratedAndroidOwnerReadGatewayV235.java"))
   classes=temp/"classes";classes.mkdir()
   compiler=subprocess.run(["javac","-source","8","-target","8","-d",str(classes),
                           *sources],capture_output=True,text=True,timeout=50)
   self.assertEqual(compiler.returncode,0,compiler.stderr)
   invoked=subprocess.run(["java","-cp",str(classes),
          "nl.kalenel.s9offline.Fixture"],capture_output=True,text=True,timeout=15)
   self.assertEqual(invoked.returncode,0,invoked.stderr)
   self.assertIn("S9_V235_OWNER_UID_ANCHOR_HEAD_DENIAL_TEST_OK",invoked.stdout)
if __name__=="__main__":unittest.main(verbosity=2)
