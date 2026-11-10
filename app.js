/* ============================================================
   Кривое Зеркало — интерфейс, загрузка фото, MediaPipe, рендер
   ============================================================ */
"use strict";

const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const resultCanvas = $("result"), beforeCanvas = $("beforeCanvas");
const emptyState = $("emptyState"), compareWrap = $("compare"), compareRange = $("compareRange");
const dropzone = $("dropzone"), fileInput = $("fileInput"), pickBtn = $("pickBtn");
const themeList = $("themeList"), intensityInput = $("intensity"), intensityOut = $("intensityOut");
const randomBtn = $("randomBtn"), resetBtn = $("resetBtn"), downloadBtn = $("downloadBtn");
const stageNote = $("stageNote"), toasts = $("toasts");
const engineChip = $("engineChip"), engineText = $("engineText");
const thinking = $("thinking");

/* ---------- состояние ---------- */
const state = {
  img: null,        // канвас-источник (ужатый оригинал)
  orig: null,       // копия для слоя «до»
  face: null,       // якорные точки лица | null
  theme: THEMES[0],
  intensity: .9,
  result: null,
};

/* ---------- утилиты UI ---------- */
const showEl = el => { el.hidden = false; };
const hideEl = el => { el.hidden = true; };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  toasts.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, 2600);
}

function setEngine(status, text) {
  engineChip.classList.remove("is-loading", "is-ready", "is-off");
  engineChip.classList.add(status);
  engineText.textContent = text;
}

function enableToggles(on) {
  randomBtn.disabled = !on;
  resetBtn.disabled = !on;
  downloadBtn.disabled = !on;
}

/* ---------- чипсы тем ---------- */
function buildThemes() {
  for (const t of THEMES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "theme-chip" + (t === state.theme ? " is-active" : "");
    b.style.setProperty("--grad", t.grad);
    b.innerHTML = `<span class="t-emoji">${t.emoji}</span>${t.name}`;
    b.setAttribute("role", "option");
    b.addEventListener("click", () => selectTheme(t));
    t._btn = b;
    themeList.appendChild(b);
  }
}

function selectTheme(t, { quiet = false } = {}) {
  state.theme = t;
  for (const th of THEMES) th._btn.classList.toggle("is-active", th === t);
  if (state.img) updateRender();
  if (!quiet) stageNote.textContent = `Вы выбрали: ${t.emoji} ${t.name}`;
}

/* ---------- загрузка фото ---------- */
const MAXW = 1280;

function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function loadFromDataURL(dataURL) {
  showEl(thinking);
  try {
    const imgEl = new Image();
    imgEl.src = dataURL;
    try {
      await imgEl.decode();
    } catch {
      await new Promise((res, rej) => { imgEl.onload = res; imgEl.onerror = rej; });
    }

    // ужимаем большие фото до MAXW по длинной стороне
    let w = imgEl.naturalWidth, h = imgEl.naturalHeight;
    const scale = Math.min(1, MAXW / Math.max(w, h));
    w = Math.max(2, Math.round(w * scale));
    h = Math.max(2, Math.round(h * scale));

    state.img = newCanvas(w, h);
    state.img.getContext("2d").drawImage(imgEl, 0, 0, w, h);
    state.orig = newCanvas(w, h);
    state.orig.getContext("2d").drawImage(state.img, 0, 0);

    // рендерим сразу (в резервном режиме), лицо детектится ниже
    state.face = null;
    updateRender();

    if (landmarker) {
      try {
        const res = landmarker.detect(state.img);
        const lms = res && res.faceLandmarks && res.faceLandmarks[0];
        state.face = lms ? buildAnchors(lms, w, h) : null;
        if (!lms) toast("Лицо не нашлось — эффекты применились к центру кадра", "info");
        updateRender();
      } catch (e) {
        console.warn("detect failed", e);
      }
    }
  } catch (e) {
    console.error(e);
    toast("Не удалось прочитать это изображение 😿", "err");
  } finally {
    hideEl(thinking);
  }
}

async function handleFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast("Нужно изображение (JPG/PNG/WEBP)", "err"); return; }
  try { await loadFromDataURL(await fileToDataURL(file)); }
  catch (e) { toast("Не удалось загрузить файл", "err"); }
}

/* отклик дропзоны */
pickBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

["dragenter", "dragover"].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add("is-drag"); }));
["dragleave", "drop"].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove("is-drag"); }));
dropzone.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));
window.addEventListener("paste", e => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const it of items) if (it.type.startsWith("image/")) { handleFile(it.getAsFile()); break; }
});

/* ---------- рендер и сравнение ---------- */
let pending = false;

