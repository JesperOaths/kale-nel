(() => {
  "use strict";

  // The answer labels below are supplied by the quiz owner; the app does not infer identity from images.
  const ROUNDS = [
    { image: "./media/01.webp", answer: "Alexandra Daddario", aliases: [], label: "Afbeelding 01" },
    { image: "./media/02.webp", answer: "Margot Robbie", aliases: [], label: "Afbeelding 02" },
    { image: "./media/03.webp", answer: "Kate Upton", aliases: [], label: "Afbeelding 03" },
    { image: "./media/04.webp", answer: "Sofia Vergara", aliases: ["Sofía Vergara"], label: "Afbeelding 04" },
    { image: "./media/05.webp", answer: "Sydney Sweeney", aliases: [], label: "Afbeelding 05" },
    { image: "./media/06.webp", answer: "Pamela Anderson", aliases: [], label: "Afbeelding 06" },
    { image: "./media/07.webp", answer: "Salma Hayek", aliases: [], label: "Afbeelding 07" },
    { image: "./media/08.webp", answer: "Scarlett Johansson", aliases: [], label: "Afbeelding 08" },
    { image: "./media/09.webp", answer: "Ana de Armas", aliases: [], label: "Afbeelding 09" },
    { image: "./media/10.webp", answer: "Mia Khalifa", aliases: [], label: "Afbeelding 10" }
  ];

  const BONUS_PARTS = [
    "./media/bonus/part-00a.b64",
    "./media/bonus/part-00b.b64",
    "./media/bonus/part-01.b64",
    "./media/bonus/part-02.b64",
    "./media/bonus/part-03.b64",
    "./media/bonus/part-04.b64"
  ];

  let bonusVideoUrl = "";

  const state = {
    round: 0,
    score: 0,
    hintUsed: false,
    answers: []
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    intro: $("introSlide"),
    guess: $("guessSlide"),
    reveal: $("revealSlide"),
    bonus: $("bonusSlide"),
    end: $("endSlide"),
    bonusVideo: $("bonusVideo"),
    bonusVideoStatus: $("bonusVideoStatus"),
    bonusContinueButton: $("bonusContinueButton"),
    roundPill: $("roundPill"),
    scorePill: $("scorePill"),
    guessRoundLabel: $("guessRoundLabel"),
    guessValueLabel: $("guessValueLabel"),
    image: $("questionImage"),
    imagePlaceholder: $("imagePlaceholder"),
    placeholderTitle: $("placeholderTitle"),
    answerForm: $("answerForm"),
    answerInput: $("answerInput"),
    submitAnswer: $("submitAnswer"),
    hintButton: $("hintButton"),
    hintReveal: $("hintReveal"),
    formMessage: $("formMessage"),
    revealRoundLabel: $("revealRoundLabel"),
    roundPointsLabel: $("roundPointsLabel"),
    revealHeading: $("revealHeading"),
    revealKicker: $("revealKicker"),
    playerAnswerLabel: $("playerAnswerLabel"),
    answerVerdict: $("answerVerdict"),
    runningScore: $("runningScore"),
    nextButton: $("nextButton"),
    finalScore: $("finalScore"),
    finalGrade: $("finalGrade"),
    gradeCaption: $("gradeCaption"),
    bruisStamp: $("bruisStamp"),
    stampGrade: $("stampGrade"),
    approvalCopy: $("approvalCopy")
  };

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function levenshtein(a, b) {
    const aa = normalize(a);
    const bb = normalize(b);
    if (aa === bb) return 0;
    if (!aa.length) return bb.length;
    if (!bb.length) return aa.length;

    let previous = Array.from({ length: bb.length + 1 }, (_, i) => i);
    for (let i = 1; i <= aa.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= bb.length; j += 1) {
        const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + cost
        );
      }
      previous = current;
    }
    return previous[bb.length];
  }

  function similarity(a, b) {
    const aa = normalize(a);
    const bb = normalize(b);
    const longest = Math.max(aa.length, bb.length);
    if (!longest) return 1;
    return 1 - levenshtein(aa, bb) / longest;
  }

  function acceptedAnswer(input, round) {
    if (!round.answer) return { configured: false, correct: false };
    const candidate = normalize(input);
    if (!candidate) return { configured: true, correct: false };

    const valid = [round.answer, ...(round.aliases || [])]
      .map(normalize)
      .filter(Boolean);

    const correct = valid.some((answer) => {
      if (candidate === answer) return true;
      const distance = levenshtein(candidate, answer);
      const maxEdits = answer.length >= 16 ? 3 : answer.length >= 8 ? 2 : 1;
      return distance <= maxEdits || similarity(candidate, answer) >= 0.84;
    });

    return { configured: true, correct };
  }

  function firstNameHint(answer) {
    const first = normalize(answer).split(" ")[0] || "";
    if (!first) return "Nog niet ingesteld";
    const originalFirst = String(answer).trim().split(/\s+/)[0] || first;
    return originalFirst.slice(0, 3) + (originalFirst.length > 3 ? "…" : "");
  }

  function formatScore(score) {
    return Number.isInteger(score) ? String(score) : score.toFixed(1).replace(".", ",");
  }

  function gradeFor(score) {
    if (score >= 10) return { grade: "S+", caption: "Perfect. Bruis heeft niets meer om je te leren." };
    if (score >= 8.5) return { grade: "A", caption: "Verdacht goed. Bijna encyclopedisch." };
    if (score >= 7) return { grade: "B", caption: "Sterke vorm. Je weet duidelijk waar je naar kijkt." };
    if (score >= 5) return { grade: "C", caption: "Degelijk middenveld. Nog wat huiswerk te doen." };
    if (score >= 3) return { grade: "D", caption: "Een paar rake treffers, maar vooral veel mysterie." };
    return { grade: "F", caption: "Er is ruimte voor studie." };
  }

  function showSlide(target) {
    [els.intro, els.guess, els.reveal, els.bonus, els.end].forEach((slide) => {
      const active = slide === target;
      slide.hidden = !active;
      slide.classList.toggle("is-active", active);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateTopbar() {
    els.scorePill.textContent = `${formatScore(state.score)} / 10`;
    els.roundPill.textContent = state.round < 10 ? `Ronde ${state.round + 1} · 10` : "Eindscore";
  }

  function loadRound() {
    const round = ROUNDS[state.round];
    state.hintUsed = false;
    els.guessRoundLabel.textContent = `RONDE ${state.round + 1} VAN 10`;
    els.guessValueLabel.textContent = "1 PUNT";
    els.placeholderTitle.textContent = round.label || `Afbeelding ${String(state.round + 1).padStart(2, "0")}`;
    els.answerInput.value = "";
    els.formMessage.textContent = "";
    els.hintReveal.hidden = true;
    els.hintReveal.textContent = "";
    els.hintButton.disabled = false;
    els.hintButton.innerHTML = "✦ Gebruik hint <span>−0,5 punt</span>";

    if (round.image) {
      els.image.hidden = false;
      els.imagePlaceholder.hidden = true;
      els.image.src = round.image;
      els.image.alt = `Quizafbeelding ronde ${state.round + 1}`;
    } else {
      els.image.hidden = true;
      els.image.removeAttribute("src");
      els.imagePlaceholder.hidden = false;
    }

    if (!round.answer) {
      els.formMessage.textContent = "Deze ronde is nog een placeholder; antwoord en foto worden later ingevuld.";
    }

    updateTopbar();
    showSlide(els.guess);
    requestAnimationFrame(() => els.answerInput.focus({ preventScroll: true }));
  }

  function useHint() {
    if (state.hintUsed) return;
    const round = ROUNDS[state.round];
    state.hintUsed = true;
    els.guessValueLabel.textContent = "MAX 0,5 PUNT";
    els.hintButton.disabled = true;
    els.hintButton.innerHTML = "✦ Hint gebruikt <span>max 0,5 punt</span>";
    els.hintReveal.hidden = false;
    els.hintReveal.textContent = `Voornaam begint met: ${firstNameHint(round.answer)}`;
  }

  function submitRound(event) {
    event.preventDefault();
    const round = ROUNDS[state.round];
    const raw = els.answerInput.value.trim();

    if (!raw && round.answer) {
      els.formMessage.textContent = "Vul eerst een naam in.";
      els.answerInput.focus();
      return;
    }

    const result = acceptedAnswer(raw, round);
    const points = result.configured && result.correct ? (state.hintUsed ? 0.5 : 1) : 0;
    state.score += points;
    state.answers.push({
      round: state.round + 1,
      input: raw,
      correct: result.correct,
      configured: result.configured,
      hintUsed: state.hintUsed,
      points
    });

    els.revealRoundLabel.textContent = `RONDE ${state.round + 1} VAN 10`;
    els.roundPointsLabel.textContent = result.configured ? `+${formatScore(points)} PUNT${points === 1 ? "" : "EN"}` : "PLACEHOLDER";
    els.revealHeading.textContent = round.answer || "Nog niet ingesteld";
    els.revealKicker.textContent = result.configured ? "Het antwoord was…" : "Deze ronde wacht nog op de definitieve inhoud";
    els.playerAnswerLabel.textContent = raw || "—";
    els.answerVerdict.textContent = !result.configured ? "Nog niet ingesteld" : result.correct ? (state.hintUsed ? "Goed · met hint" : "Goed") : "Niet goed";
    els.runningScore.textContent = `${formatScore(state.score)} / 10`;
    els.nextButton.innerHTML = state.round === 9 ? "Bekijk eindscore <span>→</span>" : "Volgende ronde <span>→</span>";

    updateTopbar();
    showSlide(els.reveal);
  }

  async function loadBonusVideo() {
    if (bonusVideoUrl) {
      els.bonusVideo.src = bonusVideoUrl;
      els.bonusVideoStatus.hidden = true;
      return;
    }

    els.bonusVideoStatus.hidden = false;
    els.bonusVideoStatus.textContent = "Video laden…";

    try {
      const parts = await Promise.all(BONUS_PARTS.map(async (path) => {
        const response = await fetch(path, { cache: "force-cache" });
        if (!response.ok) throw new Error(`Bonusdeel kon niet laden: ${path}`);
        return (await response.text()).trim();
      }));
      const binary = atob(parts.join(""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      bonusVideoUrl = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
      els.bonusVideo.src = bonusVideoUrl;
      els.bonusVideoStatus.hidden = true;
    } catch (error) {
      els.bonusVideoStatus.hidden = false;
      els.bonusVideoStatus.textContent = "De bonusvideo kon niet worden geladen.";
      console.error(error);
    }
  }

  function showBonus() {
    updateTopbar();
    els.roundPill.textContent = "Bonus";
    showSlide(els.bonus);
    loadBonusVideo();
  }

  function nextRound() {
    if (state.round >= 9) {
      showBonus();
      return;
    }
    state.round += 1;
    loadRound();
  }

  function finishGame() {
    state.round = 10;
    updateTopbar();
    const result = gradeFor(state.score);
    els.finalScore.textContent = formatScore(state.score);
    els.finalGrade.textContent = result.grade;
    els.gradeCaption.textContent = result.caption;
    els.finalGrade.classList.remove("grade-pop");
    els.bruisStamp.classList.remove("stamp-in");
    els.bruisStamp.hidden = true;
    els.approvalCopy.textContent = "";

    showSlide(els.end);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.finalGrade.classList.add("grade-pop");
        if (state.score > 8) {
          els.stampGrade.textContent = result.grade;
          els.bruisStamp.hidden = false;
          els.bruisStamp.classList.add("stamp-in");
          els.approvalCopy.textContent = "Meer dan 8 punten: officieel bekroond met de Seal of Approval from Bruis.";
        }
      });
    });
  }

  function restart() {
    state.round = 0;
    state.score = 0;
    state.hintUsed = false;
    state.answers = [];
    els.finalGrade.classList.remove("grade-pop");
    els.bruisStamp.classList.remove("stamp-in");
    els.bruisStamp.hidden = true;
    if (els.bonusVideo) {
      els.bonusVideo.pause();
      els.bonusVideo.currentTime = 0;
    }
    updateTopbar();
    showSlide(els.intro);
  }

  els.image.addEventListener("error", () => {
    els.image.hidden = true;
    els.imagePlaceholder.hidden = false;
    els.formMessage.textContent = "De ingestelde afbeelding kon niet worden geladen.";
  });

  $("startButton").addEventListener("click", loadRound);
  els.hintButton.addEventListener("click", useHint);
  els.answerForm.addEventListener("submit", submitRound);
  els.nextButton.addEventListener("click", nextRound);
  els.bonusContinueButton.addEventListener("click", finishGame);
  $("restartButton").addEventListener("click", restart);

  window.addEventListener("beforeunload", () => {
    if (bonusVideoUrl) URL.revokeObjectURL(bonusVideoUrl);
  });

  updateTopbar();
})();
