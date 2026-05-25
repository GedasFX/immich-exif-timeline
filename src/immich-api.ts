export interface ImmichConfig {
  apiKey: string;
}

export interface Album {
  id: string;
  albumName: string;
  assetCount: number;
  albumThumbnailAssetId: string | null;
}

export interface ExifInfo {
  dateTimeOriginal: string | null;
  make: string | null;
  model: string | null;
}

export interface Asset {
  id: string;
  originalFileName: string;
  exifInfo: ExifInfo | null;
  thumbhash: string | null;
  type: string;
}

export class ImmichApi {
  private apiKey: string;

  constructor(config: ImmichConfig) {
    this.apiKey = config.apiKey;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Immich API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  async ping(): Promise<boolean> {
    try {
      await this.request('/server/ping');
      return true;
    } catch {
      return false;
    }
  }

  async getAlbums(): Promise<Album[]> {
    return this.request('/albums');
  }

  async getAlbumAssets(albumId: string): Promise<Asset[]> {
    const album = await this.request<{ assets: Asset[] }>(`/albums/${albumId}`);
    return album.assets;
  }

  async getThumbnailUrl(assetId: string): Promise<string> {
    const res = await fetch(`/api/assets/${assetId}/thumbnail`, {
      headers: { 'x-api-key': this.apiKey },
    });
    if (!res.ok) throw new Error(`Thumbnail fetch failed: ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  async updateAssetTimestamp(assetId: string, dateTimeOriginal: string): Promise<void> {
    await this.request(`/assets/${assetId}`, {
      method: 'PUT',
      body: JSON.stringify({ dateTimeOriginal }),
    });
  }
}
