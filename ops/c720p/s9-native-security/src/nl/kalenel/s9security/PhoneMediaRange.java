package nl.kalenel.s9security;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Read-only byte-range HTTP endpoint served ON S9+ from its microSD card.
 * C720P remains an authenticated byte relay; no ADB subprocess or decoding
 * is needed for the modern Camera2 motion recordings.
 *
 * Port 8808 is bound to 127.0.0.1 by CameraService. It can be reached only
 * through the existing C720P-to-phone authorized ADB forwarding.
 */
final class PhoneMediaRange {
 private static final Pattern PATH=Pattern.compile(
   "^(GET|HEAD) /clip/(motion_[0-9]{13}[.]mp4) HTTP/1[.][01]$");
 private static final Pattern RANGE=Pattern.compile("bytes=([0-9]*)-([0-9]*)");
 private static final long MAX_BYTES=4L*1024*1024*1024;
 private static final int COPY_SIZE=65536;
 private PhoneMediaRange(){}

 static boolean handle(BufferedReader request,OutputStream out,String first,File folder)
     throws IOException {
  if(!(first.startsWith("GET /clip/")||first.startsWith("HEAD /clip/")))return false;
  Matcher match=PATH.matcher(first);
  if(!match.matches()||folder==null){
   respond(out,404,0,0,0,0,false,false);
   return true;
  }
  boolean head="HEAD".equals(match.group(1));
  File home=folder.getCanonicalFile();
  File clip=new File(home,match.group(2)).getCanonicalFile();
  if(!clip.getParentFile().equals(home)||!clip.isFile()||!clip.canRead()||
      clip.length()<10000||clip.length()>MAX_BYTES){
   respond(out,404,0,0,0,0,false,head);
   return true;
  }
  long size=clip.length(),start=0,end=size-1;
  boolean ranged=false;
  String header;
  int lines=0;
  while(lines++<35&&(header=request.readLine())!=null&&!header.isEmpty()){
   if(header.length()>1024){respond(out,400,size,0,0,0,false,head);return true;}
   if(header.regionMatches(true,0,"Range:",0,6)){
    if(ranged){respond(out,416,size,0,0,0,false,head);return true;}
    ranged=true;
    Matcher ranges=RANGE.matcher(header.substring(6).trim());
    if(!ranges.matches()||(ranges.group(1).isEmpty()&&ranges.group(2).isEmpty())){
     respond(out,416,size,0,0,0,false,head);return true;
    }
    try{
     String a=ranges.group(1),b=ranges.group(2);
     if(!a.isEmpty()){
      start=Long.parseLong(a);
      end=b.isEmpty()?size-1:Math.min(size-1,Long.parseLong(b));
     }else{
      long suffix=Long.parseLong(b);
      start=Math.max(0,size-suffix);
      end=size-1;
     }
    }catch(NumberFormatException error){
     respond(out,416,size,0,0,0,false,head);return true;
    }
   }
  }
  if(start<0||start>=size||end<start||end>=size){
   respond(out,416,size,0,0,0,false,head);return true;
  }
  long remaining=end-start+1;
  respond(out,ranged?206:200,size,start,end,remaining,ranged,head);
  if(head)return true;
  try(RandomAccessFile file=new RandomAccessFile(clip,"r")){
   file.seek(start);
   byte[] buffer=new byte[COPY_SIZE];
   while(remaining>0){
    int n=file.read(buffer,0,(int)Math.min(remaining,COPY_SIZE));
    if(n<0)break;
    out.write(buffer,0,n);
    remaining-=n;
   }
  }
  out.flush();
  return true;
 }

 private static void respond(OutputStream out,int code,long size,long start,
                             long end,long length,boolean ranged,boolean head)
     throws IOException {
  String reason=code==200?"OK":code==206?"Partial Content":
                code==416?"Range Not Satisfiable":
                code==400?"Bad Request":"Not Found";
  StringBuilder response=new StringBuilder("HTTP/1.1 "+code+" "+reason+"\r\n");
  if(code==200||code==206) {
   response.append("Content-Type: video/mp4\r\n")
     .append("Accept-Ranges: bytes\r\n")
     .append("Content-Length: ").append(length).append("\r\n");
   if(ranged)response.append("Content-Range: bytes ").append(start).append("-")
     .append(end).append("/").append(size).append("\r\n");
  }else{
   response.append("Content-Length: 0\r\n");
   if(code==416)response.append("Content-Range: bytes */").append(size).append("\r\n");
  }
  response.append("Cache-Control: private, no-store\r\n")
   .append("X-Content-Type-Options: nosniff\r\n")
   .append("Connection: close\r\n\r\n");
  out.write(response.toString().getBytes("UTF-8"));
  out.flush();
 }
}
