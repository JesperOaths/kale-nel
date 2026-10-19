package nl.kalenel.s9offline;
import java.util.*;
public final class PhoneAutomaticPersonMatcherTest {
 static final String SHA="a".repeat(64),B="b".repeat(64);
 static float[] vector(float x,float y){float[] out=new float[512];out[0]=x;out[1]=y;return out;}
 static PhoneAutomaticPersonMatcher.Face face(String clip,String folder,float x,float y,boolean approved,boolean aligned){
  return new PhoneAutomaticPersonMatcher.Face("sd",clip,folder,B,SHA,vector(x,y),aligned,approved);
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
  System.out.println("S9_AUTOMATIC_PERSON_MATCHER_SYNTHETIC_PASS");
 }
}
