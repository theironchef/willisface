import { PEOPLE } from './people.js';
import { listPhotos, thumbUrl, fetchImageDataUrl } from './drive.js';
import { APPS_SCRIPT_URL } from './config.js';
import {
  loadImage,
  detectFace,
  preloadDetector,
  drawCoverOnly,
  drawAligned,
  drawLandmarkMarkers,
  canonicalTargets,
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
const debugBtn = document.getElementById('debugBtn');
const debugStatusEl = document.getElementById('debugStatus');
const roster = document.getElementById('roster');
const nextPick = document.getElementById('nextPick');

[cv1, cv2].forEach((c) => { c.width = COMPARE_W; c.height = COMPARE_H; });

const state = {
  left: null,
  right: null,
  nextSlot: 'left',
  debug: true,
  photos: {},
  cache: new Map(),    // name -> { image, landmarks, sourceLabel }
  loading: new Map(),  // name -> Promise<entry>
};

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

// Loads an image (preferring the Apps Script proxy for CORS-clean bytes
// so face detection can read pixels) and runs detection on it. Cached.
async function ensureEntry(name) {
  if (state.cache.has(name)) return state.cache.get(name);
  if (state.loading.has(name)) return state.loading.get(name);

  const fileId = state.photos[name];
  const promise = (async () => {
    if (!fileId) {
      const image = await loadImage(PLACEHOLDER);
      const entry = { image, landmarks: null, sourceLabel: 'placeholder' };
      state.cache.set(name, entry);
      state.loading.delete(name);
      return entry;
    }

    // Proxy first (returns a data: URL — same-origin, CORS-clean).
    let url = await fetchImageDataUrl(fileId);
    let sourceLabel = 'proxy';
    if (!url) { url = thumbUrl(fileId, 800); sourceLabel = 'thumb'; }
    const image = await loadImage(url);
    let landmarks = null;
    try { landmarks = await detectFace(image); }
    catch (err) { console.warn('detect threw for', name, err); }
    if (!landmarks) console.warn('no face landmarks for', name, '(source=' + sourceLabel + ')');
    else            console.log('landmarks for', name, landmarks);
    const entry = { image, landmarks, sourceLabel };
    state.cache.set(name, entry);
    state.loading.delete(name);
    return entry;
  })();
  state.loading.set(name, promise);
  return promise;
}

function setDebugStatus(text) {
  debugStatusEl.textContent = text;
}

function fmtMark(landmarks) {
  if (!landmarks) return '✗';
  const have = ['leftEye', 'rightEye', 'nose', 'mouth'].filter((k) => landmarks[k]).length;
  return `${have}/4`;
}

let renderToken = 0;

async function renderCompare() {
  const token = ++renderToken;

  name1El.textContent = (state.left  || '—').toUpperCase();
  name2El.textContent = (state.right || '—').toUpperCase();

  if (state.left)  paintLoading(cv1, 'LOADING…'); else paintEmpty(cv1);
  if (state.right) paintLoading(cv2, 'LOADING…'); else paintEmpty(cv2);
  setDebugStatus('LOADING…');

  const leftP  = state.left  ? ensureEntry(state.left).catch(() => null)  : Promise.resolve(null);
  const rightP = state.right ? ensureEntry(state.right).catch(() => null) : Promise.resolve(null);
  const [leftEntry, rightEntry] = await Promise.all([leftP, rightP]);

  if (renderToken !== token) return;

  // Both panes get transformed to the SAME canonical target, so eye
  // midpoints land at canvas X=50% — putting both face centerlines on
  // the split divider.
  if (leftEntry) {
    if (leftEntry.landmarks && leftEntry.landmarks.leftEye && leftEntry.landmarks.rightEye) {
      drawAligned(cv1, leftEntry.image, leftEntry.landmarks);
    } else {
      drawCoverOnly(cv1, leftEntry.image);
    }
  }
  if (rightEntry) {
    if (rightEntry.landmarks && rightEntry.landmarks.leftEye && rightEntry.landmarks.rightEye) {
      drawAligned(cv2, rightEntry.image, rightEntry.landmarks);
    } else {
      drawCoverOnly(cv2, rightEntry.image);
    }
  }

  if (state.debug) {
    const targets = canonicalTargets(COMPARE_W, COMPARE_H);
    if (leftEntry  && leftEntry.landmarks)  drawLandmarkMarkers(cv1, targets);
    if (rightEntry && rightEntry.landmarks) drawLandmarkMarkers(cv2, targets);
  }

  // Status text.
  const lTag = leftEntry  ? fmtMark(leftEntry.landmarks)  : '—';
  const rTag = rightEntry ? fmtMark(rightEntry.landmarks) : '—';
  const lSrc = leftEntry  ? leftEntry.sourceLabel  : '—';
  const rSrc = rightEntry ? rightEntry.sourceLabel : '—';
  setDebugStatus(`L: ${lTag} (${lSrc})   R: ${rTag} (${rSrc})`);
}

// ---------- UI ----------

function refreshDebugBtn() {
  debugBtn.textContent = state.debug ? 'DEBUG: ON' : 'DEBUG: OFF';
  debugBtn.classList.toggle('off', !state.debug);
}

debugBtn.addEventListener('click', () => {
  state.debug = !state.debug;
  refreshDebugBtn();
  renderCompare();
});

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

splitSlider.addEventListener('input', () => setSplit(splitSlider.value));

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
refreshDebugBtn();
renderCompare();
renderHint();
setSplit(50);
preloadDetector();
loadPhotos();
