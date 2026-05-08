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
  const url = captureUrl(name);

  // Anchor wraps the whole card so a tap on phone opens the capture page.
  const card = document.createElement('a');
  card.className = 'qr-card';
  card.href = url;

  // qrcode() is the global from qrcode-generator (CDN script tag in qr.html).
  // eslint-disable-next-line no-undef
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  // 6 = cell size px, 2 = margin cells. Returns an <img> HTML string with data URL.
  const imgHtml = qr.createImgTag(6, 2);

  const imgWrap = document.createElement('div');
  imgWrap.innerHTML = imgHtml;

  const label = document.createElement('div');
  label.className = 'qr-name';
  label.textContent = name.toUpperCase();

  card.appendChild(imgWrap.firstChild);
  card.appendChild(label);
  return card;
}

for (const name of PEOPLE) {
  grid.appendChild(makeCard(name));
}
