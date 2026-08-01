// 検索プラットフォームの表示メタデータ
import type { PlatformMeta } from './types';

export const PLATFORMS: Record<string, PlatformMeta> = {
  soundcloud: { name: 'SoundCloud', color: '#ff5500' },
  deezer: { name: 'Deezer', color: '#a238ff' },
  apple: { name: 'Apple Music', color: '#fa243c' },
  youtube: { name: 'YouTube', color: '#ff0033' },
};

export function platformMeta(platform: string): PlatformMeta {
  return PLATFORMS[platform] || { name: platform, color: '#888' };
}
