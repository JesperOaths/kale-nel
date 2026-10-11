package nl.kalenel.s9security;

import java.io.ByteArrayOutputStream;

/** Normalize Android AVC access units for the read-only live relay. */
final class H264AnnexB {
 private H264AnnexB(){}
 static byte[] normalize(byte[] data){
  if(data==null||data.length==0)return new byte[0];
  if(data.length>=4&&data[0]==0&&data[1]==0&&
     (data[2]==1||(data[2]==0&&data[3]==1)))return data;
  ByteArrayOutputStream out=new ByteArrayOutputStream(data.length+16);
  int cursor=0;
  while(cursor<data.length){
   if(data.length-cursor<4)throw new IllegalArgumentException("truncated_AVC_NAL_length");
   long length=((data[cursor]&255L)<<24)|((data[cursor+1]&255L)<<16)|
      ((data[cursor+2]&255L)<<8)|(data[cursor+3]&255L);
   cursor+=4;
   if(length<1||length>data.length-cursor)throw new IllegalArgumentException("invalid_AVC_NAL_length");
   out.write(0);out.write(0);out.write(0);out.write(1);
   out.write(data,cursor,(int)length);cursor+=(int)length;
  }
  return out.toByteArray();
 }
 static byte[] join(byte[] first,byte[] second){
  byte[] result=new byte[first.length+second.length];
  System.arraycopy(first,0,result,0,first.length);
  System.arraycopy(second,0,result,first.length,second.length);
  return result;
 }
}
