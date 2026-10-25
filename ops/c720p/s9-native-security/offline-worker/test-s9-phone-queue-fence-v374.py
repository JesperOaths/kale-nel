#!/usr/bin/env python3
"""Actual durable V304 queue failure/restart tests; temporary paths only."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parent

class QueueFenceTests(unittest.TestCase):
    def setUp(self):
        path=BASE.parent/'test-s9-priority-rescan-feedback-v304.py'
        spec=importlib.util.spec_from_file_location('actual_queue_fixture',path)
        self.fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.fixture)
        self.case=self.fixture.QueueTest()
        self.case.setUp();self.addCleanup(self.case.doCleanups)
        self.v=self.fixture.v
        self.fence=self.case.state/'phone-inflight-v374.json'
        p=patch.object(self.v,'PHONE_INFLIGHT',self.fence)
        p.start();self.addCleanup(p.stop)
        self.v.produce()

    def result(self,row):
        return dict(clip_no=row['clip_no'],duration_ms=12000,
            source_sha256=row['source_sha256'],source_bytes=row['source_bytes'],
            source_revision=row['media_revision'],model_sha256=self.v.MODEL_SHA,
            analysis_version=self.v.ANALYSIS,samples=[dict(time_ms=t,state='decoded',
                original_resolution=[3840,2160],face_candidates=[])
                for t in (2032,6032,10032)])

    def test_fence_blocks_host_fallback_even_without_release_manifest(self):
        self.fence.write_text('{"synthetic":"unknown remote outcome"}')
        before=self.v.QUEUE.read_bytes()
        with patch.object(self.v,'PHONE_RELEASE',self.case.root/'absent.json'),\
             patch.object(self.v,'camera_guard') as guard,\
             patch.object(self.v,'evaluate_one') as evaluate,\
             patch.object(self.v,'publish') as publish:
            with self.assertRaisesRegex(self.v.Refusal,'reconciliation'):self.v.work()
        guard.assert_not_called();evaluate.assert_not_called();publish.assert_not_called()
        self.assertEqual(before,self.v.QUEUE.read_bytes())

    def test_dangling_fence_symlink_also_blocks_before_any_work(self):
        self.fence.symlink_to(self.case.root/'not-there')
        with patch.object(self.v,'camera_guard') as guard:
            with self.assertRaisesRegex(self.v.Refusal,'reconciliation'):self.v.work()
        guard.assert_not_called()

    def test_expired_fenced_lease_becomes_blocked_with_no_success_outcome(self):
        doc=self.v.items();row=doc['rows'][0]
        row.update(status='processing',attempts=1,lease_until=self.v.now()-1,
                   outcome={'verified_secondary_report':True})
        self.v.atomic(self.v.QUEUE,doc)
        self.fence.write_text('{"synthetic":"interrupted attempt"}')
        with self.assertRaisesRegex(self.v.Refusal,'reconciliation'):self.v.work()
        saved=next(r for r in self.v.items()['rows'] if r['id']==row['id'])
        self.assertEqual(saved['status'],'blocked');self.assertEqual(saved['lease_until'],0)
        self.assertIsNone(saved['outcome'])
        self.assertEqual(saved['last_reason'],'phone_worker_outcome_requires_reconciliation')

    def test_cleanup_failure_blocks_task_and_never_publishes(self):
        def failed(row):
            self.fence.write_text('{"synthetic":"cleanup failed"}')
            raise self.v.Refusal('phone_first_recoverable_deferred')
        with patch.object(self.v,'camera_guard',return_value={}),\
             patch.object(self.v,'evaluate_one',side_effect=failed),\
             patch.object(self.v,'publish') as publish:
            result=self.v.work()
        self.assertEqual(result['status'],'blocked');publish.assert_not_called()
        self.assertFalse(result['verified_secondary'])
        saved=next(r for r in self.v.items()['rows'] if r['last_reason']=='phone_worker_outcome_requires_reconciliation')
        self.assertEqual(saved['attempts'],1);self.assertIsNone(saved['outcome'])
        with patch.object(self.v,'evaluate_one') as evaluate:
            with self.assertRaisesRegex(self.v.Refusal,'reconciliation'):self.v.work()
        evaluate.assert_not_called()

    def test_success_shaped_result_cannot_bypass_outstanding_fence(self):
        def incomplete(row):
            self.fence.write_text('{"synthetic":"unverified remote exit"}')
            return self.result(row)
        with patch.object(self.v,'camera_guard',return_value={}),\
             patch.object(self.v,'evaluate_one',side_effect=incomplete),\
             patch.object(self.v,'publish') as publish:
            result=self.v.work()
        self.assertEqual(result['status'],'blocked');publish.assert_not_called()

    def test_interruption_retains_fence_and_processing_lease_without_publication(self):
        def interrupted(row):
            self.fence.write_text('{"synthetic":"interrupted"}')
            raise KeyboardInterrupt('synthetic interrupt')
        with patch.object(self.v,'camera_guard',return_value={}),\
             patch.object(self.v,'evaluate_one',side_effect=interrupted),\
             patch.object(self.v,'publish') as publish:
            with self.assertRaises(KeyboardInterrupt):self.v.work()
        publish.assert_not_called();self.assertTrue(self.fence.exists())
        self.assertEqual(sum(r['status']=='processing' for r in self.v.items()['rows']),1)
        with patch.object(self.v,'camera_guard') as guard:
            with self.assertRaisesRegex(self.v.Refusal,'reconciliation'):self.v.work()
        guard.assert_not_called()

    def test_expired_lease_cannot_publish_returned_record(self):
        def late(row):
            row['lease_until']=self.v.now()+39
            return self.result(row)
        with patch.object(self.v,'camera_guard',return_value={}),\
             patch.object(self.v,'evaluate_one',side_effect=late),\
             patch.object(self.v,'publish') as publish:
            result=self.v.work()
        publish.assert_not_called();self.assertFalse(result['verified_secondary'])

    def test_downstream_failure_never_marks_complete_or_claims_partial_success(self):
        with patch.object(self.v,'camera_guard',return_value={}),\
             patch.object(self.v,'evaluate_one',side_effect=self.result),\
             patch.object(self.v,'consumer_visible',side_effect=self.v.Refusal('anonymous_consumer_revalidation_unavailable')):
            result=self.v.work()
        # The existing authoritative report stores the entire three-frame
        # candidate. Eligibility still requires current source/queue admission;
        # this is not a cross-file transaction or a downstream visibility proof.
        self.assertTrue(self.v.SECONDARY.is_file())
        self.assertEqual(result['status'],'pending')
        self.assertFalse(result['verified_secondary'])
        self.assertFalse(result['consumer_visibility_confirmed'])
        row=next(r for r in self.v.items()['rows'] if r.get('deferrals')==1)
        self.assertIsNone(row['outcome']);self.assertEqual(row['lease_until'],0)

if __name__=='__main__':unittest.main()
