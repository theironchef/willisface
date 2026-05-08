import { APPS_SCRIPT_URL } from './config.js';

function ensureUrl() {
  if (!APPS_SCRIPT_URL) {
    throw new Error('APPS_SCRIPT_URL is not set in js/config.js');
  }
}

// POST a JPEG blob (overwrites the existing photo for `name`).
// Uses text/plain to avoid CORS preflight on Apps Script.
export async function uploadPhoto(name, jpegBlob) {
  ensureUrl();
  const imageBase64 = await blobToBase64(jpegBlob);
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ name, imageBase64 }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// GET the folder listing: { Charlet: 'fileId', Grandma: 'fileId', ... }
export async function listPhotos() {
  ensureUrl();
  const res = await fetch(APPS_SCRIPT_URL + '?action=list', { method: 'GET' });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// Drive thumbnail URL for a public file
export function thumbUrl(fileId, size = 600) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${size}`;
}

// Fetch the file via the Apps Script proxy as a data: URL — guaranteed
// CORS-clean (the Apps Script Web App returns JSON with the same-origin
// fetch). Returns null if the proxy isn't configured or returned an error.
// Requires the apps-script Code.gs to handle ?action=image (added 2026-05-08).
export async function fetchImageDataUrl(fileId) {
  if (!APPS_SCRIPT_URL) return null;
  try {
    const url = `${APPS_SCRIPT_URL}?action=image&id=${encodeURIComponent(fileId)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json || !json.ok || !json.b64) return null;
    return `data:${json.mime || 'image/jpeg'};base64,${json.b64}`;
  } catch (_) {
    return null;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result;
      // dataURL → base64 only
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
