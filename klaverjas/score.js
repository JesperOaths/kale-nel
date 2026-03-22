let game = {
  started: false,
  scoreWij: 0,
  scoreZij: 0,
  roemWij: 0,
  roemZij: 0,
  nat: false,
  pit: false,
  rounds: []
};

function startGame() {
  game.started = true;
  document.getElementById("game").classList.remove("hidden");
}

function addRoem(val) {
  game.roemWij += val;
}

function setNat() {
  game.nat = true;
}

function setPit() {
  game.pit = true;
}

function submitRound() {
  let input = parseInt(document.getElementById("points-input").value);
  if (isNaN(input)) return;

  let total = 162;
  let other = total - input;

  let wij = input;
  let zij = other;

  if (game.nat) {
    wij = 0;
    zij = total + game.roemWij + game.roemZij;
  }

  if (game.pit) {
    wij = total + 10;
    zij = 0;
  }

  wij = Math.round(wij / 10);
  zij = Math.round(zij / 10);

  game.scoreWij += wij;
  game.scoreZij += zij;

  game.rounds.push({ wij, zij });

  render();
  resetRound();
}

function resetRound() {
  game.roemWij = 0;
  game.roemZij = 0;
  game.nat = false;
  game.pit = false;
  document.getElementById("points-input").value = "";
}

function render() {
  document.getElementById("score-wij").innerText = game.scoreWij;
  document.getElementById("score-zij").innerText = game.scoreZij;

  let history = document.getElementById("history");
  history.innerHTML = game.rounds.map((r,i)=>
    `<div>R${i+1}: ${r.wij} - ${r.zij}</div>`
  ).join("");
}
