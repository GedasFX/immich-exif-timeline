# EXIF Timeline

A small web app for reordering Immich photos by editing their EXIF timestamps. Click photos to select, drop them between others, and adjust with a slider. Detects timestamps in filenames and offers one-click fixes with per-timezone interpretation.

https://github.com/user-attachments/assets/2b0acd16-a55b-4026-93c9-0c480d443777

## Setup

1. Set `IMMICH_URL` in `.env`
2. `npm install && npm run dev`
3. Open the app, paste your Immich API key (needs `asset.read`, `asset.view`, `asset.update`, `album.read` scopes)
