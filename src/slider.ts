import { ImmichApi } from './immich-api';
import type { Asset } from './immich-api';
import { formatDateTime, getAssets } from './timeline';

export function showSliderModal(
  api: ImmichApi,
  movedAssets: Asset[],
  beforeAsset: Asset | null,
  afterAsset: Asset | null,
  onApply: () => void,
) {
  const modal = document.getElementById('slider-modal')!;
  const slider = document.getElementById('timestamp-slider') as HTMLInputElement;
  const newTimestampDisplay = document.getElementById('new-timestamp-display')!;

  const beforeTime = beforeAsset?.exifInfo?.dateTimeOriginal
    ? new Date(beforeAsset.exifInfo.dateTimeOriginal).getTime()
    : null;
  const afterTime = afterAsset?.exifInfo?.dateTimeOriginal
    ? new Date(afterAsset.exifInfo.dateTimeOriginal).getTime()
    : null;

  let minTime: number;
  let maxTime: number;

  if (beforeTime !== null && afterTime !== null) {
    minTime = beforeTime;
    maxTime = afterTime;
  } else if (beforeTime !== null) {
    minTime = beforeTime;
    maxTime = beforeTime + 3600_000;
  } else if (afterTime !== null) {
    minTime = afterTime - 3600_000;
    maxTime = afterTime;
  } else {
    const now = Date.now();
    minTime = now - 3600_000;
    maxTime = now;
  }

  const count = movedAssets.length;
  const isMulti = count > 1;

  // Set up photos
  setupPhoto('slider-before', beforeAsset, api);
  setupPhoto('slider-after', afterAsset, api);

  // For target photo, show the first moved asset (or a summary)
  const targetContainer = document.getElementById('slider-target')!;
  const targetImg = targetContainer.querySelector('img') as HTMLImageElement;
  const targetSpan = targetContainer.querySelector('span')!;

  if (isMulti) {
    api.getThumbnailUrl(movedAssets[0].id).then(url => { targetImg.src = url; });
    targetImg.alt = `${count} photos`;
    targetSpan.textContent = `${count} photos`;
    targetContainer.classList.remove('empty');
  } else {
    setupPhoto('slider-target', movedAssets[0], api);
  }

  // Labels
  document.getElementById('slider-min-label')!.textContent = formatDateTime(new Date(minTime).toISOString());
  document.getElementById('slider-max-label')!.textContent = formatDateTime(new Date(maxTime).toISOString());

  // Update heading
  const heading = document.querySelector('#slider-content h2')!;
  heading.textContent = isMulti ? `Place ${count} Photos` : 'Adjust Timestamp';

  slider.value = '500';
  updateTimestampDisplay();

  function getTimestamps(): number[] {
    const ratio = parseInt(slider.value) / 1000;

    if (count === 1) {
      return [minTime + ratio * (maxTime - minTime)];
    }

    // For multiple photos: slider controls where the group center sits.
    // Photos are evenly spaced. At 0.5 they fill the whole range.
    // We keep even spacing but shift the group along the range.
    const totalRange = maxTime - minTime;
    // Reserve a small margin so photos don't land exactly on neighbor timestamps
    const margin = totalRange * 0.02;
    const usableMin = minTime + margin;
    const usableMax = maxTime - margin;
    const usableRange = usableMax - usableMin;

    // Spacing between photos
    const spacing = count > 1 ? usableRange / (count + 1) : 0;
    // Group width
    const groupWidth = spacing * (count - 1);
    // Slide the group center: ratio 0 = group at start, 1 = group at end
    const maxOffset = usableRange - groupWidth;
    const groupStart = usableMin + ratio * maxOffset;

    return movedAssets.map((_, i) => groupStart + i * spacing);
  }

  function updateTimestampDisplay() {
    const timestamps = getTimestamps();
    if (count === 1) {
      newTimestampDisplay.textContent = formatDateTime(new Date(timestamps[0]).toISOString());
    } else {
      const first = formatDateTime(new Date(timestamps[0]).toISOString());
      const last = formatDateTime(new Date(timestamps[count - 1]).toISOString());
      newTimestampDisplay.textContent = `${first}  ...  ${last}`;
    }
  }

  slider.oninput = updateTimestampDisplay;

  modal.classList.remove('hidden');

  const cancelBtn = document.getElementById('slider-cancel')!;
  const applyBtn = document.getElementById('slider-apply')!;
  const backdrop = document.getElementById('slider-backdrop')!;

  const cleanup = () => {
    modal.classList.add('hidden');
    cancelBtn.onclick = null;
    applyBtn.onclick = null;
    backdrop.onclick = null;
    slider.oninput = null;
  };

  cancelBtn.onclick = cleanup;
  backdrop.onclick = cleanup;

  applyBtn.onclick = async () => {
    const timestamps = getTimestamps();
    applyBtn.textContent = isMulti ? `Applying (0/${count})...` : 'Applying...';
    applyBtn.setAttribute('disabled', 'true');

    try {
      for (let i = 0; i < count; i++) {
        const asset = movedAssets[i];
        const newTime = new Date(timestamps[i]).toISOString();

        await api.updateAssetTimestamp(asset.id, newTime);

        if (asset.exifInfo) {
          asset.exifInfo.dateTimeOriginal = newTime;
        } else {
          asset.exifInfo = { dateTimeOriginal: newTime, make: null, model: null };
        }

        if (isMulti) {
          applyBtn.textContent = `Applying (${i + 1}/${count})...`;
        }
      }

      // Re-sort
      const allAssets = getAssets();
      allAssets.sort((a, b) => {
        const dateA = a.exifInfo?.dateTimeOriginal;
        const dateB = b.exifInfo?.dateTimeOriginal;
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });

      cleanup();
      onApply();
    } catch (err) {
      alert(`Failed to update timestamp: ${err}`);
    } finally {
      applyBtn.textContent = 'Apply';
      applyBtn.removeAttribute('disabled');
    }
  };
}

function setupPhoto(containerId: string, asset: Asset | null, api: ImmichApi) {
  const container = document.getElementById(containerId)!;
  const img = container.querySelector('img') as HTMLImageElement;
  const timeSpan = container.querySelector('span')!;

  if (asset) {
    container.classList.remove('empty');
    api.getThumbnailUrl(asset.id).then(url => { img.src = url; });
    img.alt = asset.originalFileName;
    const dt = asset.exifInfo?.dateTimeOriginal;
    timeSpan.textContent = dt ? formatDateTime(dt) : 'No date';
  } else {
    container.classList.add('empty');
    img.src = '';
    img.alt = '';
    timeSpan.textContent = '(edge)';
  }
}
