(function(global){
  function safeNumber(v){ const n=Number(v||0); return Number.isFinite(n)?n:0; }
  function summarizePlayer(row){
    const score=safeNumber(row && row.cross_game_score); const games=safeNumber(row && (row.games_played_count||row.game_count)); const specials=safeNumber(row && row.special_count);
    const label = score >= 100 ? 'Allround gevaar' : score >= 50 ? 'Brede speler' : games > 1 ? 'In opbouw' : 'Specialist';
    return { label, score, games, specials };
  }
  global.GEJAST_CROSS_GAME_INSIGHTS={summarizePlayer};
})(window);
