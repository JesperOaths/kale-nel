import copy
import unittest
import game_rules as rules


def session():
    s = {"score": 0, "step": -1, "phase": "ready", "round": 1, "history": [],
         "titleDone": False, "artistDone": False, "track": {"title": "Midnight City", "artist": "M83"}}
    rules.start_round(s)
    return s


def apply(s, op, **data):
    rules.apply(s, {"op": op, **data}, lambda a, b: a.casefold() == b.casefold(),
                lambda title: [title], lambda value: value.strip().casefold())


class RulesTests(unittest.TestCase):
    def test_one_second_is_between_half_and_one_and_half(self):
        self.assertEqual(rules.DURATIONS[:3], (500, 1000, 1500))

    def test_artist_only_earns_five_and_can_keep_guessing(self):
        s = session(); apply(s, "clue"); apply(s, "answer", artist="M83")
        self.assertEqual(s["score"], 5)
        self.assertTrue(s["artistDone"])
        self.assertEqual(s["phase"], "playing")
        apply(s, "answer", title="A different title")
        self.assertEqual(s["score"], 4.75)
        self.assertTrue(s["artistDone"])

    def test_half_second_title_earns_bonus_without_artist(self):
        s = session(); apply(s, "clue"); apply(s, "answer", title="Midnight City")
        self.assertEqual(s["score"], 7)
        self.assertFalse(s["artistDone"])
        self.assertEqual(rules.breakdown(s)["bonus"], 2)

    def test_one_second_has_no_speed_bonus(self):
        s = session(); apply(s, "clue", targetStep=1)
        apply(s, "answer", title="Midnight City", artist="M83")
        self.assertEqual(s["score"], 9.75)
        self.assertEqual(rules.breakdown(s)["bonus"], 0)

    def test_early_complete_guess_is_twelve(self):
        s = session(); apply(s, "clue"); apply(s, "answer", title="Midnight City", artist="M83")
        self.assertEqual(s["score"], 12)

    def test_multiple_wrong_attempts_and_correct_partial_are_transcribed(self):
        s = session(); apply(s, "clue")
        apply(s, "answer", title="Wrong track", artist="M83")
        apply(s, "answer", title="Another wrong track")
        self.assertEqual(len(s["attempts"]), 2)
        self.assertEqual(s["attempts"][0]["artist"]["result"], "correct")
        self.assertEqual(s["attempts"][1]["title"]["result"], "incorrect")
        self.assertEqual(s["score"], 4.5)

    def test_duplicate_wrong_entry_is_not_charged_again(self):
        s = session(); apply(s, "clue"); apply(s, "answer", title="Wrong")
        with self.assertRaises(ValueError): apply(s, "answer", title="wrong")
        self.assertEqual(rules.breakdown(s)["misses"], .25)
        self.assertEqual(len(s["attempts"]), 1)

    def test_solved_field_never_pays_twice(self):
        s = session(); apply(s, "clue"); apply(s, "answer", artist="M83")
        apply(s, "answer", artist="M83", title="Wrong")
        self.assertEqual(s["score"], 4.75)
        self.assertEqual(s["attempts"][-1]["artist"]["result"], "already-correct")

    def test_final_fragment_allows_more_than_one_attempt(self):
        s = session(); apply(s, "clue", targetStep=7)
        apply(s, "answer", title="Wrong"); apply(s, "answer", title="Another")
        self.assertEqual(s["phase"], "playing")
        apply(s, "answer", title="Midnight City", artist="M83")
        self.assertEqual(s["score"], 7.75)

    def test_hint_cost_is_small_and_skipping_tiers_cannot_avoid_it(self):
        direct, incremental = session(), session()
        apply(direct, "clue", targetStep=7)
        for target in range(8): apply(incremental, "clue", targetStep=target)
        self.assertEqual(rules.breakdown(direct)["hints"], 1.75)
        self.assertEqual(rules.breakdown(direct), rules.breakdown(incremental))

    def test_new_round_cannot_deduct_earlier_round_points(self):
        s = session(); s["score"] = 12; rules.start_round(s)
        apply(s, "clue", targetStep=7); apply(s, "answer", title="Wrong")
        self.assertEqual(s["score"], 12)
        self.assertEqual(rules.breakdown(s)["floor"], 2)

    def test_summary_arithmetic_and_partial_answers(self):
        s = session(); apply(s, "clue"); apply(s, "answer", artist="M83", title="Wrong")
        s["history"].append(rules.round_recap(s)); summary = rules.summary(s)
        self.assertEqual(summary["total"], summary["title"] + summary["artist"] + summary["bonus"] - summary["hints"] - summary["misses"] + summary["floor"])
        self.assertEqual(summary["artists"], 1)
        self.assertEqual(summary["titles"], 0)
        self.assertEqual(summary["solved"], 0)

    def test_only_solved_fields_are_disclosed(self):
        s = session(); apply(s, "clue"); apply(s, "answer", artist="M83")
        details = rules.public_details(s)
        self.assertEqual(details["solved"], {"title": "", "artist": "M83"})
        self.assertNotIn("track", details)

    def test_invalid_or_empty_attempts_have_no_effect(self):
        s = session(); original = copy.deepcopy(s)
        with self.assertRaises(ValueError): apply(s, "answer", title="Midnight City")
        self.assertEqual(s, original)
        apply(s, "clue"); original = copy.deepcopy(s)
        with self.assertRaises(ValueError): apply(s, "answer")
        self.assertEqual(s, original)


if __name__ == "__main__": unittest.main()
