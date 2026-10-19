#!/usr/bin/env python3
"""Offline, private-data-free regression for Edit people presence probe."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).with_name("smoke-c720p-edit-people-presence-v152.py")
spec=importlib.util.spec_from_file_location("edit_presence_v152",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def mock_source():
 return ("""function openApproval(item){return item}
function addApprovalPerson(){}
function manualLink(){}
function card(item){
 const tools={append:function(){}};
 if(item.decision==='approved'){
  tools.append(control('＋ Edit people',()=>openApproval(item),'primary'));
  if(state.folder)tools.append(control('↩ Return to review queue',
    ()=>manualLink(item,null),'secondary'));
 }else if(['rejected','skipped'].includes(item.decision)){
  return false;
 }
}
const data={action:selected.length>1?'assign_many':'assign'};
""")

def good():
 return {"ok":True,"loaded_security_shell":True,"approved_edit_action":True,
 "separate_return_action":True,"grouped_assignments_preserved":True,
 "loaded_asset_characters":81300,"read_only":True,
 "identities_returned":False,"signed_urls_returned":False,
 "actual_card_click_or_review_write_executed":False}

class Checks(unittest.TestCase):
 def test_scoped_edit_and_group_contract(self):
  self.assertTrue(m.structure(mock_source()))
  for replacement in ("＋ Edit people","Return to review queue","assign_many","addApprovalPerson"):
   with self.subTest(replacement=replacement):
    with self.assertRaises(RuntimeError):
     m.structure(mock_source().replace(replacement,"absent_token"))
  with self.assertRaises(RuntimeError):
   m.structure(mock_source()+mock_source())

 def test_browser_result_must_prove_no_writes(self):
  self.assertTrue(m.validate(good())["edit_people_action_served"])
  for changes in ({"ok":False},{"loaded_security_shell":False},
    {"approved_edit_action":False},{"grouped_assignments_preserved":False},
    {"separate_return_action":False},{"read_only":False},
    {"identities_returned":True},{"signed_urls_returned":True},
    {"actual_card_click_or_review_write_executed":True},
    {"loaded_asset_characters":0}):
   d=good();d.update(changes)
   with self.subTest(changes=changes),self.assertRaises(RuntimeError):
    m.validate(d)

 def test_synthetic_local_file_and_bad_symlink(self):
  with tempfile.TemporaryDirectory() as directory:
   p=Path(directory)/"people.js";p.write_text(mock_source())
   with patch.object(m,"TARGET",p):
    self.assertEqual(m.local(),mock_source().encode())
   p.unlink();p.symlink_to(Path(directory)/"nowhere")
   with patch.object(m,"TARGET",p),self.assertRaises(RuntimeError):
    m.local()

 def test_browser_js_only_returns_non_identifying_contract(self):
  js=m.script()
  for marker in ("approved_edit_action:","separate_return_action:",
                 "grouped_assignments_preserved:","read_only:true",
                 "identities_returned:false","actual_card_click_or_review_write_executed:false"):
   self.assertIn(marker,js)
  for forbidden in ("method:'POST'","method:\"POST\"","/save","/delete","video.play("):
   self.assertNotIn(forbidden,js)
  script=SOURCE.read_text()
  for forbidden in ("adb push","pm install","os.unlink(","shutil.rmtree(","delete_file("):
   self.assertNotIn(forbidden,script)
  self.assertIn("mod.run()",script)
  self.assertIn("if served()!=before",script)

if __name__=="__main__":
 unittest.main(verbosity=2)
