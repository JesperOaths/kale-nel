#!/usr/bin/env python3
"""Neural triage follows real manual assignments without relaxing media binding."""
from __future__ import annotations
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import s9_local_neural_triage_readonly_v1 as api

class Contract(unittest.TestCase):
    def test_folder_membership_is_strict(self):
        ok={'sd:clip':{'folders':['Gfolder1','Gfolder2'],'source':'sd'}}
        self.assertEqual(api.folder_ids(ok,'sd:clip'),['Gfolder1','Gfolder2'])
        for folders in ([('../etc',)],['Gfolder1']*2,list('abcdefghi')):
            with self.assertRaises(ValueError):
                api.folder_ids({'sd:clip':{'folders':folders}},'sd:clip')
        with self.assertRaises(ValueError):
            api.folder_ids({'sd:clip':'bad_source'},'sd:clip')
    def test_no_attestation_mutations(self):
        src=Path(api.__file__).read_text()
        self.assertNotIn('opened_ticket',src)
        self.assertNotIn('preview_ticket',src)
        self.assertNotIn('phone_run(',src)
        self.assertIn("'review_writes_enabled':False",src)
        self.assertIn("'original_attestation':False",src)
        self.assertNotIn('manual_assignments_modified_since_model_built',src)

@unittest.skipUnless(api.MODEL.exists() and api.MANUAL.exists(),'private C720P corpus not available in CI')
class DeviceCorpus(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model,cls.crops,cls.manual=api.source_metadata()
    def test_baseline_and_after_one_review(self):
        old=api.calculate_queue(self.model,self.crops,self.manual)
        self.assertEqual(old['indexed_crop_count'],52)
        self.assertEqual(old['count']+old['assigned_s9_count'],52)
        self.assertEqual(old['count'],49)
        self.assertEqual(old['assigned_s9_count'],3)
        row=old['items'][0]
        key='sd:'+row['clip_id']
        update=copy.deepcopy(self.manual)
        update[key]={'source':'sd','name':row['clip_id'],
                     'folder':row['folder_id'],'review_status':'assigned'}
        fresh=api.calculate_queue(self.model,self.crops,update)
        self.assertEqual(fresh['count'],48)
        self.assertEqual(fresh['assigned_s9_count'],4)
        self.assertEqual(fresh['reference_count'],old['reference_count']+1)
        self.assertIn(row['clip_id'],{r['clip_id'] for r in fresh['assigned_s9_crops']})
        self.assertNotIn(row['clip_id'],{r['clip_id'] for r in fresh['items']})
        other=next(fid for fid in old['folder_ids'] if fid!=row['folder_id'])
        update[key]['folders']=[row['folder_id'],other]
        update[key].pop('folder')
        multiple=api.calculate_queue(self.model,self.crops,update)
        self.assertEqual(multiple['count'],48)
        ref=next(r for r in multiple['assigned_s9_crops'] if r['clip_id']==row['clip_id'])
        self.assertEqual(ref['folder_ids'],[row['folder_id'],other])
    def test_dynamic_source_index_hash_updates_are_accepted(self):
        original=json.loads(api.MANUAL.read_text())
        baseline=api.calculate_queue(self.model,self.crops,self.manual)
        row=baseline['items'][0]
        changed=copy.deepcopy(original)
        changed['revision']+=1
        changed['items']['sd:'+row['clip_id']]={
           'source':'sd','name':row['clip_id'],'folder':row['folder_id'],
           'review_status':'assigned'}
        with tempfile.TemporaryDirectory() as tmp:
            dest=Path(tmp)/'manual.json'
            dest.write_text(json.dumps(changed))
            with patch.object(api,'MANUAL',dest):
                a,b,links=api.source_metadata()
                fresh=api.calculate_queue(a,b,links)
                self.assertEqual(fresh['count'],baseline['count']-1)
                changed['version']=999
                dest.write_text(json.dumps(changed))
                with self.assertRaises(ValueError):
                    api.source_metadata()

if __name__=='__main__':unittest.main()