function scheduleRender(force = false) {
  if (aiMode && !force) return; // в ИИ-режиме рисует нейросеть, а не canvas
  if (!state.img || pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    if (!state.img || !state.orig) return; // фото успели сбросить — ничего не рендерим
    const t0 = performance.now();
    const anchors = state.face || fallbackAnchors(state.img.width, state.img.height);
    const { canvas, ms } = renderFunnyPic(state.img, anchors, state.theme, state.intensity);

    resultCanvas.width = canvas.width;
    resultCanvas.height = canvas.height;
    resultCanvas.getContext("2d").drawImage(canvas, 0, 0);
    resultCanvas.classList.add("show");

    beforeCanvas.width = canvas.width;
    beforeCanvas.height = canvas.height;
    beforeCanvas.getContext("2d").drawImage(state.orig, 0, 0);

    hideEl(emptyState);
    showEl(compareWrap);
    showEl(compareRange);

    state.result = canvas;
    enableToggles(true);
    stageNote.textContent =
      `${state.theme.emoji} ${state.theme.name} · ${canvas.width}×${canvas.height} · ${Math.round(ms)} мс · ` +
      (state.face ? "лицо найдено 🧠" : "центральный режим (лицо не найдено)");
  });
}

function setCompare(p) {
  // p — сколько показать результата; слой «до» открываем слева на (100 − p)%
  const slip = clamp(100 - p, 0, 100);
  compareWrap.style.setProperty("--p", slip + "%");
  compareWrap.classList.toggle("at-end", slip <= 1 || slip >= 99);
}

compareRange.addEventListener("input", () => setCompare(+compareRange.value));

/* ---------- управление ---------- */
intensityInput.addEventListener("input", () => {
  state.intensity = +intensityInput.value;
  intensityOut.textContent = Math.round(state.intensity * 100) + "%";
  if (aiMode) { clearTimeout(aiDebT); aiDebT = setTimeout(aiRender, 1500); }
  else scheduleRender();
});

randomBtn.addEventListener("click", () => {
  const pool = THEMES.filter(t => t !== state.theme);
  const t = pool[Math.floor(Math.random() * pool.length)];
  state.intensity = Math.round(rand(.55, 1.35) * 20) / 20;
  intensityInput.value = state.intensity;
  intensityOut.textContent = Math.round(state.intensity * 100) + "%";
  selectTheme(t, { quiet: true });
  stageNote.textContent = `🎲 Случайная тема: ${t.emoji} ${t.name} · сила ${Math.round(state.intensity * 100)}%`;
});

resetBtn.addEventListener("click", () => {
  state.img = state.orig = state.face = state.result = null;
  const rctx = resultCanvas.getContext("2d");
  rctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  const bctx = beforeCanvas.getContext("2d");
  bctx.clearRect(0, 0, beforeCanvas.width, beforeCanvas.height);
  resultCanvas.classList.remove("show");
  showEl(emptyState);
  hideEl(compareWrap);
  hideEl(compareRange);
  enableToggles(false);
  fileInput.value = "";
  syncAiRows();
  stageNote.textContent = "";
  toast("Готов к новому фото ↺", "info");
});

