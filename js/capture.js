import { PEOPLE } from './people.js';
import { uploadPhoto } from './drive.js';
import { CAPTURE_WIDTH, CAPTURE_HEIGHT, JPEG_QUALITY, APPS_SCRIPT_URL } from './config.js';

const params = new URLSearchParams(location.search);
const name = params.get('name') || '';

const whoEl = document.getElementById('who');
const viewport = document.getElementById('viewport');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
const snapBtn = document.getElementById('snapBtn');
const retakeBtn = document.getElementById('retakeBtn');
const useBtn = document.getElementById('useBtn');
const flipBtn = document.getElementById('flipBtn');

let stream = null;
let capturedBlob = null;
let facingMode = 'user'; // 'user' | 'environment'

function setStatus(text, kind = '') {
  status.textContent = text;
  status.className = 'status' + (kind ? ' ' + kind : '');
}

function validName() {
  return PEOPLE.includes(name);
}

function applyMirror() {
  // Only mirror the selfie cam — rear cam should be true-to-life.
  viewport.classList.toggle('mirrored', facingMode === 'user');
}

async function startCamera() {
  stopCamera();
  applyMirror();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
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

async function flipCamera() {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  flipBtn.disabled = true;
  setStatus('SWITCHING CAMERA…');
  await startCamera();
  flipBtn.disabled = false;
}

// Crop the live video to a 3:4 frame matching the visible viewport. Output
// CAPTURE_WIDTH × CAPTURE_HEIGHT JPEG. Mirror only for selfie cam.
function snap() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    setStatus('CAMERA NOT READY', 'error');
    return;
  }

  const targetAspect = CAPTURE_WIDTH / CAPTURE_HEIGHT; // 3/4 = 0.75
  const videoAspect = vw / vh;
  let sx, sy, sw, sh;
  if (videoAspect > targetAspect) {
    sh = vh;
    sw = vh * targetAspect;
    sx = (vw - sw) / 2;
    sy = 0;
  } else {
    sw = vw;
    sh = vw / targetAspect;
    sx = 0;
    sy = (vh - sh) / 2;
  }

  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;
  const ctx = canvas.getContext('2d');

  if (facingMode === 'user') {
    ctx.save();
    ctx.translate(CAPTURE_WIDTH, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    ctx.restore();
  } else {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
  }

  canvas.style.display = 'block';
  video.style.display = 'none';

  canvas.toBlob(
    (blob) => {
      capturedBlob = blob;
      snapBtn.hidden = true;
      retakeBtn.hidden = false;
      useBtn.hidden = false;
      flipBtn.disabled = true;
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
  flipBtn.disabled = false;
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
    flipBtn.hidden = true;
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
    flipBtn.disabled = true;
    return;
  }
  whoEl.textContent = name.toUpperCase();
  document.title = `WILLISFACE :: ${name.toUpperCase()}`;
  snapBtn.addEventListener('click', snap);
  retakeBtn.addEventListener('click', retake);
  useBtn.addEventListener('click', upload);
  flipBtn.addEventListener('click', flipCamera);
  startCamera();
}

window.addEventListener('beforeunload', stopCamera);
init();
