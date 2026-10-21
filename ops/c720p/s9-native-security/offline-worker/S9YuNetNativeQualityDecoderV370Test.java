package nl.kalenel.s9offline;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Synthetic shapes only. Never loads a model, video, image or phone. */
public final class S9YuNetNativeQualityDecoderV370Test {
  static void check(boolean v,String reason){if(!v)throw new IllegalStateException(reason);}
  static Map<String,Object> heads(){
    Map<String,Object> h=new HashMap<>();
    for(int stride:new int[]{8,16,32}){
      int count=(640/stride)*(640/stride);
      h.put("cls_"+stride,new float[1][count][1]);
      h.put("obj_"+stride,new float[1][count][1]);
      h.put("bbox_"+stride,new float[1][count][4]);
      h.put("kps_"+stride,new float[1][count][10]);
    }
    return h;
  }
  public static void main(String[] ignored){
    Map<String,Object> h=heads();
    int[] full={0,0,3840,2160};
    check(S9YuNetNativeQualityDecoderV370.decode(h,full,640,360,0,140).isEmpty(),
          "empty_fixture_must_stay_empty");
    int index=40*80+40;
    ((float[][][])h.get("cls_8"))[0][index][0]=.99f;
    ((float[][][])h.get("obj_8"))[0][index][0]=.99f;
    float[] box=((float[][][])h.get("bbox_8"))[0][index];
    box[2]=(float)Math.log(4);box[3]=(float)Math.log(4);
    float[] eyes=((float[][][])h.get("kps_8"))[0][index];
    eyes[0]=-1;eyes[1]=-1;eyes[2]=1;eyes[3]=-1;
    List<S9YuNetNativeQualityDecoderV370.Face> found=
        S9YuNetNativeQualityDecoderV370.decode(h,full,640,360,0,140);
    check(found.size()==1,"valid_synthetic_single_hit");
    S9YuNetNativeQualityDecoderV370.Face a=found.get(0);
    check(a.nativeBox[0]>=0&&a.nativeBox[1]>=0
          &&a.nativeBox[0]+a.nativeBox[2]<=3840
          &&a.nativeBox[1]+a.nativeBox[3]<=2160
          &&a.nativeEyeSpan>8,"native_mapping_and_eye_span");
    ((float[][][])h.get("cls_8"))[0][index][0]=Float.NaN;
    check(S9YuNetNativeQualityDecoderV370.decode(h,full,640,360,0,140).isEmpty(),
          "nonfinite_head_cannot_create_measurement");
    System.out.println("S9_NATIVE_YUNET_V370_SYNTHETIC_MAPPING_PASS_NO_MEDIA");
  }
}