downloadBtn.addEventListener("click", () => {
  if (!state.result) return;
  const name = `krivoe-zerkalo-${state.theme.id}.png`;
  state.result.toBlob(blob => {
    if (!blob) { toast("Браузер отказался отдавать PNG", "err"); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
  toast(`Скачано: ${name} 💾`);
});

/* ============================================================
   ИИ-генерация (img2img, бесплатно и без ключей)
   Pollinations gptimage рисует эффект; своё фото уходит анонимно
   на tmpfiles.org (~1 час) — без него gptimage требует публичный URL.
   ============================================================ */
for (const t of THEMES) t.ai = AI_PROMPTS[t.id] || "";

const aiGenToggle = $("aiGenToggle"), aiRegen = $("aiRegen");
const faceBtn = $("faceBtn"), urlBtn = $("urlBtn");
const urlRow = $("urlRow"), urlInput = $("urlInput");

let aiMode = store.get("fm_ai") !== "0"; // ИИ-режим по умолчанию вкл
let aiSeed = Math.floor(Math.random() * 1e6);
let aiBusy = false;
let aiDebT = 0;
let aiPrivacyToasted = false;

function canvasToBlob(c) {
  return new Promise((res, rej) =>
    c.toBlob(b => (b ? res(b) : rej(new Error("toBlob null"))), "image/png"));
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function syncAiRows() {
  aiGenToggle.checked = aiMode;
  aiRegen.hidden = !(aiMode && state.img);
}

/* диспетчер: ИИ-канвас или мгновенный canvas */
function updateRender() {
  if (aiMode) { clearTimeout(aiDebT); aiDebT = setTimeout(aiRender, 900); }
  else scheduleRender();
}

function setAiMode(on, { quiet = false } = {}) {
  aiMode = on;
  store.set("fm_ai", on ? "1" : "0");
  syncAiRows();
  if (on && !quiet && !aiPrivacyToasted) {
    aiPrivacyToasted = true;
    toast("✨ ИИ-режим: фото временно уходит в бесплатные сервисы tmpfiles.org и Pollinations", "info");
  }
  if (state.img) (on ? updateRender() : scheduleRender());
}

aiGenToggle.addEventListener("change", () => setAiMode(aiGenToggle.checked));

aiRegen.addEventListener("click", () => {
  aiSeed = Math.floor(Math.random() * 1e6);
  aiRender();
});

const AI_SUFFIX =
  ". Keep the same person, same pose and background. Single edited photorealistic photo, face clearly visible, no text, no watermark";

function buildAiPrompt() {
  const p = state.intensity;
  const word = p < .45 ? "Subtle effect" : p < .95 ? "Strong effect" : "Extreme effect";
  return `Edit this photo: ${state.theme.ai}. ${word}${AI_SUFFIX}`;
}

/* своё фото → анонимная публичная ссылка (tmpfiles.org, живёт ~1 час) */
async function tmpfilesUpload(blob) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 40000);
  try {
    const fd = new FormData();
    fd.append("file", blob, `funny-mirror-${Date.now()}.png`);
    const r = await fetch("https://tmpfiles.org/api/v1/upload", { method: "POST", body: fd, signal: ctl.signal });
    if (!r.ok) throw new Error("tmpfiles HTTP " + r.status);
    const j = await r.json();
    const url = j && j.data && j.data.url;
    if (!url || !/^https:\/\/tmpfiles\.org\//.test(url)) throw new Error("tmpfiles: нет ссылки");
    return url.replace("tmpfiles.org/", "tmpfiles.org/dl/"); // прямая ссылка на файл
  } finally { clearTimeout(t); }
}

/* Pollinations gptimage —(img2img); анонимно, 2 попытки */
async function gptImageEdit(imgUrl, prompt, seed, w, h) {
  const api = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) +
    "?model=gptimage&image=" + encodeURIComponent(imgUrl) +
    "&width=" + w + "&height=" + h + "&nologo=true&seed=" + seed;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 90000);
    try {
      const r = await fetch(api, { signal: ctl.signal, cache: "no-store" });
      if (!r.ok) {
        await r.text().catch(() => "");
        throw new Error("HTTP " + r.status + (r.status === 402 ? " (лимит бесплатного тира)" : ""));
      }
      const blob = await r.blob();
      if (!/^image\//.test(blob.type)) throw new Error("пришло не изображение: " + blob.type);
      return blob;
    } catch (e) { lastErr = e; console.warn("gptImage", attempt + 1, e); }
    finally { clearTimeout(t); }
    if (attempt === 0) await new Promise(res => setTimeout(res, 2500));
  }
  throw lastErr || new Error("ИИ-картинка не получена");
}

function aiTargetSize() {
  const MAXAI = 1024;
  const w = state.img.width, h = state.img.height;
  const s = Math.min(1, MAXAI / Math.max(w, h));
  return {
    w: Math.max(256, Math.round(w * s / 64) * 64),
    h: Math.max(256, Math.round(h * s / 64) * 64),
  };
}

async function aiRender() {
  if (!state.img || aiBusy) return;
  aiBusy = true;
  aiRegen.disabled = true;
  downloadBtn.disabled = true;
  const t0 = performance.now();
  stageNote.textContent = `✨ ИИ рисует «${state.theme.name}»… обычно 10–40 с`;
  try {
    if (navigator.onLine === false) throw new Error("офлайн: нет интернета");
    const blob = await canvasToBlob(state.img);
    const pub = await tmpfilesUpload(blob);
    const { w, h } = aiTargetSize();
    const got = await gptImageEdit(pub, buildAiPrompt(), aiSeed, w, h);
    if (!state.img) throw new Error("фото успели сбросить");
    const bmp = await createImageBitmap(got);
    const c = newCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);

    resultCanvas.width = c.width;
    resultCanvas.height = c.height;
    resultCanvas.getContext("2d").drawImage(c, 0, 0);
    resultCanvas.classList.add("show");
    beforeCanvas.width = c.width;
    beforeCanvas.height = c.height;
    beforeCanvas.getContext("2d").drawImage(state.orig, 0, 0);
    hideEl(emptyState);
    showEl(compareWrap);
    showEl(compareRange);
    setCompare(100);
    downloadBtn.disabled = false;
    aiRegen.disabled = false;

    state.result = c;
    stageNote.textContent =
      `✨ ${state.theme.emoji} ${state.theme.name} — нарисовано ИИ · ${c.width}×${c.height} · ${((performance.now() - t0) / 1000).toFixed(1)} с`;
  } catch (e) {
    console.warn("aiRender", e);
    aiRegen.disabled = false;
    downloadBtn.disabled = !state.img ? true : downloadBtn.disabled;
    if (state.img) {
      toast(e.message && e.message.startsWith("офлайн")
        ? "Нет интернета — показываю быстрый canvas-эффект 💨"
        : "ИИ не смог нарисовать — показываю быстрый canvas-эффект 💨", "err");
      scheduleRender(true); // аварийный локальный вариант
    }
  } finally {
    aiBusy = false;
  }
}

