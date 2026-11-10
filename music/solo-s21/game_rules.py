"""Authoritative, quarter-point Tune Rush rules. No browser-owned scoring."""
from copy import deepcopy

VERSION = 2
DURATIONS = (500, 1000, 1500, 3000, 5000, 8000, 12000, 20000)
FIELD_UNITS = 20
BONUS_UNITS = 8


def start_round(session):
    session["roundBaseScore"] = session["score"]
    session["roundLedger"] = {"title": 0, "artist": 0, "bonus": 0, "hints": 0, "misses": 0}
    session["attempts"] = []


def breakdown(session):
    ledger = session["roundLedger"]
    earned = ledger["title"] + ledger["artist"] + ledger["bonus"]
    deductions = ledger["hints"] + ledger["misses"]
    return {
        "title": ledger["title"] / 4,
        "artist": ledger["artist"] / 4,
        "bonus": ledger["bonus"] / 4,
        "hints": ledger["hints"] / 4,
        "misses": ledger["misses"] / 4,
        "floor": max(0, deductions - earned) / 4,
        "total": max(0, earned - deductions) / 4,
    }


def update_score(session):
    session["score"] = session["roundBaseScore"] + breakdown(session)["total"]


def apply(session, data, matcher, title_aliases, normalizer):
    """Apply one new clue or any number of distinct answer attempts."""
    op = data["op"]
    if session["phase"] not in ("ready", "playing"):
        raise ValueError("This song is already revealed.")
    if op == "clue":
        target = data.get("targetStep", session["step"] + 1)
        if type(target) is not int or not session["step"] < target < len(DURATIONS):
            raise ValueError("Choose a longer clue.")
        session["step"] = target
        session["phase"] = "playing"
        session["roundLedger"]["hints"] = target
        session["last"] = None
        update_score(session)
        return
    if op != "answer" or session["step"] < 0:
        raise ValueError("Play a clue before guessing.")
    guesses = {field: str(data.get(field) or "")[:100].strip() for field in ("title", "artist")}
    if not any(guesses.values()):
        raise ValueError("Enter a song title, an artist, or both.")
    before = session["score"]
    result = {"sequence": len(session["attempts"]) + 1,
              "seconds": DURATIONS[session["step"]] / 1000}
    fresh = False
    for field in ("title", "artist"):
        guess = guesses[field]
        done = field + "Done"
        if session[done]:
            status = "already-correct"
        elif not guess:
            status = "not-entered"
        elif any(normalizer(previous[field]["guess"]) == normalizer(guess)
                 for previous in session["attempts"] if previous[field]["guess"]):
            status = "duplicate"
        else:
            fresh = True
            answers = title_aliases(session["track"][field]) if field == "title" else [session["track"][field]]
            if any(matcher(guess, answer) for answer in answers):
                status = "correct"
                session[done] = True
                session["roundLedger"][field] = FIELD_UNITS
                if field == "title" and session["step"] == 0:
                    session["roundLedger"]["bonus"] = BONUS_UNITS
            else:
                status = "incorrect"
                session["roundLedger"]["misses"] += 1
        result[field] = {"guess": guess, "result": status}
    if not fresh:
        raise ValueError("Those entries were already checked. Try a different answer or a longer clue.")
    update_score(session)
    result["delta"] = session["score"] - before
    result["roundPoints"] = breakdown(session)["total"]
    session["attempts"].append(result)
    session["last"] = {field: result[field]["result"] for field in ("title", "artist")}
    session["last"]["delta"] = result["delta"]
    session["guessedStep"] = session["step"]  # Legacy clients may display this; it is never a lock.
    session["phase"] = "playing"  # The final fragment also allows further attempts.


def round_recap(session):
    return {"round": session["round"], "title": session["track"]["title"],
            "artist": session["track"]["artist"], "clues": session["step"] + 1,
            "seconds": DURATIONS[session["step"]] / 1000 if session["step"] >= 0 else 0,
            "titleCorrect": session["titleDone"], "artistCorrect": session["artistDone"],
            "attemptCount": len(session["attempts"]), "breakdown": breakdown(session)}


def summary(session):
    rounds = list(session["history"])
    if not any(row["round"] == session["round"] for row in rounds):
        rounds.append(round_recap(session))
    totals = {key: sum(row.get("breakdown", {}).get(key, 0) for row in rounds)
              for key in ("title", "artist", "bonus", "hints", "misses", "floor", "total")}
    return {**totals, "titles": sum(row["titleCorrect"] for row in rounds),
            "artists": sum(row["artistCorrect"] for row in rounds),
            "solved": sum(row["titleCorrect"] and row["artistCorrect"] for row in rounds),
            "attempts": sum(row.get("attemptCount", 0) for row in rounds),
            "rounds": len(rounds), "maxPoints": len(rounds) * 12}


def public_details(session):
    return {"rulesVersion": VERSION, "roundPoints": breakdown(session),
            "attemptCount": len(session["attempts"]),
            "attempts": deepcopy(session["attempts"][-24:]),
            "solved": {field: session["track"][field] if session[field + "Done"] else ""
                       for field in ("title", "artist")},
            "summary": summary(session)}
