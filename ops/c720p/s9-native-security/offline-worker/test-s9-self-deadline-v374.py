#!/usr/bin/env python3
"""Isolated JVM tests of the self-watchdog. No ADB, Android or media access.

The test-only child uses reflection to exercise the private timer in its own
disposable JVM. Production start() still requires the exact standalone context.
This verifies desktop JVM behavior, not Android scheduling or ORT/codec memory.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

SOURCE=Path(__file__).with_name('S9StandaloneDeadlineV374.java')
HARNESS=r'''
package nl.kalenel.s9offline;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
public final class DeadlineHarness {
  private static final long FIXTURE_BUDGET_NS=2_000_000_000L;
  private static final long STARTUP_DELAY_MS=350L;
  private static native void blockNative();
  private static S9StandaloneDeadlineV374 arm(long budgetNs)throws Exception {
    Constructor<?> ctor=S9StandaloneDeadlineV374.class.getDeclaredConstructor(long.class,long.class);
    ctor.setAccessible(true);
    long begun=System.nanoTime();
    // Deliberately include a pause longer than the old 150ms fixture budget.
    // The production clock is never reset to hide initialization overhead.
    Thread.sleep(STARTUP_DELAY_MS);
    return (S9StandaloneDeadlineV374)ctor.newInstance(budgetNs,begun);
  }
  public static void main(String[] args)throws Exception {
    Class<?> cls=S9StandaloneDeadlineV374.class;
    if(args[0].equals("guard")) {
      Method match=cls.getDeclaredMethod("standaloneContext",byte[].class,String.class,String[].class);
      match.setAccessible(true);
      String[] task={"--probe-one-frame","motion_1792604351921.mp4","a","100001","b","2000"};
      String argv="app_process\0-Djava.library.path=/data/local/tmp/s9_worker/lib\0/system/bin\0"+
          "nl.kalenel.s9offline.S9Original4KGapAuditV370\0"+String.join("\0",task)+"\0";
      byte[] bytes=argv.getBytes(StandardCharsets.UTF_8);
      String jar="/data/local/tmp/s9_worker/s9_gap_v371.dex.jar";
      if(!Boolean.TRUE.equals(match.invoke(null,bytes,jar,task)))throw new AssertionError("worker refused");
      byte[] camera="nl.kalenel.s9security\0".getBytes(StandardCharsets.UTF_8);
      if(!Boolean.FALSE.equals(match.invoke(null,camera,jar,task)))throw new AssertionError("camera accepted");
      if(!Boolean.FALSE.equals(match.invoke(null,bytes,"camera.apk",task)))throw new AssertionError("wrong jar accepted");
      String[] changed=task.clone();changed[5]="3000";
      if(!Boolean.FALSE.equals(match.invoke(null,bytes,jar,changed)))throw new AssertionError("wrong task accepted");
      try { S9StandaloneDeadlineV374.start(task);throw new AssertionError("desktop VM accepted"); }
      catch(IllegalStateException expected) { System.out.println("GUARD_REFUSED:"+expected.getMessage()); }
      System.out.println("CONTEXT_GUARD_PASS");return;
    }
    if(args[0].equals("expiredinit")) {
      try { arm(150_000_000L);throw new AssertionError("expired initialization accepted"); }
      catch(InvocationTargetException expected) {
        Throwable cause=expected.getCause();
        if(!(cause instanceof IllegalStateException)
            ||!"standalone_deadline_expired".equals(cause.getMessage()))throw expected;
      }
      System.out.println("EXPIRED_INITIALIZATION_REFUSED");return;
    }
    // JNI linking is fixture setup. Arm before the genuinely blocking call.
    if(args[0].equals("nativeblock"))System.load(args[1]);
    S9StandaloneDeadlineV374 deadline=arm(FIXTURE_BUDGET_NS);
    if(args[0].equals("block")) {
      System.out.println("ENTER_BLOCK");System.out.flush();
      Thread.sleep(60_000L);
      throw new AssertionError("watchdog failed to stop sleeping VM");
    }
    if(args[0].equals("nativeblock")) {
      System.out.println("ENTER_NATIVE_BLOCK");System.out.flush();
      blockNative();
      throw new AssertionError("watchdog failed to stop JNI-blocked VM");
    }
    if(args[0].equals("complete")) {
      System.out.println("SYNTHETIC_OUTPUT");System.out.flush();
      deadline.complete();
      // Survive beyond the complete original budget after cancellation.
      Thread.sleep(FIXTURE_BUDGET_NS/1_000_000L+250L);
      System.out.println("CANCEL_SURVIVED");return;
    }
    throw new IllegalArgumentException("unknown synthetic mode");
  }
}
'''

class SelfDeadlineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.java=shutil.which('java')
        if not cls.java:raise unittest.SkipTest('Java runtime unavailable')
        cls.temp=tempfile.TemporaryDirectory(prefix='task9-self-deadline-jvm-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root=Path(cls.temp.name)
        harness=cls.root/'DeadlineHarness.java'
        harness.write_text(HARNESS)
        javac=shutil.which('javac')
        compiler=[javac] if javac else [cls.java,'-m','jdk.compiler/com.sun.tools.javac.Main']
        result=subprocess.run(compiler+['-d',str(cls.root),str(SOURCE),str(harness)],
                              capture_output=True,text=True,timeout=30)
        if result.returncode:
            raise AssertionError('watchdog compilation failed: '+result.stderr)
        # A real blocking JNI call verifies that this is more than a Java
        # cooperative-loop deadline. It remains desktop evidence, not proof
        # of Android scheduling, MediaCodec or ONNX memory limits.
        cc=shutil.which('cc')
        if not cc:raise AssertionError('C compiler required for blocked-JNI watchdog test')
        native=cls.root/'block.c'
        # The Linux fixture ignores both JNI pointer arguments and calls no
        # JNI API, so it needs no development headers or VM interface layout.
        native.write_text('#include <time.h>\n'
            '__attribute__((visibility("default"))) void '
            'Java_nl_kalenel_s9offline_DeadlineHarness_blockNative'
            '(void *env, void *cls) { struct timespec left={60,0}; '
            'while (nanosleep(&left,&left)!=0) {} }\n')
        cls.native_lib=cls.root/'libtask9block.so'
        compiled=subprocess.run([cc,'-shared','-fPIC',str(native),'-o',str(cls.native_lib)],
            capture_output=True,text=True,timeout=20)
        if compiled.returncode:raise AssertionError('JNI fixture compilation failed: '+compiled.stderr)

    def child(self,mode,**env_overrides):
        env=dict(os.environ)
        env.pop('TASK9_FRAME_BUDGET_MS',None)
        env.update(env_overrides)
        return subprocess.run([self.java,'-cp',str(self.root),
                               'nl.kalenel.s9offline.DeadlineHarness',mode,str(self.native_lib)],
                              capture_output=True,text=True,timeout=15,env=env)

    def test_watchdog_halts_only_its_blocked_child_vm(self):
        begun=time.monotonic()
        result=self.child('block')
        self.assertEqual(result.returncode,124,result.stderr)
        self.assertIn('ENTER_BLOCK',result.stdout)
        self.assertLess(time.monotonic()-begun,15)

    def test_timely_completion_cancels_watchdog_after_output(self):
        result=self.child('complete')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('SYNTHETIC_OUTPUT',result.stdout)
        self.assertIn('CANCEL_SURVIVED',result.stdout)

    def test_watchdog_halts_own_vm_while_main_thread_blocks_in_jni(self):
        result=self.child('nativeblock')
        self.assertEqual(result.returncode,124,result.stderr)
        self.assertIn('ENTER_NATIVE_BLOCK',result.stdout)

    def test_elapsed_initialization_budget_still_refuses_before_work(self):
        result=self.child('expiredinit')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('EXPIRED_INITIALIZATION_REFUSED',result.stdout)
        self.assertNotIn('ENTER_',result.stdout)
        self.assertNotIn('SYNTHETIC_OUTPUT',result.stdout)

    def test_camera_wrong_jar_and_changed_task_cannot_start_watchdog(self):
        result=self.child('guard',TASK9_FRAME_BUDGET_MS='1000')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('CONTEXT_GUARD_PASS',result.stdout)
        self.assertIn('self_deadline_requires_exact_standalone_process',result.stdout)

    def test_missing_budget_refuses_before_work(self):
        result=self.child('guard')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('standalone_budget_missing_or_invalid',result.stdout)

    def test_worker_arms_before_parsing_and_completes_only_after_flush(self):
        worker=SOURCE.with_name('S9Original4KGapAuditV370.java').read_text()
        main=worker[worker.index('public static void main'):]
        self.assertLess(main.index('S9StandaloneDeadlineV374.start(args)'),
                        main.index('Long.parseLong'))
        self.assertLess(main.index('S9StandaloneDeadlineV374.start(args)'),
                        main.index('JSONObject receipt=scan('))
        order=['deadline.requireCurrent();','System.out.println(',
               'System.out.flush();','deadline.complete();',
               'Runtime.getRuntime().halt(0);']
        positions=[main.index(token) for token in order]
        self.assertEqual(positions,sorted(positions))
        self.assertIn('deadline.deadlineNanos()',main)
        builder=SOURCE.with_name('build-s9-4k-phone-jar-v371.py').read_text()
        self.assertIn('"S9StandaloneDeadlineV374.java"',builder)

    def test_invalid_or_unbounded_budget_refuses_before_work(self):
        for value in ('0','-1','1.2','NaN','65001','999999'):
            with self.subTest(value=value):
                result=self.child('guard',TASK9_FRAME_BUDGET_MS=value)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertRegex(result.stdout,'standalone_budget_(missing_or_invalid|above_maximum)')

if __name__=='__main__':unittest.main(verbosity=2)