/* 🎲 лицо придумывает ИИ (без ключей; flux → gptimage) */
faceBtn.addEventListener("click", async () => {
  if (aiBusy) return;
  stageNote.textContent = "🎲 ИИ придумывает лицо…";
  try {
    const seed = Math.floor(Math.random() * 1e6);
    const p = "casual candid smartphone selfie photo of a young person, natural daylight, sharp focus, vertical composition, realistic";
    const urls = [
      "https://image.pollinations.ai/prompt/" + encodeURIComponent(p) + "?model=flux&width=768&height=1024&nologo=true&seed=" + seed,
      "https://image.pollinations.ai/prompt/" + encodeURIComponent(p) + "?model=gptimage&width=768&height=1024&nologo=true&seed=" + seed,
    ];
    let blob = null;
    for (const u of urls) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 75000);
      try {
        const r = await fetch(u, { signal: ctl.signal, cache: "no-store" });
        const b = await r.blob();
        if (r.ok && /^image\//.test(b.type)) { blob = b; break; }
      } catch (e) { console.warn("faceModel", e); }
      finally { clearTimeout(t); }
    }
    if (!blob) throw new Error("У бесплатного ИИ сейчас лимит — попробуйте через несколько минут или загрузите своё фото");
    await loadFromDataURL(await blobToDataURL(blob));
    toast("ИИ придумал новое лицо 🎭");
  } catch (e) {
    console.warn("faceBtn", e);
    toast(e.message || "Не получилось придумать лицо", "err");
    stageNote.textContent = "";
  }
});

/* 🔗 фото по ссылке (через weserv-прокси, он же кроп под лицо) */
urlBtn.addEventListener("click", () => {
  urlRow.hidden ? showEl(urlRow) : hideEl(urlRow);
  if (!urlRow.hidden) urlInput.focus();
});

urlRow.addEventListener("submit", async e => {
  e.preventDefault();
  const u = urlInput.value.trim();
  if (!/^https?:\/\//i.test(u)) { toast("Нужна ссылка, начинающаяся с http(s)://", "err"); return; }
  stageNote.textContent = "🔗 Тянем картинку по ссылке…";
  try {
    const noScheme = u.replace(/^https?:\/\//i, "");
    const prox = "https://images.weserv.nl/?url=" + encodeURIComponent(noScheme) +
      "&w=1280&h=1600&fit=cover&a=face&output=jpg";
    const r = await fetch(prox, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    await loadFromDataURL(await blobToDataURL(await r.blob()));
    toast("Фото по ссылке загружено 🔗");
    hideEl(urlRow);
  } catch (e2) {
    console.warn("urlRow", e2);
    toast("По этой ссылке не вытянулась картинка", "err");
    stageNote.textContent = "";
  }
});

/* init ИИ-блока */
syncAiRows();

/* ---------- MediaPipe Face Landmarker (CDN, опционально) ---------- */
let landmarker = null;

function detectFace() {
  if (!landmarker || !state.img) return false;
  try {
    const res = landmarker.detect(state.img);
    const lms = res && res.faceLandmarks && res.faceLandmarks[0];
    state.face = lms ? buildAnchors(lms, state.img.width, state.img.height) : null;
    return !!lms;
  } catch (e) {
    console.warn("detect failed", e);
    return false;
  }
}

async function initLandmarker() {
  try {
    setEngine("is-loading", "загрузка нейросети…");
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    const make = delegate =>
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate,
        },
        runningMode: "IMAGE",
        numFaces: 1,
      });
    try { landmarker = await make("GPU"); }
    catch { landmarker = await make("CPU"); }

    setEngine("is-ready", "лица распознаются локально");
    if (state.img && detectFace()) {
      scheduleRender();
      toast("Лицо найдено — эффекты стали точнее 🧠", "info");
    } else if (state.img) {
      stageNote.textContent = "лицо не найдено — эффекты применяются к центру кадра";
    }
  } catch (e) {
    console.warn("MediaPipe недоступен, работаем в центральном режиме:", e);
    setEngine("is-off", "нет сети — центральный режим");
    if (state.img) {
      stageNote.textContent = "нет сети: лицо не распознаётся, эффекты применяются к центру кадра";
      scheduleRender();
    }
  }
}

/* ---------- init ---------- */
hideEl(thinking);
buildThemes();
enableToggles(false);
setCompare(100);
intensityOut.textContent = Math.round(state.intensity * 100) + "%";
initLandmarker();

/* хук для тестов/отладки */
window.__funny = {
  state, THEMES, loadFromDataURL, renderFunnyPic, fallbackAnchors,
  buildAnchors, detectFace,
  testImage() {
    const c = newCanvas(900, 1100);
    const x = c.getContext("2d");
    x.fillStyle = "#dff1ff"; x.fillRect(0, 0, c.width, c.height);
    // мультяшное лицо-болванчик
    x.fillStyle = "#3a2e2a";
    x.beginPath(); x.ellipse(450, 240, 240, 130, 0, Math.PI, TAU); x.fill();
    x.fillStyle = "#ffd9b3";
    x.beginPath(); x.ellipse(450, 480, 250, 310, 0, 0, TAU); x.fill();
    x.fillStyle = "#fff";
    x.beginPath(); x.ellipse(360, 420, 50, 32, 0, 0, TAU); x.fill();
    x.beginPath(); x.ellipse(540, 420, 50, 32, 0, 0, TAU); x.fill();
    x.fillStyle = "#243b53";
    x.beginPath(); x.arc(364, 424, 14, 0, TAU); x.fill();
    x.beginPath(); x.arc(544, 424, 14, 0, TAU); x.fill();
    x.strokeStyle = "#b06145"; x.lineWidth = 10;
    x.beginPath(); x.arc(450, 590, 90, .15 * Math.PI, .85 * Math.PI); x.stroke();
    x.strokeStyle = "#3a2e2a"; x.lineWidth = 14;
    x.beginPath(); x.moveTo(410, 350); x.quadraticCurveTo(450, 470, 490, 350); x.stroke();
    x.fillStyle = "#e98b7a";
    x.beginPath(); x.ellipse(450, 560, 34, 26, 0, 0, TAU); x.fill();
    return loadFromDataURL(c.toDataURL("image/png"));
  },
};

