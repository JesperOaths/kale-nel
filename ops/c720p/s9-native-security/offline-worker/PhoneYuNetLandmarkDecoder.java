package nl.kalenel.s9offline;
import java.util.*;

/**
 * Bounded decoder of the official YuNet 12-head ONNX face-landmark output.
 * No network, ONNX runtime, camera, image bytes, identity inference or writes.
 * Caller provides authentic model outputs for ONE independently verified
 * original square S9+ face snapshot, never invented detector landmarks.
 */
public final class PhoneYuNetLandmarkDecoder {
  private PhoneYuNetLandmarkDecoder() {}
  private static final int MODEL=640;
  private static final int[] STRIDES={8,16,32};
  public static final class Face {
    public final double confidence;
    public final double[] nativeLandmarks;
    public final PhoneFaceLandmarkGate.Verdict alignment;
    public final double[] nativeBox;
    private Face(double score,double[] p,double[] box,
                 PhoneFaceLandmarkGate.Verdict geometry){
      confidence=score;nativeLandmarks=p.clone();
      nativeBox=box.clone();alignment=geometry;
    }
  }
  private static float[][] head(Map<String,Object> heads,String key,int n,int depth){
    Object value=heads.get(key);
    if(!(value instanceof float[][][]))throw new IllegalArgumentException("missing_yunet_head");
    float[][][] tensor=(float[][][])value;
    if(tensor.length!=1||tensor[0].length!=n)
      throw new IllegalArgumentException("unexpected_yunet_head_shape");
    for(float[] x:tensor[0])
      if(x==null||x.length!=depth)
        throw new IllegalArgumentException("unexpected_yunet_head_channels");
    return tensor[0];
  }
  private static double bounded(float v){
    if(!Float.isFinite(v))return Double.NaN;
    return Math.max(0,Math.min(1,v));
  }
  private static double overlap(double[] a,double[] b){
    double xa=Math.max(a[0],b[0]),ya=Math.max(a[1],b[1]);
    double xb=Math.min(a[0]+a[2],b[0]+b[2]);
    double yb=Math.min(a[1]+a[3],b[1]+b[3]);
    double intersection=Math.max(0,xb-xa)*Math.max(0,yb-ya);
    double union=a[2]*a[3]+b[2]*b[3]-intersection;
    return union<=0?0:intersection/union;
  }
  /**
   * Exact FaceDetectorYN-style YuNet stride/keypoint decoding.
   * OpenCV model points are right eye, left eye, nose, right mouth, left
   * mouth (the two 'right' features are image-left in frontal photos).
   * The decoder MUST NOT swap guessed landmarks to force validation.
   */
  public static List<Face> decode(Map<String,Object> heads,int nativeWidth,int nativeHeight){
    if(heads==null||heads.size()!=12||nativeWidth!=nativeHeight
       ||nativeWidth<70||nativeWidth>4096)
      throw new IllegalArgumentException("untrusted_yunet_source_geometry");
    double ratio=nativeWidth/(double)MODEL;
    ArrayList<Face> candidates=new ArrayList<>();
    for(int stride:STRIDES){
      int cols=MODEL/stride,n=cols*cols;
      float[][] cls=head(heads,"cls_"+stride,n,1);
      float[][] obj=head(heads,"obj_"+stride,n,1);
      float[][] bbox=head(heads,"bbox_"+stride,n,4);
      float[][] kps=head(heads,"kps_"+stride,n,10);
      for(int idx=0;idx<n;idx++){
        double a=bounded(cls[idx][0]),b=bounded(obj[idx][0]);
        if(!Double.isFinite(a)||!Double.isFinite(b))continue;
        double score=Math.sqrt(a*b);
        if(score<.86)continue;
        int row=idx/cols,col=idx%cols;
        boolean finite=true;
        for(float x:bbox[idx])if(!Float.isFinite(x))finite=false;
        for(float x:kps[idx])if(!Float.isFinite(x))finite=false;
        if(!finite)continue;
        double w=Math.exp(bbox[idx][2])*stride*ratio;
        double h=Math.exp(bbox[idx][3])*stride*ratio;
        double cx=(col+bbox[idx][0])*stride*ratio;
        double cy=(row+bbox[idx][1])*stride*ratio;
        if(!Double.isFinite(w)||!Double.isFinite(h)||w<35||h<35
           ||w>nativeWidth*1.7||h>nativeHeight*1.7)continue;
        double[] box={cx-w/2,cy-h/2,w,h};
        double[] pts=new double[10];
        for(int i=0;i<5;i++){
          pts[2*i]=(col+kps[idx][2*i])*stride*ratio;
          pts[2*i+1]=(row+kps[idx][2*i+1])*stride*ratio;
        }
        PhoneFaceLandmarkGate.Verdict verdict=
          PhoneFaceLandmarkGate.assess(pts,nativeWidth,nativeHeight,score);
        if(!verdict.accepted)continue;
        candidates.add(new Face(score,pts,box,verdict));
        if(candidates.size()>180)throw new IllegalArgumentException("excessive_yunet_detections");
      }
    }
    candidates.sort((x,y)->Double.compare(y.confidence,x.confidence));
    ArrayList<Face> finalFaces=new ArrayList<>();
    for(Face face:candidates){
      boolean duplicate=false;
      for(Face known:finalFaces)
        if(overlap(face.nativeBox,known.nativeBox)>.35)duplicate=true;
      if(!duplicate)finalFaces.add(face);
      if(finalFaces.size()>3)break;
    }
    return finalFaces;
  }
}
