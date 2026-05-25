import { ImmichApi } from './immich-api';
import type { Asset } from './immich-api';
import { showSliderModal } from './slider';

let api: ImmichApi;
let assets: Asset[] = [];
let selected: Set<number> = new Set();

export function initTimeline(immichApi: ImmichApi) {
  api = immichApi;
}

export function getAssets(): Asset[] {
  return assets;
}

export function clearSelection() {
  selected.clear();
  updateSelectionUI();
}

export async function loadAlbumAssets(albumId: string) {
  const grid = document.getElementById('timeline-grid')!;
  grid.innerHTML = '<div class="loading">Loading assets...</div>';

  const rawAssets = await api.getAlbumAssets(albumId);

  // Sort descending (newest first), nulls at end
  assets = rawAssets.sort((a, b) => {
    const dateA = a.exifInfo?.dateTimeOriginal;
    const dateB = b.exifInfo?.dateTimeOriginal;
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  selected.clear();

  const countEl = document.getElementById('asset-count')!;
  countEl.textContent = `(${assets.length} assets)`;

  renderGrid();
  setupKeyboardShortcuts();
}

function setupKeyboardShortcuts() {
  document.onkeydown = (e) => {
    if (e.key === 'Escape' && selected.size > 0) {
      clearSelection();
    }
  };
}

function getDateKey(asset: Asset): string {
  const dt = asset.exifInfo?.dateTimeOriginal;
  if (!dt) return 'Unknown date';
  const d = new Date(dt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateHeading(key: string): string {
  if (key === 'Unknown date') return key;
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function renderGrid() {
  const container = document.getElementById('timeline-grid')!;
  container.innerHTML = '';

  let currentDay = '';

  assets.forEach((asset, index) => {
    const day = getDateKey(asset);
    if (day !== currentDay) {
      currentDay = day;
      const header = document.createElement('div');
      header.className = 'day-header';
      header.textContent = formatDateHeading(day);
      container.appendChild(header);

      const row = document.createElement('div');
      row.className = 'day-row';
      row.dataset.day = day;
      container.appendChild(row);
    }

    const row = container.querySelector(`.day-row[data-day="${CSS.escape(currentDay)}"]`) as HTMLElement;
    const card = createAssetCard(asset, index);
    row.appendChild(card);
  });

  updateSelectionUI();
}

function updateSelectionUI() {
  const container = document.getElementById('timeline-grid')!;
  const hasSelection = selected.size > 0;

  container.querySelectorAll('.asset-card').forEach((card) => {
    const el = card as HTMLElement;
    const index = parseInt(el.dataset.index!);
    el.classList.toggle('selected', selected.has(index));
  });

  container.querySelectorAll('.pin-zone').forEach((zone) => {
    (zone as HTMLElement).classList.toggle('pin-active', hasSelection);
  });

  let toolbar = document.getElementById('selection-toolbar');
  if (hasSelection) {
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'selection-toolbar';
      document.getElementById('timeline-container')!.prepend(toolbar);
    }
    toolbar.innerHTML = `
      <span>${selected.size} photo${selected.size > 1 ? 's' : ''} selected — hover between images and click the pin to place</span>
      <button id="clear-selection-btn">Clear (Esc)</button>
    `;
    document.getElementById('clear-selection-btn')!.onclick = clearSelection;
  } else if (toolbar) {
    toolbar.remove();
  }
}

function createPinZone(insertIndex: number): HTMLElement {
  const zone = document.createElement('div');
  zone.className = 'pin-zone';
  zone.dataset.insertIndex = String(insertIndex);

  // The pin: a circle with + on top, a needle line going down
  const pin = document.createElement('div');
  pin.className = 'pin';

  const circle = document.createElement('div');
  circle.className = 'pin-circle';
  circle.textContent = '+';

  const needle = document.createElement('div');
  needle.className = 'pin-needle';

  pin.appendChild(circle);
  pin.appendChild(needle);
  zone.appendChild(pin);

  zone.addEventListener('click', (e) => {
    e.stopPropagation();
    if (selected.size === 0) return;
    handleInsert(insertIndex);
  });

  return zone;
}

function createAssetCard(asset: Asset, index: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'card-wrapper';

  // Pin zone on the left
  wrapper.appendChild(createPinZone(index));

  const card = document.createElement('div');
  card.className = 'asset-card';
  card.dataset.index = String(index);

  const img = document.createElement('img');
  img.alt = asset.originalFileName;
  img.loading = 'lazy';
  api.getThumbnailUrl(asset.id).then(url => { img.src = url; });

  const info = document.createElement('div');
  info.className = 'asset-info';

  const name = document.createElement('span');
  name.className = 'asset-name';
  name.textContent = asset.originalFileName;
  name.title = asset.originalFileName;

  const time = document.createElement('span');
  time.className = 'asset-time';
  const dt = asset.exifInfo?.dateTimeOriginal;
  time.textContent = dt ? formatDateTime(dt) : 'No date';

  info.appendChild(name);
  info.appendChild(time);
  card.appendChild(img);
  card.appendChild(info);

  card.addEventListener('click', () => {
    if (selected.has(index)) {
      selected.delete(index);
    } else {
      selected.add(index);
    }
    updateSelectionUI();
  });

  wrapper.appendChild(card);

  // Pin zone on the right for the last card
  if (index === assets.length - 1) {
    wrapper.appendChild(createPinZone(index + 1));
  }

  return wrapper;
}

function handleInsert(insertIndex: number) {
  const selectedIndices = [...selected].sort((a, b) => a - b);
  const movedAssets = selectedIndices.map(i => assets[i]);

  const remaining = assets.filter((_, i) => !selected.has(i));

  let adjustedIndex = insertIndex;
  for (const si of selectedIndices) {
    if (si < insertIndex) adjustedIndex--;
  }

  const beforeAsset = adjustedIndex > 0 ? remaining[adjustedIndex - 1] : null;
  const afterAsset = adjustedIndex < remaining.length ? remaining[adjustedIndex] : null;

  showSliderModal(api, movedAssets, beforeAsset, afterAsset, () => {
    selected.clear();
    renderGrid();
  });
}

export function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