/* ============================================================
   Кривуля — мелкий чат-бот (локальный) + опциональная своя нейросеть
   ============================================================ */
const chatFab = $("chatFab"), chatPanel = $("chatPanel"), chatLog = $("chatLog");
const chatForm = $("chatForm"), chatText = $("chatText"), chatChips = $("chatChips");
const chatClose = $("chatClose"), aiForm = $("aiForm"), aiKeyField = $("aiKey");
const aiModel = $("aiModel"), aiForget = $("aiForget"), aiSetup = $("aiSetup");
const chatMode = $("chatMode");

const pickFrom = arr => arr[Math.floor(Math.random() * arr.length)];

const HISTORY_MAX = 10;
const chatHistory = [];

let aiKey = store.get("fm_ai_key") || "";
let aiModelName = store.get("fm_ai_model") || "gpt-4o-mini";
// бесплатный ИИ без ключа (Pollinations) + поиск через Wikipedia; Можно выключить в ⚙️
let freeAi = store.get("fm_freeai") !== "0";
let aiOfflineWarned = false;

/* чистим markdown-артефакты нейросети: пузырь рендерится через textContent */
function cleanReply(t) {
  return (t || "")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")                          // `код`
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")                            // **жирный**
    .replace(/(^|[^\d\wА-Яа-яёЁ])\*([^*\n]{1,80})\*(?=[^\d\wА-Яа-яёЁ]|$)/g, "$1$2") // *курсив* (2*3 не трогаем)
    .replace(/^\s*#{1,6}\s+/gm, "")                                 // ### заголовки
    .replace(/^\s*[-*]\s+(?=)/gm, "• ")                             // маркеры списка → •
    .replace(/⇒|➜|->/g, "→")
    .replace(/[ \t]+\n/g, "\n")                                     // хвостовые пробелы
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\*{2,}/g, "")                                         // неприпаренные звёздочки парами
    .trim();
}

const SYSTEM_PROMPT = [
  "Ты Кривуля — добродушный мини-помощник сайта «Кривое Зеркало», где смешно уродуют лица на фото через canvas-эффекты.",
  "Отвечай кратко (до 4 предложений), по-русски, с лёгким юмором.",
  "Сложные примеры считай аккуратно и точно; если дана выжимка из Wikipedia — опирайся только на неё и укажи источник.",
  "Не используй markdown-разметку (звёздочки, решётки, таблицы, код-блоки) — пиши обычным текстом; умножение обозначай знаком ×.",
  "Не поддерживай травлю, обиды и оскорбления; шутки — только добрые.",
].join(" ");

function warnAiOffline() {
  if (aiOfflineWarned) return;
  aiOfflineWarned = true;
  toast("Бесплатный ИИ не отвечает — пока отвечаю локально 📡", "err");
}

function addMsg(who, text) {
  const b = document.createElement("div");
  b.className = `msg ${who}`;
  const t = document.createElement("span");
  t.textContent = text;
  b.appendChild(t);
  chatLog.appendChild(b);
  chatLog.scrollTop = chatLog.scrollHeight;
  return t;
}

function remember(role, text) {
  chatHistory.push({ role, text });
  if (chatHistory.length > HISTORY_MAX) chatHistory.shift();
}

function typeOut(span, text) {
  return new Promise(res => {
    let i = 0;
    (function step() {
      i = Math.min(text.length, i + 3);
      span.textContent = text.slice(0, i);
      chatLog.scrollTop = chatLog.scrollHeight;
      if (i < text.length) setTimeout(step, 13);
      else res();
    })();
  });
}

/* ---------- локальный ответ ---------- */
const JOKES = [
  "Заходит как-то фотограф в кривое зеркало… и уже не выходит 🪞😄",
  "— Доктор, меня все игнорируют! — Следующий!",
  "Почему компьютеры не ходят в походы? Боятся потерять слежку за окнами 🪟",
  "Купил себе часы-будильник. Теперь я точно знаю время, когда мне надо встать… снова лечь.",
  "Что делает селфи, когда его обсуждают? Висит в сторис и краснеет 📸",
  "Оптимист видит стакан воды. Пессимист — кривое зеркало стакана 🥛",
];
const FACTS = [
  "Ваше фото обрабатывается прямо в браузере — до сайта доходит ровно ноль байт картинки 🕵️",
  "Нейросеть MediaPipe находит 478 точек на лице — от радужки до подбородка 🧠",
  "Первые «кривые зеркала» делали из бронзы — в Китае, больше 4000 лет назад 🪞",
  "Смекалка: смех активирует в среднем 15 мышц лица, а вот плач — почти 50 📐",
  "Веб-версия MediaPipe весит пару мегабайт и работает на WASM — фактически нейросеть в кармане 🤖",
  "Бот, которого вы хвалите и ругаете, — сотня-другая строк JavaScript и ни одной нейронки 🙂",
];
const HELLO = [
  "Привет-привет! Я Кривуля 🤖 Спросите время, посчитайте что-нибудь или попросите «подкинь тему» 😄",
  "О, привет! Заглянул на огонёк — отлично. Могу посчитать, побросать монетку, рассказать анекдот или выбрать тему для фото 🎲",
];
const HELP = [
  "Вот что я умею:",
  "• посчитать — напишите «сколько будет 7*8+2»",
  "• время и дата — «который час», «какой сегодня день»",
  "• «подкинь тему» — применю случайную тему к фото",
  "• «брось монетку», «брось кубик»",
  "• «анекдот», «факт»",
  "• кто такой/что такое … — найду в интернете (Wikipedia) ✍️",
  "• а ещё могу отвечать почти на любые вопросы — во мне вшит бесплатный ИИ (Pollinations) 🧠",
  "Если что-то не так ответит — скажите, я всего лишь бот в одном файле 🙂",
].join("\n");

