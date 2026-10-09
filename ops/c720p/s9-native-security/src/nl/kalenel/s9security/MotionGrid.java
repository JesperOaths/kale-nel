package nl.kalenel.s9security;
import android.media.Image;
import android.os.SystemClock;
import java.nio.ByteBuffer;
import java.util.ArrayDeque;

/** Luma-based regional motion with exposure-change rejection and temporal voting. */
public final class MotionGrid {
 private static final int W=24,H=14,N=W*H;
 private final float[] background=new float[N],nowCells=new float[N];
 private final boolean[] changed=new boolean[N],seen=new boolean[N];
 private final int[] stack=new int[N];
 private long lastSample=0;
 private int init=0;
 private final ArrayDeque<Boolean> votes=new ArrayDeque<>();
 public double changedRatio=0,lighting=0;
 public int coherent=0;
 public boolean motion=false;
 public boolean analyze(Image frame) {
  long t=SystemClock.elapsedRealtime();
  if(t-lastSample<190)return motion;
  lastSample=t;
  Image.Plane p=frame.getPlanes()[0];
  ByteBuffer y=p.getBuffer();
  int width=frame.getWidth(),height=frame.getHeight();
  int stride=p.getRowStride(),pixelStride=p.getPixelStride();
  double global=0;
  for(int gy=0;gy<H;gy++){
   for(int gx=0;gx<W;gx++){
    int x=(gx*width/W)+(width/(W*2));
    int yy=(gy*height/H)+(height/(H*2));
    int acc=0,n=0;
    for(int dy=-2;dy<=2;dy+=2)for(int dx=-2;dx<=2;dx+=2){
     int xx=Math.max(0,Math.min(width-1,x+dx));
     int ry=Math.max(0,Math.min(height-1,yy+dy));
     int ix=ry*stride+xx*pixelStride;
     if(ix<y.limit()){acc+=(y.get(ix)&0xff);n++;}
    }
    int i=gy*W+gx;
    nowCells[i]=n>0?acc/(float)n:0;
    global+=nowCells[i];
   }
  }
  lighting=global/N;
  if(init<7){
   if(init==0)System.arraycopy(nowCells,0,background,0,N);
   else for(int i=0;i<N;i++)background[i]=0.75f*background[i]+0.25f*nowCells[i];
   init++;motion=false;return false;
  }
  float shift=0;
  for(int i=0;i<N;i++)shift+=nowCells[i]-background[i];
  shift/=N;
  int nChange=0;
  for(int i=0;i<N;i++){
   boolean c=Math.abs(nowCells[i]-background[i]-shift)>16.5f;
   changed[i]=c;
   if(c)nChange++;
  }
  changedRatio=nChange/(double)N;
  coherent=0;
  java.util.Arrays.fill(seen,false);
  for(int i=0;i<N;i++)if(changed[i]&&!seen[i]){
   int head=0,tail=0;
   stack[tail++]=i;seen[i]=true;
   while(head<tail){
    int j=stack[head++],x=j%W,z=j/W;
    if(x>0)push(j-1,tail); // handled via iterative adjacency below
    int[] near=new int[]{x>0?j-1:-1,x<W-1?j+1:-1,z>0?j-W:-1,z<H-1?j+W:-1};
    for(int k:near)if(k>=0&&changed[k]&&!seen[k]){seen[k]=true;stack[tail++]=k;}
   }
   coherent=Math.max(coherent,tail);
  }
  // Sudden global exposure/camera adjustment should not count as an intruder.
  boolean meaningful=changedRatio>=0.019&&changedRatio<0.51&&coherent>=6
      &&Math.abs(shift)<28.0;
  votes.addLast(meaningful);
  while(votes.size()>5)votes.removeFirst();
  int positive=0;for(Boolean yes:votes)if(yes)positive++;
  motion=positive>=3;
  float alpha=motion?0.008f:0.045f;
  for(int i=0;i<N;i++)background[i]=background[i]*(1-alpha)+nowCells[i]*alpha;
  return motion;
 }
 private void push(int i,int tail){} // adjacency performed in analyze; no recursion
}
