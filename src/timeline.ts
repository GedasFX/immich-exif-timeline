import { ImmichApi } from './immich-api';
import type { Asset } from './immich-api';
import { showSliderModal } from './slider';

let api: ImmichApi;
let assets: Asset[] = [];
let selected: Set<number> = new Set();
let lastClickedIndex: number | null = null;
let activeTimezones: string[] = [];
let lastQuickfixTz: string | null = null;

function getLocalTzOffset(): string {
  const localOffset = -new Date().getTimezoneOffset();
  const sign = localOffset >= 0 ? '+' : '-';
  const absMin = Math.abs(localOffset);
  return `${sign}${String(Math.floor(absMin / 60)).padStart(2, '0')}:${String(absMin % 60).padStart(2, '0')}`;
}

function getAllOffsets(): string[] {
  const offsets: string[] = [];
  for (let h = -12; h <= 14; h++) {
    for (const m of [0, 30]) {
      if (h === -12 && m === 30) continue;
      if (h === 14 && m === 30) continue;
      const absH = Math.abs(h);
      offsets.push(`${h < 0 ? '-' : '+'}${String(absH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return [...new Set(offsets)];
}

function saveTzPreference() {
  localStorage.setItem('filename-tzs', JSON.stringify(activeTimezones));
}

function makeDateWithOffset(year: number, month: number, day: number, hour: number, min: number, sec: number, offset: string): Date {
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(min)}:${pad(sec)}${offset}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date(NaN) : d;
}

/** Extract raw timestamp parts from filename (no timezone applied) */
function extractFilenameParts(filename: string): [number, number, number, number, number, number] | null {
  const name = filename.replace(/\.[^.]+$/, '');

  let m = name.match(/(\d{4})([-_]?)(\d{2})\2(\d{2})[-_ ]?(\d{2})\2?(\d{2})\2?(\d{2})/);
  if (m) return [+m[1], +m[3], +m[4], +m[5], +m[6], +m[7]];

  m = name.match(/(\d{4})[-.](\d{2})[-.](\d{2})[-_ T](\d{2})[-.:](\d{2})[-.:](\d{2})/);
  if (m) return [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]];

  m = name.match(/(\d{4})(\d{2})(\d{2})/);
  if (m && +m[1] >= 1990 && +m[1] <= 2099) return [+m[1], +m[2], +m[3], 0, 0, 0];

  return null;
}

/** Check if filename timestamp disagrees with EXIF across all active timezones.
 *  Returns the suggested Date (using first timezone) if none match, or null if any match. */
function getFilenameMismatch(asset: Asset): Date | null {
  const parts = extractFilenameParts(asset.originalFileName);
  if (!parts) return null;

  const exifDt = asset.exifInfo?.dateTimeOriginal;
  const exifTime = exifDt ? new Date(exifDt).getTime() : null;

  const tzs = activeTimezones.length > 0 ? activeTimezones : [getLocalTzOffset()];

  // If any timezone interpretation matches EXIF within 60s, no mismatch
  for (const tz of tzs) {
    const d = makeDateWithOffset(...parts, tz);
    if (!isNaN(d.getTime()) && exifTime !== null) {
      if (Math.abs(d.getTime() - exifTime) <= 60_000) return null;
    }
  }

  // No match — suggest using the first timezone
  const suggested = makeDateWithOffset(...parts, tzs[0]);
  if (isNaN(suggested.getTime())) return null;

  // If no EXIF at all, or mismatch in all timezones
  return suggested;
}

/** Populate the timezone add-dropdown and render chips */
function initTimezoneSelector() {
  const sel = document.getElementById('tz-add-select') as HTMLSelectElement;

  if (sel.dataset.initialized) {
    renderTzChips();
    return;
  }
  sel.dataset.initialized = 'true';

  const allOffsets = getAllOffsets();
  for (const offset of allOffsets) {
    const opt = document.createElement('option');
    opt.value = offset;
    opt.textContent = `UTC${offset}`;
    sel.appendChild(opt);
  }

  // Load saved or default to local tz
  const saved = localStorage.getItem('filename-tzs');
  if (saved) {
    try { activeTimezones = JSON.parse(saved); } catch { activeTimezones = [getLocalTzOffset()]; }
  }
  if (activeTimezones.length === 0) {
    activeTimezones = [getLocalTzOffset()];
    saveTzPreference();
  }

  sel.addEventListener('change', () => {
    const val = sel.value;
    if (val && !activeTimezones.includes(val)) {
      activeTimezones.push(val);
      saveTzPreference();
      renderTzChips();
      renderGrid();
    }
    // Reset back to placeholder after a tick so the browser finishes the event
    setTimeout(() => { sel.value = ''; }, 0);
  });

  renderTzChips();
}

function renderTzChips() {
  const container = document.getElementById('tz-chips')!;
  container.innerHTML = '';

  for (const tz of activeTimezones) {
    const chip = document.createElement('span');
    chip.className = 'tz-chip';

    const label = document.createElement('span');
    label.textContent = `UTC${tz}`;
    chip.appendChild(label);

    const remove = document.createElement('button');
    remove.className = 'tz-chip-remove';
    remove.textContent = '\u00d7';
    remove.addEventListener('click', () => {
      activeTimezones = activeTimezones.filter(t => t !== tz);
      if (activeTimezones.length === 0) activeTimezones = [getLocalTzOffset()];
      saveTzPreference();
      renderTzChips();
      renderGrid();
    });
    chip.appendChild(remove);

    container.appendChild(chip);
  }
}

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

  initTimezoneSelector();
  renderGrid();
  setupKeyboardShortcuts();

  const autofixBtn = document.getElementById('autofix-all-btn')!;
  autofixBtn.onclick = autofixSelected;
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

function getSelectedMismatches(): { asset: Asset; date: Date }[] {
  const results: { asset: Asset; date: Date }[] = [];
  for (const i of selected) {
    const asset = assets[i];
    const d = getFilenameMismatch(asset);
    if (d) results.push({ asset, date: d });
  }
  return results;
}

function updateAutofixButton() {
  const btn = document.getElementById('autofix-all-btn')!;
  if (selected.size === 0) {
    btn.classList.add('hidden');
    return;
  }
  const count = getSelectedMismatches().length;
  if (count > 0) {
    btn.classList.remove('hidden');
    btn.textContent = `Fix Selected (${count})`;
  } else {
    btn.classList.add('hidden');
  }
}

async function autofixSelected() {
  // Use last quickfix tz, or first active tz
  const tz = lastQuickfixTz || localStorage.getItem('quickfix-last-tz') || activeTimezones[0] || getLocalTzOffset();

  const mismatches: { asset: Asset; date: Date }[] = [];
  for (const i of selected) {
    const asset = assets[i];
    const parts = extractFilenameParts(asset.originalFileName);
    if (!parts) continue;
    const d = makeDateWithOffset(...parts, tz);
    if (isNaN(d.getTime())) continue;

    const exifDt = asset.exifInfo?.dateTimeOriginal;
    const exifTime = exifDt ? new Date(exifDt).getTime() : null;
    if (exifTime === null || Math.abs(d.getTime() - exifTime) > 60_000) {
      mismatches.push({ asset, date: d });
    }
  }

  if (mismatches.length === 0) return;

  const btn = document.getElementById('autofix-all-btn')!;
  btn.setAttribute('disabled', 'true');

  for (let i = 0; i < mismatches.length; i++) {
    btn.textContent = `Fixing ${i + 1}/${mismatches.length}...`;
    const { asset, date } = mismatches[i];
    const newTime = date.toISOString();
    try {
      await api.updateAssetTimestamp(asset.id, newTime);
      if (asset.exifInfo) {
        asset.exifInfo.dateTimeOriginal = newTime;
      } else {
        asset.exifInfo = { dateTimeOriginal: newTime, make: null, model: null };
      }
    } catch (err) {
      alert(`Failed on ${asset.originalFileName}: ${err}`);
      break;
    }
  }

  resortAssets();
  selected.clear();
  btn.removeAttribute('disabled');
  renderGrid();
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
  updateAutofixButton();
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

  updateAutofixButton();
}

function showQuickfixModal(asset: Asset) {
  const parts = extractFilenameParts(asset.originalFileName);
  if (!parts) return;

  const modal = document.getElementById('quickfix-modal')!;
  const filenameEl = document.getElementById('quickfix-filename')!;
  const currentEl = document.getElementById('quickfix-current')!;
  const optionsEl = document.getElementById('quickfix-options')!;
  const cancelBtn = document.getElementById('quickfix-cancel')!;
  const backdrop = document.getElementById('quickfix-backdrop')!;

  filenameEl.textContent = asset.originalFileName;

  const exifDt = asset.exifInfo?.dateTimeOriginal;
  currentEl.textContent = exifDt ? `Current EXIF: ${formatDateTime(exifDt)}` : 'No EXIF timestamp';

  // Build timezone options: UTC + all active timezones, deduplicated
  const tzOptions = new Set<string>();
  tzOptions.add('+00:00'); // UTC always available
  for (const tz of activeTimezones) tzOptions.add(tz);

  // Put last used timezone first if it exists
  const savedLastTz = lastQuickfixTz || localStorage.getItem('quickfix-last-tz');
  const orderedTzs: string[] = [];
  if (savedLastTz && tzOptions.has(savedLastTz)) {
    orderedTzs.push(savedLastTz);
  }
  for (const tz of tzOptions) {
    if (!orderedTzs.includes(tz)) orderedTzs.push(tz);
  }

  optionsEl.innerHTML = '';
  for (const tz of orderedTzs) {
    const date = makeDateWithOffset(...parts, tz);
    if (isNaN(date.getTime())) continue;

    const btn = document.createElement('button');
    btn.className = 'quickfix-option';
    if (tz === savedLastTz) btn.classList.add('quickfix-option-last');

    const tzLabel = document.createElement('span');
    tzLabel.className = 'quickfix-tz';
    tzLabel.textContent = `UTC${tz}`;

    const timeLabel = document.createElement('span');
    timeLabel.className = 'quickfix-time';
    timeLabel.textContent = formatDateTime(date.toISOString());

    btn.appendChild(tzLabel);
    btn.appendChild(timeLabel);

    btn.addEventListener('click', async () => {
      const newTime = date.toISOString();
      btn.textContent = 'Applying...';
      btn.setAttribute('disabled', 'true');

      lastQuickfixTz = tz;
      localStorage.setItem('quickfix-last-tz', tz);

      try {
        await api.updateAssetTimestamp(asset.id, newTime);
        if (asset.exifInfo) {
          asset.exifInfo.dateTimeOriginal = newTime;
        } else {
          asset.exifInfo = { dateTimeOriginal: newTime, make: null, model: null };
        }
        resortAssets();
        cleanup();
        renderGrid();
      } catch (err) {
        alert(`Failed to update: ${err}`);
        btn.removeAttribute('disabled');
        btn.textContent = '';
        btn.appendChild(tzLabel);
        btn.appendChild(timeLabel);
      }
    });

    optionsEl.appendChild(btn);
  }

  modal.classList.remove('hidden');

  const cleanup = () => {
    modal.classList.add('hidden');
    cancelBtn.onclick = null;
    backdrop.onclick = null;
  };

  cancelBtn.onclick = cleanup;
  backdrop.onclick = cleanup;
}

function resortAssets() {
  assets.sort((a, b) => {
    const dateA = a.exifInfo?.dateTimeOriginal;
    const dateB = b.exifInfo?.dateTimeOriginal;
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });
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

  // Check for filename timestamp mismatch
  if (getFilenameMismatch(asset)) {
    const badge = document.createElement('div');
    badge.className = 'automove-badge';
    badge.title = 'Filename timestamp differs from EXIF — click to fix';
    badge.textContent = '!';
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      showQuickfixModal(asset);
    });
    card.appendChild(badge);
  }

  card.addEventListener('click', (e) => {
    if (e.shiftKey && lastClickedIndex !== null) {
      // Range select from lastClickedIndex to current
      const from = Math.min(lastClickedIndex, index);
      const to = Math.max(lastClickedIndex, index);
      for (let i = from; i <= to; i++) {
        selected.add(i);
      }
    } else {
      if (selected.has(index)) {
        selected.delete(index);
      } else {
        selected.add(index);
      }
    }
    lastClickedIndex = index;
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
