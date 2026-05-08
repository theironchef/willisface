// Shared face detector. MediaPipe Tasks Vision (BlazeFace short-range)
// returns a bounding box AND 6 keypoints — the first two are the eyes,
// which we use to compute a similarity transform (scale + rotate +
// translate) to align faces in the compare view.
//
// MediaPipe is preferred over the browser's native FaceDetector because
// (a) it works on iOS Safari, and (b) Chrome's native API doesn't reliably
// return eye landmarks.

const MP_VERSION = '0.10.14';
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';

let detector = null;
let loadPromise = null;

export function preloadDetector() {
  loadDetector().catch(() => {});
}

function loadDetector() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const mod = await import(/* @vite-ignore */ `https://esm.sh/@mediapipe/tasks-vision@${MP_VERSION}`);
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
    detector = await mod.FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
      runningMode: 'IMAGE',
    });
  })();
  loadPromise.catch(() => { loadPromise = null; }); // allow retry on transient failure
  return loadPromise;
}

// Detects the most prominent face in `imgOrCanvas`.
// Returns { box: {x,y,width,height}, leftEye?: {x,y}, rightEye?: {x,y} } in
// PIXEL coordinates of the source, or null if nothing found.
//
// "leftEye" / "rightEye" are sorted by x so they correspond to the
// viewer's left and right halves of the image (subject's right eye and
// subject's left eye respectively).
export async function detectFace(imgOrCanvas) {
  try { await loadDetector(); } catch (_) { return null; }
  if (!detector) return null;

  const W = imgOrCanvas.naturalWidth  || imgOrCanvas.width;
  const H = imgOrCanvas.naturalHeight || imgOrCanvas.height;
  if (!W || !H) return null;

  let out;
  try { out = detector.detect(imgOrCanvas); }
  catch (err) { console.warn('detect failed', err); return null; }
  if (!out || !out.detections || !out.detections.length) return null;

  const det = out.detections[0];
  const bb = det.boundingBox;
  const result = {
    box: { x: bb.originX, y: bb.originY, width: bb.width, height: bb.height },
  };

  // BlazeFace short-range keypoints (in subject perspective):
  // 0=right_eye, 1=left_eye, 2=nose_tip, 3=mouth, 4=right_ear, 5=left_ear
  // Tasks Vision sometimes returns normalized [0,1], sometimes pixel coords.
  // We auto-detect by magnitude.
  const kps = det.keypoints || [];
  if (kps.length >= 2) {
    const raw = kps.map((p) => ({ x: p.x, y: p.y }));
    const allSmall = raw.every((p) => p.x <= 1.5 && p.y <= 1.5);
    if (allSmall) for (const p of raw) { p.x *= W; p.y *= H; }
    // Sort eyes (first two keypoints) so viewer-left has lower x.
    const a = raw[0], b = raw[1];
    if (a.x < b.x) { result.leftEye = a;  result.rightEye = b; }
    else           { result.leftEye = b;  result.rightEye = a; }
    if (raw[2]) result.nose  = raw[2];
    if (raw[3]) result.mouth = raw[3];
  }
  return result;
}

// Loads an image, preferring CORS-clean (so face detection can read pixels).
// Falls back to a non-CORS load if the host doesn't return CORS headers — in
// that case face detection will silently fail and we display the raw image.
export async function loadImage(url) {
  try { return await loadOnce(url, true); }
  catch (_) { /* fall back to non-CORS */ }
  return loadOnce(url, false);
}

