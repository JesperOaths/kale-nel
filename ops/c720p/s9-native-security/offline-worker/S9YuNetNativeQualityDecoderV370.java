package nl.kalenel.s9offline;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Quality-only YuNet 12-head decoding at ORIGINAL 3840x2160 coordinates.
 * The existing strict face-alignment decoder is intentionally NOT used here:
 * its 22px eye rule applies to native source pixels, not a padded 640px proxy.
 * No face embedding, identity score, image, crop or file access.
 */
public final class S9YuNetNativeQualityDecoderV370 {
  private S9YuNetNativeQualityDecoderV370() {}
  static final int NET=640;
  static final int[] STRIDES={8,16,32};
  public static final class Face {
    public final double confidence;
    public final double[] nativeBox;
    public final double nativeEyeSpan;
    Face(double confidence,double[] box,double eye) {
      this.confidence=confidence;
      nativeBox=box.clone();
      nativeEyeSpan=eye;
    }
  }
  static float[][] head(Map<String,Object> values,String name,int n,int depth) {
    Object raw=values.get(name);
    if(!(raw instanceof float[][][]))
      throw new IllegalArgumentException("missing_original_yunet_output");
    float[][][] h=(float[][][])raw;
    if(h.length!=1||h[0].length!=n)
      throw new IllegalArgumentException("original_yunet_head_shape");
    for(float[] x:h[0])
      if(x==null||x.length!=depth)
        throw new IllegalArgumentException("original_yunet_head_depth");
    return h[0];
  }
  static double map(double point,int origin,int pad,int size,int scaledSize) {
    return origin+(point-pad)*(double)size/scaledSize;
  }
  public static List<Face> decode(Map<String,Object> heads,int[] tile,
                                  int resizedW,int resizedH,int px,int py) {
    if(heads==null||heads.size()!=12||tile==null||tile.length!=4
        ||tile[2]<=0||tile[3]<=0||resizedW<=0||resizedH<=0
        ||resizedW>NET||resizedH>NET||px<0||py<0
        ||px+resizedW>NET||py+resizedH>NET
        ||tile[0]<0||tile[1]<0
        ||tile[0]+tile[2]>3840||tile[1]+tile[3]>2160)
      throw new IllegalArgumentException("untrusted_native_yunet_geometry");
    List<Face> faces=new ArrayList<>();
    for(int stride:STRIDES) {
      int width=NET/stride,count=width*width;
      float[][] cls=head(heads,"cls_"+stride,count,1);
      float[][] obj=head(heads,"obj_"+stride,count,1);
      float[][] bbox=head(heads,"bbox_"+stride,count,4);
      float[][] kps=head(heads,"kps_"+stride,count,10);
      for(int i=0;i<count;i++) {
        double c=cls[i][0],o=obj[i][0];
        if(!Double.isFinite(c)||!Double.isFinite(o)||c<0||o<0
            ||c>1||o>1)continue;
        double score=Math.sqrt(c*o);
        if(score<.90)continue;
        boolean good=true;
        for(float f:bbox[i])if(!Float.isFinite(f))good=false;
        for(float f:kps[i])if(!Float.isFinite(f))good=false;
        if(!good)continue;
        int col=i%width,row=i/width;
        double w=Math.exp(bbox[i][2])*stride;
        double h=Math.exp(bbox[i][3])*stride;
        double cx=(col+bbox[i][0])*stride,cy=(row+bbox[i][1])*stride;
        if(!Double.isFinite(w)||!Double.isFinite(h)||w<=0||h<=0)continue;
        double x0=map(cx-w/2,tile[0],px,tile[2],resizedW);
        double y0=map(cy-h/2,tile[1],py,tile[3],resizedH);
        double x1=map(cx+w/2,tile[0],px,tile[2],resizedW);
        double y1=map(cy+h/2,tile[1],py,tile[3],resizedH);
        x0=Math.max(0,Math.min(3840,x0));
        x1=Math.max(x0,Math.min(3840,x1));
        y0=Math.max(0,Math.min(2160,y0));
        y1=Math.max(y0,Math.min(2160,y1));
        double nativeW=x1-x0,nativeH=y1-y0;
        double leftEyeX=map((col+kps[i][0])*stride,tile[0],px,tile[2],resizedW);
        double rightEyeX=map((col+kps[i][2])*stride,tile[0],px,tile[2],resizedW);
        double leftEyeY=map((row+kps[i][1])*stride,tile[1],py,tile[3],resizedH);
        double rightEyeY=map((row+kps[i][3])*stride,tile[1],py,tile[3],resizedH);
        double eye=Math.hypot(leftEyeX-rightEyeX,leftEyeY-rightEyeY);
        if(nativeW<18||nativeH<18||!Double.isFinite(eye)||eye<8)continue;
        faces.add(new Face(score,new double[]{x0,y0,nativeW,nativeH},eye));
        if(faces.size()>12)
          throw new IllegalArgumentException("unbounded_original_yunet_candidates");
      }
    }
    return faces;
  }
}
