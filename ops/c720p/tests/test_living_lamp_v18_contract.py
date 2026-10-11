#!/usr/bin/env python3
"""Static, no-camera/no-network regression contract for the V18 patch."""
import ast
import runpy
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / "frontcam_motion_v18_normal_light_patch.py"

class LivingLampV18Contract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = runpy.run_path(str(PATCH))
        cls.functions = {}
        helper_src = cls.module["NORMAL_HELPER"]
        ast.parse(helper_src)
        exec(compile(helper_src, str(PATCH), "exec"), cls.functions)

    def test_source_labels_have_explicit_transition_veto(self):
        expr = self.module["DARK_CONFIRM_NEW"]
        self.assertIn("night_motion_source_ok(source,in_transition_guard)", expr)
        self.assertNotIn("localized-during-transition", expr)

    def test_historic_false_event_2107_excluded(self):
        self.assertFalse(self.functions["night_motion_source_ok"]("transition-settling", True))

    def test_historic_false_event_2123_excluded(self):
        self.assertFalse(self.functions["night_motion_source_ok"]("localized-during-transition", True))

    def test_explicit_lighting_transitions_excluded(self):
        for label in ("lighting-transition", "transition-stable", "warming"):
            self.assertFalse(self.functions["night_motion_source_ok"](label, True))

    def test_valid_dark_background_and_temporal_sources(self):
        for label in ("background", "temporal"):
            self.assertTrue(self.functions["night_motion_source_ok"](label, False))

    def test_even_valid_source_blocked_during_transition(self):
        for label in ("background", "temporal"):
            self.assertFalse(self.functions["night_motion_source_ok"](label, True))

    def test_moderate_lit_room_motion_retained(self):
        fn = self.functions["normal_motion_evidence"]
        self.assertTrue(fn(.65, 75, .35, (30,20,18,26)))
        self.assertTrue(fn(.085, 19, .15, (30,20,7,10), True))

    def test_noise_and_global_flicker_rejected(self):
        fn = self.functions["normal_motion_evidence"]
        self.assertFalse(fn(.4, 10, .8, (2,2,4,4)))
        self.assertFalse(fn(1.2, 33, .02, (20,20,15,15)))
        self.assertFalse(fn(60, 9000, 1, (0,0,160,120)))

    def test_v17_guard_and_safeguards_required(self):
        self.assertIn("NIGHT_SHAPE_GATE_V17_20261011", PATCH.read_text())
        self.assertIn("EXPECTED_SHA", PATCH.read_text())
        self.assertIn("BACKUP", PATCH.read_text())
        self.assertIn("shutil.copy2(BACKUP,SOURCE)", PATCH.read_text())

    def test_startup_waits_for_two_fresh_writes(self):
        text = PATCH.read_text()
        self.assertIn("startup_deadline=time.monotonic()+35.0", text)
        self.assertIn("healthy_samples>=2", text)
        self.assertIn("sample_ts>restart_started_at", text)
        self.assertIn('state.get("version")=="frontcam-motion-v18"', text)

    def test_previous_rollback_backup_is_reused_only_if_verified(self):
        text = PATCH.read_text()
        self.assertIn("existing_backup_sha=hashlib.sha256(BACKUP.read_bytes()).hexdigest()", text)
        self.assertIn("existing_backup_sha!=EXPECTED_SHA", text)
        self.assertIn("shutil.copy2(BACKUP,SOURCE)", text)

    def test_requires_explicit_operator_action(self):
        source = PATCH.read_text()
        self.assertIn('parser.add_argument("--apply"', source)
        self.assertIn("if not a.apply or already:", source)
        self.assertIn("return", source)

if __name__ == "__main__":
    unittest.main()
