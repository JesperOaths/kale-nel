import importlib.util
from pathlib import Path
import unittest
import tempfile
import os

spec = importlib.util.spec_from_file_location('joiner_health', Path(__file__).with_name('s9_historical_joiner_health_v1.py'))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


def current():
    return dict(ok=True, mode='watching', native_4k_enabled=True,
                garden_person_gate_backend='gpu', preroll_enabled=False,
                preroll_ready=False, continuous_4k_ready=True,
                continuous_4k_buffered_ms=8995,
                continuous_4k_dropped_output_frames=0, sensor_result_fps=30.02,
                temperature_c=32.1, last_frame_age_ms=28,
                sd_free_bytes=80*1024**3)


class Tests(unittest.TestCase):
    def test_current_continuous_recorder_does_not_require_retired_preview_ring(self):
        self.assertTrue(h.safe(current()))

    def test_all_capture_health_and_active_worker_failures_defer(self):
        bad = {'mode':'recording', 'ok':False, 'native_4k_enabled':False,
               'garden_person_gate_backend':'cpu', 'continuous_4k_ready':False,
               'continuous_4k_buffered_ms':6499,
               'continuous_4k_dropped_output_frames':1,
               'sensor_result_fps':9.99, 'temperature_c':36.2,
               'last_frame_age_ms':2600, 'sd_free_bytes':10*1024**3}
        for k,v in bad.items():
            with self.subTest(k=k):self.assertFalse(h.safe(dict(current(), **{k:v})))
        for k in h.BUSY:
            for v in (True, 'true', None):
                with self.subTest(k=k, v=v):self.assertFalse(h.safe(dict(current(), **{k:v})))

    def test_missing_and_mistyped_metrics_do_not_pass(self):
        for k in ('continuous_4k_buffered_ms','continuous_4k_dropped_output_frames',
                  'sensor_result_fps','temperature_c','last_frame_age_ms','sd_free_bytes'):
            d=current();d.pop(k)
            self.assertFalse(h.safe(d), k)
            for v in (True, '30', float('nan'), float('inf')):
                self.assertFalse(h.safe(dict(current(), **{k:v})), (k,v))

    def test_continuous_failure_cannot_fall_back_to_old_ready_flag(self):
        self.assertFalse(h.safe(dict(current(), continuous_4k_enabled=True,
            continuous_4k_ready=False, preroll_enabled=True, preroll_ready=True)))

    def test_explicit_legacy_mode_still_supported(self):
        d=current()
        for k in list(d):
            if k.startswith('continuous_4k_'):d.pop(k)
        d.update(preroll_enabled=True, preroll_ready=True)
        self.assertTrue(h.safe(d))

    def test_patch_preserves_entire_media_pipeline(self):
        source='def safe(s):\n return s.get("preroll_ready") is True\n\ndef head(url):\n return "unchanged media pipeline"\nif __name__=="__main__":raise SystemExit(main())\n'
        new=h.patch_worker(source)
        self.assertIn('def head(url):\n return "unchanged media pipeline"',new)
        self.assertIn('run_exclusive(main)',new)
        compile(new,'patched-worker','exec')
        with self.assertRaises(ValueError):h.patch_worker(new)

    @unittest.skipIf(os.name=='nt','Linux flock/owner semantics')
    def test_same_inode_lock_excludes_other_worker_and_releases_on_error(self):
        import fcntl
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            for name in h.LOCKS:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.touch(mode=0o600)
            with (root/h.LOCKS[0]).open('r') as held:
                fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with self.assertRaises(BlockingIOError):
                    with h.exclusion(root):pass
            with self.assertRaisesRegex(RuntimeError,'test-callback'):
                with h.exclusion(root):raise RuntimeError('test-callback')
            with h.exclusion(root):pass

    @unittest.skipIf(os.name=='nt','Linux nofollow and mode checks')
    def test_missing_symlink_and_nonprivate_locks_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            with self.assertRaises(FileNotFoundError):
                with h.exclusion(root):pass
            for name in h.LOCKS:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.touch(mode=0o600)
            (root/h.LOCKS[0]).chmod(0o644)
            with self.assertRaises(RuntimeError):
                with h.exclusion(root):pass
            (root/h.LOCKS[0]).unlink()
            (root/h.LOCKS[0]).symlink_to(root/h.LOCKS[1])
            with self.assertRaises(OSError):
                with h.exclusion(root):pass


if __name__=='__main__':unittest.main()
