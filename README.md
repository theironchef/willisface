# WILLISFACE

A throwaway family photo-booth web app.

- Each person has a personal QR code that opens a camera with a face-centering overlay so every photo is framed identically.
- Photos upload directly to a Google Drive folder via a Google Apps Script Web App (no server, no credentials in client code).
- The home page is a Street Fighter "Select Your Fighter" grid — tap two faces, see them up top side by side.

Hosted on GitHub Pages: <https://theironchef.github.io/willisface/>

## Pages

- `/` — character select (`index.html`)
- `/capture.html?name=<DisplayName>` — camera + overlay + upload
- `/qr.html` — printable grid of QR codes for all 21 people

## One-time setup

### 1. Drive folder

Create a folder in your Google Drive (e.g. `willisface`). Open it; the URL ends with `…/folders/<FOLDER_ID>` — copy that ID.

### 2. Apps Script

1. Go to <https://script.google.com> → **New project**.
2. Replace the default `Code.gs` content with `apps-script/Code.gs` from this repo.
3. Set `FOLDER_ID` at the top to the ID from step 1.
4. **Deploy → New deployment**:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Authorize when prompted (warning screen → Advanced → Go to project → Allow).
6. Copy the deployment URL (ends with `/exec`).

### 3. Wire it up

Paste the `/exec` URL into [`js/config.js`](js/config.js):

```js
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/.../exec';
```

Commit and push.

### 4. GitHub Pages

In repo settings → Pages → set source to `main` branch, root. Wait ~1 minute.
The site will be at `https://<user>.github.io/willisface/`.

### 5. Print the QR codes

Open `/qr.html` and click PRINT.

## After the event

- Revoke the Apps Script's authorization at <https://myaccount.google.com/permissions>.
- Or just delete the script project, the Drive folder, and the GitHub repo.

## Notes

- QR code URLs are computed from `window.location` at render time, so they automatically point at whatever host is serving the page.
- Photos are stored as `{Name}.jpg`. New uploads trash and replace the existing file by name (no collisions between people, no duplicates per person).
- The face-overlay viewport is 3:4. Captured JPEGs are 800×1067 by default — change in `js/config.js`.
- Selfie cam is mirrored on screen and the captured photo is mirrored to match what the user saw.
