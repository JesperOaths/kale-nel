(function(){
  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

  function roundedRectPath(ctx, x, y, w, h, r){
    const rr = clamp(r, 0, Math.min(w, h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawPip(ctx, x, y, r, color){
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function pipLayout(face){
    // Returns array of [gx,gy] on a 3x3 grid: 0(left/top), 1(center), 2(right/bottom)
    switch (Number(face)) {
      case 1: return [[1,1]];
      case 2: return [[0,0],[2,2]];
      case 3: return [[0,0],[1,1],[2,2]];
      case 4: return [[0,0],[2,0],[0,2],[2,2]];
      case 5: return [[0,0],[2,0],[1,1],[0,2],[2,2]];
      case 6: return [[0,0],[2,0],[0,1],[2,1],[0,2],[2,2]];
      default: return [];
    }
  }

  function drawDie(ctx, face, x, y, size, opts){
    const o = Object.assign({
      border: 'rgba(0,0,0,.12)',
      pip: '#201b16',
      pikPip: '#9a8241',
      bg0: '#ffffff',
      bg1: '#f3eee4',
      highlight: 'rgba(255,255,255,.65)',
      radius: 0.24,   // relative
      inset: 0.10,    // relative
      pipRadius: 0.075,
      crisp: true
    }, opts || {});

    const s = Number(size || 64);
    const px = Number(x || 0), py = Number(y || 0);

    // Optional crisp alignment
    const ax = o.crisp ? Math.round(px) + 0.5 : px;
    const ay = o.crisp ? Math.round(py) + 0.5 : py;

    const r = s * o.radius;
    const inset = s * o.inset;

    // Background
    const grad = ctx.createLinearGradient(ax + s*0.12, ay + s*0.10, ax + s*0.88, ay + s*0.92);
    grad.addColorStop(0, o.bg0);
    grad.addColorStop(1, o.bg1);

    roundedRectPath(ctx, ax, ay, s, s, r);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, s * 0.02);
    ctx.strokeStyle = o.border;
    ctx.stroke();

    // Inner highlight
    roundedRectPath(ctx, ax + inset, ay + inset, s - inset*2, s - inset*2, r - inset*0.6);
    ctx.lineWidth = Math.max(1.5, s * 0.02);
    ctx.strokeStyle = o.highlight;
    ctx.stroke();

    // Pips
    const pipR = s * o.pipRadius;
    const left = ax + s * 0.32;
    const mid = ax + s * 0.50;
    const right = ax + s * 0.68;
    const top = ay + s * 0.32;
    const center = ay + s * 0.50;
    const bottom = ay + s * 0.68;

    const gridX = [left, mid, right];
    const gridY = [top, center, bottom];
    const pipColor = Number(face) === 1 ? o.pikPip : o.pip;

    pipLayout(face).forEach(([gx,gy])=> drawPip(ctx, gridX[gx], gridY[gy], pipR, pipColor));
  }

  function renderDieToCanvas(face, size, opts){
    const s = Number(size || 96);
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d');
    drawDie(ctx, face, 0, 0, s, opts);
    return c;
  }

  function renderDieDataUrl(face, size, opts){
    return renderDieToCanvas(face, size, opts).toDataURL('image/png');
  }

  window.PIKKEN_DICE_ART = { drawDie, renderDieToCanvas, renderDieDataUrl };
})();

