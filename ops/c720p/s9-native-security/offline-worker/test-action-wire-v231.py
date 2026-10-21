#!/usr/bin/env python3
"""Pure JVM synthetic signed tuple parsing, no live APK, auth, media or network."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parent
class Tests(unittest.TestCase):
 def test_wire_java8_and_synthetic_negative_cases(self):
  paths=['S9MigratedSignedActionV198.java',
         'S9MigratedActionWireV231.java',
         'S9MigratedActionWireTestV231.java']
  with tempfile.TemporaryDirectory() as out:
   build=subprocess.run(['javac','-source','8','-target','8','-d',out]+
       [str(ROOT/x) for x in paths],capture_output=True,text=True,timeout=40)
   self.assertEqual(build.returncode,0,build.stderr)
   run=subprocess.run(['java','-cp',out,
     'nl.kalenel.s9offline.S9MigratedActionWireTestV231'],
     capture_output=True,text=True,timeout=25)
   self.assertEqual(run.returncode,0,run.stderr)
   self.assertIn('S9_MIGRATED_ACTION_WIRE_V231_SYNTHETIC_OK',run.stdout)
 def test_no_shortcut_authority_or_io(self):
  t=(ROOT/'S9MigratedActionWireV231.java').read_text()
  for required in ('lines.length!=KEYS.length',
                   'wire_ascii_or_control_character_invalid',
                   'wire_missing_terminal_lf',
                   'wire_fields_count_invalid',
                   'new S9MigratedSignedActionV198.Request(',
                   'approvesUser(){return false;}',
                   'enablesNetworkTransport(){return false;}'):
   self.assertIn(required,t)
  for dangerous in ('Socket(', 'HttpServer(', 'URL(', 'Files.write',
                    'Runtime.getRuntime()', 'createKey', 'delete(', 'commitMetadataOnly('):
   self.assertNotIn(dangerous,t)

if __name__=='__main__':unittest.main(verbosity=2)
