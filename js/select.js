import { PEOPLE } from './people.js';
import { listPhotos, thumbUrl } from './drive.js';
import { APPS_SCRIPT_URL } from './config.js';

const PLACEHOLDER = './assets/placeholder.svg';

const comparePane = document.getElementById('comparePane');
const img1 = document.getElementById('img1');
const img2 = document.getElementById('img2');
const name1El = document.getElementById('name1');
const name2El = document.getElementById('name2');
const splitSlider = document.getElementById('splitSlider');
const roster = document.getElementById('roster');
const nextPick = document.getElementById('nextPick');

const state = {
  left: null,      // name on the left side (revealed when slider moves right)
  right: null,     // name on the right side (revealed when slider moves left)
  nextSlot: 'left',
  photos: {},      // { name: fileId }
};

function renderCompare() {
  img1.src = state.left  ? imgSrc(state.left)  : PLACEHOLDER;
  img2.src = state.right ? imgSrc(state.right) : PLACEHOLDER;
  img1.classList.toggle('placeholder', !state.left);
  img2.classList.toggle('placeholder', !state.right);
  name1El.textContent = (state.left  || '—').toUpperCase();
  name2El.textContent = (state.right || '—').toUpperCase();
}

function renderHint() {
  if (state.nextSlot === 'left') {
    nextPick.textContent = 'TAP A FACE FOR THE LEFT SIDE';
  } else {
    nextPick.textContent = 'TAP A FACE FOR THE RIGHT SIDE';
  }
}

function renderTiles() {
  for (const tile of roster.children) {
    const name = tile.dataset.name;
    tile.classList.toggle('picked-left',  state.left  === name);
    tile.classList.toggle('picked-right', state.right === name);
  }
}

function imgSrc(name) {
  const id = state.photos[name];
  return id ? thumbUrl(id, 800) : PLACEHOLDER;
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
      const name = tile.dataset.name;
      const id = state.photos[name];
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
renderCompare();
renderHint();
setSplit(50);
loadPhotos();
