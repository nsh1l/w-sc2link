// AYP TrackID 共通型定義

export interface SearchResult {
  platform: string;
  title: string;
  artist: string;
  url: string;
  thumb: string;
}

export interface PlatformMeta {
  name: string;
  color: string;
}

export interface ParsedOcr {
  title: string;
  artist: string;
  elapsed: string;
  episode: string;
}

export interface FallbackLink {
  name: string;
  url: string;
}
