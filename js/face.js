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
  // 0=right_eye, 1=left_eye, 2=nose, 3=mouth, 4=right_ear, 5=left_ear
  // Coordinates from Tasks Vision come in pixel space already (they are
  // typed as `NormalizedKeypoint` but the values are pixels for IMAGE mode
  // when run on an HTMLImageElement / HTMLCanvasElement — so we don't
  // multiply by W/H). We sort by x to label viewer-left vs viewer-right.
  if (det.keypoints && det.keypoints.length >= 2) {
    const a = { x: det.keypoints[0].x, y: det.keypoints[0].y };
    const b = { x: det.keypoints[1].x, y: det.keypoints[1].y };
    // Some pipeline versions normalize to [0,1] — if both x,y < ~2 we treat as normalized.
    if (a.x <= 1.5 && a.y <= 1.5 && b.x <= 1.5 && b.y <= 1.5) {
      a.x *= W; a.y *= H; b.x *= W; b.y *= H;
    }
    if (a.x < b.x) { result.leftEye = a; result.rightEye = b; }
    else           { result.leftEye = b; result.rightEye = a; }
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

// Renders `image` into `canvas` so the eye line lands at a canonical
// position: eye center at (TGT_CX, TGT_CY) and eye distance = TGT_EYE_DIST,
// with a rotation correction so eyes are level. If `eyes` is null, falls
// back to a center "object-fit: cover" draw.
export function drawAligned(canvas, image, eyes, opts = {}) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = opts.background || '#160630';
  ctx.fillRect(0, 0, W, H);

  if (!eyes || !eyes.leftEye || !eyes.rightEye) {
    drawCover(ctx, image, W, H);
    return;
  }

  // Canonical eye position in the output canvas.
  const TGT_CX   = W * (opts.eyeCx   ?? 0.50);
  const TGT_CY   = H * (opts.eyeCy   ?? 0.40);
  const TGT_DIST = W * (opts.eyeDist ?? 0.32);

  const lx = eyes.leftEye.x,  ly = eyes.leftEye.y;
  const rx = eyes.rightEye.x, ry = eyes.rightEye.y;
  const cx = (lx + rx) / 2;
  const cy = (ly + ry) / 2;
  const d  = Math.hypot(rx - lx, ry - ly);
  const angle = Math.atan2(ry - ly, rx - lx);

  if (!d || !isFinite(d)) { drawCover(ctx, image, W, H); return; }

  const scale = TGT_DIST / d;
  ctx.save();
  ctx.translate(TGT_CX, TGT_CY);
  ctx.rotate(-angle);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
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

// Given an image, detected source-pixel eyes, and a canvas size W/H,
// return where those eyes will land on the canvas after a cover-fit
// draw. Used by the compare page to make the LEFT face the reference
// and align the RIGHT face to the same eye positions.
export function coverEyesOnCanvas(image, eyes, W, H) {
  if (!eyes || !eyes.leftEye || !eyes.rightEye) return null;
  const r = coverRect(image, W, H);
  const sx = (p) => (p.x - r.sx) * (W / r.sw);
  const sy = (p) => (p.y - r.sy) * (H / r.sh);
  return {
    leftEye:  { x: sx(eyes.leftEye),  y: sy(eyes.leftEye)  },
    rightEye: { x: sx(eyes.rightEye), y: sy(eyes.rightEye) },
  };
}

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
