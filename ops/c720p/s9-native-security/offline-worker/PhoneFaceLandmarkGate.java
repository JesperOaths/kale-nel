package nl.kalenel.s9offline;

/**
 * Exact native-pixel, five-landmark eligibility and similarity alignment.
 * This has NO detector, face image reader, identity score, archive writer or
 * enrollment side effect. A real pinned landmark detector must supply the
 * five measured points, in image-left-to-right order, before using this gate.
 */
public final class PhoneFaceLandmarkGate {
  private PhoneFaceLandmarkGate() {}
  private static final double[] TARGET={
    38.2946,51.6963, 73.5318,51.5014, 56.0252,71.7366,
    41.5493,92.3655, 70.7299,92.2041
  };
  public static final class Verdict {
    public final boolean accepted;
    public final String reason;
    /** Maps original native-pixel coordinates to the 112x112 alignment canvas. */
    public final double[] sourceTo112;
    private Verdict(boolean yes,String why,double[] transform) {
      accepted=yes;reason=why;
      sourceTo112=transform==null?null:transform.clone();
    }
  }
  private static Verdict deny(String why){return new Verdict(false,why,null);}
  /**
   * @param p 5 authentic measured points in image pixels:
   *          image-left eye, image-right eye, nose, image-left mouth,
   *          image-right mouth. Never approximate using a face box/midpoint.
   * @param width,height Dimensions of the ORIGINAL unscaled source bitmap.
   */
  public static Verdict assess(double[] p,int width,int height,double confidence) {
    if(p==null||p.length!=10||width<70||height<70
       ||width>8192||height>8192||!Double.isFinite(confidence)
       ||confidence<.86||confidence>1)return deny("not_verified_detector_output");
    for(int i=0;i<5;i++){
      if(!Double.isFinite(p[2*i])||!Double.isFinite(p[2*i+1])
          ||p[2*i]<2||p[2*i]>width-3
          ||p[2*i+1]<2||p[2*i+1]>height-3)
        return deny("invalid_or_clipped_landmark");
    }
    double dx=p[2]-p[0],dy=p[3]-p[1],eye=Math.hypot(dx,dy);
    // The 22px native eye-distance rule is evaluated BEFORE any resizing.
    if(eye<22||eye>Math.min(width,height)*.68)
      return deny("insufficient_native_eye_detail");
    if(p[0]>=p[2]||p[6]>=p[8])
      return deny("mirrored_or_unordered_landmarks");
    double roll=Math.abs(Math.atan2(dy,dx));
    if(roll>Math.toRadians(18))return deny("excessive_roll");
    double eyeY=(p[1]+p[3])/2,eyeX=(p[0]+p[2])/2;
    double mouthY=(p[7]+p[9])/2,mouthX=(p[6]+p[8])/2;
    if(p[5]-eyeY<.18*eye||p[5]-eyeY>1.4*eye
       ||mouthY-p[5]<.17*eye||mouthY-p[5]>1.35*eye
       ||Math.abs(p[4]-eyeX)>.43*eye
       ||Math.abs(mouthX-eyeX)>.45*eye
       ||Math.hypot(p[8]-p[6],p[9]-p[7])<.38*eye)
      return deny("implausible_five_point_geometry");
    double xbar=0,ybar=0,ubar=0,vbar=0;
    for(int i=0;i<5;i++){
      xbar+=p[2*i];ybar+=p[2*i+1];
      ubar+=TARGET[2*i];vbar+=TARGET[2*i+1];
    }
    xbar/=5;ybar/=5;ubar/=5;vbar/=5;
    double numerA=0,numerB=0,denom=0;
    for(int i=0;i<5;i++){
      double x=p[2*i]-xbar,y=p[2*i+1]-ybar;
      double u=TARGET[2*i]-ubar,v=TARGET[2*i+1]-vbar;
      numerA+=x*u+y*v;numerB+=x*v-y*u;denom+=x*x+y*y;
    }
    if(denom<1e-7)return deny("degenerate_landmarks");
    double a=numerA/denom,b=numerB/denom;
    double scale=Math.hypot(a,b),tx=ubar-a*xbar+b*ybar,ty=vbar-b*xbar-a*ybar;
    if(!Double.isFinite(scale)||scale<.25||scale>6
       ||!Double.isFinite(tx)||!Double.isFinite(ty))
      return deny("unstable_similarity_transform");
    double residual=0;
    for(int i=0;i<5;i++){
      double xx=a*p[2*i]-b*p[2*i+1]+tx-TARGET[2*i];
      double yy=b*p[2*i]+a*p[2*i+1]+ty-TARGET[2*i+1];
      residual+=xx*xx+yy*yy;
    }
    if(Math.sqrt(residual/5)>8.0)
      return deny("poor_landmark_alignment_fit");
    return new Verdict(true,"five_points_geometry_accepted",
       new double[]{a,-b,tx,b,a,ty});
  }
}
