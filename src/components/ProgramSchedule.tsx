'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { usePlayer, usePlayerTime } from '@/lib/player-context';
import { formatTime, parseRadikoDate } from '@/lib/radiko-parser';

interface Program {
  id: string;
  stationId: string;
  title: string;
  subtitle: string;
  performer: string;
  description: string;
  info: string;
  url: string;
  imageUrl: string;
  startTime: string;
  endTime: string;
  duration: number;
  isOnAir: boolean;
  isTimefree: boolean;
}

interface Station {
  id: string;
  name: string;
  asciiName: string;
  href: string;
  logoUrl: string;
}

interface StationData {
  station: Station;
  programs: Program[];
}

interface NoaItem {
  title: string;
  artist: string;
  stamp: string;
  img: string;
  imgLarge: string;
  amazon: string;
  itunes: string;
  recochoku: string;
  id: string;
}

// Get the current radiko broadcast date in YYYYMMDD (JST, day starts at 05:00)
function getRadikoBroadcastDate(offset = 0): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (jst.getUTCHours() < 5) {
    jst.setUTCDate(jst.getUTCDate() - 1);
  }
  jst.setUTCDate(jst.getUTCDate() + offset);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function formatDateLabel(dateStr: string, todayStr: string): string {
  const m = parseInt(dateStr.substring(4, 6), 10);
  const d = parseInt(dateStr.substring(6, 8), 10);
  if (dateStr === todayStr) return 'Today';
  const y = parseInt(dateStr.substring(0, 4), 10);
  const date = new Date(y, m - 1, d);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${m}/${d} (${days[date.getDay()]})`;
}

// Format stamp "2026-04-01T12:00:28+09:00" -> "12:00"
function formatStamp(stamp: string): string {
  if (!stamp) return '';
  const m = stamp.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

// Parse stamp "2026-04-01T12:00:28+09:00" -> epoch ms
function parseStampMs(stamp: string): number {
  if (!stamp) return 0;
  return new Date(stamp).getTime();
}

// Parse YYYYMMDDHHmmss (JST) -> epoch ms
function parseFtMs(ft: string): number {
  const y = parseInt(ft.substring(0, 4), 10);
  const mo = parseInt(ft.substring(4, 6), 10) - 1;
  const d = parseInt(ft.substring(6, 8), 10);
  const h = parseInt(ft.substring(8, 10), 10);
  const min = parseInt(ft.substring(10, 12), 10);
  const sec = parseInt(ft.substring(12, 14), 10);
  return Date.UTC(y, mo, d, h - 9, min, sec);
}

// Find the song that is playing at a given offset (seconds) from ft
function findSongAtTime(songs: NoaItem[], ft: string, offsetSec: number): NoaItem | null {
  if (!songs.length || !ft) return null;
  const playbackMs = parseFtMs(ft) + offsetSec * 1000;
  // Songs are in chronological order; find the last song whose stamp <= playbackMs
  let best: NoaItem | null = null;
  for (const song of songs) {
    const stampMs = parseStampMs(song.stamp);
    if (stampMs && stampMs <= playbackMs) {
      best = song;
    }
  }
  return best;
}

// Format duration in seconds to human-readable "1h 30m" or "45m"
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

const PLACEHOLDER_IMG = 'https://ac-static.cf.radiko.jp/jacket_placeholder.png';
const PLACEHOLDER_IMG_LARGE = 'https://ac-static.cf.radiko.jp/jacket_placeholder_large.jpeg';

function isRealImage(url: string): boolean {
  return !!url && url !== PLACEHOLDER_IMG && url !== PLACEHOLDER_IMG_LARGE;
}

// --- Song list for a program's detail view ---
// When `liveNoaItems` is provided (on-air program), those are shown directly
// and kept up-to-date by the parent's 60s NOA polling.  For past programs the
// component does a one-time fetch using the ft/to time range.
function SongList({ stationId, ft, to, compact, liveNoaItems }: {
  stationId: string; ft: string; to: string; compact?: boolean; liveNoaItems?: NoaItem[];
}) {
  const [songs, setSongs] = useState<NoaItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Use live NOA items when available (on-air program)
  const isLive = !!liveNoaItems;

  useEffect(() => {
    if (isLive) {
      // On-air: data comes from parent via liveNoaItems prop
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/noa?stationId=${stationId}&ft=${ft}&to=${to}`)
      .then((r) => r.json())
      .then((d) => setSongs(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [stationId, ft, to, isLive]);

  // For live data, filter out songs from previous programs.
  // The id field is like "2026-04-07T11:46:43-YFM" — extract time part and
  // compare with the program's ft (YYYYMMDDHHmmss) to drop songs before this program.
  const displaySongs = useMemo(() => {
    const raw = isLive ? (liveNoaItems || []) : songs;
    if (!isLive || !ft) return raw;
    return raw.filter((song) => {
      // id: "2026-04-07T11:46:43-YFM" -> "20260407114643"
      const m = song.id.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      if (!m) return true;
      const songTime = m[1] + m[2] + m[3] + m[4] + m[5] + m[6];
      return songTime >= ft;
    });
  }, [isLive, liveNoaItems, songs, ft]);

  if (loading) {
    return (
      <div className="py-3">
        <div className="animate-pulse flex gap-2 items-center">
          <div className="w-4 h-4 bg-gray-200 dark:bg-gray-700 rounded-full" />
          <div className="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (displaySongs.length === 0) return null;

  // Show newest songs first — sort by stamp descending so the order is
  // consistent regardless of API endpoint (live returns newest-first,
  // timefree returns oldest-first).
  const sorted = [...displaySongs].sort((a, b) => (b.stamp > a.stamp ? 1 : b.stamp < a.stamp ? -1 : 0));

  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
        Songs ({displaySongs.length})
      </h3>
      {sorted.map((song) => (
        <div key={song.id} className={`flex items-start gap-2.5 ${compact ? 'py-1.5' : 'py-2'}`}>
          {isRealImage(song.img) ? (
            <img src={song.img} alt="" className={`rounded object-cover flex-shrink-0 ${compact ? 'w-8 h-8' : 'w-10 h-10'}`} />
          ) : (
            <div className={`rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 ${compact ? 'w-8 h-8' : 'w-10 h-10'}`}>
              <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className={`font-medium truncate leading-tight ${compact ? 'text-xs' : 'text-sm'}`}>{song.title}</p>
            <p className={`text-gray-500 dark:text-gray-400 truncate leading-tight ${compact ? 'text-[11px]' : 'text-xs'}`}>{song.artist}</p>
            {(song.itunes || song.amazon) && (
              <div className="flex gap-2 mt-0.5">
                {song.itunes && (
                  <a href={song.itunes} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-pink-500 hover:text-pink-600 dark:text-pink-400 dark:hover:text-pink-300 transition-colors">
                    Apple Music
                  </a>
                )}
                {song.amazon && (
                  <a href={song.amazon} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300 transition-colors">
                    Amazon
                  </a>
                )}
              </div>
            )}
          </div>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono flex-shrink-0 mt-0.5">
            {formatStamp(song.stamp)}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Now-playing song bar (subscribes to high-frequency time context) ---
// Isolated into its own component so that time-tick re-renders (~4x/sec)
// don't cascade to the parent ProgramDetail or the rest of the schedule.
function NowPlayingSongBar({
  playingSongs,
  noaItems,
  stationId,
}: {
  playingSongs: NoaItem[];
  noaItems: NoaItem[];
  stationId: string;
}) {
  const { currentInfo, isPlaying, isBehindLive } = usePlayer();
  const { currentTime } = usePlayerTime();

  const nowPlayingSong = useMemo(() => {
    const ft = currentInfo?.ft;
    if (!ft || !playingSongs.length) return null;
    const isTimefreePlaying = currentInfo?.stationId === stationId && isPlaying &&
      (currentInfo?.type === 'timefree' || (currentInfo?.type === 'live' && isBehindLive));
    if (!isTimefreePlaying) return null;
    return findSongAtTime(playingSongs, ft, currentTime);
  }, [playingSongs, currentInfo, stationId, isPlaying, isBehindLive, currentTime]);

  const isLivePlaying = currentInfo?.stationId === stationId && isPlaying &&
    currentInfo?.type === 'live' && !isBehindLive;
  // For live, filter noaItems to only include songs from the current program
  const latestSong = useMemo(() => {
    if (!isLivePlaying || noaItems.length === 0) return null;
    const ft = currentInfo?.ft;
    if (!ft) return noaItems[0] ?? null;
    // Filter: keep only songs whose id timestamp >= program ft
    for (const song of noaItems) {
      const m = song.id.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      if (!m) continue;
      const songTime = m[1] + m[2] + m[3] + m[4] + m[5] + m[6];
      if (songTime >= ft) return song;
    }
    return null;
  }, [isLivePlaying, noaItems, currentInfo?.ft]);
  const song = nowPlayingSong || (latestSong?.title ? latestSong : null);
  if (!song) return null;

  const isTimefreeMode = !!nowPlayingSong;

  return (
    <div className={`flex items-center gap-2 sm:gap-2.5 p-2 sm:p-2.5 rounded-lg bg-gradient-to-r border ${
      isTimefreeMode
        ? 'from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200/60 dark:border-blue-800/40'
        : 'from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200/60 dark:border-green-800/40'
    }`}>
      {isRealImage(song.img) ? (
        <img src={song.img} alt="" className="w-9 h-9 sm:w-10 sm:h-10 rounded shadow-sm object-cover flex-shrink-0" />
      ) : (
        <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded flex items-center justify-center flex-shrink-0 ${
          isTimefreeMode
            ? 'bg-blue-100 dark:bg-blue-900/30'
            : 'bg-green-100 dark:bg-green-900/30'
        }`}>
          <svg className={`w-5 h-5 ${isTimefreeMode ? 'text-blue-500' : 'text-green-500'}`} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {isTimefreeMode ? (
            <svg className="w-3 h-3 text-blue-500 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          ) : (
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse flex-shrink-0" />
          )}
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${
            isTimefreeMode
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-green-600 dark:text-green-400'
          }`}>
            {isTimefreeMode ? 'Listening' : 'Now Playing'}
          </span>
        </div>
        <p className="text-sm font-medium truncate leading-tight">{song.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate leading-tight">{song.artist}</p>
      </div>
      {(song.itunes || song.amazon) && (
        <div className="flex gap-1 flex-shrink-0">
          {song.itunes && (
            <a href={song.itunes} target="_blank" rel="noopener noreferrer"
              className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full bg-white/80 dark:bg-gray-800 hover:bg-pink-50 dark:hover:bg-pink-900/30 transition-colors shadow-sm"
              title="Apple Music">
              <svg className="w-3.5 h-3.5 text-pink-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
            </a>
          )}
          {song.amazon && (
            <a href={song.amazon} target="_blank" rel="noopener noreferrer"
              className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full bg-white/80 dark:bg-gray-800 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors shadow-sm"
              title="Amazon">
              <svg className="w-3.5 h-3.5 text-orange-500" viewBox="0 0 24 24" fill="currentColor"><path d="M1 16c3.04 2.19 7.4 3.5 12 3.5 3.2 0 6.7-.7 9.6-2.1.5-.2.9.3.5.7C20.3 20.4 16.5 22 12 22 7.3 22 3.1 20.2.4 17.2c-.3-.4.1-.8.6-.5z" /></svg>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// --- Program Detail View (the main content area) ---
function ProgramDetail({
  program,
  station,
  stationId,
  noaItems,
  playingSongs,
  isStationLive,
  onPlayLive,
  onPlayTimefree,
  currentInfo,
  isPlaying,
}: {
  program: Program | null;
  station: Station | null;
  stationId: string;
  noaItems: NoaItem[];
  playingSongs: NoaItem[];
  isStationLive: boolean;
  onPlayLive: () => void;
  onPlayTimefree: (p: Program) => void;
  currentInfo: { stationId: string; type: string; ft?: string } | null;
  isPlaying: boolean;
}) {
  if (!station) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full" />
      </div>
    );
  }

  const isThisProgramPlaying = program && currentInfo?.stationId === station.id && isPlaying &&
    ((currentInfo?.type === 'timefree' && currentInfo?.ft === program.startTime) ||
     (currentInfo?.type === 'live' && program.isOnAir));

  return (
    <div className="flex flex-col gap-4">
      {/* Station header */}
      <div className="flex items-center gap-3">
        <img
          src={station.logoUrl}
          alt={station.name}
          className="w-11 h-11 rounded-lg object-contain bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex-shrink-0 p-1"
        />
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold truncate">{station.name}</h1>
          {station.asciiName && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{station.asciiName}</p>
          )}
        </div>
        <button
          onClick={onPlayLive}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-all flex-shrink-0 shadow-sm ${
            isStationLive
              ? 'bg-red-500 text-white shadow-red-200 dark:shadow-red-900/30'
              : 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-200 dark:shadow-blue-900/30'
          }`}
        >
          {isStationLive ? (
            <>
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              On Air
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Live
            </>
          )}
        </button>
      </div>

      {/* Now playing song bar — isolated component to avoid time-tick re-renders */}
      <NowPlayingSongBar playingSongs={playingSongs} noaItems={noaItems} stationId={stationId} />

      {/* Selected program detail */}
      {program ? (
        <div className="flex flex-col gap-4">
          {/* Top section: image left, info right */}
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Program image - constrained width, 8:5 ratio */}
            <div className="relative rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 flex-shrink-0 w-full sm:w-[240px] md:w-[300px] lg:w-[356px]">
              {program.imageUrl ? (
                <div className="aspect-[8/5] w-full">
                  <img
                    src={program.imageUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="aspect-[8/5] w-full flex items-center justify-center">
                  <svg className="w-12 h-12 text-gray-300 dark:text-gray-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM8 15l2.5-3.21 1.79 2.15 2.5-3.22L19 15H5l3 0z" />
                  </svg>
                </div>
              )}
              {/* On-air badge overlay */}
              {program.isOnAir && (
                <div className="absolute top-2 left-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-md shadow-lg">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    LIVE
                  </span>
                </div>
              )}
            </div>

            {/* Program info - right side */}
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <h2 className="text-lg font-bold leading-snug">{program.title}</h2>
              {program.subtitle && (
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{program.subtitle}</p>
              )}
              {program.performer && (
                <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                  {program.performer}
                </p>
              )}
              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
                  </svg>
                  <span className="font-mono">{formatTime(program.startTime)} – {formatTime(program.endTime)}</span>
                </span>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span>{formatDuration(program.duration)}</span>
              </div>

              {/* Play buttons */}
              {(program.isTimefree || program.isOnAir) && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {program.isOnAir ? (
                    <button
                      onClick={onPlayLive}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
                        isStationLive
                          ? 'bg-red-500 text-white shadow-red-200 dark:shadow-red-900/30'
                          : 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-200 dark:shadow-blue-900/30'
                      }`}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      {isStationLive ? 'Listening Live' : 'Listen Live'}
                    </button>
                  ) : program.isTimefree && (
                    <button
                      onClick={() => onPlayTimefree(program)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
                        isThisProgramPlaying
                          ? 'bg-blue-500 text-white shadow-blue-200 dark:shadow-blue-900/30'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-blue-500 hover:text-white'
                      }`}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      {isThisProgramPlaying ? 'Playing' : 'Timefree'}
                    </button>
                  )}
                  {/* Program link */}
                  {program.url && (
                    <a
                      href={program.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                      </svg>
                      Website
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Program description / info */}
          {(program.description || program.info) && (
            <div className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed space-y-2 border-t border-gray-100 dark:border-gray-800 pt-4">
              {program.description && (
                <div dangerouslySetInnerHTML={{ __html: program.description }} className="program-html" />
              )}
              {program.info && (
                <div dangerouslySetInnerHTML={{ __html: program.info }} className="program-html" />
              )}
            </div>
          )}

          {/* Song list */}
          <SongList
            stationId={stationId}
            ft={program.startTime}
            to={program.endTime}
            liveNoaItems={program.isOnAir ? noaItems : undefined}
          />
        </div>
      ) : (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-200 dark:text-gray-700" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
          <p className="text-sm">Select a program from the schedule</p>
        </div>
      )}
    </div>
  );
}

// --- Compact schedule list (used in sidebar and drawer) ---
function ScheduleList({
  programs,
  stationId,
  selectedProgramId,
  onSelectProgram,
  onPlayTimefree,
  currentInfo,
  isPlaying,
  isToday,
  onAirRef,
}: {
  programs: Program[];
  stationId: string;
  selectedProgramId: string | null;
  onSelectProgram: (p: Program) => void;
  onPlayTimefree: (p: Program) => void;
  currentInfo: { stationId: string; type: string; ft?: string } | null;
  isPlaying: boolean;
  isToday: boolean;
  onAirRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="py-0.5">
      {programs.map((program) => {
        const isNowPlaying =
          currentInfo?.stationId === stationId &&
          isPlaying &&
          ((currentInfo?.type === 'timefree' && currentInfo?.ft === program.startTime) ||
           (currentInfo?.type === 'live' && program.isOnAir));
        const isSelected = selectedProgramId === program.id;

        return (
          <div
            key={program.id}
            ref={program.isOnAir && isToday ? onAirRef : undefined}
            className={`flex items-center gap-2 px-2 sm:px-3 py-1.5 cursor-pointer transition-colors border-l-2 ${
              isSelected
                ? 'border-l-blue-500 bg-blue-50 dark:bg-blue-950/20'
                : program.isOnAir
                ? 'border-l-red-500 bg-red-50/50 dark:bg-red-950/10'
                : isNowPlaying
                ? 'border-l-blue-400 bg-blue-50/50 dark:bg-blue-950/10'
                : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-800/50'
            }`}
            onClick={() => onSelectProgram(program)}
          >
            {/* Thumbnail */}
            {program.imageUrl ? (
              <img
                src={program.imageUrl}
                alt=""
                className="w-14 h-[35px] rounded object-cover flex-shrink-0 bg-gray-100 dark:bg-gray-800"
              />
            ) : (
              <div className="w-14 h-[35px] rounded flex-shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <svg className="w-4 h-4 text-gray-300 dark:text-gray-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM8 15l2.5-3.21 1.79 2.15 2.5-3.22L19 15H5l3 0z" />
                </svg>
              </div>
            )}

            {/* Time + Title + performer */}
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 leading-none">
                {formatTime(program.startTime)}
              </span>
              <p className="text-xs font-medium truncate leading-tight">{program.title}</p>
              {program.performer && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate leading-tight">
                  {program.performer}
                </p>
              )}
            </div>

            {/* Badges */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {program.isOnAir && (
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              )}
              {program.isTimefree && (
                <button
                  onClick={(e) => { e.stopPropagation(); onPlayTimefree(program); }}
                  className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors ${
                    isNowPlaying
                      ? 'bg-blue-500 text-white'
                      : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                  }`}
                  title="Play timefree"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Mobile bottom sheet drawer ---
function ScheduleDrawer({
  isOpen,
  onClose,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Backdrop */}
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Sheet */}
      <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl max-h-[85vh] flex flex-col shadow-2xl animate-slide-up">
        {/* Handle */}
        <div className="flex items-center justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2 flex-shrink-0">
          <h3 className="font-semibold text-base">Schedule</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 pb-safe">
          {children}
        </div>
      </div>
    </div>
  );
}

// --- URL sync component (isolated to avoid high-frequency re-renders in parent) ---
// Updates the browser URL with the current playback position every 10s.
// Works for both timefree and behind-live modes.
function UrlSync({ stationId }: { stationId: string }) {
  const { currentInfo, isPlaying, isBehindLive } = usePlayer();
  const { currentTime } = usePlayerTime();
  const lastWrittenRef = useRef(0);

  useEffect(() => {
    if (!isPlaying || !currentInfo || currentInfo.stationId !== stationId) return;
    const ft = currentInfo.ft;
    if (!ft) return;

    // Write URL for timefree playback or behind-live seek-back
    const shouldWrite =
      currentInfo.type === 'timefree' ||
      (currentInfo.type === 'live' && isBehindLive);

    if (!shouldWrite) {
      // Live at edge: clear any lingering params
      if (currentInfo.type === 'live' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      return;
    }

    const t = Math.floor(currentTime);
    // Throttle: only write if at least 10s since last write and position changed meaningfully
    if (Math.abs(t - lastWrittenRef.current) < 10) return;
    lastWrittenRef.current = t;

    const params = new URLSearchParams({ ft, ...(t > 0 ? { t: String(t) } : {}) });
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }, [isPlaying, currentInfo, stationId, currentTime, isBehindLive]);

  return null;
}

// --- Main component ---
export default function ProgramSchedule({ stationId }: { stationId: string }) {
  const { dates, todayStr } = useMemo(() => {
    const today = getRadikoBroadcastDate(0);
    const list: string[] = [];
    for (let i = 0; i >= -7; i--) {
      list.push(getRadikoBroadcastDate(i));
    }
    return { dates: list, todayStr: today };
  }, []);

  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [data, setData] = useState<StationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noaItems, setNoaItems] = useState<NoaItem[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { playLive, playTimefree, seek, seekLive, currentInfo, isPlaying, isBehindLive } = usePlayer();

  const scheduleRef = useRef<HTMLDivElement>(null);
  const onAirRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);
  const deepLinkRef = useRef<{ ft: string; t?: number } | null>(null);
  const lastLiveFtRef = useRef<string | null>(null);
  const selectedProgram = data?.programs.find((p) => p.id === selectedProgramId) || null;

  // Read deep-link params from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ft = params.get('ft');
    if (ft) {
      const t = params.get('t');
      deepLinkRef.current = { ft, t: t ? parseInt(t, 10) : undefined };
    }
  }, []);

  // Fetch program schedule
  useEffect(() => {
    setLoading(true);
    setError(null);
    hasScrolledRef.current = false;
    const params = new URLSearchParams({ stationId, date: selectedDate });
    fetch(`/api/programs?${params}`)
      .then((res) => res.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);

        const dl = deepLinkRef.current;
        if (dl) {
          // Deep-link: find the program whose time range contains ft
          const match = d.programs?.find((p: Program) => p.startTime === dl.ft)
            || d.programs?.find((p: Program) => p.startTime <= dl.ft && dl.ft < p.endTime);
          if (match) {
            setSelectedProgramId(match.id);
            return; // auto-play handled by separate effect after data is set
          }
          // If not found on this date, the deep-link ft may belong to a different broadcast date.
          // Extract the broadcast date from ft (radiko day starts at 05:00 JST).
          const h = parseInt(dl.ft.substring(8, 10), 10);
          const dateFromFt = h < 5
            ? // Before 05:00 belongs to previous calendar day's broadcast
              (() => {
                const y = parseInt(dl.ft.substring(0, 4), 10);
                const m = parseInt(dl.ft.substring(4, 6), 10) - 1;
                const day = parseInt(dl.ft.substring(6, 8), 10);
                const prev = new Date(y, m, day - 1);
                return `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}${String(prev.getDate()).padStart(2, '0')}`;
              })()
            : dl.ft.substring(0, 8);
          if (dateFromFt !== selectedDate) {
            // Switch to the correct date — this effect will re-run
            setSelectedDate(dateFromFt);
            return;
          }
          // Program not found even on correct date — clear deep-link, fall through
          deepLinkRef.current = null;
        }

        // Default: auto-select on-air program for today, or first program for past dates
        if (selectedDate === todayStr) {
          const onAir = d.programs?.find((p: Program) => p.isOnAir);
          setSelectedProgramId(onAir?.id || d.programs?.[0]?.id || null);
        } else {
          setSelectedProgramId(d.programs?.[0]?.id || null);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [stationId, selectedDate, todayStr]);

  // Deep-link auto-play: once data loads and the matching program is selected,
  // trigger playback. If the program is currently on-air, start live + seek back;
  // otherwise start timefree.
  useEffect(() => {
    const dl = deepLinkRef.current;
    if (!dl || !data || !selectedProgram) return;
    // Match: ft is exact program start, or ft falls within the selected program's range
    const inRange = selectedProgram.startTime <= dl.ft && dl.ft < selectedProgram.endTime;
    if (selectedProgram.startTime !== dl.ft && !inRange) return;
    // Consume deep-link so it only fires once
    const seekTo = dl.t;
    deepLinkRef.current = null;

    if (selectedProgram.isOnAir && seekTo && seekTo > 0) {
      // Program is currently on-air: start live then seek back to the saved position
      playLive({
        stationId: data.station.id,
        stationName: data.station.name,
        stationLogo: data.station.logoUrl,
        type: 'live',
        title: selectedProgram.title,
        performer: selectedProgram.performer || data.station.name,
        ft: selectedProgram.startTime,
        to: selectedProgram.endTime,
      });
      const timer = setTimeout(() => seekLive(seekTo), 1500);
      return () => clearTimeout(timer);
    }

    // Ended program or no seek position: use timefree
    playTimefree({
      stationId: data.station.id,
      stationName: data.station.name,
      stationLogo: data.station.logoUrl,
      type: 'timefree',
      title: selectedProgram.title,
      performer: selectedProgram.performer || data.station.name,
      ft: selectedProgram.startTime,
      to: selectedProgram.endTime,
      duration: selectedProgram.duration,
    });
    // Seek to specific position after a short delay (wait for stream to load)
    if (seekTo && seekTo > 0) {
      const timer = setTimeout(() => seek(seekTo), 1500);
      return () => clearTimeout(timer);
    }
  }, [data, selectedProgram, playLive, playTimefree, seek, seekLive]);


  // Fetch NOA (now-on-air) for live display.
  // Only poll when viewing today AND the selected program is on-air (60s interval).
  const selectedIsOnAir = selectedProgram?.isOnAir ?? false;
  const shouldPollNoa = selectedDate === todayStr && selectedIsOnAir;
  useEffect(() => {
    if (!shouldPollNoa) return;
    let active = true;
    const fetchNoa = () => {
      fetch(`/api/noa?stationId=${stationId}`)
        .then((res) => res.json())
        .then((d) => {
          if (active && d.items) setNoaItems(d.items);
        })
        .catch(() => {});
    };
    fetchNoa();
    const interval = setInterval(fetchNoa, 60000);
    return () => { active = false; clearInterval(interval); };
  }, [stationId, shouldPollNoa]);

  // Fetch song list for the currently playing timefree/behind-live program
  const [playingSongs, setPlayingSongs] = useState<NoaItem[]>([]);
  const playingSongsFtRef = useRef<string>('');
  useEffect(() => {
    const ft = currentInfo?.ft;
    const to = currentInfo?.to;
    const isTimefreePlaying = currentInfo?.stationId === stationId && isPlaying &&
      (currentInfo?.type === 'timefree' || (currentInfo?.type === 'live' && isBehindLive));
    if (!isTimefreePlaying || !ft || !to) {
      setPlayingSongs([]);
      playingSongsFtRef.current = '';
      return;
    }
    // Only re-fetch when ft changes (new program)
    if (playingSongsFtRef.current === ft) return;
    playingSongsFtRef.current = ft;
    let active = true;
    fetch(`/api/noa?stationId=${stationId}&ft=${ft}&to=${to}`)
      .then((r) => r.json())
      .then((d) => { if (active) setPlayingSongs(d.items || []); })
      .catch(() => {});
    return () => { active = false; };
  }, [stationId, currentInfo, isPlaying, isBehindLive]);

  // When live program transitions (player-context updates currentInfo.ft),
  // immediately switch the selected program and on-air flags so the detail
  // view reflects the new program without waiting for the 60s interval.
  // We use a ref to track the last ft so we only act on real transitions,
  // NOT when the user manually selects a different program.
  useEffect(() => {
    if (!data || selectedDate !== todayStr) return;
    if (!isPlaying || currentInfo?.stationId !== stationId || currentInfo?.type !== 'live') return;
    const ft = currentInfo.ft;
    if (!ft) return;
    // Only act when ft actually changed (real live transition)
    if (ft === lastLiveFtRef.current) return;
    lastLiveFtRef.current = ft;
    const match = data.programs.find((p) => p.startTime === ft);
    if (!match) return;
    // Update isOnAir flags and recompute isTimefree for the transitioning program.
    // The previously on-air program has just ended and should now be timefree-eligible.
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const updated = data.programs.map((p) => {
      const isOnAir = p.id === match.id;
      // Recompute isTimefree: program ended (not on-air) and within 7-day window
      const endDate = parseRadikoDate(p.endTime);
      const isTimefree = !isOnAir && endDate < now && endDate > oneWeekAgo;
      return { ...p, isOnAir, isTimefree };
    });
    setData({ ...data, programs: updated });
    setSelectedProgramId(match.id);
  }, [currentInfo?.ft, currentInfo?.stationId, currentInfo?.type, isPlaying, data, selectedDate, todayStr, stationId]);

  // Auto-scroll to on-air program in schedule (centered)
  useEffect(() => {
    if (loading || hasScrolledRef.current) return;
    if (selectedDate !== todayStr) return;
    const timer = setTimeout(() => {
      if (onAirRef.current && scheduleRef.current) {
        const container = scheduleRef.current;
        const target = onAirRef.current;
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const offset = targetRect.top - containerRect.top - containerRect.height / 2 + targetRect.height / 2;
        container.scrollTo({
          top: container.scrollTop + offset,
          behavior: 'smooth',
        });
        hasScrolledRef.current = true;
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [loading, selectedDate, todayStr]);

  // Auto-update on-air status every 60s
  useEffect(() => {
    if (selectedDate !== todayStr || !data) return;
    const interval = setInterval(() => {
      const now = new Date();
      const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const nowStr =
        jst.getUTCFullYear().toString() +
        String(jst.getUTCMonth() + 1).padStart(2, '0') +
        String(jst.getUTCDate()).padStart(2, '0') +
        String(jst.getUTCHours()).padStart(2, '0') +
        String(jst.getUTCMinutes()).padStart(2, '0') +
        String(jst.getUTCSeconds()).padStart(2, '0');

      let changed = false;
      const updated = data.programs.map((p) => {
        const isOnAir = p.startTime <= nowStr && nowStr < p.endTime;
        if (isOnAir !== p.isOnAir) changed = true;
        return { ...p, isOnAir };
      });
      if (changed) {
        setData({ ...data, programs: updated });
        // Update selected program to new on-air if current selection was on-air
        const newOnAir = updated.find((p) => p.isOnAir);
        if (newOnAir) {
          setSelectedProgramId(newOnAir.id);
        }
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [selectedDate, todayStr, data]);

  const handlePlayLive = useCallback(() => {
    if (!data) return;
    const onAir = data.programs.find((p) => p.isOnAir);
    playLive({
      stationId: data.station.id,
      stationName: data.station.name,
      stationLogo: data.station.logoUrl,
      type: 'live',
      title: onAir?.title || `${data.station.name} Live`,
      performer: onAir?.performer || data.station.name,
      ft: onAir?.startTime,
      to: onAir?.endTime,
    });
    // Select the on-air program if found
    if (onAir) {
      setSelectedProgramId(onAir.id);
    }
    // Clear timefree params from URL
    window.history.replaceState(null, '', window.location.pathname);
  }, [data, playLive]);

  const handlePlayTimefree = useCallback(
    (program: Program) => {
      if (!data) return;
      // Start playback
      playTimefree({
        stationId: data.station.id,
        stationName: data.station.name,
        stationLogo: data.station.logoUrl,
        type: 'timefree',
        title: program.title,
        performer: program.performer || data.station.name,
        ft: program.startTime,
        to: program.endTime,
        duration: program.duration,
      });
      // Select the program so details are shown on the left
      setSelectedProgramId(program.id);
      // Update URL with timefree params
      const params = new URLSearchParams({ ft: program.startTime });
      window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
    },
    [data, playTimefree]
  );

  const handleSelectProgram = useCallback((program: Program) => {
    setSelectedProgramId(program.id);
    setDrawerOpen(false);
  }, []);

  const isToday = selectedDate === todayStr;
  const isStationLive =
    currentInfo?.stationId === stationId && isPlaying && currentInfo?.type === 'live';

  // Date selector + schedule list (shared between sidebar and drawer)
  const scheduleContent = (
    <>
      {/* Date selector - sticky */}
      <div className="px-3 py-2 overflow-x-auto scrollbar-none border-b border-gray-200 dark:border-gray-700 flex-shrink-0 sticky top-0 z-10 bg-white dark:bg-gray-900">
        <div className="flex gap-1 min-w-max">
          {dates.map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDate(d)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                d === selectedDate
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {formatDateLabel(d, todayStr)}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule list */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full" />
        </div>
      ) : error || !data ? (
        <div className="text-center py-10">
          <p className="text-red-500 text-sm">{error || 'Failed to load'}</p>
        </div>
      ) : (
        <ScheduleList
          programs={data.programs}
          stationId={stationId}
          selectedProgramId={selectedProgramId}
          onSelectProgram={handleSelectProgram}
          onPlayTimefree={handlePlayTimefree}
          currentInfo={currentInfo}
          isPlaying={isPlaying}
          isToday={isToday}
          onAirRef={onAirRef}
        />
      )}
    </>
  );

  return (
    <>
      <UrlSync stationId={stationId} />
      <div className="flex flex-1 lg:min-h-0 gap-0 lg:gap-6">
        {/* === Left: Program detail (main area) === */}
        {/* Mobile: flows with document scroll for pull-to-refresh. Desktop: internal scroll for dual-pane layout. */}
        <div
          className="flex-1 min-w-0 lg:overflow-y-auto pr-0 lg:pr-2 pt-2"
          style={{ paddingBottom: 'var(--player-bar-h, 0px)' }}
        >
          <ProgramDetail
            program={selectedProgram}
            station={data?.station || null}
            stationId={stationId}
            noaItems={noaItems}
            playingSongs={playingSongs}
            isStationLive={isStationLive}
            onPlayLive={handlePlayLive}
            onPlayTimefree={handlePlayTimefree}
            currentInfo={currentInfo}
            isPlaying={isPlaying}
          />
        </div>

        {/* === Right: Schedule sidebar (desktop only) === */}
        <div
          className="hidden lg:flex flex-col w-80 xl:w-96 flex-shrink-0 border-l border-gray-200 dark:border-gray-700 overflow-hidden"
          style={{ paddingBottom: 'var(--player-bar-h, 0px)' }}
        >
          <div ref={scheduleRef} className="flex-1 overflow-y-auto min-h-0">
            {scheduleContent}
          </div>
        </div>
      </div>

      {/* === Mobile: Floating schedule button === */}
      <button
        onClick={() => setDrawerOpen(true)}
        className="lg:hidden fixed right-3 sm:right-4 z-40 w-11 h-11 sm:w-12 sm:h-12 bg-blue-500 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-blue-600 active:bg-blue-700 transition-colors"
        style={{ bottom: 'calc(var(--player-bar-h, 0px) + 16px)' }}
        aria-label="Open schedule"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
        </svg>
      </button>

      {/* === Mobile: Schedule drawer === */}
      <ScheduleDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)}>
        {scheduleContent}
      </ScheduleDrawer>
    </>
  );
}