function localReply(qRaw, { noFallback = false } = {}) {
  const q = qRaw.toLowerCase().trim();
  const has = keys => keys.some(k => q.includes(k));

  if (has(["привет", "здравств", "добрый день", "добрый вечер", "доброе утро", "хай", "хэллоу"]))
    return pickFrom(HELLO);

  if (has(["кто ты", "ты кто", "как тебя зовут", "твоё имя", "твое имя", "представься"]))
    return "Я Кривуля 🤖 — мелкий бот сайта «Кривое Зеркало». Живу в одном файле app.js, разговариваю без интернета. Стараюсь быть весёлым и полезным 🙂";

  if (has(["что умеешь", "помощь", "помоги", "help", "команд", "как пользоваться"]))
    return HELP;

  if (has(["сколько лет", "возраст", "старик"]))
    return "Мне ровно столько строк JS, сколько вы найдёте в моём исходнике. То есть вечная молодость, как у вампира 🧛";

  if (has(["туп", "глуп", "дура", "дурак", "дурак", "кривой"]))
    return "Ну при друге-то честно: я бот из двухсот строк — быть Эйнштейном выше моих сил 😅 но я стараюсь!";

  if (has(["как дела", "как ты", "как жизнь", "чем занят"]))
    return pickFrom([
      "Вися на этом сайте и щёлкаю пикселями — жизнь удалась! Как ваши дела? 🙃",
      "Отлично! Сегодня уже покривил 42 лица. Надеюсь, все смеялись 😄",
    ]);

  if (has(["люблю", "обнимаю", "❤", "❤️"]))
    return "И я вас — всеми 478 точками лица 🥹❤";

  if (has(["который час", "время", "сколько времени", "часиков"])) {
    const t = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return `На ваши часах сейчас ${t} ⏰`;
  }

  if (has(["какой день", "какое сегодня", "дата", "какое число"])) {
    const d = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return `Сегодня ${d}. Идеальный день, чтобы посмеяться над чьей-нибудь фотографией 📅`;
  }

  if (has(["погод", "дождь", "жара", "холодно"]))
    return "Погоду я не чувствую — у меня нет секретной метеостанции, и врать не стану. Проверьте в окно или в приложении погоды 🪟";

  // арифметика: «сколько будет 7*8», «посчитай 12+90/3»…
  if (has(["посчитай", "сколько будет", "сколько", "="]) || /\d\s*[-+*/^]\s*\d/.test(q)) {
    const m = q.match(/-?\d+(?:[.,]\d+)?(?:\s*[-+*/^]\s*-?\(?\s*-?\d+(?:[.,]\d+)?\s*\)?)+/);
    if (m) {
      let expr = m[0].replace(/,/g, ".").replace(/\^/g, "**");
      if (/^[-+*/().\d\s*]+$/.test(expr)) {
        try {
          const val = Function(`"use strict"; return (${expr});`)();
          if (typeof val === "number" && isFinite(val)) {
            const pretty = Math.abs(val) < 1e12 ? String(+val.toFixed(6)) : "вот такое большое число даже писать боязно";
            return `Считаю честно: ${expr.replace(/\*\*/g, "^")} = ${pretty} 🧮`;
          }
        } catch {}
      }
    }
    if (noFallback) return ""; // пусть решает бесплатный ИИ или общий фолбэк
    return "Такие дела… не понял выражение. Напишите, например: «сколько будет 12*34+5» 🧮";
  }

  if (has(["монет", "орел", "орёл", "решк", "подбрось"]))
    return pickFrom(["Монетка в воздухе… и это 🪙 ОРЁЛ!", "Крутится… ага, 🪙 РЕШКА!", "Бросила монетка и ответ: 🪙 ОРЁЛ!"]);

  if (has(["кубик", "кость", "кости"]))
    return `🎲 Кубик в полёте… выпало ${1 + Math.floor(Math.random() * 6)}!`;

  if (has(["анекдот", "шутк", "рассмеши", "шуткни", "поприкалывайся"]))
    return pickFrom(JOKES);

  if (has(["факт", "интересн", "знаешь ли", "расскажи что-нибудь"]))
    return pickFrom(FACTS);

  if (has(["темк", "какую тему", "подкинь тему", "выбери тему", "что выбрать", "поменяй тему", "скучно", "не знаю что"]))
  {
    const pool = THEMES.filter(t => t.id !== state.theme.id);
    const t = pickFrom(pool);
    selectTheme(t, { quiet: true });
    return `Применяю: ${t.emoji} ${t.name}! Если зайдёт — жмите 💾 и сохраняйте PNG. Не зайдёт — так и скажите, перекривим 🎨`;
  }

  if (has(["спасибо", "спс", "пасиб", "благодар"]))
    return pickFrom(["Всегда пожалуйста! 💫", "Рад услужить 😌", "Обращайтесь — я ведь всё равно тут, в этом же окне 🙂"]);

  if (has(["пока", "до свидан", "бай", "прощай", "до встречи"]))
    return "До встречи! Помните: улыбка продлевает жизнь, а кривое зеркало — продлевает её вдвое 😅 🪞";

  if (has(["кривое зеркало", "этот сайт", "этого сайта", "зачем этот"]))
    return "Этот сайт умеет: загружать фото (кнопкой, Drag&Drop или Ctrl+V), выбирать одну из 14 тем, крутить «силу смеха», сравнивать до/после и скачивать PNG. Правило одно: смеёмся только над фото тех, кто в курсе шутки 😉";

  if (noFallback) return "";
  return pickFrom([
    "Хм, не понял 🤔 Напишите «что умеешь» — покажу весь мой скромный арсенал.",
    "Я всего лишь мини-бот из двухсот строк… переформулируйте или спросите время, арифметику, анекдот 🙂",
    `Ответ на «${qRaw.slice(0, 40)}» мне недоступен — у меня образование начальное-JS. Может «подкинь тему»? 🎨`,
  ]);
}

