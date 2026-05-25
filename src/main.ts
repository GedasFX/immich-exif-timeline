import { ImmichApi } from './immich-api';
import { initTimeline, loadAlbumAssets } from './timeline';
import './style.css';

const savedKey = localStorage.getItem('immich-key') || '';

const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
const statusEl = document.getElementById('connection-status')!;
const albumBar = document.getElementById('album-bar')!;
const albumSelect = document.getElementById('album-select') as HTMLSelectElement;
const timelineContainer = document.getElementById('timeline-container')!;

apiKeyInput.value = savedKey;

let api: ImmichApi | null = null;

connectBtn.addEventListener('click', connect);

// Auto-connect if we have saved key
if (savedKey) {
  connect();
}

async function connect() {
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    statusEl.textContent = 'Please enter an API key';
    statusEl.className = 'error';
    return;
  }

  statusEl.textContent = 'Connecting...';
  statusEl.className = '';

  api = new ImmichApi({ apiKey });

  const ok = await api.ping();
  if (!ok) {
    statusEl.textContent = 'Failed to connect — check IMMICH_URL in .env';
    statusEl.className = 'error';
    api = null;
    return;
  }

  localStorage.setItem('immich-key', apiKey);

  statusEl.textContent = 'Connected';
  statusEl.className = 'success';

  initTimeline(api);
  await loadAlbums();
}

async function loadAlbums() {
  if (!api) return;

  const albums = await api.getAlbums();
  albumSelect.innerHTML = '<option value="">Select an album...</option>';

  albums
    .sort((a, b) => a.albumName.localeCompare(b.albumName))
    .forEach(album => {
      const opt = document.createElement('option');
      opt.value = album.id;
      opt.textContent = `${album.albumName} (${album.assetCount})`;
      albumSelect.appendChild(opt);
    });

  albumBar.classList.remove('hidden');
}

albumSelect.addEventListener('change', async () => {
  const albumId = albumSelect.value;
  if (!albumId) {
    timelineContainer.classList.add('hidden');
    return;
  }

  timelineContainer.classList.remove('hidden');
  await loadAlbumAssets(albumId);
});
