package nl.kalenel.s9offline;
import java.util.*;
public final class PhoneAutomaticPersonMatcherTest {
 static final String SHA="a".repeat(64),B="b".repeat(64);
 static float[] vector(float x,float y){float[] out=new float[512];out[0]=x;out[1]=y;return out;}
 static String snap(String clip,String folder){
  return String.format(Locale.ROOT,"%064x",
    Integer.toUnsignedLong((clip+"|"+String.valueOf(folder)).hashCode()));
 }
 static PhoneAutomaticPersonMatcher.Face face(String clip,String folder,float x,float y,boolean approved,boolean aligned){
  return new PhoneAutomaticPersonMatcher.Face("sd",clip,folder,
    snap(clip,folder),SHA,vector(x,y),aligned,approved,approved);
 }
 static PhoneAutomaticPersonMatcher.Face rawClipApproval(String clip,String folder){
  return new PhoneAutomaticPersonMatcher.Face("sd",clip,folder,
    snap(clip,folder),SHA,vector(1,0),true,true);
 }
 static void check(boolean pass,String issue){if(!pass)throw new AssertionError(issue);}
 public static void main(String[] args){
  String a="motion_1792200000000.mp4",b="motion_1792200060000.mp4";
  String c="motion_1792200120000.mp4",d="motion_1792200180000.mp4";
  PhoneAutomaticPersonMatcher.Face query=face(d,null,1,0,false,true);
  List<PhoneAutomaticPersonMatcher.Face> references=Arrays.asList(
    face(a,"G123",1,0,true,true),face(b,"G123",.99f,.01f,true,true),
    face(a,"G789",0,1,true,true),face(c,"G789",.03f,.97f,true,true));
  List<PhoneAutomaticPersonMatcher.Proposal> results=
    PhoneAutomaticPersonMatcher.rank(Arrays.asList(query),references,Set.of());
  check(results.size()==1&&results.get(0).folder.equals("G123"),"correct person proposal");
  check(results.get(0).referenceCount>=2&&!results.get(0).automaticAssignment,"human gate");
  check(PhoneAutomaticPersonMatcher.rank(List.of(query),references,Set.of(d)).isEmpty(),"already filed");
  check(PhoneAutomaticPersonMatcher.rank(List.of(query),List.of(references.get(0)),Set.of()).isEmpty(),"two references required");
  check(PhoneAutomaticPersonMatcher.rank(List.of(face(d,null,1,0,false,false)),references,Set.of()).isEmpty(),"unaligned head crop rejected");
  check(PhoneAutomaticPersonMatcher.rank(List.of(face(d,null,0,0,false,true)),references,Set.of()).isEmpty(),"zero vector rejected");
  List<PhoneAutomaticPersonMatcher.Face> impostors=Arrays.asList(
    face(a,"G123",1,0,true,true),face(b,"G123",1,0,true,true),
    face(a,"G789",1,0,true,true),face(c,"G789",1,0,true,true));
  check(PhoneAutomaticPersonMatcher.rank(List.of(query),impostors,Set.of()).isEmpty(),"ambiguous people rejected");
  // The original clip-level review alone does not establish which person's
  // face appears in a multi-person/group video.
  check(PhoneAutomaticPersonMatcher.rank(List.of(query),List.of(
    rawClipApproval(a,"G123"),rawClipApproval(b,"G123")),Set.of()).isEmpty(),
    "group clip-level approvals cannot turn into labeled face references");
  // Two historical clips carrying the SAME exact JPEG do not make two
  // independent face observations, even when each has a separate clip name.
  String repeated=snap(a,"G123");
  List<PhoneAutomaticPersonMatcher.Face> copied=List.of(
    new PhoneAutomaticPersonMatcher.Face("sd",a,"G123",repeated,SHA,
       vector(1,0),true,true,true),
    new PhoneAutomaticPersonMatcher.Face("sd",b,"G123",repeated,SHA,
       vector(1,0),true,true,true));
  check(PhoneAutomaticPersonMatcher.rank(List.of(query),copied,Set.of()).isEmpty(),
    "copied JPEG cannot masquerade as two independent references");
  // Contradictory manual folder membership for one face SHA must exclude
  // that crop for both people, not pick an arbitrary winner.
  List<PhoneAutomaticPersonMatcher.Face> confused=List.of(
    new PhoneAutomaticPersonMatcher.Face("sd",a,"G123",repeated,SHA,
       vector(1,0),true,true,true),
    new PhoneAutomaticPersonMatcher.Face("sd",b,"G789",repeated,SHA,
       vector(1,0),true,true,true),
    face(c,"G123",1,0,true,true));
  check(PhoneAutomaticPersonMatcher.rank(List.of(query),confused,Set.of()).isEmpty(),
    "a shared face cannot be proven to identify two distinct people");
  System.out.println("S9_AUTOMATIC_PERSON_MATCHER_SYNTHETIC_PASS");
 }
}
