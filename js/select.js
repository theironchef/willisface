import { PEOPLE } from './people.js';
import { listPhotos, thumbUrl } from './drive.js';
import { APPS_SCRIPT_URL } from './config.js';

const PLACEHOLDER = './assets/placeholder.svg';

const slot1 = document.getElementById('slot1');
const slot2 = document.getElementById('slot2');
const roster = document.getElementById('roster');
const nextPick = document.getElementById('nextPick');

const state = {
  p1: null,        // name
  p2: null,        // name
  nextSlot: 1,     // which slot a tap fills next (1, 2, then back to 1)
  photos: {},      // { name: fileId }
};

function render() {
  renderSlot(slot1, state.p1);
  renderSlot(slot2, state.p2);

  for (const tile of roster.children) {
    const name = tile.dataset.name;
    tile.classList.toggle('p1', state.p1 === name);
    tile.classList.toggle('p2', state.p2 === name);
  }

  const nextLabel = state.nextSlot === 1 ? 'PLAYER 1' : 'PLAYER 2';
  nextPick.textContent = `TAP A FACE TO PICK ${nextLabel}`;
}

function renderSlot(slotEl, name) {
  slotEl.innerHTML = '';
  if (!name) {
    slotEl.classList.add('empty');
    return;
  }
  slotEl.classList.remove('empty');
  const img = document.createElement('img');
  img.src = imgSrc(name);
  img.alt = name;
  img.onerror = () => { img.src = PLACEHOLDER; };
  const label = document.createElement('div');
  label.className = 'slot-name';
  label.textContent = name.toUpperCase();
  slotEl.appendChild(img);
  slotEl.appendChild(label);
}

function imgSrc(name) {
  const id = state.photos[name];
  return id ? thumbUrl(id, 600) : PLACEHOLDER;
}

function pick(name) {
  if (state.nextSlot === 1) {
    state.p1 = name;
    state.nextSlot = 2;
  } else {
    state.p2 = name;
    state.nextSlot = 1;
  }
  render();
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
    if (state.p1) renderSlot(slot1, state.p1);
    if (state.p2) renderSlot(slot2, state.p2);
  } catch (err) {
    console.warn('listPhotos failed', err);
  }
}

buildRoster();
render();
loadPhotos();
