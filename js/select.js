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
  alignedLandmarksOnCanvas,
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
  debug: false,
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
// Always resolves with an entry — image may be null on hard failure.
async function ensureEntry(name) {
  if (state.cache.has(name)) return state.cache.get(name);
  if (state.loading.has(name)) return state.loading.get(name);

  const fileId = state.photos[name];
  const promise = (async () => {
    let entry = { image: null, landmarks: null, sourceLabel: 'error' };
    try {
      if (!fileId) {
        entry.image = await loadImage(PLACEHOLDER);
        entry.sourceLabel = 'placeholder';
      } else {
        // Proxy first (returns a data: URL — same-origin, CORS-clean).
        let url = await fetchImageDataUrl(fileId);
        let sourceLabel = 'proxy';
        if (!url) { url = thumbUrl(fileId, 800); sourceLabel = 'thumb'; }
        try {
          entry.image = await loadImage(url);
          entry.sourceLabel = sourceLabel;
        } catch (err) {
          console.warn('image load failed for', name, '(' + sourceLabel + ')', err);
          // Try the other source as a fallback.
          const otherUrl = sourceLabel === 'proxy' ? thumbUrl(fileId, 800) : null;
          if (otherUrl) {
            try {
              entry.image = await loadImage(otherUrl);
              entry.sourceLabel = sourceLabel === 'proxy' ? 'thumb' : 'proxy';
            } catch (err2) {
              console.error('both sources failed for', name, err2);
            }
          }
        }
        if (entry.image) {
          if (!entry.image.naturalWidth || !entry.image.naturalHeight) {
            console.warn('image has zero dimensions for', name);
            entry.image = null;
            entry.sourceLabel = 'zerodim';
          } else {
            try { entry.landmarks = await detectFace(entry.image); }
            catch (err) { console.warn('detect threw for', name, err); }
            if (!entry.landmarks) console.warn('no face landmarks for', name);
            else                  console.log('landmarks for', name, entry.landmarks);
          }
        }
      }
    } catch (err) {
      console.error('ensureEntry failed for', name, err);
    } finally {
      state.cache.set(name, entry);
      state.loading.delete(name);
    }
    return entry;
  })();
  state.loading.set(name, promise);
  return promise;
}

function paintError(canvas, label) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#160630';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ff2222';
  ctx.font = "bold 22px 'Press Start 2P', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label || 'LOAD FAILED', canvas.width / 2, canvas.height / 2);
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
  function drawSlot(canvas, entry) {
    if (!entry) return;
    if (!entry.image) { paintError(canvas, 'LOAD FAILED'); return; }
    const lm = entry.landmarks;
    if (lm && lm.leftEye && lm.rightEye && lm.box && lm.box.height > 0) {
      drawAligned(canvas, entry.image, lm);
    } else {
      drawCoverOnly(canvas, entry.image);
    }
  }
  drawSlot(cv1, leftEntry);
  drawSlot(cv2, rightEntry);

  if (state.debug) {
    if (leftEntry && leftEntry.landmarks) {
      drawLandmarkMarkers(cv1, alignedLandmarksOnCanvas(cv1, leftEntry.landmarks));
    }
    if (rightEntry && rightEntry.landmarks) {
      drawLandmarkMarkers(cv2, alignedLandmarksOnCanvas(cv2, rightEntry.landmarks));
    }
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
