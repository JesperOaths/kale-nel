package nl.kalenel.s9offline;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.LockSupport;

/**
 * Process-local deadline for the standalone Task9 VM only.
 *
 * This does not signal a numeric PID, touch Camera2, or impose a native/codec
 * memory ceiling. Android scheduling/JNI behavior still needs qualification.
 */
final class S9StandaloneDeadlineV374 {
  private static final String MAIN="nl.kalenel.s9offline.S9Original4KGapAuditV370";
  private static final String JAR="/data/local/tmp/s9_worker/s9_gap_v371.dex.jar";
  private static final long MAXIMUM_NS=65_000_000_000L;
  private final long begun;
  private final long budgetNs;
  private final AtomicBoolean completed=new AtomicBoolean(false);
  private final Thread watchdog;

  private static void need(boolean ok,String reason) {
    if(!ok)throw new IllegalStateException(reason);
  }

  private static boolean standaloneContext(byte[] raw,String classpath,String[] args) {
    if(!JAR.equals(classpath)||raw.length==0||raw.length>8192
        ||args.length!=6||!"--probe-one-frame".equals(args[0]))return false;
    String[] words=new String(raw,StandardCharsets.UTF_8).split("\\x00",-1);
    int count=words.length;
    while(count>0&&words[count-1].isEmpty())count--;
    if(count<args.length+3
        ||!words[0].matches("(?:/system/bin/)?app_process(?:32|64)?"))return false;
    int entry=count-args.length-1;
    if(!MAIN.equals(words[entry])||!"/system/bin".equals(words[entry-1]))return false;
    for(int i=0;i<args.length;i++)
      if(!args[i].equals(words[entry+1+i]))return false;
    return true;
  }

  private static byte[] ownCommandLine() throws Exception {
    byte[] bytes=new byte[8193];int length=0;
    try(InputStream in=Files.newInputStream(Paths.get("/proc/self/cmdline"))) {
      while(length<bytes.length) {
        int n=in.read(bytes,length,bytes.length-length);
        if(n<0)break;
        if(n==0)continue;
        length+=n;
      }
    }
    need(length>0&&length<=8192,"standalone_command_line_untrusted");
    return Arrays.copyOf(bytes,length);
  }

  static S9StandaloneDeadlineV374 start(String[] args) throws Exception {
    // Begin before parsing, /proc validation, original hashing or model work.
    long begun=System.nanoTime();
    String raw=System.getenv("TASK9_FRAME_BUDGET_MS");
    need(raw!=null&&raw.matches("[1-9][0-9]{0,4}"),"standalone_budget_missing_or_invalid");
    long milliseconds=Long.parseLong(raw);
    need(milliseconds<=65_000,"standalone_budget_above_maximum");
    need(standaloneContext(ownCommandLine(),System.getenv("CLASSPATH"),args),
         "self_deadline_requires_exact_standalone_process");
    return new S9StandaloneDeadlineV374(milliseconds*1_000_000L,begun);
  }

  private S9StandaloneDeadlineV374(long budgetNs,long begun) {
    need(budgetNs>0&&budgetNs<=MAXIMUM_NS,"standalone_budget_outside_bounds");
    this.begun=begun;this.budgetNs=budgetNs;
    requireCurrent();
    watchdog=new Thread(new Runnable() {
      @Override public void run() {
        while(!completed.get()) {
          long remaining=S9StandaloneDeadlineV374.this.budgetNs-
              (System.nanoTime()-S9StandaloneDeadlineV374.this.begun);
          if(remaining<=0) {
            // halt affects this standalone VM only, including blocked JNI.
            // No remote PID is selected or signalled.
            Runtime.getRuntime().halt(124);
            return;
          }
          LockSupport.parkNanos(remaining);
        }
      }
    },"task9-self-deadline");
    watchdog.setDaemon(true);
    watchdog.start();
  }

  void requireCurrent() {
    need(!completed.get()&&System.nanoTime()-begun<budgetNs,
         "standalone_deadline_expired");
  }

  long deadlineNanos() {
    requireCurrent();
    return begun+budgetNs;
  }

  void complete() {
    // Late output cannot disarm the timeout. Only a timely flushed success
    // reaches this point; errors leave the watchdog armed until VM exit.
    requireCurrent();
    completed.set(true);
    LockSupport.unpark(watchdog);
  }
}
