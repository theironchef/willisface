import { PEOPLE } from './people.js';

const grid = document.getElementById('qrGrid');

// Build the capture URL relative to the page so it works on
// localhost, GitHub Pages, or any host without changes.
function captureUrl(name) {
  const base = new URL('./capture.html', location.href);
  base.searchParams.set('name', name);
  return base.toString();
}

function makeCard(name) {
  const card = document.createElement('div');
  card.className = 'qr-card';
  const canvas = document.createElement('canvas');
  card.appendChild(canvas);
  const label = document.createElement('div');
  label.className = 'qr-name';
  label.textContent = name.toUpperCase();
  card.appendChild(label);
  // QRCode is loaded globally from the CDN script tag.
  // eslint-disable-next-line no-undef
  QRCode.toCanvas(canvas, captureUrl(name), { width: 240, margin: 1 });
  return card;
}

for (const name of PEOPLE) {
  grid.appendChild(makeCard(name));
}
