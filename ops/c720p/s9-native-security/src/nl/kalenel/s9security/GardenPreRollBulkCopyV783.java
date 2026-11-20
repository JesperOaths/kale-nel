package nl.kalenel.s9security;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Locale;

/**
 * R783: bounded lossless plane copy for the independent 640x480 preroll
 * hardware H264 worker, NOT the Camera2 main recorder.
 *
 * Bulk rows are used only when BOTH pixel strides are exactly one; otherwise
 * the original per-pixel addressing is preserved. This helper reads neither
 * camera images nor person labels on its own; its tests use fake byte arrays.
 */
public final class GardenPreRollBulkCopyV783 {
  private GardenPreRollBulkCopyV783(){}

  public static void copy(ByteBuffer destination,int dstRowStride,int dstPixelStride,
                          byte[] src,int srcRowStride,int srcPixelStride,
                          int width,int height){
    if(destination==null||src==null||width<=0||height<=0||
       dstRowStride<=0||srcRowStride<=0||
       dstPixelStride<=0||srcPixelStride<=0) {
      throw new IllegalArgumentException("invalid_plane_or_stride");
    }
    long sourceLast=(long)(height-1)*srcRowStride+(long)(width-1)*srcPixelStride;
    long destLast=(long)(height-1)*dstRowStride+(long)(width-1)*dstPixelStride;
    if(sourceLast>=src.length||destLast>=destination.limit()) {
      throw new IllegalArgumentException("plane_buffer_out_of_bounds");
    }
    if(srcPixelStride==1&&dstPixelStride==1) {
      // ByteBuffer.duplicate protects the parent Image.Plane buffer's
      // position and limit. Its direct memory is shared intentionally.
      ByteBuffer target=destination.duplicate();
      for(int y=0;y<height;y++) {
        target.position(y*dstRowStride);
        target.put(src,y*srcRowStride,width);
      }
    } else {
      // Exactly the legacy YUV420 flexible-plane copy, including padded
      // interleaved UV pixel strides, but with whole-region bounds checks.
      for(int y=0;y<height;y++) {
        int srcBase=y*srcRowStride,dstBase=y*dstRowStride;
        for(int x=0;x<width;x++) {
          destination.put(dstBase+x*dstPixelStride,
                          src[srcBase+x*srcPixelStride]);
        }
      }
    }
  }

  static void baseline(ByteBuffer destination,int dstRowStride,int dstPixelStride,
                       byte[] src,int srcRowStride,int srcPixelStride,
                       int width,int height){
    for(int y=0;y<height;y++)for(int x=0;x<width;x++) {
      int sourceIndex=y*srcRowStride+x*srcPixelStride;
      int targetIndex=y*dstRowStride+x*dstPixelStride;
      if(sourceIndex<0||sourceIndex>=src.length||targetIndex<0||
         targetIndex>=destination.limit()) {
        throw new IllegalArgumentException("baseline_bounds");
      }
      destination.put(targetIndex,src[sourceIndex]);
    }
  }

  static void require(boolean good,String why){
    if(!good)throw new IllegalStateException(why);
  }
  static void compare(int width,int height,int srcRow,int srcStep,int dstRow,int dstStep){
    int srcSize=(height-1)*srcRow+(width-1)*srcStep+1;
    int dstSize=(height-1)*dstRow+(width-1)*dstStep+1;
    byte[] src=new byte[srcSize+7];
    for(int i=0;i<src.length;i++)src[i]=(byte)((i*103+23)&255);
    ByteBuffer old=ByteBuffer.allocateDirect(dstSize+8);
    ByteBuffer updated=ByteBuffer.allocateDirect(dstSize+8);
    for(int i=0;i<dstSize+8;i++) {
      old.put(i,(byte)77);updated.put(i,(byte)77);
    }
    int position=updated.position();
    baseline(old,dstRow,dstStep,src,srcRow,srcStep,width,height);
    copy(updated,dstRow,dstStep,src,srcRow,srcStep,width,height);
    require(updated.position()==position,
        "new_copy_mutated_original_buffer_position");
    for(int i=0;i<dstSize+8;i++) {
      require(old.get(i)==updated.get(i),
          "bulk_and_scalar_plane_pixels_disagree_at_"+i);
    }
  }
  public static void main(String[] args) {
    require(args.length==1&&"--self-test".equals(args[0]),
            "synthetic_plane_only");
    compare(640,480,640,1,640,1);
    compare(640,480,672,1,688,1);
    compare(320,240,672,2,640,2);
    compare(320,240,640,2,320,1);
    compare(320,240,320,1,640,2);
    compare(5,3,17,3,26,4);
    byte[] tooShort={1,2,3};
    try {
      copy(ByteBuffer.allocateDirect(100),8,1,tooShort,5,1,4,4);
      throw new IllegalStateException("out_of_bounds_source_was_accepted");
    } catch(IllegalArgumentException expected){}
    try {
      copy(ByteBuffer.allocateDirect(3),8,1,new byte[100],5,1,4,4);
      throw new IllegalStateException("out_of_bounds_target_was_accepted");
    } catch(IllegalArgumentException expected){}

    byte[] src=new byte[640*480];
    for(int i=0;i<src.length;i++)src[i]=(byte)((i*73+7)&255);
    ByteBuffer old=ByteBuffer.allocateDirect(src.length);
    ByteBuffer improved=ByteBuffer.allocateDirect(src.length);
    for(int i=0;i<4;i++) {
      baseline(old,640,1,src,640,1,640,480);
      copy(improved,640,1,src,640,1,640,480);
    }
    int rounds=40;
    long start=System.nanoTime();
    for(int i=0;i<rounds;i++)baseline(old,640,1,src,640,1,640,480);
    long oldNs=System.nanoTime()-start;
    start=System.nanoTime();
    for(int i=0;i<rounds;i++)copy(improved,640,1,src,640,1,640,480);
    long newNs=System.nanoTime()-start;
    require(old.get(0)==improved.get(0) &&
            old.get(src.length-1)==improved.get(src.length-1),
            "benchmark_changed_output_data");
    System.out.println(String.format(Locale.US,
      "R783_SYNTHETIC_YUV_STRIDE_AND_BULK_COPY_PASS test_shapes=6 "+
      "out_of_bounds_refusals=2 frames=%d legacy_ms=%.3f bulk_ms=%.3f "+
      "speedup_x=%.2f source_images_read=0 person_labels=0 camera_changed=false",
      rounds,oldNs/1e6,newNs/1e6,(double)oldNs/Math.max(1,newNs)));
  }
}