function loadOnce(url, withCors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (withCors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

// Canonical target where every face's bounding box lands. Both compare
// panes use the same target so faces are the same size and centerlines
// coincide with the split divider.
//
// Scale is driven by the face bounding-box HEIGHT (more reliable than
// eye distance for matching head sizes). Translation puts the eye
// midpoint at (eyeCx, eyeCy) so eye lines coincide. Rotation makes the
// eye line horizontal.
export const CANONICAL = {
  eyeCx:    0.50, // eye midpoint X (fraction of canvas width)
  eyeCy:    0.42, // eye midpoint Y (fraction of canvas height)
  faceHFrac: 0.70, // face bounding-box height as fraction of canvas height
};

// Returns the canonical landmark target positions in canvas pixel coords
// — used both as transform targets and to draw debug markers.
export function canonicalTargets(W, H, opts = CANONICAL) {
  const cx = W * opts.eyeCx;
  const cy = H * opts.eyeCy;
  // Approximate eye half-spacing for the debug eye-line marker. Real
  // alignment uses the bounding box, so this is illustrative only.
  const halfEye = W * 0.16;
  const faceH = H * opts.faceHFrac;
  return {
    leftEye:  { x: cx - halfEye, y: cy },
    rightEye: { x: cx + halfEye, y: cy },
    nose:     { x: cx,           y: cy + faceH * 0.18 },
    mouth:    { x: cx,           y: cy + faceH * 0.36 },
  };
}

// Renders `image` into `canvas` with a similarity transform that:
//  - centers the source eye midpoint at the canonical (eyeCx, eyeCy),
//  - scales so the source face bounding-box height equals faceHFrac × H,
//  - rotates so the eye line is horizontal.
// Falls back to "object-fit: cover" if any required landmark is missing.
export function drawAligned(canvas, image, lm, opts = CANONICAL) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#160630';
  ctx.fillRect(0, 0, W, H);

  if (!lm || !lm.leftEye || !lm.rightEye || !lm.box || !lm.box.height) {
    drawCover(ctx, image, W, H);
    return;
  }

  const lx = lm.leftEye.x,  ly = lm.leftEye.y;
  const rx = lm.rightEye.x, ry = lm.rightEye.y;
  const eyeCx = (lx + rx) / 2;
  const eyeCy = (ly + ry) / 2;
  const angle = Math.atan2(ry - ly, rx - lx);

  const scale = (H * opts.faceHFrac) / lm.box.height;
  if (!isFinite(scale) || scale <= 0) { drawCover(ctx, image, W, H); return; }

  const tcx = W * opts.eyeCx;
  const tcy = H * opts.eyeCy;

  ctx.save();
  ctx.translate(tcx, tcy);     // eye midpoint lands here
  ctx.rotate(-angle);          // levels the eye line
  ctx.scale(scale, scale);     // bbox height becomes faceHFrac × H
  ctx.translate(-eyeCx, -eyeCy);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

function coverRect(image, W, H) {
  const iw = image.naturalWidth  || image.width;
  const ih = image.naturalHeight || image.height;
  const ca = W / H;
  const ia = iw / ih;
  if (ia > ca) {
    const sh = ih, sw = sh * ca;
    return { sx: (iw - sw) / 2, sy: 0, sw, sh };
  }
  const sw = iw, sh = sw / ca;
  return { sx: 0, sy: (ih - sh) / 2, sw, sh };
}

function drawCover(ctx, image, W, H) {
  const iw = image.naturalWidth  || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  const r = coverRect(image, W, H);
  ctx.drawImage(image, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
}

// Maps source-pixel landmark coords to canvas coords after a cover-fit
// draw of `image` into a W×H canvas. Used by the compare page to know
// where the LEFT face's landmarks are visible, so the RIGHT face can be
// aligned to those same canvas positions.
export function landmarksOnCanvas(image, landmarks, W, H) {
  if (!landmarks) return null;
  const r = coverRect(image, W, H);
  const sx = (p) => (p.x - r.sx) * (W / r.sw);
  const sy = (p) => (p.y - r.sy) * (H / r.sh);
  const map = (p) => (p ? { x: sx(p), y: sy(p) } : null);
  const out = {
    leftEye:  map(landmarks.leftEye),
    rightEye: map(landmarks.rightEye),
    nose:     map(landmarks.nose),
    mouth:    map(landmarks.mouth),
  };
  if (!out.leftEye || !out.rightEye) return null;
  return out;
}

// Backwards-compat alias.
export const coverEyesOnCanvas = landmarksOnCanvas;

// Render `image` into `canvas` with a similarity transform that lands its
// detected `eyes` exactly on `targetEyes` (in canvas coords). Falls back to
// cover-fit if anything's missing.
export function drawAlignedToTarget(canvas, image, eyes, targetEyes, opts = {}) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = opts.background || '#160630';
  ctx.fillRect(0, 0, W, H);

  if (!eyes || !eyes.leftEye || !eyes.rightEye ||
      !targetEyes || !targetEyes.leftEye || !targetEyes.rightEye) {
    drawCover(ctx, image, W, H);
    return;
  }

  const lx = eyes.leftEye.x,  ly = eyes.leftEye.y;
  const rx = eyes.rightEye.x, ry = eyes.rightEye.y;
  const cx = (lx + rx) / 2, cy = (ly + ry) / 2;
  const d  = Math.hypot(rx - lx, ry - ly);
  const angle = Math.atan2(ry - ly, rx - lx);

  const tlx = targetEyes.leftEye.x,  tly = targetEyes.leftEye.y;
  const trx = targetEyes.rightEye.x, ttry = targetEyes.rightEye.y;
  const tcx = (tlx + trx) / 2, tcy = (tly + ttry) / 2;
  const td  = Math.hypot(trx - tlx, ttry - tly);
  const tAngle = Math.atan2(ttry - tly, trx - tlx);

  if (!d || !td || !isFinite(d) || !isFinite(td)) {
    drawCover(ctx, image, W, H);
    return;
  }

  ctx.save();
  ctx.translate(tcx, tcy);
  ctx.rotate(tAngle - angle);
  ctx.scale(td / d, td / d);
  ctx.translate(-cx, -cy);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

// Cover-fit only — exposed for the "alignment off" debug mode.
export function drawCoverOnly(canvas, image) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#160630';
  ctx.fillRect(0, 0, W, H);
  drawCover(ctx, image, W, H);
}

// Draw `image` cover-fit, with a manual transform (translate, scale,
// rotate) applied around the canvas center. Used for user-driven
// manual face alignment on the right pane.
export function drawCoverWithTransform(canvas, image, t) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#160630';
  ctx.fillRect(0, 0, W, H);
  if (!image) return;
  const r = coverRect(image, W, H);
  const tx = (t && t.tx) || 0;
  const ty = (t && t.ty) || 0;
  const scale = (t && typeof t.scale === 'number') ? t.scale : 1;
  const rotation = (t && typeof t.rotation === 'number') ? t.rotation : 0;
  ctx.save();
  ctx.translate(W / 2 + tx, H / 2 + ty);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.drawImage(image, r.sx, r.sy, r.sw, r.sh, -W / 2, -H / 2, W, H);
  ctx.restore();
}

// Debug overlay: draws markers at each landmark on the canvas.
// Eyes = green, nose = yellow, mouth = pink.
export function drawLandmarkMarkers(canvas, landmarksOnCv) {
  if (!landmarksOnCv) return;
  const ctx = canvas.getContext('2d');
  const dot = (p, color, r = 12) => {
    if (!p) return;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  ctx.save();
  dot(landmarksOnCv.leftEye,  '#00ff66', 14);
  dot(landmarksOnCv.rightEye, '#00ff66', 14);
  dot(landmarksOnCv.nose,     '#ffd400', 12);
  dot(landmarksOnCv.mouth,    '#ff2e88', 12);
  // Eye line
  if (landmarksOnCv.leftEye && landmarksOnCv.rightEye) {
    ctx.strokeStyle = '#00ff66';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(landmarksOnCv.leftEye.x, landmarksOnCv.leftEye.y);
    ctx.lineTo(landmarksOnCv.rightEye.x, landmarksOnCv.rightEye.y);
    ctx.stroke();
  }
  ctx.restore();
}

// Backwards-compat alias.
export const drawEyeMarkers = drawLandmarkMarkers;
