/* ============================================================
   Кривое Зеркало — движок смешных лиц (чистые функции, без DOM)
   Используется из app.js. Фото обрабатывается только локально.
   ============================================================ */
"use strict";

const TAU = Math.PI * 2;
const clamp = (v, mi, ma) => Math.min(ma, Math.max(mi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const pdist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const meanPt = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

/* ------------------------------------------------------------
   ТОЧКИ ЛИЦА
   ------------------------------------------------------------ */
const LM = {
  forehead: 10, chin: 152, sideL: 234, sideR: 454,
  nose: 1, philtrum: 2, mouthL: 61, mouthR: 291,
  eyeAa: 33, eyeAb: 133, eyeBa: 362, eyeBb: 263,
  irisA: 473, irisB: 468, // доступны в модели с радужкой (478 точек)
};

function buildAnchors(lms, w, h) {
  const P = i => ({ x: lms[i].x * w, y: lms[i].y * h });
  const sideL = P(LM.sideL), sideR = P(LM.sideR);
  const forehead = P(LM.forehead), chin = P(LM.chin);
  const eyeA = lms.length >= 478 ? P(LM.irisA) : meanPt(P(LM.eyeAa), P(LM.eyeAb));
  const eyeB = lms.length >= 478 ? P(LM.irisB) : meanPt(P(LM.eyeBa), P(LM.eyeBb));
  const faceCenter = { x: (sideL.x + sideR.x) / 2, y: (forehead.y + chin.y) / 2 };
  const fw = Math.max(12, pdist(sideL, sideR));
  return {
    faceCenter, forehead, chin, sideL, sideR,
    nose: P(LM.nose), philtrum: P(LM.philtrum),
    mouth: meanPt(P(LM.mouthL), P(LM.mouthR)),
    eyeA, eyeB, eyeMid: meanPt(eyeA, eyeB),
    cheekL: { x: lerp(faceCenter.x, sideL.x, .68), y: lerp(faceCenter.y, sideL.y, .68) },
    cheekR: { x: lerp(faceCenter.x, sideR.x, .68), y: lerp(faceCenter.y, sideR.y, .68) },
    hairTop: { x: forehead.x, y: forehead.y - fw * .12 },
    headTop: { x: forehead.x, y: forehead.y - fw * .2 },
    faceW: fw, faceH: pdist(forehead, chin) || fw,
  };
}

// запасные точки, когда лицо не найдено: обобщённое «лицо» по центру кадра
function fallbackAnchors(w, h) {
  const fw = Math.min(w, h) * 0.42;
  const cx = w * 0.5, cy = h * 0.46;
  return {
    faceCenter: { x: cx, y: cy },
    forehead: { x: cx, y: cy - fw * .45 },
    hairTop: { x: cx, y: cy - fw * .57 },
    headTop: { x: cx, y: cy - fw * .65 },
    chin: { x: cx, y: cy + fw * .5 },
    sideL: { x: cx - fw * .5, y: cy + fw * .05 },
    sideR: { x: cx + fw * .5, y: cy + fw * .05 },
    nose: { x: cx, y: cy + fw * .22 },
    philtrum: { x: cx, y: cy + fw * .3 },
    mouth: { x: cx, y: cy + fw * .38 },
    eyeA: { x: cx - fw * .19, y: cy - fw * .08 },
    eyeB: { x: cx + fw * .19, y: cy - fw * .08 },
    eyeMid: { x: cx, y: cy - fw * .08 },
    cheekL: { x: cx - fw * .34, y: cy + fw * .16 },
    cheekR: { x: cx + fw * .34, y: cy + fw * .16 },
    faceW: fw, faceH: fw * .95,
  };
}

/* ------------------------------------------------------------
   ТЕМЫ
   warps    : деформации (bulge надуть, pinch сжать, widenX растянуть вширь,
              widenY растянуть ввысь, wobble волна).
              at — якорная точка; r (или rx/ry) — радиус в долях ширины лица;
              s — сила эффекта.
   filters  : строка CSS-фильтров; overlays — векторные украшения.
   ------------------------------------------------------------ */
const THEMES = [
  {
    id: "mirror", name: "Кривое зеркало", emoji: "🌀",
    grad: "linear-gradient(135deg,#7c5cff,#22d1ee)",
    filters: "saturate(1.18) contrast(1.07)",
    vignette: .34,
    warps: [
      { type: "bulge", at: "faceCenter", r: .52, s: .9 },
      { type: "wobble", at: "faceCenter", r: .62, amp: .05, freq: 2.6 },
      { type: "pinch", at: "mouth", r: .26, s: .55 },
    ],
    overlays: [],
  },
  {
    id: "piggy", name: "Поросёнок", emoji: "🐷",
    grad: "linear-gradient(135deg,#ff8ac2,#ffb199)",
    filters: "sepia(.22) saturate(1.65) hue-rotate(-28deg) brightness(1.05)",
    warps: [
      { type: "bulge", at: "nose", r: .2, s: 1.55 },
      { type: "bulge", at: "chin", r: .22, s: .5 },
      { type: "pinch", at: "forehead", r: .34, s: .45 },
    ],
    overlays: ["ears-round", "pink-snout", "blush"],
  },
  {
    id: "brain", name: "Большой мозг", emoji: "🧠",
    grad: "linear-gradient(135deg,#22d1ee,#7c5cff)",
    filters: "saturate(1.12) contrast(1.03)",
    warps: [
      { type: "bulge", at: "forehead", r: .42, s: 1.0 },
      { type: "bulge", at: "hairTop", r: .3, s: .8 },
      { type: "pinch", at: "chin", r: .3, s: .5 },
    ],
    overlays: ["lightbulb"],
  },
  {
    id: "clown", name: "Весёлый клоун", emoji: "🤡",
    grad: "linear-gradient(135deg,#ff5f6d,#ffc371)",
    filters: "saturate(1.5) contrast(1.12)",
    warps: [
      { type: "widenX", at: "mouth", rx: .3, ry: .2, s: 1.15 },
      { type: "bulge", at: "nose", r: .17, s: 1.3 },
      { type: "bulge", at: "eyeA", r: .13, s: .85 },
      { type: "bulge", at: "eyeB", r: .13, s: .85 },
    ],
    overlays: ["clown-nose", "clown-hair", "cheek-stars"],
  },
  {
    id: "alien", name: "Серый пришелец", emoji: "👽",
    grad: "linear-gradient(135deg,#39e75f,#22d1ee)",
    filters: "hue-rotate(65deg) saturate(1.25) contrast(1.08) brightness(1.02)",
    warps: [
      { type: "bulge", at: "forehead", r: .42, s: .75 },
      { type: "pinch", at: "chin", r: .26, s: .85 },
      { type: "bulge", at: "eyeA", r: .15, s: 1.15 },
      { type: "bulge", at: "eyeB", r: .15, s: 1.15 },
    ],
    overlays: ["alien-eyes", "antenna"],
  },
  {
    id: "wizard", name: "Добрый волшебник", emoji: "🎅",
    grad: "linear-gradient(135deg,#ff416c,#ff9a44)",
    filters: "saturate(1.08) contrast(1.06) brightness(1.02)",
    warps: [
      { type: "bulge", at: "cheekL", r: .2, s: .75 },
      { type: "bulge", at: "cheekR", r: .2, s: .75 },
      { type: "bulge", at: "nose", r: .16, s: .85 },
    ],
    overlays: ["santa-hat", "beard", "mustache", "blush"],
  },
  {
    id: "zombie", name: "Зомби", emoji: "🧟",
    grad: "linear-gradient(135deg,#5f7a3d,#2f3b2a)",
    filters: "grayscale(.45) saturate(1.2) hue-rotate(52deg) contrast(1.18) brightness(.94)",
    vignette: .5,
    warps: [
      { type: "bulge", at: "eyeA", r: .16, s: .6 },
      { type: "bulge", at: "eyeB", r: .16, s: .6 },
      { type: "pinch", at: "cheekL", rx: .16, ry: .26, s: .7 },
      { type: "pinch", at: "cheekR", rx: .16, ry: .26, s: .7 },
      { type: "pinch", at: "chin", r: .2, s: .4 },
    ],
    overlays: ["zombie-eyes", "stitches"],
  },
  {
    id: "chubs", name: "Пухлые щёчки", emoji: "😙",
    grad: "linear-gradient(135deg,#ffd86f,#fc6262)",
    filters: "saturate(1.22) brightness(1.05)",
    warps: [
      { type: "bulge", at: "cheekL", r: .28, s: 1.15 },
      { type: "bulge", at: "cheekR", r: .28, s: 1.15 },
      { type: "bulge", at: "chin", r: .24, s: .8 },
    ],
    overlays: ["blush"],
  },
  {
    id: "puppy", name: "Щенок", emoji: "🐶",
    grad: "linear-gradient(135deg,#c9a26b,#8d6e63)",
    filters: "sepia(.16) saturate(1.35) brightness(1.08) contrast(1.03)",
    warps: [
      { type: "bulge", at: "eyeA", r: .17, s: 1.45 },
      { type: "bulge", at: "eyeB", r: .17, s: 1.45 },
      { type: "pinch", at: "mouth", r: .24, s: .5 },
    ],
    overlays: ["puppy-ears", "puppy-nose", "sparkles"],
  },
  {
    id: "tiny", name: "Крошечное лицо", emoji: "🫣",
    grad: "linear-gradient(135deg,#94a3b8,#e2e8f0)",
    filters: "saturate(1.05)",
    warps: [
      { type: "pinch", at: "faceCenter", r: .58, s: 2.0 },
    ],
    overlays: [],
  },
  {
    id: "elder", name: "Старейшина", emoji: "🧓",
    grad: "linear-gradient(135deg,#b9b3a8,#8d8377)",
    filters: "sepia(.38) saturate(.9) contrast(1.08) brightness(.97)",
    warps: [
      { type: "pinch", at: "cheekL", rx: .14, ry: .22, s: .55 },
      { type: "pinch", at: "cheekR", rx: .14, ry: .22, s: .55 },
      { type: "bulge", at: "nose", r: .14, s: .6 },
      { type: "bulge", at: "chin", r: .16, s: .5 },
    ],
    overlays: ["wrinkles", "big-mustache"],
  },
  {
    id: "baby", name: "Малыш", emoji: "👶",
    grad: "linear-gradient(135deg,#ffd6e8,#b3e5fc)",
    filters: "saturate(1.15) brightness(1.08)",
    warps: [
      { type: "bulge", at: "eyeA", r: .16, s: 1.35 },
      { type: "bulge", at: "eyeB", r: .16, s: 1.35 },
      { type: "bulge", at: "forehead", r: .38, s: .85 },
      { type: "pinch", at: "mouth", r: .18, s: .7 },
      { type: "pinch", at: "chin", r: .22, s: .6 },
    ],
    overlays: ["blush", "haircurl"],
  },
  {
    id: "hamster", name: "Хомяк", emoji: "🐹",
    grad: "linear-gradient(135deg,#f3c98b,#d7a15c)",
    filters: "sepia(.12) saturate(1.25) brightness(1.06)",
    warps: [
      { type: "bulge", at: "cheekL", r: .26, s: 1.35 },
      { type: "bulge", at: "cheekR", r: .26, s: 1.35 },
      { type: "bulge", at: "chin", r: .2, s: .9 },
      { type: "pinch", at: "eyeA", r: .1, s: .45 },
      { type: "pinch", at: "eyeB", r: .1, s: .45 },
    ],
    overlays: ["blush"],
  },
  {
    id: "tadpole", name: "Головастик", emoji: "🐸",
    grad: "linear-gradient(135deg,#7be07b,#22d1ee)",
    filters: "hue-rotate(30deg) saturate(1.25) contrast(1.05)",
    warps: [
      { type: "bulge", at: "forehead", r: .45, s: 1.1, dy: -.1 },
      { type: "bulge", at: "eyeA", r: .14, s: 1.0 },
      { type: "bulge", at: "eyeB", r: .14, s: 1.0 },
      { type: "pinch", at: "chin", r: .28, s: 1.4 },
      { type: "widenX", at: "mouth", rx: .26, ry: .16, s: .8 },
    ],
    overlays: ["goggles"],
  },
];

/* ------------------------------------------------------------
   ДЕФОРМАЦИИ (inverse mapping: dest → src, билинейная выборка)
   ------------------------------------------------------------ */
function makeWarp(cfg, anchors, intensity) {
  const sEff = clamp(cfg.s * (0.35 + 0.75 * intensity), 0, 2.4);
  const R = (cfg.r || 0) * anchors.faceW;
  const rx = (cfg.rx || 0) * anchors.faceW, ry = (cfg.ry || 0) * anchors.faceW;
  const base = anchors[cfg.at] || anchors.faceCenter;
  const c = { x: base.x + (cfg.dx || 0) * anchors.faceW, y: base.y + (cfg.dy || 0) * anchors.faceW };
  c.R = R; c.rx = rx; c.ry = ry;

  const isRadial = cfg.type === "bulge" || cfg.type === "pinch" && !(cfg.ry && cfg.rx);
  const pinch = cfg.type === "pinch";

  if (cfg.type === "wobble") {
    const amp = (cfg.amp || .04) * anchors.faceW, freq = cfg.freq || 2.5;
    return { c, r: R * 1.1, map(px, py) {
      const dx = px - c.x, dy = py - c.y;
      const d = Math.hypot(dx, dy);
      if (d >= R * 1.1) return null;
      const f = Math.max(0, Math.cos((d / (R * 1.1)) * Math.PI / 2));
      const offX = Math.sin((py / Math.max(R, 1)) * Math.PI * freq) * amp * f;
      const offY = Math.sin((px / Math.max(R, 1)) * Math.PI * (freq * .8)) * amp * .55 * f;
      return [px + offX, py + offY];
    } };
  }

  if (cfg.type === "widenX" || cfg.type === "widenY" || (cfg.type === "pinch" && cfg.rx && cfg.ry)) {
    const horiz = cfg.type !== "widenY" || cfg.type === "pinch" && cfg.rx && cfg.ry;
    return { c, r: Math.max(rx, ry) * 1.45, map(px, py) {
      const dx = px - c.x, dy = py - c.y;
      const q = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (q > 1) return null;
      const g = Math.exp(-2.2 * q);
      // s>0 → растягиваем черты от центра оси; s<0 → сжимаем
      const fac = Math.max(.3, 1 - sEff * g);
      if (horiz) return [c.x + dx / fac, py];
      return [px, c.y + dy / fac];
    } };
  }

  if (isRadial && R > 1) {
    const kind = pinch ? "pinch" : "bulge";
    return { c, r: R * 1.05, map(px, py) {
      const dx = px - c.x, dy = py - c.y;
      const d = Math.hypot(dx, dy);
      if (d >= R * 1.02 || d < 1e-4) return null;
      const t = d / R;
      const rSrc = kind === "pinch"
        ? R * Math.pow(t, 1 + sEff)
        : R * Math.pow(t, 1 / (1 + sEff));
      const k = rSrc / d;
      return [c.x + dx * k, c.y + dy * k];
    } };
  }

  return null;
}

function warpBBox(wp, w, h) {
  const pad = wp.r * 1.2;
  return { x0: wp.c.x - pad, y0: wp.c.y - pad, x1: wp.c.x + pad, y1: wp.c.y + pad };
}

function bilinear(data, w, h, x, y) {
  const xi = clamp(Math.floor(x), 0, w - 2), yi = clamp(Math.floor(y), 0, h - 2);
  const fx = clamp(x - xi, 0, 1), fy = clamp(y - yi, 0, 1);
  const i = (yi * w + xi) * 4, j = i + 4, k = i + w * 4, l = k + 4;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  return [
    data[i] * w00 + data[j] * w10 + data[k] * w01 + data[l] * w11,
    data[i + 1] * w00 + data[j + 1] * w10 + data[k + 1] * w01 + data[l + 1] * w11,
    data[i + 2] * w00 + data[j + 2] * w10 + data[k + 2] * w01 + data[l + 2] * w11,
    data[i + 3] * w00 + data[j + 3] * w10 + data[k + 3] * w01 + data[l + 3] * w11,
  ];
}

function applyWarps(canvas, warps) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;

  for (const wp of warps) {
    const bb = warpBBox(wp, w, h);
    const x0 = Math.max(0, Math.floor(bb.x0)), y0 = Math.max(0, Math.floor(bb.y0));
    const x1 = Math.min(w, Math.ceil(bb.x1)), y1 = Math.min(h, Math.ceil(bb.y1));
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;

    const cur = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    const out = new ImageData(new Uint8ClampedArray(cur.data), x1 - x0, y1 - y0);
    const cw = x1 - x0, ch = y1 - y0;
    const cdata = cur.data, odata = out.data;
    let acc = [0, 0];

    for (let py = 0; py < ch; py++) {
      for (let px = 0; px < cw; px++) {
        const X = px + x0, Y = py + y0;
        const src = wp.map(X + .5, Y + .5);
        if (!src) continue;
        acc[0] = clamp(src[0], 0, w - 1); acc[1] = clamp(src[1], 0, h - 1);
        // выборка идёт из соседнего ImageData (текущее содержимое канваса)
        const [r, g, b, a] = sampleFrom(cw, ch, cdata, acc[0], acc[1], x0, y0);
        const o = (py * cw + px) * 4;
        odata[o] = r; odata[o + 1] = g; odata[o + 2] = b; odata[o + 3] = a;
      }
    }
    ctx.putImageData(out, x0, y0);
  }
}

// выборка из ImageData области: переводим глобальные координаты в локальные
function sampleFrom(cw, ch, data, gx, gy, x0, y0) {
  const x = gx - x0, y = gy - y0;
  if (x < 0 || y < 0 || x > cw - 1 || y > ch - 1) {
    // выходим за область — берём ближайший пиксель края области
    const xi = clamp(Math.round(x), 0, cw - 1), yi = clamp(Math.round(y), 0, ch - 1);
    const i = (yi * cw + xi) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }
  // билинейная интерполяция
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const i = (yi * cw + xi) * 4, j = i + 4, k = i + cw * 4, l = k + 4;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  return [
    data[i] * w00 + data[j] * w10 + data[k] * w01 + data[l] * w11,
    data[i + 1] * w00 + data[j + 1] * w10 + data[k + 1] * w01 + data[l + 1] * w11,
    data[i + 2] * w00 + data[j + 2] * w10 + data[k + 2] * w01 + data[l + 2] * w11,
    data[i + 3] * w00 + data[j + 3] * w10 + data[k + 3] * w01 + data[l + 3] * w11,
  ];
}

/* ------------------------------------------------------------
   ЦВЕТОКОРРЕКЦИЯ И ВИНЬЕТКА
   ------------------------------------------------------------ */
function applyColorFilter(canvas, filterStr) {
  if (!filterStr) return;
  const ctx = canvas.getContext("2d");
  if (ctx.filter === undefined) return; // нет поддержки — просто пропускаем
  const t = document.createElement("canvas");
  t.width = canvas.width; t.height = canvas.height;
  const tc = t.getContext("2d");
  tc.filter = filterStr;
  tc.drawImage(canvas, 0, 0);
  ctx.clearRect(0, 0, t.width, t.height);
  ctx.drawImage(t, 0, 0);
}

function drawVignette(ctx, w, h, amount) {
  if (!amount) return;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .34, w / 2, h / 2, Math.max(w, h) * .72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(8,6,18,${amount})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* ------------------------------------------------------------
   УКРАШЕНИЯ (векторные, привязаны к точкам лица)
   ------------------------------------------------------------ */
const INK = "#181223";

function star(ctx, cx, cy, r, n) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 === 0 ? r : r * .42;
    const an = (i / (n * 2)) * TAU - Math.PI / 2;
    const x = cx + Math.cos(an) * rr, y = cy + Math.sin(an) * rr;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawOverlays(ctx, a, list) {
  const fw = a.faceW;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const type of list) {
    ctx.lineWidth = Math.max(2.5, fw * .014);
    switch (type) {

      case "ears-round": {
        const y = a.hairTop.y + fw * .06;
        for (const s of [-1, 1]) {
          const ex = a.faceCenter.x + s * fw * .44, ey = y;
          ctx.fillStyle = "#f7a8c8";
          ctx.beginPath(); ctx.arc(ex, ey, fw * .13, 0, TAU); ctx.fill();
          ctx.strokeStyle = INK; ctx.stroke();
          ctx.fillStyle = "#ffb9d3";
          ctx.beginPath(); ctx.arc(ex, ey + fw * .02, fw * .075, 0, TAU); ctx.fill();
        }
        break;
      }

      case "pink-snout": {
        const r = fw * .16;
        ctx.fillStyle = "#f8a8c0";
        ctx.beginPath(); ctx.ellipse(a.nose.x, a.nose.y, r * 1.15, r * .9, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = INK; ctx.stroke();
        ctx.fillStyle = INK;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(a.nose.x + s * r * .45, a.nose.y - r * .08, r * .16, r * .22, 0, 0, TAU);
          ctx.fill();
        }
        break;
      }

      case "blush": {
        ctx.save();
        ctx.globalAlpha = .5;
        ctx.fillStyle = "#ff7fb0";
        for (const p of [a.cheekL, a.cheekR]) {
          ctx.beginPath(); ctx.ellipse(p.x, p.y, fw * .1, fw * .065, 0, 0, TAU); ctx.fill();
        }
        ctx.restore();
        break;
      }

      case "lightbulb": {
        const r = fw * .09;
        const bx = a.faceCenter.x, by = a.hairTop.y - fw * .12;
        ctx.save();
        ctx.strokeStyle = "rgba(255,214,110,.85)";
        ctx.lineWidth = Math.max(2, fw * .012);
        for (let i = 0; i < 8; i++) {
          const an = (i / 8) * TAU + .4;
          ctx.beginPath();
          ctx.moveTo(bx + Math.cos(an) * (r + fw * .035), by + Math.sin(an) * (r + fw * .035));
          ctx.lineTo(bx + Math.cos(an) * (r + fw * .07), by + Math.sin(an) * (r + fw * .07));
          ctx.stroke();
        }
        const g = ctx.createRadialGradient(bx - r * .3, by - r * .3, r * .1, bx, by, r);
        g.addColorStop(0, "#ffefb8"); g.addColorStop(1, "#ffd66e");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2.5, fw * .014); ctx.stroke();
        ctx.beginPath(); ctx.arc(bx - r * .3, by - r * .3, r * .22, 0, TAU);
        ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fill();
        ctx.restore();
        break;
      }

      case "clown-nose": {
        const r = fw * .11;
        const g = ctx.createRadialGradient(a.nose.x - r * .3, a.nose.y - r * .3, r * .15, a.nose.x, a.nose.y, r);
        g.addColorStop(0, "#ff8a8a"); g.addColorStop(1, "#e2261f");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(a.nose.x, a.nose.y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = INK; ctx.stroke();
        break;
      }

      case "clown-hair": {
        for (const s of [-1, 1]) {
          const hx = a.faceCenter.x + s * fw * .45, hy = a.hairTop.y + fw * .04;
          ctx.fillStyle = s < 0 ? "#ff5db1" : "#ffd23f";
          ctx.beginPath(); ctx.arc(hx, hy, fw * .15, 0, TAU); ctx.fill();
          ctx.fillStyle = "#22d1ee";
          ctx.beginPath(); ctx.arc(hx + s * fw * .06, hy - fw * .13, fw * .1, 0, TAU); ctx.fill();
        }
        break;
      }

      case "cheek-stars": {
        ctx.fillStyle = "rgba(255,255,255,.95)";
        for (const p of [a.cheekL, a.cheekR]) star(ctx, p.x, p.y, fw * .06, 5);
        break;
      }

      case "alien-eyes": {
        for (const e of [a.eyeA, a.eyeB]) {
          ctx.fillStyle = "#0d0512";
          ctx.beginPath();
          ctx.ellipse(e.x, e.y, fw * .145, fw * .2, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,.35)";
          ctx.beginPath(); ctx.ellipse(e.x - fw * .04, e.y - fw * .07, fw * .035, fw * .02, -.5, 0, TAU); ctx.fill();
        }
        break;
      }

      case "antenna": {
        const top = a.headTop;
        const tipX = top.x + fw * .06, tipY = top.y - fw * .4;
        ctx.strokeStyle = "#39e75f"; ctx.lineWidth = Math.max(3, fw * .022);
        ctx.beginPath();
        ctx.quadraticCurveTo(top.x + fw * .14, top.y - fw * .22, tipX, tipY);
        ctx.stroke();
        ctx.fillStyle = "#39e75f";
        ctx.beginPath(); ctx.arc(tipX, tipY, fw * .045, 0, TAU); ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2.5, fw * .012); ctx.stroke();
        break;
      }

      case "santa-hat": {
        const bw = fw * .78;
        const fy = a.hairTop.y;
        const cx = a.faceCenter.x;
        ctx.fillStyle = "#e63946";
        ctx.beginPath();
        ctx.moveTo(cx - bw / 2, fy);
        ctx.quadraticCurveTo(cx - bw * .1, fy - fw * .5, cx + bw * .42, fy - fw * .36);
        ctx.quadraticCurveTo(cx + bw * .1, fy - fw * .08, cx + bw / 2, fy);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = INK; ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(cx + bw * .42, fy - fw * .36, fw * .075, 0, TAU); ctx.fill();
        ctx.strokeStyle = INK; ctx.stroke();
        ctx.fillStyle = "#f5f0e6";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cx - bw / 2 - fw * .02, fy - fw * .05, bw + fw * .04, fw * .11, fw * .055);
        else ctx.rect(cx - bw / 2 - fw * .02, fy - fw * .05, bw + fw * .04, fw * .11);
        ctx.fill(); ctx.strokeStyle = INK; ctx.stroke();
        break;
      }

      case "beard": {
        // полумесяц вдоль нижней части лица: от щеки до щеки, подо ртом
        const bx = a.faceCenter.x;
        const xL = a.sideL.x + fw * .24, xR = a.sideR.x - fw * .24;
        const yTopAnchor = Math.max(a.mouth.y + fw * .12, a.chin.y - fw * .2);
        ctx.fillStyle = "#f5f0e6";
        ctx.strokeStyle = INK;
        ctx.beginPath();
        ctx.moveTo(xL, yTopAnchor);
        ctx.quadraticCurveTo(bx, a.chin.y + fw * .28, xR, yTopAnchor); // нижняя кромка
        ctx.quadraticCurveTo(bx, yTopAnchor - fw * .03, xL, yTopAnchor); // верхняя кромка
        ctx.fill(); ctx.stroke();
        break;
      }

      case "mustache": {
        const p = a.philtrum, w1 = fw * .19;
        ctx.fillStyle = "#f5f0e6";
        ctx.strokeStyle = INK;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + fw * .05);
        ctx.quadraticCurveTo(p.x - w1 * .6, p.y - fw * .01, p.x - w1, p.y + fw * .07);
        ctx.quadraticCurveTo(p.x - w1 * .55, p.y + fw * .12, p.x, p.y + fw * .06);
        ctx.quadraticCurveTo(p.x + w1 * .55, p.y + fw * .12, p.x + w1, p.y + fw * .07);
        ctx.quadraticCurveTo(p.x + w1 * .6, p.y - fw * .01, p.x, p.y + fw * .05);
        ctx.fill(); ctx.stroke();
        break;
      }

      case "zombie-eyes": {
        for (const e of [a.eyeA, a.eyeB]) {
          const g = ctx.createRadialGradient(e.x, e.y, fw * .01, e.x, e.y, fw * .17);
          g.addColorStop(0, "rgba(5,8,6,.95)");
          g.addColorStop(1, "rgba(5,8,6,0)");
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(e.x, e.y, fw * .17, 0, TAU); ctx.fill();
        }
        break;
      }

      case "stitches": {
        const p = a.cheekR;
        const len = fw * .22, ang = .6;
        const mx = Math.cos(ang) * len / 2, my = Math.sin(ang) * len / 2;
        ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2.5, fw * .014);
        ctx.beginPath();
        ctx.moveTo(p.x - mx, p.y - my); ctx.lineTo(p.x + mx, p.y + my);
        ctx.stroke();
        for (let i = -1; i <= 1; i++) {
          const sx = p.x + i * mx * .5, sy = p.y + i * my * .5;
          ctx.beginPath();
          ctx.moveTo(sx, sy - fw * .045); ctx.lineTo(sx, sy + fw * .045);
          ctx.stroke();
        }
        break;
      }

      case "puppy-ears": {
        for (const s of [-1, 1]) {
          const ex = a.faceCenter.x + s * fw * .5, ey = a.hairTop.y + fw * .1;
          ctx.fillStyle = "#a9754f";
          ctx.beginPath();
          ctx.ellipse(ex + s * fw * .04, ey, fw * .12, fw * .2, s * .45, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = INK; ctx.stroke();
        }
        break;
      }

      case "puppy-nose": {
        const r = fw * .075;
        ctx.fillStyle = "#241a12";
        ctx.beginPath();
        ctx.ellipse(a.nose.x, a.nose.y - fw * .005, r * 1.35, r * .95, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.5)";
        ctx.beginPath(); ctx.arc(a.nose.x - r * .45, a.nose.y - r * .3, r * .2, 0, TAU); ctx.fill();
        break;
      }

      case "sparkles": {
        ctx.fillStyle = "rgba(255,255,255,.92)";
        for (let i = 0; i < 6; i++) {
          const an = (i / 6) * TAU + .5, rr = fw * (.55 + (i % 3) * .12);
          star(ctx, a.faceCenter.x + Math.cos(an) * rr, a.faceCenter.y + Math.sin(an) * rr, fw * .035, 4);
        }
        break;
      }

      case "wrinkles": { // морщины: лоб, носогубки, мешки под глазами, гусиные лапки
        ctx.strokeStyle = "rgba(74,48,30,.55)";
        ctx.lineWidth = Math.max(2, fw * .011);
        // линии на лбу
        for (let k = 0; k < 3; k++) {
          const y = a.forehead.y + fw * (.03 + k * .045);
          ctx.beginPath();
          ctx.moveTo(a.faceCenter.x - fw * .26, y);
          ctx.quadraticCurveTo(a.faceCenter.x, y + fw * .022, a.faceCenter.x + fw * .26, y);
          ctx.stroke();
        }
        // переносица: две складки
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(a.faceCenter.x + s * fw * .025, a.eyeMid.y - fw * .02);
          ctx.lineTo(a.faceCenter.x + s * fw * .012, a.eyeMid.y + fw * .07);
          ctx.stroke();
        }
        // носогубные складки
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(a.nose.x + s * fw * .07, a.nose.y + fw * .04);
          ctx.quadraticCurveTo(
            a.nose.x + s * fw * .2, a.mouth.y - fw * .02,
            a.mouth.x + s * fw * .19, a.mouth.y + fw * .04
          );
          ctx.stroke();
        }
        // мешки под глазами и гусиные лапки
        for (const e of [a.eyeA, a.eyeB]) {
          ctx.beginPath();
          ctx.arc(e.x, e.y + fw * .02, fw * .085, Math.PI * .15, Math.PI * .85);
          ctx.stroke();
          const outer = e.x < a.faceCenter.x ? -1 : 1;
          for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            ctx.moveTo(e.x + outer * fw * (1.2 + i * .4) * .1, e.y - fw * .02 + i * fw * .03);
            ctx.lineTo(e.x + outer * fw * (1.5 + i * .44) * .1, e.y + fw * .05 + i * fw * .04);
            ctx.stroke();
          }
        }
        // складки у рта от растянутых щёк
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(a.mouth.x + s * fw * .2, a.mouth.y + fw * .1);
          ctx.quadraticCurveTo(a.mouth.x + s * fw * .24, a.mouth.y + fw * .2, a.mouth.x + s * fw * .2, a.mouth.y + fw * .3);
          ctx.stroke();
        }
        break;
      }

      case "haircurl": { // завиток-пружинка на макушке
        const top = a.hairTop;
        let px = top.x, py = top.y - fw * .12;
        ctx.strokeStyle = "#5d4037";
        ctx.lineWidth = Math.max(3, fw * .016);
        ctx.beginPath();
        ctx.moveTo(px, py);
        const r0 = fw * .04;
        for (let i = 0; i < 3; i++) {
          const r = r0 * (1 - i * .18);
          ctx.arc(px + r, py, r, Math.PI, Math.PI * 2.55);
          px += r * 1.2; py -= r * .28;
        }
        ctx.stroke();
        break;
      }

      case "big-mustache": { // пышные усы-подкова (седые для старейшины)
        const p = a.philtrum, w1 = fw * .27;
        ctx.fillStyle = "#d9d0c2";
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(2.5, fw * .013);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + fw * .06);
        ctx.quadraticCurveTo(p.x - w1 * .7, p.y - fw * .0, p.x - w1, p.y + fw * .1);
        ctx.quadraticCurveTo(p.x - w1 * .82, p.y + fw * .2, p.x - w1 * .45, p.y + fw * .16);
        ctx.quadraticCurveTo(p.x - w1 * .25, p.y + fw * .12, p.x, p.y + fw * .07);
        ctx.quadraticCurveTo(p.x + w1 * .25, p.y + fw * .12, p.x + w1 * .45, p.y + fw * .16);
        ctx.quadraticCurveTo(p.x + w1 * .82, p.y + fw * .2, p.x + w1, p.y + fw * .1);
        ctx.quadraticCurveTo(p.x + w1 * .7, p.y - fw * .0, p.x, p.y + fw * .06);
        ctx.fill(); ctx.stroke();
        break;
      }

      case "goggles": { // очки-маска у головастика
        const r = fw * .135;
        for (const e of [a.eyeA, a.eyeB]) {
          ctx.fillStyle = "rgba(214,245,255,.5)";
          ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, TAU); ctx.fill();
          ctx.strokeStyle = "#0f2b3a";
          ctx.lineWidth = Math.max(3, fw * .02);
          ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255,.9)";
          ctx.lineWidth = Math.max(2, fw * .01);
          ctx.beginPath(); ctx.arc(e.x - r * .3, e.y - r * .3, r * .28, 0, TAU); ctx.stroke();
          ctx.fillStyle = "rgba(15,43,58,.85)";
          ctx.beginPath(); ctx.arc(e.x + r * .18, e.y + r * .06, fw * .022, 0, TAU); ctx.fill();
        }
        // перемычка и ремешок
        const bridgeY = a.eyeMid.y - r * .18;
        ctx.strokeStyle = "#0f2b3a";
        ctx.lineWidth = Math.max(6, fw * .028);
        ctx.beginPath();
        ctx.moveTo(a.eyeA.x + r * .82, bridgeY);
        ctx.quadraticCurveTo(a.faceCenter.x, bridgeY - r * .28, a.eyeB.x - r * .82, bridgeY);
        ctx.stroke();
        for (const s of [-1, 1]) {
          const e = s < 0 ? a.eyeA : a.eyeB;
          ctx.beginPath();
          ctx.moveTo(e.x + s * r, e.y);
          ctx.lineTo(a.faceCenter.x + s * (fw * .55), bridgeY + fw * .02);
          ctx.lineWidth = Math.max(3, fw * .018);
          ctx.stroke();
        }
        break;
      }
    }
  }
}

/* ------------------------------------------------------------
   ПАЙПЛАЙН (чистая функция: принимает канвас-источник, возвращает канвас)
   ------------------------------------------------------------ */
function newCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function renderFunnyPic(src, anchors, theme, intensity) {
  const t0 = performance.now();
  const { width: w, height: h } = src;

  const warps = [];
  for (const cfg of theme.warps) {
    const wp = makeWarp(cfg, anchors, intensity);
    if (wp) warps.push(wp);
  }

  const out = newCanvas(w, h);
  const octx = out.getContext("2d", { willReadFrequently: true }); // частые getImageData в деформациях
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(src, 0, 0);

  if (warps.length) applyWarps(out, warps);

  applyColorFilter(out, theme.filters);

  drawOverlays(octx, anchors, theme.overlays);
  drawVignette(octx, w, h, theme.vignette || 0);

  return { canvas: out, ms: performance.now() - t0 };
}
