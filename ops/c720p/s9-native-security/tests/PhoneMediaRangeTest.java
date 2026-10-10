package nl.kalenel.s9security;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.StringReader;
import java.nio.file.Files;
import java.util.Arrays;

/** No Android SDK or camera needed: check the live phone microSD byte server. */
public final class PhoneMediaRangeTest {
 private static void check(boolean yes,String what){if(!yes)throw new AssertionError(what);}
 private static byte[] serve(File root,String request)throws Exception{
  BufferedReader in=new BufferedReader(new StringReader(request));
  String first=in.readLine();
  ByteArrayOutputStream out=new ByteArrayOutputStream();
  check(PhoneMediaRange.handle(in,out,first,root),"request handled");
  return out.toByteArray();
 }
 private static int split(byte[] reply){
  for(int i=0;i<reply.length-3;i++)
   if(reply[i]==13&&reply[i+1]==10&&reply[i+2]==13&&reply[i+3]==10)return i+4;
  return -1;
 }
 private static String headers(byte[] reply)throws Exception{
  int n=split(reply);check(n>0,"header delimiter");
  return new String(reply,0,n,"UTF-8");
 }
 public static void main(String[] args)throws Exception{
  File root=Files.createTempDirectory("s9-native-range-test").toFile();
  String name="motion_1791651708493.mp4";
  File clip=new File(root,name);
  byte[] data=new byte[145678];
  for(int i=0;i<data.length;i++)data[i]=(byte)(i*17+11);
  try(FileOutputStream out=new FileOutputStream(clip)){out.write(data);}
  try{
   byte[] partial=serve(root,"GET /clip/"+name+" HTTP/1.1\r\nRange: bytes=1234-9876\r\n\r\n");
   String h=headers(partial);
   check(h.contains("206 Partial Content"),"206");
   check(h.contains("Content-Range: bytes 1234-9876/145678"),"range header");
   check(h.contains("Content-Length: 8643"),"exact size");
   check(h.contains("Cache-Control: private, no-store"),"cache privacy");
   check(Arrays.equals(Arrays.copyOfRange(partial,split(partial),partial.length),
                       Arrays.copyOfRange(data,1234,9877)),"byte fidelity");
   byte[] suffix=serve(root,"GET /clip/"+name+" HTTP/1.1\r\nRange: bytes=-10\r\n\r\n");
   check(headers(suffix).contains("Content-Range: bytes 145668-145677/145678"),"suffix");
   check(Arrays.equals(Arrays.copyOfRange(suffix,split(suffix),suffix.length),
        Arrays.copyOfRange(data,145668,data.length)),"suffix bytes");
   byte[] full=serve(root,"GET /clip/"+name+" HTTP/1.1\r\n\r\n");
   check(headers(full).contains("200 OK"),"full GET");
   check(full.length-split(full)==data.length,"full GET body");
   byte[] head=serve(root,"HEAD /clip/"+name+" HTTP/1.1\r\nRange: bytes=0-4\r\n\r\n");
   check(headers(head).contains("206 Partial Content"),"HEAD metadata");
   check(head.length==split(head),"HEAD has no bytes");
   byte[] invalid=serve(root,"GET /clip/"+name+" HTTP/1.1\r\nRange: bytes=145678-145679\r\n\r\n");
   check(headers(invalid).contains("416 Range Not Satisfiable"),"reject bad ranges");
   byte[] traversal=serve(root,"GET /clip/../secrets HTTP/1.1\r\n\r\n");
   check(headers(traversal).contains("404 Not Found"),"no traversal");
   byte[] unfinished=serve(root,"GET /clip/"+name+".recording HTTP/1.1\r\n\r\n");
   check(headers(unfinished).contains("404 Not Found"),"no unfinished footage");
  }finally{
   clip.delete();root.delete();
  }
  System.out.println("S9_PHONE_NATIVE_MP4_BYTE_RANGE_TESTS_PASS");
 }
}
