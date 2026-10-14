"""Run the production recovery scheduling method with a controlled executor."""
import subprocess,tempfile
from pathlib import Path

root=Path(__file__).resolve().parent
source=(root/'src/nl/kalenel/s9security/CameraService.java').read_text()
start=source.index(' private void queueArchiveRecovery(){')
opening=source.index('{',start);depth=1;end=opening+1
while depth:
 depth += (source[end]=='{')-(source[end]=='}');end+=1
method=source[start:end]
harness='''import java.io.File;
class RecoveryLifecycleTest {
 boolean recoveryQueued=false,fail=false;int runs=0;
 File folder=new File("archive");ManualExecutor reviewer=new ManualExecutor();
 static class ManualExecutor {
  Runnable task;int submissions=0;boolean reject=false;
  void execute(Runnable job){if(reject)throw new java.util.concurrent.RejectedExecutionException();submissions++;task=job;}
  void drain(){Runnable job=task;task=null;job.run();}
 }
 void recoverArchive(File archive){runs++;if(!recoveryQueued)throw new AssertionError("guard released during scan");if(fail)throw new IllegalStateException("scan failed");}
 METHOD
 static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args){
  RecoveryLifecycleTest s=new RecoveryLifecycleTest();
  s.queueArchiveRecovery();check(s.recoveryQueued);s.queueArchiveRecovery();check(s.reviewer.submissions==1);
  s.reviewer.drain();check(!s.recoveryQueued&&s.runs==1);
  s.fail=true;s.queueArchiveRecovery();try{s.reviewer.drain();throw new AssertionError();}catch(IllegalStateException expected){}
  check(!s.recoveryQueued&&s.runs==2);
  s.reviewer.reject=true;s.queueArchiveRecovery();check(!s.recoveryQueued);
  s.reviewer.reject=false;s.folder=null;s.queueArchiveRecovery();check(!s.recoveryQueued&&s.reviewer.task==null);
  s.folder=new File("archive");s.reviewer=null;s.queueArchiveRecovery();check(!s.recoveryQueued);
  System.out.println("ARCHIVE_RECOVERY_LIFECYCLE_PASS normal exception rejection dedup missing_resources");
 }
}'''.replace(' METHOD',method)
with tempfile.TemporaryDirectory(prefix='s9-recovery-lifecycle-') as temp:
 path=Path(temp)/'RecoveryLifecycleTest.java';path.write_text(harness)
 subprocess.run(['javac',str(path)],check=True,capture_output=True,text=True)
 subprocess.run(['java','-cp',temp,'RecoveryLifecycleTest'],check=True)
