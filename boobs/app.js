(() => {
  "use strict";

  const ROUNDS = [
    { image: "./media/01.webp", answer: "Alexandra Daddario", aliases: [] },
    { image: "./media/02.webp", answer: "Margot Robbie", aliases: [] },
    { image: "./media/03.webp", answer: "Kate Upton", aliases: [] },
    { image: "./media/04.webp", answer: "Sofia Vergara", aliases: ["Sofía Vergara"] },
    { image: "./media/05.webp", answer: "Sydney Sweeney", aliases: [] },
    { image: "./media/06.webp", answer: "Pamela Anderson", aliases: [] },
    { image: "./media/07.webp", answer: "Salma Hayek", aliases: [] },
    { image: "./media/08.webp", answer: "Scarlett Johansson", aliases: [] },
    { image: "./media/09.webp", answer: "Ana de Armas", aliases: [] },
    { image: "./media/10.webp", answer: "Mia Khalifa", aliases: [] }
  ];

  const BONUS_PARTS = [
    "./media/bonus/part-00a.b64",
    "./media/bonus/part-00b.b64",
    "./media/bonus/part-01.b64",
    "./media/bonus/part-02.b64",
    "./media/bonus/part-03.b64",
    "./media/bonus/part-04.b64"
  ];

  const API_URL = "https://uiqntazgnrxwliaidkmy.supabase.co/rest/v1/rpc/boobs_quiz_api_v1";
  const API_KEY = "sb_publishable_rBDv3k3BWdnQZMDi2hjfuA_76FVf_wA";
  const STORAGE_KEY = "boobs_quiz_session_v1";

  let bonusVideoUrl = "";
  let playToken = "";
  let resumeAvailable = false;
  let gateBusy = false;

  const state = {
    round: 0,
    score: 0,
    hintUsed: false,
    answers: [],
    serverComplete: false,
    phase: "intro"
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    intro: $("introSlide"),
    guess: $("guessSlide"),
    reveal: $("revealSlide"),
    bonus: $("bonusSlide"),
    end: $("endSlide"),
    locked: $("lockedSlide"),
    introStatus: $("introStatus"),
    startButton: $("startButton"),
    roundPill: $("roundPill"),
    scorePill: $("scorePill"),
    guessRoundLabel: $("guessRoundLabel"),
    guessValueLabel: $("guessValueLabel"),
    imageStage: $("imageStage"),
    image: $("questionImage"),
    imagePlaceholder: $("imagePlaceholder"),
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
    bonusVideo: $("bonusVideo"),
    bonusVideoStatus: $("bonusVideoStatus"),
    bonusContinueButton: $("bonusContinueButton"),
    finalScore: $("finalScore"),
    finalGrade: $("finalGrade"),
    gradeCaption: $("gradeCaption"),
    bruisStamp: $("bruisStamp"),
    stampGrade: $("stampGrade"),
    approvalCopy: $("approvalCopy"),
    highscoreForm: $("highscoreForm"),
    highscoreName: $("highscoreName"),
    highscoreSubmit: $("highscoreSubmit"),
    highscoreMessage: $("highscoreMessage"),
    highscoreBody: $("highscoreBody"),
    highscoreEmpty: $("highscoreEmpty"),
    lockedHeading: $("lockedHeading"),
    lockedCopy: $("lockedCopy"),
    lockedHighscoreBody: $("lockedHighscoreBody"),
    lockedHighscoreEmpty: $("lockedHighscoreEmpty")
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

  function acceptedAnswer(input, round) {
    const candidate = normalize(input);
    if (!candidate) return false;

    return [round.answer].concat(round.aliases || []).some((answerRaw) => {
      const answer = normalize(answerRaw);
      if (candidate === answer) return true;
      const distance = levenshtein(candidate, answer);
      const maxEdits = answer.length >= 16 ? 3 : answer.length >= 8 ? 2 : 1;
      const longest = Math.max(candidate.length, answer.length);
      const similarity = longest ? 1 - distance / longest : 1;
      return distance <= maxEdits || similarity >= 0.84;
    });
  }

  function firstNameHint(answer) {
    const originalFirst = String(answer || "").trim().split(/\s+/)[0] || "";
    return originalFirst.slice(0, 3) + (originalFirst.length > 3 ? "…" : "");
  }

  function formatScore(score) {
    const n = Number(score || 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
  }

  function gradeFor(score) {
    const n = Number(score || 0);
    if (n >= 10) return { grade: "S+", caption: "Perfect. Bruis heeft niets meer om je te leren." };
    if (n >= 8.5) return { grade: "A", caption: "Verdacht goed. Bijna encyclopedisch." };
    if (n >= 7) return { grade: "B", caption: "Sterke vorm. Je weet duidelijk waar je naar kijkt." };
    if (n >= 5) return { grade: "C", caption: "Degelijk middenveld. Nog wat huiswerk te doen." };
    if (n >= 3) return { grade: "D", caption: "Een paar rake treffers, maar vooral veel mysterie." };
    return { grade: "F", caption: "Er is ruimte voor studie." };
  }

  function reducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function showSlide(target, options) {
    [els.intro, els.guess, els.reveal, els.bonus, els.end, els.locked].forEach((slide) => {
      if (!slide) return;
      const active = slide === target;
      slide.hidden = !active;
      slide.classList.toggle("is-active", active);
    });

    if (!options || options.scrollTop !== false) {
      window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }

  function centerImageStage() {
    if (!els.imageStage || els.guess.hidden) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const rect = els.imageStage.getBoundingClientRect();
        if (!rect.height) return;
        const target = Math.max(0, window.scrollY + rect.top - (window.innerHeight - rect.height) / 2);
        window.scrollTo({ top: target, behavior: reducedMotion() ? "auto" : "smooth" });
      });
    });
  }

  function updateTopbar() {
    els.scorePill.textContent = formatScore(state.score) + " / 10";
    if (state.round < 10) {
      els.roundPill.textContent = "Ronde " + (state.round + 1) + " · 10";
    } else {
      els.roundPill.textContent = state.phase === "bonus" ? "Bonus" : "Eindscore";
    }
  }

  function safeSavedSession() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.token !== "string" || !parsed.token) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function persistSession() {
    if (!playToken) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        token: playToken,
        state: {
          round: state.round,
          score: state.score,
          hintUsed: state.hintUsed,
          answers: state.answers,
          serverComplete: state.serverComplete,
          phase: state.phase
        }
      }));
    } catch (_) {}
  }

  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  function restoreLocalState(saved) {
    const s = saved && saved.state && typeof saved.state === "object" ? saved.state : {};
    const answers = Array.isArray(s.answers) ? s.answers.slice(0, 10) : [];
    state.answers = answers.map((row, index) => ({
      round: index + 1,
      input: String(row && row.input || ""),
      correct: Boolean(row && row.correct),
      hintUsed: Boolean(row && row.hintUsed),
      points: Number(row && row.points || 0)
    }));
    state.score = state.answers.reduce((total, row) => total + Number(row.points || 0), 0);
    state.round = Math.min(Math.max(0, Number(s.round || state.answers.length)), 10);
    state.hintUsed = Boolean(s.hintUsed);
    state.serverComplete = Boolean(s.serverComplete);
    state.phase = String(s.phase || "intro");
  }

  async function quizApi(action, payload) {
    const data = payload || {};
    const response = await fetch(API_URL, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "apikey": API_KEY
      },
      body: JSON.stringify({
        action_input: action,
        token_input: data.token == null ? null : data.token,
        name_input: data.name == null ? null : data.name,
        answers_input: data.answers == null ? null : data.answers
      })
    });

    const raw = await response.text();
    let result = null;
    try { result = raw ? JSON.parse(raw) : null; } catch (_) {}
    if (!response.ok) throw new Error((result && (result.message || result.error)) || ("HTTP " + response.status));
    if (!result || result.ok !== true) throw new Error((result && result.error) || "quiz_api_error");
    return result;
  }

  function renderLeaderboard(rows, body, empty) {
    if (!body) return;
    body.textContent = "";
    const list = Array.isArray(rows) ? rows : [];
    if (empty) empty.hidden = list.length > 0;

    list.forEach((row, index) => {
      const tr = document.createElement("tr");
      const rank = document.createElement("td");
      const name = document.createElement("td");
      const score = document.createElement("td");
      const grade = document.createElement("td");

      rank.textContent = String(row.rank || index + 1);
      name.textContent = String(row.name || "Anoniem");
      score.textContent = formatScore(row.score) + " / 10";
      grade.textContent = String(row.grade || gradeFor(row.score).grade);

      tr.append(rank, name, score, grade);
      body.appendChild(tr);
    });
  }

  async function loadLeaderboard(body, empty) {
    try {
      const result = await quizApi("leaderboard");
      renderLeaderboard(result.leaderboard, body, empty);
    } catch (_) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = "Highscores konden nu niet worden geladen.";
      }
    }
  }

  function setIntroStatus(message, tone) {
    els.introStatus.textContent = message || "";
    els.introStatus.dataset.tone = tone || "";
  }

  function showLocked(status) {
    updateTopbar();
    els.roundPill.textContent = "Poging gebruikt";
    els.lockedHeading.textContent = "Deze verbinding heeft al gespeeld";

    if (status && status.finished && status.name) {
      els.lockedCopy.textContent =
        status.name + " eindigde met " + formatScore(status.score) + " / 10 · " + (status.grade || gradeFor(status.score).grade) +
        ". Per openbaar IP-adres is één poging toegestaan.";
    } else if (status && status.finished) {
      els.lockedCopy.textContent =
        "De score op dit openbare IP-adres is al vastgelegd. Alleen de oorspronkelijke browsersessie kan nog een naam aan die score koppelen.";
    } else {
      els.lockedCopy.textContent =
        "Op dit openbare IP-adres is al een poging gestart. Om herkansen via refresh, incognito of een tweede apparaat te voorkomen, wordt geen tweede poging geopend.";
    }

    showSlide(els.locked);
    loadLeaderboard(els.lockedHighscoreBody, els.lockedHighscoreEmpty);
  }

  function applyHintUi() {
    const round = ROUNDS[state.round];
    els.guessValueLabel.textContent = "MAX 0,5 PUNT";
    els.hintButton.disabled = true;
    els.hintButton.innerHTML = "✦ Hint gebruikt <span>max 0,5 punt</span>";
    els.hintReveal.hidden = false;
    els.hintReveal.textContent = "Voornaam begint met: " + firstNameHint(round.answer);
  }

  function loadRound(options) {
    const opts = options || {};
    const round = ROUNDS[state.round];
    const restoreHint = Boolean(opts.restoreHint && state.hintUsed);

    if (!restoreHint) state.hintUsed = false;
    state.phase = "guess";

    els.guessRoundLabel.textContent = "RONDE " + (state.round + 1) + " VAN 10";
    els.guessValueLabel.textContent = "1 PUNT";
    els.answerInput.value = "";
    els.formMessage.textContent = "";
    els.hintReveal.hidden = true;
    els.hintReveal.textContent = "";
    els.hintButton.disabled = false;
    els.hintButton.innerHTML = "✦ Gebruik hint <span>−0,5 punt</span>";

    els.image.hidden = false;
    els.imagePlaceholder.hidden = true;
    els.image.src = round.image;
    els.image.alt = "Quizafbeelding ronde " + (state.round + 1);

    if (restoreHint) applyHintUi();

    updateTopbar();
    persistSession();
    showSlide(els.guess, { scrollTop: false });
    centerImageStage();
  }

  function useHint() {
    if (state.hintUsed) return;
    state.hintUsed = true;
    applyHintUi();
    persistSession();
  }

  function submitRound(event) {
    event.preventDefault();
    const round = ROUNDS[state.round];
    const raw = els.answerInput.value.trim();

    if (!raw) {
      els.formMessage.textContent = "Vul eerst een naam in.";
      els.answerInput.focus();
      return;
    }

    const correct = acceptedAnswer(raw, round);
    const points = correct ? (state.hintUsed ? 0.5 : 1) : 0;
    state.score += points;
    state.answers.push({
      round: state.round + 1,
      input: raw,
      correct,
      hintUsed: state.hintUsed,
      points
    });
    state.phase = "reveal";
    persistSession();

    els.revealRoundLabel.textContent = "RONDE " + (state.round + 1) + " VAN 10";
    els.roundPointsLabel.textContent = "+" + formatScore(points) + " PUNT" + (points === 1 ? "" : "EN");
    els.revealHeading.textContent = round.answer;
    els.revealKicker.textContent = "Het antwoord was…";
    els.playerAnswerLabel.textContent = raw;
    els.answerVerdict.textContent = correct ? (state.hintUsed ? "Goed · met hint" : "Goed") : "Niet goed";
    els.runningScore.textContent = formatScore(state.score) + " / 10";
    els.nextButton.disabled = false;
    els.nextButton.innerHTML = state.round === 9 ? "Naar de bonus <span>→</span>" : "Volgende ronde <span>→</span>";

    updateTopbar();
    showSlide(els.reveal);
  }

  async function completeAttempt() {
    if (state.serverComplete) return { score: state.score, grade: gradeFor(state.score).grade };
    const result = await quizApi("complete", {
      token: playToken,
      answers: state.answers.map((row) => ({ input: row.input, hintUsed: row.hintUsed }))
    });
    state.score = Number(result.score || 0);
    state.serverComplete = true;
    persistSession();
    return result;
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
        if (!response.ok) throw new Error("Bonusdeel kon niet laden: " + path);
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
    state.round = 10;
    state.phase = "bonus";
    updateTopbar();
    persistSession();
    showSlide(els.bonus);
    loadBonusVideo();
  }

  async function nextRound() {
    if (state.round >= 9) {
      els.nextButton.disabled = true;
      els.nextButton.textContent = "Score vastleggen…";
      try {
        await completeAttempt();
        showBonus();
      } catch (error) {
        els.nextButton.disabled = false;
        els.nextButton.innerHTML = "Opnieuw proberen <span>→</span>";
        els.revealKicker.textContent = "De score kon niet veilig worden vastgelegd. Probeer nogmaals.";
        console.error(error);
      }
      return;
    }

    state.round += 1;
    state.hintUsed = false;
    loadRound();
  }

  function animateResult(result) {
    const score = Number(result.score == null ? state.score : result.score);
    const computed = gradeFor(score);
    const grade = result.grade || computed.grade;

    state.score = score;
    state.serverComplete = true;
    state.phase = "end";
    updateTopbar();

    els.finalScore.textContent = formatScore(score);
    els.finalGrade.textContent = grade;
    els.gradeCaption.textContent = computed.caption;
    els.finalGrade.classList.remove("grade-pop");
    els.bruisStamp.classList.remove("stamp-in");
    els.bruisStamp.hidden = true;
    els.approvalCopy.textContent = "";

    showSlide(els.end);
    persistSession();
    loadLeaderboard(els.highscoreBody, els.highscoreEmpty);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.finalGrade.classList.add("grade-pop");
        if (score > 8) {
          els.stampGrade.textContent = grade;
          els.bruisStamp.hidden = false;
          els.bruisStamp.classList.add("stamp-in");
          els.approvalCopy.textContent = "Meer dan 8 punten: officieel voorzien van de Bruis Seal of Approval.";
        }
      });
    });
  }

  async function finishGame() {
    try {
      const result = await completeAttempt();
      animateResult(result);
    } catch (error) {
      els.bonusContinueButton.disabled = false;
      els.bonusContinueButton.textContent = "Opnieuw proberen";
      els.bonusVideoStatus.hidden = false;
      els.bonusVideoStatus.textContent = "De eindscore kon niet veilig worden vastgelegd.";
      console.error(error);
    }
  }

  async function submitHighscore(event) {
    event.preventDefault();
    const name = els.highscoreName.value.trim();
    if (!name) {
      els.highscoreMessage.textContent = "Vul een naam in.";
      els.highscoreName.focus();
      return;
    }

    els.highscoreSubmit.disabled = true;
    els.highscoreSubmit.textContent = "Opslaan…";
    els.highscoreMessage.textContent = "";

    try {
      const result = await quizApi("name", { token: playToken, name });
      state.score = Number(result.score || state.score);
      state.serverComplete = true;
      state.phase = "finished";
      persistSession();

      els.finalScore.textContent = formatScore(state.score);
      els.finalGrade.textContent = result.grade || gradeFor(state.score).grade;
      els.highscoreName.disabled = true;
      els.highscoreSubmit.hidden = true;
      els.highscoreMessage.textContent = "Opgeslagen als " + (result.name || name) + ".";
      renderLeaderboard(result.leaderboard, els.highscoreBody, els.highscoreEmpty);
    } catch (error) {
      els.highscoreSubmit.disabled = false;
      els.highscoreSubmit.textContent = "Zet mij in de highscores";
      els.highscoreMessage.textContent = "Opslaan lukte niet. Probeer nogmaals.";
      console.error(error);
    }
  }

  async function startOrResume() {
    if (gateBusy) return;
    gateBusy = true;
    els.startButton.disabled = true;

    try {
      if (resumeAvailable) {
        const saved = safeSavedSession();
        if (!saved || saved.token !== playToken) throw new Error("resume_state_missing");
        restoreLocalState(saved);

        if (state.answers.length >= 10) {
          if (state.serverComplete) {
            showBonus();
          } else {
            els.startButton.textContent = "Score herstellen…";
            await completeAttempt();
            showBonus();
          }
        } else {
          state.round = state.answers.length;
          loadRound({ restoreHint: state.hintUsed && Number(saved.state && saved.state.round) === state.round });
        }
        return;
      }

      els.startButton.textContent = "Poging openen…";
      const result = await quizApi("start");
      if (!result.allowed || !result.token) {
        showLocked(result);
        return;
      }

      playToken = result.token;
      state.round = 0;
      state.score = 0;
      state.hintUsed = false;
      state.answers = [];
      state.serverComplete = false;
      state.phase = "guess";
      persistSession();
      loadRound();
    } catch (error) {
      setIntroStatus("De poging kon niet veilig worden geopend. Probeer de pagina opnieuw te laden.", "error");
      els.startButton.disabled = false;
      els.startButton.textContent = resumeAvailable ? "Hervat spel" : "Start het spel";
      console.error(error);
    } finally {
      gateBusy = false;
    }
  }

  async function initializeGate() {
    els.startButton.disabled = true;
    els.startButton.textContent = "Poging controleren…";
    setIntroStatus("Controleren of dit openbare IP-adres al heeft gespeeld…", "neutral");

    const saved = safeSavedSession();
    playToken = saved ? saved.token : "";

    try {
      const status = await quizApi("status", { token: playToken || null });

      if (!status.played) {
        if (saved) clearSession();
        playToken = "";
        resumeAvailable = false;
        els.startButton.disabled = false;
        els.startButton.textContent = "Start het spel";
        setIntroStatus("Nog niet gespeeld op deze verbinding. Zodra je start, is dit je enige poging.", "ok");
        return;
      }

      if (status.owns && status.finished && !status.name) {
        state.score = Number(status.score || 0);
        state.serverComplete = true;
        state.round = 10;
        playToken = saved ? saved.token : playToken;
        animateResult({ score: status.score, grade: status.grade });
        setIntroStatus("", "");
        return;
      }

      if (status.owns && status.finished && status.name) {
        showLocked(status);
        return;
      }

      if (status.owns && !status.finished && saved) {
        resumeAvailable = true;
        els.startButton.disabled = false;
        els.startButton.textContent = "Hervat spel";
        setIntroStatus("Je lopende poging is gevonden. Je gaat verder waar je gebleven was.", "ok");
        return;
      }

      showLocked(status);
    } catch (error) {
      resumeAvailable = false;
      els.startButton.disabled = true;
      els.startButton.textContent = "Niet beschikbaar";
      setIntroStatus("De één-poging-controle is tijdelijk niet bereikbaar. Het spel blijft geblokkeerd zodat de IP-regel niet kan worden omzeild.", "error");
      console.error(error);
    }
  }

  els.image.addEventListener("load", centerImageStage);
  els.image.addEventListener("error", () => {
    els.image.hidden = true;
    els.imagePlaceholder.hidden = false;
    els.formMessage.textContent = "De afbeelding kon niet worden geladen.";
    centerImageStage();
  });

  els.startButton.addEventListener("click", startOrResume);
  els.hintButton.addEventListener("click", useHint);
  els.answerForm.addEventListener("submit", submitRound);
  els.nextButton.addEventListener("click", nextRound);
  els.bonusContinueButton.addEventListener("click", finishGame);
  els.highscoreForm.addEventListener("submit", submitHighscore);

  window.addEventListener("beforeunload", () => {
    if (bonusVideoUrl) URL.revokeObjectURL(bonusVideoUrl);
  });

  updateTopbar();
  initializeGate();
})();