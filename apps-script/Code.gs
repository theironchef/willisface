// WILLISFACE :: Apps Script Web App
// Deploy: Extensions/Editor → Deploy → New deployment →
//   Type: Web app
//   Execute as: Me
//   Who has access: Anyone
// Copy the resulting /exec URL into js/config.js as APPS_SCRIPT_URL.

// 1) Create a folder in your Drive (e.g. "willisface").
// 2) Open it in the browser; the URL ends with .../folders/<FOLDER_ID>.
// 3) Paste that ID here:
const FOLDER_ID = '1eQnc71AWU8k2FVliNUXcWTnXzSk4vGGn';

// Allowed display names — keep in sync with js/people.js
const PEOPLE = [
  'Grandma','Grandpa','Rob','Steph','Dave','Jenna','Liz','John','Dan','Charlet','Amelia',
  'Ben','Roy','Raena','Maddie','Winnie','Henry','Orla','Tripp','Cal','Brock'
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const name = String(data.name || '').trim();
    const imageBase64 = String(data.imageBase64 || '');

    if (!name || !imageBase64) {
      return jsonResponse({ error: 'missing name or image' });
    }
    if (PEOPLE.indexOf(name) === -1) {
      return jsonResponse({ error: 'unknown person: ' + name });
    }

    const folder = DriveApp.getFolderById(FOLDER_ID);
    const filename = name + '.jpg';
    const blob = Utilities.newBlob(Utilities.base64Decode(imageBase64), 'image/jpeg', filename);

    // Trash any existing file with the same name, then create fresh.
    const existing = folder.getFilesByName(filename);
    while (existing.hasNext()) existing.next().setTrashed(true);
    const file = folder.createFile(blob);

    // Make the file viewable by anyone with the link so the front page can show thumbs.
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (_) { /* permissions sometimes restricted; folder share covers us */ }

    return jsonResponse({ ok: true, id: file.getId(), name: name });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';
  if (action === 'list') {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const files = folder.getFiles();
    const out = {};
    while (files.hasNext()) {
      const f = files.next();
      const fname = f.getName();
      const m = fname.match(/^(.+)\.jpe?g$/i);
      if (!m) continue;
      out[m[1]] = f.getId();
    }
    return jsonResponse(out);
  }
  return jsonResponse({ error: 'unknown action' });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
