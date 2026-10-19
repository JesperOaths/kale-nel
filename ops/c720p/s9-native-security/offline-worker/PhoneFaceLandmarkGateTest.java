package nl.kalenel.s9offline;
/** Deterministic, nonbiometric geometry regression; never loads real faces. */
public final class PhoneFaceLandmarkGateTest {
 static void require(boolean value,String why){if(!value)throw new AssertionError(why);}
 static final double[] REF={
  38.2946,51.6963,73.5318,51.5014,56.0252,71.7366,
  41.5493,92.3655,70.7299,92.2041
 };
 static double[] synthetic() {
  double[] p=REF.clone();
  for(int i=0;i<p.length;i+=2){
   p[i]=56+(p[i]-56)*.85;
   p[i+1]=56+(p[i+1]-56)*.85;
  }
  return p;
 }
 public static void main(String[] args){
  double[] ok=synthetic();
  PhoneFaceLandmarkGate.Verdict pass=PhoneFaceLandmarkGate.assess(ok,112,112,.94);
  require(pass.accepted&&pass.sourceTo112!=null,"valid measured landmarks should align");
  double[] transform=pass.sourceTo112;
  for(int i=0;i<5;i++){
   double u=transform[0]*ok[i*2]+transform[1]*ok[i*2+1]+transform[2];
   double v=transform[3]*ok[i*2]+transform[4]*ok[i*2+1]+transform[5];
   require(Math.hypot(u-REF[2*i],v-REF[2*i+1])<.02,"unaligned geometry");
  }
  require(!PhoneFaceLandmarkGate.assess(ok,112,112,.7).accepted,
       "a weak detector cannot verify landmarks");
  double[] small=ok.clone();
  for(int i=0;i<5;i++){small[2*i]=56+(small[2*i]-56)*.35;
                             small[2*i+1]=56+(small[2*i+1]-56)*.35;}
  require(!PhoneFaceLandmarkGate.assess(small,112,112,.95).accepted,
       "upscaled tiny original must not pass native eye-detail gate");
  double[] mirror=ok.clone();
  double eyeX=mirror[0];mirror[0]=mirror[2];mirror[2]=eyeX;
  require(!PhoneFaceLandmarkGate.assess(mirror,112,112,.95).accepted,
       "unordered mirrored face disallowed");
  double[] outside=ok.clone();outside[4]=-1;
  require(!PhoneFaceLandmarkGate.assess(outside,112,112,.95).accepted,
       "clipped face landmark cannot pass");
  double[] falseMouth=ok.clone();falseMouth[7]=ok[3]-4;
  require(!PhoneFaceLandmarkGate.assess(falseMouth,112,112,.95).accepted,
       "impossible mouth must be rejected");
  double[] nan=ok.clone();nan[5]=Double.NaN;
  require(!PhoneFaceLandmarkGate.assess(nan,112,112,.95).accepted,
       "nonfinite landmark must not pass");
  require(!PhoneFaceLandmarkGate.assess(ok,112,112,Double.NaN).accepted,
       "invalid detector confidence");
  require(!PhoneFaceLandmarkGate.assess(null,112,112,.95).accepted,
       "missing five-point detector output cannot be fabricated");
  System.out.println("S9_TRUE_FIVE_POINT_FACE_GEOMETRY_SYNTHETIC_PASS");
 }
}
