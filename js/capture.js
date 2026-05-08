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
let facingMode = 'user';
let cameras = [];
let activeDeviceId = null;

function setStatus(text, kind = '') {
  status.textContent = text;
  status.className = 'status' + (kind ? ' ' + kind : '');
}

function validName() {
  return PEOPLE.includes(name);
}

function applyMirror() {
  viewport.classList.toggle('mirrored', facingMode === 'user');
}

function inferFacingFromLabel(label) {
  const s = (label || '').toLowerCase();
  if (s.includes('back') || s.includes('rear') || s.includes('environment')) return 'environment';
  if (s.includes('front') || s.includes('user') || s.includes('selfie') || s.includes('face')) return 'user';
  return null;
}

async function refreshCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameras = devices.filter((d) => d.kind === 'videoinput');
  } catch (err) {
    console.warn('enumerateDevices failed', err);
    cameras = [];
  }
}

function stopCamera() {
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  video.srcObject = null;
}

async function startWithConstraints(constraints) {
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  await video.play();
  const track = stream.getVideoTracks()[0];
  const settings = track && track.getSettings ? track.getSettings() : {};
  activeDeviceId = settings.deviceId || null;
  if (settings.facingMode === 'user' || settings.facingMode === 'environment') {
    facingMode = settings.facingMode;
  }
  applyMirror();
}

async function startCameraInitial() {
  try {
    await startWithConstraints({
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 1707 },
      },
      audio: false,
    });
    await refreshCameraList();
    setStatus('ALIGN FACE INSIDE THE OVAL');
  } catch (err) {
    console.error(err);
    setStatus('CAMERA ERROR: ' + (err.name || err.message || 'unknown'), 'error');
  }
}

async function flipCamera() {
  flipBtn.disabled = true;
  setStatus('SWITCHING CAMERA…');
  try {
    await refreshCameraList();
    if (cameras.length < 2) {
      setStatus('NO OTHER CAMERA FOUND', 'error');
      return;
    }
    let idx = cameras.findIndex((c) => c.deviceId === activeDeviceId);
    if (idx < 0) idx = 0;
    const next = cameras[(idx + 1) % cameras.length];
    const guessed = inferFacingFromLabel(next.label);
    if (guessed) facingMode = guessed;
    else facingMode = facingMode === 'user' ? 'environment' : 'user';

    await startWithConstraints({
      video: {
        deviceId: { exact: next.deviceId },
        width: { ideal: 1280 },
        height: { ideal: 1707 },
      },
      audio: false,
    });
    setStatus('ALIGN FACE INSIDE THE OVAL');
  } catch (err) {
    console.error(err);
    setStatus('SWITCH FAILED: ' + (err.name || err.message || 'unknown'), 'error');
  } finally {
    flipBtn.disabled = false;
  }
}

// Capture is intentionally simple: center-crop the live video to a 3:4
// frame matching the visible viewport, mirrored for selfie cam. The
// compare page handles face alignment on display, so we just preserve
// the raw shot here (better fidelity, easier to re-align later).
function snap() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    setStatus('CAMERA NOT READY', 'error');
    return;
  }

  const targetAspect = CAPTURE_WIDTH / CAPTURE_HEIGHT;
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
  startCameraInitial();
}

window.addEventListener('beforeunload', stopCamera);
init();
