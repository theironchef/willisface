import { PEOPLE } from './people.js';
import { listPhotos, thumbUrl } from './drive.js';
import { APPS_SCRIPT_URL } from './config.js';
import {
  detectFace,
  loadImage,
  preloadDetector,
  drawCoverOnly,
  drawAlignedToTarget,
  coverEyesOnCanvas,
} from './face.js';

const PLACEHOLDER = './assets/placeholder.svg';

const COMPARE_W = 720;
const COMPARE_H = 960;

const comparePane = document.getElementById('comparePane');
const cv1 = document.getElementById('cv1');
const cv2 = document.getElementById('cv2');
const name1El = document.getElementById('name1');
const name2El = document.getElementById('name2');
const splitSlider = document.getElementById('splitSlider');
const alignBtn = document.getElementById('alignBtn');
const roster = document.getElementById('roster');
const nextPick = document.getElementById('nextPick');

[cv1, cv2].forEach((c) => { c.width = COMPARE_W; c.height = COMPARE_H; });

const state = {
  left: null,
  right: null,
  nextSlot: 'left',
  align: true,                     // when false, both panes render cover-fit
  photos: {},                      // { name: fileId }
  cache: new Map(),                // name -> { image, eyes }
  loading: new Map(),              // name -> Promise<{image, eyes}>
};

// ---------- helpers ----------

function paintLoading(canvas, label) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#160630';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffd400';
  ctx.font = "bold 28px 'Press Start 2P', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);
}

function paintEmpty(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#160630';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Load image + run detection once per name. Cached for fast re-render.
async function ensureEntry(name) {
  if (state.cache.has(name)) return state.cache.get(name);
  if (state.loading.has(name)) return state.loading.get(name);

  const fileId = state.photos[name];
  const promise = (async () => {
    const url = fileId ? thumbUrl(fileId, 800) : PLACEHOLDER;
    const image = await loadImage(url);
    let eyes = null;
    if (fileId) {
      try { eyes = await detectFace(image); }
      catch (_) { /* CORS-tainted or detector unavailable */ }
    }
    const entry = { image, eyes };
    state.cache.set(name, entry);
    state.loading.delete(name);
    return entry;
  })();
  state.loading.set(name, promise);
  return promise;
}

// ---------- main render ----------

async function renderCompare() {
  // Mark canvases with the current pick so async results can be discarded
  // when stale. dataset.token is bumped on every render to support that.
  const token = String(Date.now()) + Math.random();
  cv1.dataset.token = token;
  cv2.dataset.token = token;

  // Always update name labels immediately.
  name1El.textContent = (state.left  || '—').toUpperCase();
  name2El.textContent = (state.right || '—').toUpperCase();

  // Stage 1: paint loading / empty / placeholder so the user sees a response.
  if (state.left)  paintLoading(cv1, 'LOADING…'); else paintEmpty(cv1);
  if (state.right) paintLoading(cv2, 'LOADING…'); else paintEmpty(cv2);

  // Stage 2: kick off any required loads in parallel.
  const leftP  = state.left  ? ensureEntry(state.left)  : Promise.resolve(null);
  const rightP = state.right ? ensureEntry(state.right) : Promise.resolve(null);
  const [leftEntry, rightEntry] = await Promise.all([leftP, rightP]).catch(() => [null, null]);

  // Bail if a fresher render started while we were waiting.
  if (cv1.dataset.token !== token) return;

  // Stage 3: draw.
  const aligning = state.align;

  // LEFT pane: always cover-fit (it's the reference framing).
  if (leftEntry) drawCoverOnly(cv1, leftEntry.image);

  // RIGHT pane: when alignment is ON and we have eyes for both faces,
  // similarity-transform right's image so its eyes land exactly where
  // left's eyes landed on cv1. Otherwise fall back to cover-fit.
  if (rightEntry) {
    if (aligning && leftEntry && leftEntry.eyes && rightEntry.eyes) {
      const targetEyes = coverEyesOnCanvas(leftEntry.image, leftEntry.eyes, COMPARE_W, COMPARE_H);
      drawAlignedToTarget(cv2, rightEntry.image, rightEntry.eyes, targetEyes);
    } else {
      drawCoverOnly(cv2, rightEntry.image);
    }
  }
}

// ---------- UI wiring ----------

function renderHint() {
  nextPick.textContent =
    state.nextSlot === 'left'
      ? 'TAP A FACE FOR THE LEFT SIDE'
      : 'TAP A FACE FOR THE RIGHT SIDE';
}

function renderTiles() {
  for (const tile of roster.children) {
    const n = tile.dataset.name;
    tile.classList.toggle('picked-left',  state.left  === n);
    tile.classList.toggle('picked-right', state.right === n);
  }
}

function pick(name) {
  if (state.nextSlot === 'left') {
    state.left = name;
    state.nextSlot = 'right';
  } else {
    state.right = name;
    state.nextSlot = 'left';
  }
  renderCompare();
  renderTiles();
  renderHint();
}

function buildRoster() {
  for (const name of PEOPLE) {
    const tile = document.createElement('div');
    tile.className = 'tile placeholder';
    tile.dataset.name = name;
    const img = document.createElement('img');
    img.src = PLACEHOLDER;
    img.alt = name;
    const label = document.createElement('div');
    label.className = 'tile-name';
    label.textContent = name.toUpperCase();
    tile.appendChild(img);
    tile.appendChild(label);
    tile.addEventListener('click', () => pick(name));
    roster.appendChild(tile);
  }
}

function setSplit(pct) {
  comparePane.style.setProperty('--split', pct + '%');
}

function refreshAlignBtn() {
  alignBtn.textContent = state.align ? 'ALIGN: ON' : 'ALIGN: OFF';
  alignBtn.classList.toggle('off', !state.align);
}

splitSlider.addEventListener('input', () => setSplit(splitSlider.value));
alignBtn.addEventListener('click', () => {
  state.align = !state.align;
  refreshAlignBtn();
  renderCompare();
});

async function loadPhotos() {
  if (!APPS_SCRIPT_URL) return;
  try {
    const photos = await listPhotos();
    state.photos = photos || {};
    for (const tile of roster.children) {
      const n = tile.dataset.name;
      const id = state.photos[n];
      if (id) {
        tile.classList.remove('placeholder');
        const img = tile.querySelector('img');
        img.src = thumbUrl(id, 400);
        img.onerror = () => { img.src = PLACEHOLDER; tile.classList.add('placeholder'); };
      }
    }
    renderCompare();
  } catch (err) {
    console.warn('listPhotos failed', err);
  }
}

buildRoster();
refreshAlignBtn();
renderCompare();
renderHint();
setSplit(50);
preloadDetector();
loadPhotos();
