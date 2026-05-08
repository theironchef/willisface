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

function drawCover(ctx, image, W, H) {
  const iw = image.naturalWidth  || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  const ca = W / H;
  const ia = iw / ih;
  let sx, sy, sw, sh;
  if (ia > ca) {
    sh = ih; sw = sh * ca;
    sx = (iw - sw) / 2; sy = 0;
  } else {
    sw = iw; sh = sw / ca;
    sx = 0; sy = (ih - sh) / 2;
  }
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, W, H);
}
