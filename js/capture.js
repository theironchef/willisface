import { PEOPLE } from './people.js';
import { uploadPhoto } from './drive.js';
import { CAPTURE_WIDTH, CAPTURE_HEIGHT, JPEG_QUALITY, APPS_SCRIPT_URL } from './config.js';

const params = new URLSearchParams(location.search);
const name = params.get('name') || '';

const whoEl = document.getElementById('who');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
const snapBtn = document.getElementById('snapBtn');
const retakeBtn = document.getElementById('retakeBtn');
const useBtn = document.getElementById('useBtn');

let stream = null;
let capturedBlob = null;

function setStatus(text, kind = '') {
  status.textContent = text;
  status.className = 'status' + (kind ? ' ' + kind : '');
}

function validName() {
  return PEOPLE.includes(name);
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 1707 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    setStatus('ALIGN FACE INSIDE THE OVAL');
  } catch (err) {
    console.error(err);
    setStatus('CAMERA ACCESS DENIED', 'error');
  }
}

function stopCamera() {
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
}

// Crop the live video to a 3:4 frame, mirrored to match what user saw,
// then to the visible "viewport" rect. Output CAPTURE_WIDTH × CAPTURE_HEIGHT JPEG.
function snap() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    setStatus('CAMERA NOT READY', 'error');
    return;
  }

  // Compute the source rect inside the video that corresponds to the 3:4 viewport (object-fit: cover).
  const targetAspect = CAPTURE_WIDTH / CAPTURE_HEIGHT; // 3/4 = 0.75
  const videoAspect = vw / vh;
  let sx, sy, sw, sh;
  if (videoAspect > targetAspect) {
    // video wider than 3:4 → crop sides
    sh = vh;
    sw = vh * targetAspect;
    sx = (vw - sw) / 2;
    sy = 0;
  } else {
    // video taller than 3:4 → crop top/bottom
    sw = vw;
    sh = vw / targetAspect;
    sx = 0;
    sy = (vh - sh) / 2;
  }

  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;
  const ctx = canvas.getContext('2d');

  // Mirror to match the on-screen preview (which is also mirrored).
  ctx.save();
  ctx.translate(CAPTURE_WIDTH, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
  ctx.restore();

  canvas.style.display = 'block';
  video.style.display = 'none';

  canvas.toBlob(
    (blob) => {
      capturedBlob = blob;
      snapBtn.hidden = true;
      retakeBtn.hidden = false;
      useBtn.hidden = false;
      setStatus('LOOKS GOOD?');
    },
    'image/jpeg',
    JPEG_QUALITY,
  );
}

function retake() {
  capturedBlob = null;
  canvas.style.display = 'none';
  video.style.display = 'block';
  snapBtn.hidden = false;
  retakeBtn.hidden = true;
  useBtn.hidden = true;
  setStatus('ALIGN FACE INSIDE THE OVAL');
}

async function upload() {
  if (!capturedBlob) return;
  if (!APPS_SCRIPT_URL) {
    setStatus('UPLOAD URL NOT CONFIGURED', 'error');
    return;
  }
  useBtn.disabled = true;
  retakeBtn.disabled = true;
  setStatus('UPLOADING…');
  try {
    await uploadPhoto(name, capturedBlob);
    setStatus('UPLOADED! THANK YOU.', 'ok');
    stopCamera();
    snapBtn.hidden = true;
    retakeBtn.hidden = true;
    useBtn.hidden = true;
  } catch (err) {
    console.error(err);
    setStatus('UPLOAD FAILED — TRY AGAIN', 'error');
    useBtn.disabled = false;
    retakeBtn.disabled = false;
  }
}

function init() {
  if (!validName()) {
    whoEl.textContent = '???';
    setStatus('UNKNOWN PERSON: ' + (name || '(missing)'), 'error');
    snapBtn.disabled = true;
    return;
  }
  whoEl.textContent = name.toUpperCase();
  document.title = `WILLISFACE :: ${name.toUpperCase()}`;
  snapBtn.addEventListener('click', snap);
  retakeBtn.addEventListener('click', retake);
  useBtn.addEventListener('click', upload);
  startCamera();
}

window.addEventListener('beforeunload', stopCamera);
init();
