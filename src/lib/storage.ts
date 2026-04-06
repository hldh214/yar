// localStorage persistence for user preferences
// All keys are prefixed with 'yar:' to avoid collisions

const PREFIX = 'yar:';

function getItem<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function setItem<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable -- silently ignore
  }
}

// --- Volume ---

export function getVolume(): number {
  return getItem<number>('volume', 0.8);
}

export function saveVolume(v: number): void {
  setItem('volume', v);
}

// --- Station play history ---

export interface StationRecord {
  id: string;
  name: string;
  logoUrl: string;
  asciiName: string;
  playCount: number;
  lastPlayed: number; // timestamp ms
}

const MAX_HISTORY = 50;

export function getStationHistory(): StationRecord[] {
  return getItem<StationRecord[]>('stations', []);
}

export function recordStationPlay(station: {
  id: string;
  name: string;
  logoUrl: string;
  asciiName?: string;
}): void {
  const history = getStationHistory();
  const existing = history.find((s) => s.id === station.id);
  if (existing) {
    existing.playCount++;
    existing.lastPlayed = Date.now();
    // Update name/logo in case they changed
    existing.name = station.name;
    existing.logoUrl = station.logoUrl;
    if (station.asciiName) existing.asciiName = station.asciiName;
  } else {
    history.push({
      id: station.id,
      name: station.name,
      logoUrl: station.logoUrl,
      asciiName: station.asciiName || '',
      playCount: 1,
      lastPlayed: Date.now(),
    });
  }
  // Keep only the most recent MAX_HISTORY stations
  history.sort((a, b) => b.lastPlayed - a.lastPlayed);
  setItem('stations', history.slice(0, MAX_HISTORY));
}

// Get frequently played stations, sorted by play count (desc), then recency
export function getFrequentStations(limit = 8): StationRecord[] {
  const history = getStationHistory();
  return history
    .sort((a, b) => b.playCount - a.playCount || b.lastPlayed - a.lastPlayed)
    .slice(0, limit);
}

// Get the set of stationIds the user has played, with their play counts
export function getStationPlayCounts(): Map<string, number> {
  const history = getStationHistory();
  const map = new Map<string, number>();
  for (const s of history) {
    map.set(s.id, s.playCount);
  }
  return map;
}

// --- Last expanded region ---

export function getLastRegion(): string | null {
  return getItem<string | null>('lastRegion', null);
}

export function saveLastRegion(regionId: string): void {
  setItem('lastRegion', regionId);
}