/* ---------- бесплатный ИИ + поиск в интернете ---------- */
function extractTopic(q) {
  const s = " " + q.toLowerCase() + " ";
  let topic = "", m = null;
  if ((m = s.match(/(?:что такое|кто такой|кто такая|кто таков|что за)\s+/))) {
    topic = s.slice(m.index + m[0].length);
  } else if ((m = s.match(/(?:найди|погугли|поищи|посмотри)(?:\s+в\s+(?:интернете|сети|википедии))?/))) {
    topic = s.slice(m.index + m[0].length);
  } else if ((m = s.match(/(?:расскажи|инфа|информация|сведения)\s+(?:мне\s+)?(?:о|об|б|про)\s+/))) {
    topic = s.slice(m.index + m[0].length);
  }
  if (!topic) return null;
  topic = topic
    .replace(/^(?:мне\s+)?/, "")
    .replace(/^(?:что такое|кто такой|кто такая|кто таков)\s+/, "")
    .replace(/[?.!,]/g, " ")
    .trim();
  if (topic.length < 2) return null;
  topic = topic.split(/\s+(?:и |или |а ещё| плюс )/)[0].trim();
  return topic.slice(0, 80).trim() || null;
}

async function wikiFind(topic) {
  const bases = [
    ["ru", "https://ru.wikipedia.org"],
    ["en", "https://en.wikipedia.org"],
  ];
  for (const [lang, base] of bases) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const s = await fetch(
        `${base}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&format=json&origin=*&srlimit=1`,
        { signal: ctl.signal }
      );
      clearTimeout(t);
      if (!s.ok) continue;
      const d = await s.json();
      const hit = d && d.query && Array.isArray(d.query.search) && d.query.search[0];
      if (!hit || !hit.title) continue;
      const p = await fetch(`${base}/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, "_"))} `);
      const j = await p.json();
      const text = (j.extract || "").trim();
      if (!text) continue;
      const url = (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page)
        || `${base}/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`;
      return { lang, title: hit.title, text, url };
    } catch (e) {
      console.warn("wiki", lang, e);
    }
  }
  return null;
}

async function freeAI(q, wiki) {
  const msgs = [{ role: "system", content: SYSTEM_PROMPT }];
  if (wiki && wiki.text) {
    msgs.push({ role: "system", content: `Данные Wikipedia (статья «${wiki.title}»): ${wiki.text}` });
  }
  for (const h of chatHistory) {
    msgs.push({ role: h.role === "user" ? "user" : "assistant", content: h.text.slice(0, 600) });
  }
  msgs.push({ role: "user", content: q });

  // анонимный тир Pollinations иногда троттлит — пробуем дважды
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch("https://text.pollinations.ai/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai-fast", messages: msgs }),
        signal: ctl.signal,
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const text = ((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "").trim();
      if (text) return text;
      lastErr = new Error("пустой ответ");
    } catch (e) {
      lastErr = e;
      console.warn("freeAI attempt", attempt + 1, e);
    } finally {
      clearTimeout(t);
    }
    if (attempt === 0) await new Promise(res => setTimeout(res, 2500));
  }
  throw lastErr || new Error("freeAI недоступен");
}

/* ---------- своя нейросеть (по ключу) ---------- */
async function aiReply(q) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + aiKey },
    body: JSON.stringify({
      model: aiModelName || "gpt-4o-mini",
      messages: [
        { role: "system", content: "Ты Кривуля — добродушный мини-помощник сайта «Кривое Зеркало», где смешно «уродуют» лица на фото через canvas-эффекты. Отвечай кратко (максимум 3 предложения), по-русски, с лёгким юмором. Не давай медицинских расширений и не поддерживай обиды и дискриминацию." },
        ...chatHistory.map(h => ({ role: h.role, content: h.text })),
        { role: "user", content: q },
      ],
    }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || "").trim();
}

