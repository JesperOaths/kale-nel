package nl.kalenel.s9security;
import android.media.Image;
import android.graphics.Bitmap;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
/** Throttled on-phone YUV_420_888 to JPEG preview. No cloud and no 4K readback. */
public final class PreviewJpeg {
 private PreviewJpeg(){}
 public static byte[] encode(Image image,int quality){
  int w=image.getWidth(),h=image.getHeight();
  Image.Plane[] p=image.getPlanes();
  ByteBuffer y=p[0].getBuffer(),u=p[1].getBuffer(),v=p[2].getBuffer();
  int ys=p[0].getRowStride(),yps=p[0].getPixelStride();
  int us=p[1].getRowStride(),ups=p[1].getPixelStride();
  int vs=p[2].getRowStride(),vps=p[2].getPixelStride();
  int[] pixels=new int[w*h];
  for(int row=0;row<h;row++){
   int yr=row*ys,ur=(row/2)*us,vr=(row/2)*vs;
   for(int col=0;col<w;col++){
    int ly=y.get(Math.min(y.limit()-1,yr+col*yps))&255;
    int uu=(u.get(Math.min(u.limit()-1,ur+(col/2)*ups))&255)-128;
    int vv=(v.get(Math.min(v.limit()-1,vr+(col/2)*vps))&255)-128;
    int c=Math.max(0,ly-16);
    int red=(298*c+409*vv+128)>>8;
    int green=(298*c-100*uu-208*vv+128)>>8;
    int blue=(298*c+516*uu+128)>>8;
    red=Math.max(0,Math.min(255,red));
    green=Math.max(0,Math.min(255,green));
    blue=Math.max(0,Math.min(255,blue));
    pixels[row*w+col]=0xff000000|(red<<16)|(green<<8)|blue;
   }
  }
  Bitmap bitmap=Bitmap.createBitmap(pixels,w,h,Bitmap.Config.ARGB_8888);
  try{
   ByteArrayOutputStream out=new ByteArrayOutputStream(60000);
   if(!bitmap.compress(Bitmap.CompressFormat.JPEG,quality,out))
    throw new IllegalStateException("jpeg_encode_failed");
   return out.toByteArray();
  }finally{bitmap.recycle();}
 }
}