public final class S9FaceFallbackGeometryR805 {
 public static void main(String[] args) {
  if(args.length!=1||!"--synthetic-only".equals(args[0]))
   throw new IllegalArgumentException("synthetic_only");
  for(int mode:new int[]{640,320}) {
    int onnxDimension=640;
    int[] strides={8,16,32}, heads={80,40,20};
    for(int k=0;k<strides.length;k++)
      if(onnxDimension/strides[k]!=heads[k])
        throw new IllegalStateException("wrong_head");
    if(mode==320 && mode*2!=onnxDimension)
      throw new IllegalStateException("wrong_upsample");
    if(onnxDimension*onnxDimension!=409600)
      throw new IllegalStateException("tensor_quarter_only");
  }
  System.out.println("R805_FULL_TENSOR_FALLBACK_GEOMETRY_SYNTHETIC_PASS");
 }
}