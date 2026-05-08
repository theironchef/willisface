import { PEOPLE } from './people.js';
import { listPhotos, thumbUrl } from './drive.js';
import { APPS_SCRIPT_URL } from './config.js';
import { detectFace, drawAligned, loadImage, preloadDetector } from './face.js';

const PLACEHOLDER = './assets/placeholder.svg';

// Compare canvas resolution (logical px). Drawn into pane via CSS sizing.
const COMPARE_W = 720;
const COMPARE_H = 960;

const comparePane = document.getElementById('comparePane');
const cv1 = document.getElementById('cv1');
const cv2 = document.getElementById('cv2');
const name1El = document.getElementById('name1');
const name2El = document.getElementById('name2');
const splitSlider = document.getElementById('splitSlider');
const roster = document.getElementById('roster');
const nextPick = document.getElementById('nextPick');

[cv1, cv2].forEach((c) => { c.width = COMPARE_W; c.height = COMPARE_H; });

const state = {
  left: null,
  right: null,
  nextSlot: 'left',
  photos: {},
  // cached per-name detection results so re-picking is fast
  cache: new Map(), // name -> { image, eyes }
};

function renderCompare() {
  drawSlot(cv1, state.left);
  drawSlot(cv2, state.right);
  name1El.textContent = (state.left  || '—').toUpperCase();
  name2El.textContent = (state.right || '—').toUpperCase();
}

async function drawSlot(canvas, name) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#160630';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!name) return;

  const fileId = state.photos[name];
  if (!fileId) {
    // No photo yet — paint the placeholder centered
    try {
      const img = await loadImage(PLACEHOLDER);
      drawAligned(canvas, img, null);
    } catch (_) { /* ignore */ }
    return;
  }

  // Use cached image+eyes if available; otherwise load + detect.
  let entry = state.cache.get(name);
  if (!entry) {
    try {
      const img = await loadImage(thumbUrl(fileId, 800));
      const eyes = await detectFace(img);
      entry = { image: img, eyes };
      state.cache.set(name, entry);
    } catch (err) {
      console.warn('failed to load/detect face for', name, err);
      try {
        const img = await loadImage(PLACEHOLDER);
        drawAligned(canvas, img, null);
      } catch (_) {}
      return;
    }
  }

  drawAligned(canvas, entry.image, entry.eyes);
}

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
    renderCompare(); // re-render with real photos if slots already set
  } catch (err) {
    console.warn('listPhotos failed', err);
  }
}

buildRoster();
renderCompare();
renderHint();
setSplit(50);
preloadDetector();
loadPhotos();
