package nl.kalenel.s9security;

import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.media.Image;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/** Encode low-resolution camera preview entirely on the S9+, off cameraHandler.

 * snapshot(Image) copies ONLY the three YUV planes while Camera2 owns the Image.
 * encode(Snapshot) runs on a separate, lower-priority Java worker and never
 * touches an Image whose camera callback has already closed it.
 */
public final class PreviewJpeg {
 private PreviewJpeg(){}

 public static final class Snapshot {
  final int width,height;
  final byte[][] planes;
  final int[] rowStrides,pixelStrides;
  private Snapshot(int w,int h,byte[][] p,int[] rs,int[] ps){
   width=w;height=h;planes=p;rowStrides=rs;pixelStrides=ps;
  }
 }

 public static Snapshot snapshot(Image image){
  int w=image.getWidth(),h=image.getHeight();
  if(w<=0||h<=0||w>1280||h>720||(w&1)!=0||(h&1)!=0)
   throw new IllegalArgumentException("unsupported_preview_dimensions");
  if(image.getFormat()!=ImageFormat.YUV_420_888)
   throw new IllegalArgumentException("preview_must_be_YUV_420_888");
  Image.Plane[] source=image.getPlanes();
  if(source.length!=3)throw new IllegalArgumentException("invalid_YUV_plane_count");
  byte[][] planes=new byte[3][];
  int[] rowStrides=new int[3],pixelStrides=new int[3];
  for(int n=0;n<3;n++){
   ByteBuffer buffer=source[n].getBuffer().duplicate();
   buffer.position(0);
   planes[n]=new byte[buffer.remaining()];
   buffer.get(planes[n]);
   rowStrides[n]=source[n].getRowStride();
   pixelStrides[n]=source[n].getPixelStride();
   if(rowStrides[n]<=0||pixelStrides[n]<=0)
    throw new IllegalArgumentException("invalid_YUV_strides");
  }
  return new Snapshot(w,h,planes,rowStrides,pixelStrides);
 }

 private static int at(Snapshot s,int plane,int row,int col){
  long offset=(long)row*s.rowStrides[plane]+(long)col*s.pixelStrides[plane];
  if(offset<0||offset>=s.planes[plane].length)
   throw new IllegalArgumentException("YUV_plane_out_of_bounds");
  return s.planes[plane][(int)offset]&255;
 }

 public static byte[] encode(Snapshot s,int quality){
  if(quality<10||quality>95)throw new IllegalArgumentException("JPEG_quality_out_of_range");
  int width=s.width,height=s.height;
  byte[] nv21=new byte[width*height*3/2];
  for(int y=0;y<height;y++)
   for(int x=0;x<width;x++)
    nv21[y*width+x]=(byte)at(s,0,y,x);
  int base=width*height;
  for(int y=0;y<height/2;y++)for(int x=0;x<width/2;x++){
   int pos=base+y*width+x*2;
   nv21[pos]=(byte)at(s,2,y,x);   // NV21 VU, not I420 UV.
   nv21[pos+1]=(byte)at(s,1,y,x);
  }
  YuvImage image=new YuvImage(nv21,ImageFormat.NV21,width,height,null);
  ByteArrayOutputStream out=new ByteArrayOutputStream(50000);
  if(!image.compressToJpeg(new Rect(0,0,width,height),quality,out))
   throw new IllegalStateException("JPEG_encoding_failed");
  return out.toByteArray();
 }

 /** Compatibility: do not keep Android Image beyond the caller's callback. */
 public static byte[] encode(Image frame,int quality){
  return encode(snapshot(frame),quality);
 }
}
