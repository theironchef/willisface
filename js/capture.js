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
let facingMode = 'user';      // 'user' | 'environment' — drives mirror behavior
let cameras = [];             // [{ deviceId, label }, ...]
let activeDeviceId = null;

function setStatus(text, kind = '') {
  status.textContent = text;
  status.className = 'status' + (kind ? ' ' + kind : '');
}

function validName() {
  return PEOPLE.includes(name);
}

function applyMirror() {
  // Only mirror the selfie cam — rear cam stays true-to-life.
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
  // Refine facingMode from track settings (Chrome reports it on Android).
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
    // Labels are only populated AFTER permission grants. Refresh now.
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

    // Find current camera index, advance to next.
    let idx = cameras.findIndex((c) => c.deviceId === activeDeviceId);
    if (idx < 0) idx = 0;
    const next = cameras[(idx + 1) % cameras.length];

    // Predict facing mode from label so mirror flips correctly even before
    // the new track's settings come back.
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

// Target framing: face occupies ~62% of output height, eyes ~38% from top.
// Implemented as: place the face bounding box's vertical center at FACE_CY of
// output, horizontal center at output center, and scale so face height equals
// FACE_H_FRAC of output height. This normalizes scale + translation so users
// just need to be in frame — exact alignment is corrected automatically.
const FACE_H_FRAC = 0.62;
const FACE_CX_FRAC = 0.50;
const FACE_CY_FRAC = 0.48;

// Cross-platform face detection: native FaceDetector (Android Chrome) when
// available, MediaPipe Tasks Vision FaceDetector as fallback (iOS Safari etc.).
const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';

let detectorState = { kind: null, detector: null, promise: null };

function ensureDetector() {
  if (detectorState.promise) return detectorState.promise;
  detectorState.promise = (async () => {
    if ('FaceDetector' in window) {
      try {
        detectorState.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        detectorState.kind = 'native';
        return;
      } catch (_) { /* fall through to MediaPipe */ }
    }
    const mod = await import(/* @vite-ignore */ `https://esm.sh/@mediapipe/tasks-vision@${MP_VERSION}`);
    const vision = await mod.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    detectorState.detector = await mod.FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
      runningMode: 'IMAGE',
    });
    detectorState.kind = 'mediapipe';
  })();
  detectorState.promise.catch((err) => {
    console.warn('detector load failed', err);
    detectorState.promise = null; // allow retry
  });
  return detectorState.promise;
}

async function detectFace(canvasEl) {
  try {
    await ensureDetector();
  } catch (_) { return null; }
  const { kind, detector } = detectorState;
  if (!detector) return null;
  try {
    if (kind === 'native') {
      const faces = await detector.detect(canvasEl);
      if (faces && faces.length) {
        const bb = faces[0].boundingBox;
        return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
      }
    } else {
      const out = detector.detect(canvasEl);
      if (out && out.detections && out.detections.length) {
        const bb = out.detections[0].boundingBox;
        return { x: bb.originX, y: bb.originY, width: bb.width, height: bb.height };
      }
    }
  } catch (err) {
    console.warn('detect failed', err);
  }
  return null;
}

function computeCenterCrop(vw, vh, targetAspect) {
  if (vw / vh > targetAspect) {
    const ch = vh, cw = vh * targetAspect;
    return { cx: (vw - cw) / 2, cy: 0, cw, ch };
  }
  const cw = vw, ch = vw / targetAspect;
  return { cx: 0, cy: (vh - ch) / 2, cw, ch };
}

function computeFaceCrop(face, vw, vh, outW, outH) {
  const targetAspect = outW / outH;
  const fcx = face.x + face.width / 2;
  const fcy = face.y + face.height / 2;

  let ch = face.height / FACE_H_FRAC;
  let cw = ch * targetAspect;

  // If the desired crop is bigger than the source frame, shrink to fit
  // and accept a slightly smaller face.
  if (cw > vw) { cw = vw; ch = cw / targetAspect; }
  if (ch > vh) { ch = vh; cw = ch * targetAspect; }

  let cx = fcx - cw * FACE_CX_FRAC;
  let cy = fcy - ch * FACE_CY_FRAC;
  cx = Math.max(0, Math.min(vw - cw, cx));
  cy = Math.max(0, Math.min(vh - ch, cy));
  return { cx, cy, cw, ch };
}

async function snap() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    setStatus('CAMERA NOT READY', 'error');
    return;
  }

  setStatus('FINDING FACE…');

  // Render the full video frame (mirrored for selfie cam) to a temp canvas
  // at full source resolution. We detect the face on this and then crop a
  // 3:4 region from it for the final output, preserving max detail.
  const tmp = document.createElement('canvas');
  tmp.width = vw;
  tmp.height = vh;
  const tctx = tmp.getContext('2d');
  if (facingMode === 'user') {
    tctx.translate(vw, 0);
    tctx.scale(-1, 1);
  }
  tctx.drawImage(video, 0, 0, vw, vh);

  const face = await detectFace(tmp);
  const targetAspect = CAPTURE_WIDTH / CAPTURE_HEIGHT;
  const crop = face
    ? computeFaceCrop(face, vw, vh, CAPTURE_WIDTH, CAPTURE_HEIGHT)
    : computeCenterCrop(vw, vh, targetAspect);

  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(tmp, crop.cx, crop.cy, crop.cw, crop.ch, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);

  canvas.style.display = 'block';
  video.style.display = 'none';

  canvas.toBlob(
    (blob) => {
      capturedBlob = blob;
      snapBtn.hidden = true;
      retakeBtn.hidden = false;
      useBtn.hidden = false;
      flipBtn.disabled = true;
      setStatus(face ? 'AUTO-ALIGNED — LOOKS GOOD?' : 'NO FACE DETECTED — LOOKS OK?');
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
  // Kick off the face-detector load in parallel with the camera so the
  // model is usually ready by the time the user taps SNAP.
  ensureDetector().catch(() => {});
}

window.addEventListener('beforeunload', stopCamera);
init();