let busy = false;
let qQueue = Promise.resolve();

function respond(qRaw) {
  const q = qRaw.trim();
  if (!q) return;
  qQueue = qQueue.then(() => runRespond(q)).catch(err => console.warn(err));
}

async function runRespond(q) {
  busy = true;
  const span = addMsg("bot", "…");
  let reply = "";

  try {
    // 1) мгновенные локальные ответы: время/дата/монетка/анекдот/простая арифметика…
    const local = localReply(q, { noFallback: true });
    if (local) {
      reply = local;
    } else if (aiKey) {
      // 2) своя нейросеть по ключу пользователя
      try { reply = (await aiReply(q)) || ""; }
      catch (e) { console.warn("AI error", e); toast("До вашей нейросети не достучались — использую бесплатные шанс 📡", "err"); }
    }
    if (!reply && freeAi) {
      // 3) бесплатный ИИ (Pollinations); «найди/кто такой…» → сначала Wikipedia
      const topic = extractTopic(q);
      let wiki = null;
      try { if (topic) wiki = await wikiFind(topic); } catch (e) { console.warn("wiki", e); }
      try {
        reply = (await freeAI(q, wiki)) || "";
      } catch (e) {
        console.warn("freeAI fail", e);
        warnAiOffline();
        if (wiki) reply = `${wiki.text}\n\n📄 Источник: Wikipedia — ${wiki.url}`;
      }
    }
    if (!reply) reply = localReply(q); // полный локальный запасной
    await typeOut(span, cleanReply(reply));
  } catch (e) {
    console.warn("respond", e);
    await typeOut(span, localReply(q));
  }

  remember("user", q);
  remember("assistant", span.textContent);
  chatLog.scrollTop = chatLog.scrollHeight;
  busy = false;
}

chatForm.addEventListener("submit", e => {
  e.preventDefault();
  const q = chatText.value.trim();
  if (!q) return;
  chatText.value = "";
  addMsg("me", q);
  respond(q);
});

chatChips.addEventListener("click", e => {
  const btn = e.target.closest("button[data-q]");
  if (!btn) return;
  const q = btn.dataset.q;
  addMsg("me", q);
  respond(q);
});

function chatUI(mode) {
  chatMode.textContent = mode;
}

function refreshMode() {
  chatUI(
    aiKey
      ? `своя нейросеть · ${aiModelName || "gpt-4o-mini"}`
      : freeAi
        ? "бесплатный ИИ · Pollinations + Wikipedia 🌍"
        : "локальный бот · сети не надо"
  );
}

aiForm.addEventListener("submit", e => {
  e.preventDefault();
  aiKey = aiKeyField.value.trim();
  aiModelName = aiModel.value.trim() || "gpt-4o-mini";
  store.set("fm_ai_key", aiKey);
  store.set("fm_ai_model", aiModelName);
  hideEl(aiForm);
  refreshMode();
  addMsg("bot", aiKey ? "Ключ приняла 🤝 Теперь отвечаю через вашу нейросеть." : "Ключ пустой — остаюсь маленьким, но гордым локальным ботом 🙂");
  toast(aiKey ? "Нейросеть подключена 🤖" : "Ключ не задан", aiKey ? "info" : "err");
});

function aiKey_input() { return aiKeyField.textContent || aiKeyField.value; }

aiForget.addEventListener("click", () => {
  aiKey = ""; store.del("fm_ai_key");
  aiKeyField.value = "";
  hideEl(aiForm);
  refreshMode();
  addMsg("bot", "Забыли ✌ Ключ удалён из хранилища браузера.");
});

aiSetup.addEventListener("click", () => {
  aiForm.hidden ? showEl(aiForm) : hideEl(aiForm);
  if (aiKeyField) aiKeyField.value = aiKey;
});

/* переключатель бесплатного ИИ */
const freeAiToggle = $("freeAiToggle");
if (freeAiToggle) {
  freeAiToggle.checked = freeAi;
  freeAiToggle.addEventListener("change", () => {
    freeAi = freeAiToggle.checked;
    store.set("fm_freeai", freeAi ? "1" : "0");
    refreshMode();
    addMsg("bot", freeAi
      ? "Включаю бесплатную нейросеть и поиск по Wikipedia 🌍"
      : "Ок, работаю только по своим правилам — локально и мгновенно ✌");
  });
}

chatClose.addEventListener("click", () => { hideEl(chatPanel); showEl(chatFab); });
chatFab.addEventListener("click", () => {
  showEl(chatPanel); hideEl(chatFab);
  if (!chatLog.childElementCount) {
    remember("assistant", localReply("привет"));
    typeOut(addMsg("bot", "…"), chatHistory[chatHistory.length - 1].text);
  }
  chatText.focus();
});

/* init */
showEl(chatFab);
hideEl(chatPanel);
aiKeyField.value = aiKey;
refreshMode();
