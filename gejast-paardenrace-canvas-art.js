(function (global) {
  const PALETTE = {
    paper: "#f7f0e2",
    paperWarm: "#ecdfc8",
    paperCool: "#fdfaf4",
    ink: "#17120e",
    inkSoft: "#33281f",
    muted: "#706255",
    gold: "#9a8241",
    goldSoft: "#d7c089",
    goldBright: "#eadab0",
    line: "rgba(23,18,14,0.1)",
    shadow: "rgba(24,17,11,0.18)",
    felt: "#cad2bb",
    feltDeep: "#b8c3a6",
    dust: "#d7be96",
    chalk: "rgba(255,255,255,0.72)",
    darkCard: "#34291f",
    darkCard2: "#44372a",
    darkCard3: "#241c16"
  };

  const SUITS = {
    hearts: {
      key: "hearts",
      label: "Harten",
      short: "A",
      color: "#8f3f39",
      light: "#d6aa9f",
      dark: "#5f2724",
      lane: "rgba(143,63,57,0.12)"
    },
    diamonds: {
      key: "diamonds",
      label: "Ruiten",
      short: "A",
      color: "#b96d58",
      light: "#e0b9ab",
      dark: "#7a4638",
      lane: "rgba(185,109,88,0.12)"
    },
    clubs: {
      key: "clubs",
      label: "Klaveren",
      short: "A",
      color: "#55674f",
      light: "#b2bea0",
      dark: "#33402f",
      lane: "rgba(85,103,79,0.13)"
    },
    spades: {
      key: "spades",
      label: "Schoppen",
      short: "A",
      color: "#3e4652",
      light: "#aeb6c3",
      dark: "#242a33",
      lane: "rgba(62,70,82,0.13)"
    }
  };

  const SUIT_ORDER = ["hearts", "diamonds", "clubs", "spades"];

  const ASSET_PROMISES = [];
  const DOUBLE_D_MONOGRAM = typeof global.Image === "function" ? new global.Image() : null;
  if (DOUBLE_D_MONOGRAM) {
    DOUBLE_D_MONOGRAM.decoding = "async";
    DOUBLE_D_MONOGRAM.src = "./dubbeleD-goud.png";
    ASSET_PROMISES.push(
      new Promise((resolve) => {
        if (DOUBLE_D_MONOGRAM.complete && DOUBLE_D_MONOGRAM.naturalWidth) {
          resolve(true);
          return;
        }
        const done = () => resolve(true);
        DOUBLE_D_MONOGRAM.addEventListener("load", done, { once: true });
        DOUBLE_D_MONOGRAM.addEventListener("error", done, { once: true });
      })
    );
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function fitCanvas(canvas, width, height) {
    const node = canvas || document.createElement("canvas");
    const ratio = clamp(global.devicePixelRatio || 1, 1, 2);
    node.width = Math.round(width * ratio);
    node.height = Math.round(height * ratio);
    node.style.width = width + "px";
    node.style.height = height + "px";
    const ctx = node.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { canvas: node, ctx, width, height };
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function fillRoundedRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle, lineWidth) {
    ctx.save();
    roundedRectPath(ctx, x, y, width, height, radius);
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function paperGradient(ctx, x, y, width, height, accent) {
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, PALETTE.paperCool);
    gradient.addColorStop(0.48, PALETTE.paper);
    gradient.addColorStop(1, accent || PALETTE.paperWarm);
    return gradient;
  }

  function addSpeckles(ctx, x, y, width, height, color, count) {
    ctx.save();
    ctx.fillStyle = color;
    for (let i = 0; i < count; i += 1) {
      const px = x + ((i * 37) % width);
      const py = y + ((i * 23) % height);
      const ox = Math.sin(i * 0.91) * 7;
      const oy = Math.cos(i * 1.17) * 7;
      const r = 0.4 + ((i * 13) % 10) / 10;
      ctx.beginPath();
      ctx.arc(px + ox, py + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawInnerGlow(ctx, x, y, width, height, radius) {
    ctx.save();
    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.clip();
    const glow = ctx.createRadialGradient(
      x + width * 0.42,
      y + height * 0.24,
      10,
      x + width * 0.42,
      y + height * 0.24,
      width * 0.85
    );
    glow.addColorStop(0, "rgba(255,255,255,0.52)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
  }

  function drawSuitShape(ctx, suitKey, x, y, size, fillStyle, strokeStyle) {
    const suit = SUITS[suitKey];
    const scale = size / 100;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = fillStyle || (suit ? suit.color : PALETTE.ink);
    ctx.strokeStyle = strokeStyle || "transparent";
    ctx.lineWidth = 4;
    ctx.beginPath();

    if (suitKey === "hearts") {
      ctx.moveTo(0, 40);
      ctx.bezierCurveTo(-10, 24, -36, 8, -36, -12);
      ctx.bezierCurveTo(-36, -34, -12, -46, 0, -24);
      ctx.bezierCurveTo(12, -46, 36, -34, 36, -12);
      ctx.bezierCurveTo(36, 8, 10, 24, 0, 40);
      ctx.closePath();
    } else if (suitKey === "diamonds") {
      ctx.moveTo(0, -42);
      ctx.lineTo(34, 0);
      ctx.lineTo(0, 42);
      ctx.lineTo(-34, 0);
      ctx.closePath();
    } else if (suitKey === "clubs") {
      ctx.arc(-18, -8, 18, 0, Math.PI * 2);
      ctx.moveTo(18, -8);
      ctx.arc(18, -8, 18, 0, Math.PI * 2);
      ctx.moveTo(0, -26);
      ctx.arc(0, -26, 18, 0, Math.PI * 2);
      ctx.moveTo(-12, -6);
      ctx.lineTo(12, -6);
      ctx.lineTo(18, 34);
      ctx.lineTo(-18, 34);
      ctx.closePath();
    } else {
      ctx.moveTo(0, -46);
      ctx.bezierCurveTo(-10, -20, -38, -6, -38, 18);
      ctx.bezierCurveTo(-38, 42, -12, 44, 0, 22);
      ctx.bezierCurveTo(12, 44, 38, 42, 38, 18);
      ctx.bezierCurveTo(38, -6, 10, -20, 0, -46);
      ctx.lineTo(16, 44);
      ctx.lineTo(-16, 44);
      ctx.closePath();
    }

    ctx.fill();
    if (strokeStyle) {
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRibbon(ctx, x, y, width, height, suitKey, text) {
    const suit = SUITS[suitKey];
    const ribbon = ctx.createLinearGradient(x, y, x, y + height);
    ribbon.addColorStop(0, suit.light);
    ribbon.addColorStop(1, suit.color);
    fillRoundedRect(ctx, x, y, width, height, height / 2, ribbon, "rgba(23,18,14,0.08)", 1);
    ctx.fillStyle = "rgba(255,255,255,0.26)";
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 7);
    ctx.lineTo(x + width - 14, y + 7);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = "800 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, x + width / 2, y + height / 2 + 4);
    ctx.textAlign = "left";
  }

  function drawRosette(ctx, x, y, radius, suitKey) {
    const suit = SUITS[suitKey];
    ctx.save();
    for (let i = 0; i < 16; i += 1) {
      const angle = (Math.PI * 2 * i) / 16;
      const px = x + Math.cos(angle) * radius * 0.8;
      const py = y + Math.sin(angle) * radius * 0.8;
      ctx.fillStyle = i % 2 ? suit.light : PALETTE.goldBright;
      ctx.beginPath();
      ctx.arc(px, py, radius * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.gold;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = paperGradient(ctx, x - radius, y - radius, radius * 2, radius * 2, suit.light);
    ctx.fill();
    drawSuitShape(ctx, suitKey, x, y, radius * 0.78, suit.color);
    ctx.restore();
  }

  function drawHorsePortrait(ctx, x, y, scale, suitKey) {
    const s = scale || 1;
    const pose =
      suitKey === "hearts"
        ? { scaleX: 0.98, scaleY: 1.04, rotate: -0.04, dx: 0, dy: -4 }
        : suitKey === "diamonds"
          ? { scaleX: 1.02, scaleY: 0.92, rotate: 0, dx: 2, dy: 4 }
          : suitKey === "clubs"
            ? { scaleX: 1.08, scaleY: 0.9, rotate: 0.03, dx: 2, dy: 6 }
            : { scaleX: 1.1, scaleY: 0.88, rotate: -0.02, dx: 4, dy: 5 };
    ctx.save();
    ctx.translate(x + pose.dx, y + pose.dy);
    ctx.rotate(pose.rotate);
    ctx.scale(s * pose.scaleX, s * pose.scaleY);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.fillStyle = "rgba(23,18,14,0.08)";
    ctx.beginPath();
    ctx.ellipse(4, 94, 88, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = PALETTE.ink;

    ctx.beginPath();
    ctx.moveTo(-62, 12);
    ctx.quadraticCurveTo(-88, 6, -92, -20);
    ctx.quadraticCurveTo(-92, -48, -74, -72);
    ctx.quadraticCurveTo(-54, -98, -24, -92);
    ctx.quadraticCurveTo(-2, -88, 12, -66);
    ctx.quadraticCurveTo(28, -72, 52, -68);
    ctx.quadraticCurveTo(86, -62, 104, -40);
    ctx.quadraticCurveTo(120, -18, 122, 10);
    ctx.quadraticCurveTo(116, 34, 96, 44);
    ctx.quadraticCurveTo(82, 52, 64, 50);
    ctx.quadraticCurveTo(42, 44, 18, 42);
    ctx.quadraticCurveTo(-10, 40, -32, 46);
    ctx.quadraticCurveTo(-52, 48, -62, 30);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(88, 2);
    ctx.quadraticCurveTo(108, -24, 118, -64);
    ctx.quadraticCurveTo(122, -28, 114, 2);
    ctx.quadraticCurveTo(126, -4, 136, 4);
    ctx.quadraticCurveTo(128, 22, 110, 34);
    ctx.quadraticCurveTo(96, 38, 84, 28);
    ctx.quadraticCurveTo(86, 16, 88, 2);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-86, -40);
    ctx.quadraticCurveTo(-90, -68, -74, -88);
    ctx.quadraticCurveTo(-56, -102, -34, -96);
    ctx.quadraticCurveTo(-18, -90, -14, -76);
    ctx.quadraticCurveTo(-26, -64, -34, -50);
    ctx.quadraticCurveTo(-48, -24, -74, -26);
    ctx.quadraticCurveTo(-82, -28, -86, -40);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-66, -88);
    ctx.lineTo(-54, -108);
    ctx.lineTo(-40, -86);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-44, 24);
    ctx.quadraticCurveTo(-62, 44, -70, 64);
    ctx.lineTo(-60, 112);
    ctx.lineTo(-44, 112);
    ctx.lineTo(-38, 66);
    ctx.quadraticCurveTo(-32, 48, -16, 34);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-4, 30);
    ctx.quadraticCurveTo(-12, 50, -8, 72);
    ctx.lineTo(0, 112);
    ctx.lineTo(16, 112);
    ctx.lineTo(14, 74);
    ctx.quadraticCurveTo(14, 52, 24, 34);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(42, 40);
    ctx.quadraticCurveTo(36, 58, 40, 78);
    ctx.lineTo(46, 112);
    ctx.lineTo(62, 112);
    ctx.lineTo(60, 74);
    ctx.quadraticCurveTo(58, 54, 68, 38);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(74, 34);
    ctx.quadraticCurveTo(92, 18, 102, -6);
    ctx.quadraticCurveTo(110, 20, 108, 58);
    ctx.lineTo(120, 118);
    ctx.lineTo(104, 118);
    ctx.lineTo(92, 62);
    ctx.quadraticCurveTo(88, 46, 74, 34);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-66, -74);
    ctx.quadraticCurveTo(-40, -110, -6, -98);
    ctx.quadraticCurveTo(10, -92, 24, -80);
    ctx.quadraticCurveTo(4, -82, -16, -72);
    ctx.quadraticCurveTo(-30, -64, -44, -48);
    ctx.quadraticCurveTo(-54, -54, -66, -74);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawHorsePanel(ctx, x, y, width, height, suitKey, options) {
    const suit = SUITS[suitKey];
    const opts = options || {};
    fillRoundedRect(ctx, x, y, width, height, 24, "rgba(255,252,247,0.8)", "rgba(23,18,14,0.06)", 1);
    ctx.save();
    roundedRectPath(ctx, x + 6, y + 6, width - 12, height - 12, 20);
    ctx.clip();
    const wash = ctx.createLinearGradient(x, y, x, y + height);
    wash.addColorStop(0, "rgba(255,255,255,0.36)");
    wash.addColorStop(1, suit.lane);
    ctx.fillStyle = wash;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
    addSpeckles(ctx, x + 10, y + 10, width - 20, height - 20, "rgba(154,130,65,0.03)", 28);

    drawHorsePortrait(
      ctx,
      x + width * 0.5,
      y + height * 0.58,
      Math.min(width / 360, height / 270) * (opts.scale || 1),
      suitKey
    );

    if (opts.showSuit !== false) {
      drawSuitShape(ctx, suitKey, x + 26, y + height - 24, 14, suit.color);
    }
  }

  function drawSuitStamp(canvas, suitKey, options) {
    const opts = options || {};
    const width = opts.width || 140;
    const height = opts.height || 140;
    const fitted = fitCanvas(canvas, width, height);
    const ctx = fitted.ctx;
    const suit = SUITS[suitKey];

    ctx.clearRect(0, 0, width, height);
    fillRoundedRect(ctx, 8, 8, width - 16, height - 16, 34, paperGradient(ctx, 8, 8, width - 16, height - 16, suit.light), "rgba(23,18,14,0.08)", 1.2);
    drawInnerGlow(ctx, 8, 8, width - 16, height - 16, 34);
    addSpeckles(ctx, 14, 14, width - 28, height - 28, "rgba(154,130,65,0.06)", 90);
    drawRosette(ctx, width / 2, height / 2 - 8, Math.min(width, height) * 0.22, suitKey);
    drawRibbon(ctx, width / 2 - 38, height - 42, 76, 18, suitKey, suit.label.slice(0, 3));
    return fitted.canvas;
  }

  function drawCard(canvas, options) {
    const opts = options || {};
    const width = opts.width || 220;
    const height = opts.height || 308;
    const fitted = fitCanvas(canvas, width, height);
    const ctx = fitted.ctx;
    const suitKey = opts.suit || "hearts";
    const suit = SUITS[suitKey];
    const faceDown = !!opts.faceDown;
    const rank = String(opts.rank || "A").toUpperCase();
    const compact = width < 70 || height < 100;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.shadowColor = PALETTE.shadow;
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 16;

    const backGradient = ctx.createLinearGradient(0, 0, width, height);
    backGradient.addColorStop(0, PALETTE.darkCard2);
    backGradient.addColorStop(0.55, PALETTE.darkCard);
    backGradient.addColorStop(1, PALETTE.darkCard3);

    fillRoundedRect(
      ctx,
      12,
      12,
      width - 24,
      height - 24,
      28,
      faceDown ? backGradient : paperGradient(ctx, 12, 12, width - 24, height - 24, suit.light),
      "rgba(23,18,14,0.12)",
      1.5
    );
    ctx.restore();

    if (faceDown) {
      const outerInset = compact ? 12 : 24;
      const innerInset = compact ? 18 : 34;
      const outerWidth = Math.max(18, width - outerInset * 2);
      const outerHeight = Math.max(18, height - outerInset * 2);
      const innerWidth = Math.max(14, width - innerInset * 2);
      const innerHeight = Math.max(14, height - innerInset * 2);

      fillRoundedRect(ctx, outerInset, outerInset, outerWidth, outerHeight, Math.min(22, outerWidth / 2, outerHeight / 2), PALETTE.darkCard3, "rgba(234,218,176,0.26)", 1.2);
      fillRoundedRect(ctx, innerInset, innerInset, innerWidth, innerHeight, Math.min(18, innerWidth / 2, innerHeight / 2), "rgba(255,255,255,0.008)", "rgba(234,218,176,0.16)", 1);

      ctx.save();
      roundedRectPath(ctx, innerInset + 2, innerInset + 2, innerWidth - 4, innerHeight - 4, Math.min(16, innerWidth / 2, innerHeight / 2));
      ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,0.012)";
      ctx.fillRect(innerInset, innerInset, innerWidth, innerHeight);
      ctx.strokeStyle = "rgba(234,218,176,0.065)";
      ctx.lineWidth = 1;
      const lineCount = compact ? 6 : 9;
      const lineInsetX = compact ? 14 : 22;
      for (let i = 0; i < lineCount; i += 1) {
        const y = innerInset + innerHeight * (0.14 + (i / (lineCount - 1)) * 0.72);
        const yy = Math.round(y) + 0.5;
        ctx.beginPath();
        ctx.moveTo(innerInset + lineInsetX, yy);
        ctx.lineTo(innerInset + innerWidth - lineInsetX, yy);
        ctx.stroke();
      }
      ctx.restore();

      function drawBackMonogram(cx, cy, size) {
        const gold = ctx.createLinearGradient(cx - size, cy - size, cx + size, cy + size);
        gold.addColorStop(0, PALETTE.goldBright);
        gold.addColorStop(0.42, PALETTE.goldSoft);
        gold.addColorStop(1, PALETTE.gold);

        if (DOUBLE_D_MONOGRAM && DOUBLE_D_MONOGRAM.complete && DOUBLE_D_MONOGRAM.naturalWidth) {
          const aspect = DOUBLE_D_MONOGRAM.naturalWidth / DOUBLE_D_MONOGRAM.naturalHeight;
          const targetWidth = size;
          const targetHeight = targetWidth / aspect;
          const x = cx - targetWidth / 2;
          const y = cy - targetHeight / 2;
          const shadowBlur = Math.max(10, size * 0.12);

          const monoCanvas = document.createElement("canvas");
          monoCanvas.width = Math.ceil(targetWidth);
          monoCanvas.height = Math.ceil(targetHeight);
          const monoCtx = monoCanvas.getContext("2d");
          monoCtx.imageSmoothingEnabled = true;
          monoCtx.drawImage(DOUBLE_D_MONOGRAM, 0, 0, targetWidth, targetHeight);

          const monoGold = monoCtx.createLinearGradient(0, 0, targetWidth, targetHeight);
          monoGold.addColorStop(0, PALETTE.goldBright);
          monoGold.addColorStop(0.42, PALETTE.goldSoft);
          monoGold.addColorStop(1, PALETTE.gold);
          monoCtx.globalCompositeOperation = "source-atop";
          monoCtx.fillStyle = monoGold;
          monoCtx.fillRect(0, 0, targetWidth, targetHeight);

          monoCtx.globalAlpha = 0.16;
          const highlight = monoCtx.createLinearGradient(0, 0, 0, targetHeight);
          highlight.addColorStop(0, "rgba(255,255,255,0.9)");
          highlight.addColorStop(0.35, "rgba(255,255,255,0.12)");
          highlight.addColorStop(0.7, "rgba(255,255,255,0)");
          monoCtx.fillStyle = highlight;
          monoCtx.fillRect(0, 0, targetWidth, targetHeight);
          monoCtx.globalAlpha = 1;
          monoCtx.globalCompositeOperation = "source-over";

          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.42)";
          ctx.shadowBlur = shadowBlur;
          ctx.shadowOffsetY = Math.max(3, shadowBlur * 0.22);
          ctx.drawImage(monoCanvas, x, y);
          ctx.restore();
          return;
        }

        const ringRx = size * 0.33;
        const ringRy = size * 0.4;
        const offsetX = size * 0.18;
        const stroke = Math.max(5, size * 0.14);

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowColor = "rgba(0,0,0,0.38)";
        ctx.shadowBlur = stroke * 0.9;
        ctx.shadowOffsetY = stroke * 0.18;
        ctx.strokeStyle = gold;
        ctx.lineWidth = stroke;

        ctx.beginPath();
        ctx.ellipse(cx - offsetX, cy, ringRx, ringRy, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx + offsetX, cy, ringRx, ringRy, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      drawBackMonogram(width / 2, height / 2, Math.min(width, height) * (compact ? 0.34 : 0.46));
      return fitted.canvas;
    }

    const innerInset = compact ? 10 : 14;
    fillRoundedRect(ctx, innerInset, innerInset, width - innerInset * 2, height - innerInset * 2, 22, "rgba(255,252,247,0.68)", "rgba(23,18,14,0.05)", 1);
    addSpeckles(ctx, 18, 18, width - 36, height - 36, "rgba(154,130,65,0.02)", 40);

    ctx.fillStyle = suit.color;
    ctx.font = "800 " + (compact ? 18 : 30) + "px Georgia, serif";
    ctx.fillText(rank, compact ? 18 : 28, compact ? 32 : 48);
    drawSuitShape(ctx, suitKey, compact ? 24 : 34, compact ? 48 : 72, compact ? 14 : 18, suit.color);

    ctx.save();
    ctx.translate(compact ? width - 18 : width - 28, compact ? height - 30 : height - 46);
    ctx.rotate(Math.PI);
    ctx.fillStyle = suit.color;
    ctx.font = "800 " + (compact ? 18 : 30) + "px Georgia, serif";
    ctx.fillText(rank, 0, 0);
    drawSuitShape(ctx, suitKey, compact ? 8 : 14, compact ? 14 : 20, compact ? 14 : 18, suit.color);
    ctx.restore();

    if (compact) {
      drawHorsePortrait(ctx, width / 2, height * 0.66, Math.min(width / 340, height / 270) * 0.8, suitKey);
    } else {
      drawHorsePortrait(ctx, width * 0.54, height * 0.6, Math.min(width / 310, height / 250) * 1.02, suitKey);
    }

    return fitted.canvas;
  }

  function drawHorseToken(canvas, suitKey, options) {
    const opts = options || {};
    const width = opts.width || 220;
    const height = opts.height || 170;
    const fitted = fitCanvas(canvas, width, height);
    const ctx = fitted.ctx;
    const suit = SUITS[suitKey];

    ctx.clearRect(0, 0, width, height);
    fillRoundedRect(ctx, 10, 12, width - 20, height - 24, 28, "rgba(255,252,247,0.8)", "rgba(23,18,14,0.08)", 1);
    ctx.save();
    roundedRectPath(ctx, 16, 18, width - 32, height - 36, 24);
    ctx.clip();
    const wash = ctx.createLinearGradient(0, 0, width, height);
    wash.addColorStop(0, "rgba(255,255,255,0.34)");
    wash.addColorStop(1, suit.lane);
    ctx.fillStyle = wash;
    ctx.fillRect(16, 18, width - 32, height - 36);
    ctx.restore();
    drawHorsePortrait(ctx, width * 0.54, height * 0.54, Math.min(width / 300, height / 230) * 0.96, suitKey);
    drawSuitShape(ctx, suitKey, width * 0.16, height - 28, 16, suit.color);
    return fitted.canvas;
  }

  function drawLaneBadge(ctx, x, y, width, height, suitKey) {
    const suit = SUITS[suitKey];
    fillRoundedRect(ctx, x, y, width, height, 18, paperGradient(ctx, x, y, width, height, suit.light), "rgba(23,18,14,0.08)", 1);
    drawRosette(ctx, x + 24, y + height / 2, 15, suitKey);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = "800 16px Inter, system-ui, sans-serif";
    ctx.fillText(suit.label, x + 48, y + 24);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.fillText("renner", x + 48, y + 40);
  }

  function drawBetSlip(ctx, x, y, width, height, suitKey, odds) {
    const suit = SUITS[suitKey];
    fillRoundedRect(ctx, x, y, width, height, 16, "rgba(255,251,245,0.86)", "rgba(23,18,14,0.08)", 1);
    ctx.strokeStyle = "rgba(154,130,65,0.18)";
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(x + 14, y + height * 0.54);
    ctx.lineTo(x + width - 14, y + height * 0.54);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    ctx.fillText("ticket", x + 16, y + 21);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = "800 18px Inter, system-ui, sans-serif";
    ctx.fillText(odds, x + 16, y + 44);
    drawSuitShape(ctx, suitKey, x + width - 24, y + 24, 16, suit.color);
  }

  function drawCoin(ctx, x, y, radius, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation || 0);
    const gradient = ctx.createRadialGradient(0, 0, 4, 0, 0, radius);
    gradient.addColorStop(0, PALETTE.goldBright);
    gradient.addColorStop(0.65, PALETTE.goldSoft);
    gradient.addColorStop(1, PALETTE.gold);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(103,83,42,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.62, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.stroke();
    ctx.fillStyle = "rgba(103,83,42,0.7)";
    ctx.font = "700 " + Math.round(radius * 0.9) + "px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("B", 0, 1);
    ctx.restore();
  }

  function drawTrack(canvas, options) {
    const opts = options || {};
    const width = opts.width || 1400;
    const height = opts.height || 980;
    const fitted = fitCanvas(canvas, width, height);
    const ctx = fitted.ctx;

    const outer = 24;
    const laneCount = 4;
    const totalCols = 12;
    const raceCols = 10;
    const cellGap = 10;
    const cellWidth = 80;
    const cellHeight = 104;
    const rowGap = 16;
    const boardX = 248;
    const gateY = 172;
    const gateHeight = 84;
    const laneStartY = gateY + gateHeight + 36;
    const boardWidth = totalCols * cellWidth + (totalCols - 1) * cellGap;
    const trackHeight = laneCount * cellHeight + (laneCount - 1) * rowGap;
    const boardHeight = gateHeight + 36 + trackHeight;
    const gateX = boardX + cellWidth + cellGap;
    const startBandX = boardX + cellWidth;
    const finishBandX = boardX + (cellWidth + cellGap) * 11 - cellGap;
    const startLabelX = startBandX + cellGap / 2;
    const finishLabelX = finishBandX + cellGap / 2;

    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "rgba(255,251,245,0.98)");
    bg.addColorStop(0.6, "#efe5d2");
    bg.addColorStop(1, "#e8dbc1");
    fillRoundedRect(ctx, outer, outer, width - outer * 2, height - outer * 2, 38, bg, "rgba(255,255,255,0.66)", 1.4);
    drawInnerGlow(ctx, outer, outer, width - outer * 2, height - outer * 2, 38);
    addSpeckles(ctx, 44, 44, width - 88, height - 88, "rgba(154,130,65,0.03)", 140);

    fillRoundedRect(ctx, 56, 58, width - 112, 86, 28, "rgba(255,255,255,0.62)", "rgba(23,18,14,0.08)", 1);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = "800 34px Georgia, serif";
    ctx.fillText("Paardenrace", 86, 108);

    fillRoundedRect(ctx, 94, gateY - 12, boardX + boardWidth - 28, boardHeight + 28, 34, "rgba(255,255,255,0.4)", "rgba(23,18,14,0.06)", 1.1);
    fillRoundedRect(ctx, boardX - 20, gateY - 16, boardWidth + 40, boardHeight + 32, 34, "rgba(255,255,255,0.24)", "rgba(23,18,14,0.05)", 1);

    fillRoundedRect(ctx, gateX - 10, gateY - 18, raceCols * cellWidth + (raceCols - 1) * cellGap + 20, gateHeight + 28, 24, "rgba(255,255,255,0.52)", "rgba(23,18,14,0.08)", 1);

    for (let col = 0; col < raceCols; col += 1) {
      const slotX = gateX + col * (cellWidth + cellGap);
      fillRoundedRect(ctx, slotX, gateY, cellWidth, gateHeight, 18, "rgba(255,251,245,0.72)", "rgba(23,18,14,0.08)", 1);
      fillRoundedRect(ctx, slotX + 8, gateY + 6, cellWidth - 16, gateHeight - 12, 14, "rgba(23,18,14,0.02)", "rgba(23,18,14,0.06)", 1);
    }

    function drawCheckBand(x, y, h) {
      const square = 5;
      const cols = 2;
      const rows = Math.ceil(h / square);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          ctx.fillStyle = (row + col) % 2 ? "rgba(23,18,14,0.42)" : "rgba(255,255,255,0.84)";
          ctx.fillRect(x + col * square, y + row * square, square, square);
        }
      }
      ctx.strokeStyle = "rgba(23,18,14,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, square * cols, h);
    }

    drawCheckBand(startBandX, laneStartY - 10, trackHeight + 20);
    drawCheckBand(finishBandX, laneStartY - 10, trackHeight + 20);

    function drawChipLabel(text, centerX, y) {
      ctx.save();
      ctx.font = "900 11px Inter, system-ui, sans-serif";
      const paddingX = 10;
      const width = Math.ceil(ctx.measureText(text).width + paddingX * 2);
      const height = 22;
      fillRoundedRect(ctx, Math.round(centerX - width / 2), y, width, height, height / 2, "rgba(255,251,245,0.88)", "rgba(23,18,14,0.08)", 1);
      ctx.fillStyle = "rgba(23,18,14,0.75)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, centerX, y + height / 2 + 0.5);
      ctx.restore();
    }

    const chipY = laneStartY - 30;
    drawChipLabel("START", startLabelX, chipY);
    drawChipLabel("FINISH", finishLabelX, chipY);

    for (let row = 0; row < laneCount; row += 1) {
      const suitKey = SUIT_ORDER[row];
      const suit = SUITS[suitKey];
      const rowY = laneStartY + row * (cellHeight + rowGap);

      const labelX = 112;
      const labelY = rowY + 8;
      const labelWidth = 108;
      const labelHeight = cellHeight - 16;
      fillRoundedRect(ctx, labelX, labelY, labelWidth, labelHeight, 24, paperGradient(ctx, labelX, labelY, labelWidth, labelHeight, suit.light), "rgba(23,18,14,0.08)", 1);

      const stampSize = 46;
      const stamp = drawSuitStamp(null, suitKey, { width: stampSize, height: stampSize });
      const stampX = labelX + Math.round((labelWidth - stampSize) / 2);
      const stampY = labelY + 10;
      ctx.drawImage(stamp, stampX, stampY, stampSize, stampSize);

      const centerX = labelX + labelWidth / 2;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";

      ctx.fillStyle = PALETTE.ink;
      let suitFontSize = 14;
      ctx.font = "800 " + suitFontSize + "px Georgia, serif";
      if (ctx.measureText(suit.label).width > labelWidth - 14) {
        suitFontSize = 12;
        ctx.font = "800 " + suitFontSize + "px Georgia, serif";
      }
      ctx.fillText(suit.label, centerX, labelY + 70);

      ctx.restore();

      for (let col = 0; col < totalCols; col += 1) {
        const cellX = boardX + col * (cellWidth + cellGap);
        const isStart = col === 0;
        const isFinish = col === totalCols - 1;
        const cellFill = isFinish
          ? "rgba(234,218,176,0.32)"
          : isStart
            ? "rgba(255,251,245,0.82)"
            : "rgba(255,251,245,0.72)";
        const cellStroke = isFinish ? "rgba(154,130,65,0.24)" : "rgba(23,18,14,0.1)";

        fillRoundedRect(ctx, cellX, rowY, cellWidth, cellHeight, 20, cellFill, cellStroke, 1.1);
        ctx.save();
        roundedRectPath(ctx, cellX + 2, rowY + 2, cellWidth - 4, cellHeight - 4, 18);
        ctx.clip();
        const tint = ctx.createLinearGradient(cellX, rowY, cellX, rowY + cellHeight);
        tint.addColorStop(0, "rgba(255,255,255,0.14)");
        tint.addColorStop(1, suit.lane);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = tint;
        ctx.fillRect(cellX, rowY, cellWidth, cellHeight);
        ctx.restore();

        // keep race cells unlabelled to avoid overlapping with live overlay cards.
      }
    }

    return fitted.canvas;
  }

  function canvasToDataUrl(canvas, type) {
    return canvas.toDataURL(type || "image/png");
  }

  global.GEJAST_PAARDENRACE_ART = {
    palette: PALETTE,
    suits: SUITS,
    suitOrder: SUIT_ORDER.slice(),
    preload: function () {
      return Promise.all(ASSET_PROMISES).then(() => true);
    },
    drawSuitShape,
    drawSuitStamp,
    drawHorsePortrait,
    drawHorseToken,
    drawCard,
    drawTrack,
    canvasToDataUrl
  };
})(typeof window !== "undefined" ? window : globalThis);
