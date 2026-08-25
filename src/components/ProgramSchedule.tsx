'use client';

import { useEffect, useState, useCallback, useMemo, useRef, memo } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePlayer, usePlayerTime } from '@/lib/player-context';
import { formatTime, parseRadikoDate } from '@/lib/radiko-parser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { CalendarDays, Clock3, Disc3, ExternalLink, ImageIcon, ListMusic, Music2, Play, Radio, UserRound, X } from 'lucide-react';

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

function getBroadcastDateFromFt(ft: string): string {
  const h = parseInt(ft.substring(8, 10), 10);
  if (h >= 5) return ft.substring(0, 8);

  const y = parseInt(ft.substring(0, 4), 10);
  const m = parseInt(ft.substring(4, 6), 10) - 1;
  const day = parseInt(ft.substring(6, 8), 10);
  const prev = new Date(y, m, day - 1);
  return `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}${String(prev.getDate()).padStart(2, '0')}`;
}

const TIMEFREE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isTimefreeAvailable(program: Pick<Program, 'endTime'>, now = new Date()): boolean {
  const endDate = parseRadikoDate(program.endTime);
  return endDate < now && endDate > new Date(now.getTime() - TIMEFREE_MAX_AGE_MS);
}

const TIMEFREE_EXPIRED_MESSAGE = 'Timefree playback is only available for programs from the last 7 days.';

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
// and kept up-to-date by the parent's 10s NOA polling.  For past programs the
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
          <div className="size-8 rounded-full bg-muted" />
          <div className="h-3 w-32 rounded bg-muted" />
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
      <div className="mb-3 flex items-center gap-2">
        <Music2 className="size-4 text-[#e73c64]" />
        <h3 className="text-sm font-semibold tracking-tight">Songs</h3>
        <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">{displaySongs.length}</Badge>
      </div>
      {sorted.map((song) => (
        <div key={song.id} className={cn('flex items-start gap-3 rounded-lg transition-colors hover:bg-accent/60', compact ? 'p-1.5' : 'p-2')}>
          {isRealImage(song.img) ? (
            <img src={song.img} alt="" className={`rounded object-cover flex-shrink-0 ${compact ? 'w-8 h-8' : 'w-10 h-10'}`} />
          ) : (
            <div className={`rounded bg-muted flex items-center justify-center flex-shrink-0 ${compact ? 'w-8 h-8' : 'w-10 h-10'}`}>
              <Music2 className="size-4 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className={`font-medium truncate leading-tight ${compact ? 'text-xs' : 'text-sm'}`}>{song.title}</p>
            <p className={`text-muted-foreground truncate leading-tight ${compact ? 'text-[11px]' : 'text-xs'}`}>{song.artist}</p>
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
          <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0 mt-0.5">
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
            ? 'from-[#fdf2f2] to-[#fff7f9] dark:from-[#3a101b]/40 dark:to-[#2a0b13]/40 border-[#e73c64]/30'
            : 'from-[#e2f4f9] to-[#f5fcff] dark:from-[#0f2f3a]/40 dark:to-[#071f28]/40 border-[#00a7e9]/30'
    }`}>
      {isRealImage(song.img) ? (
        <img src={song.img} alt="" className="w-9 h-9 sm:w-10 sm:h-10 rounded shadow-sm object-cover flex-shrink-0" />
      ) : (
        <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded flex items-center justify-center flex-shrink-0 ${
          isTimefreeMode
            ? 'bg-[#fdf2f2] dark:bg-[#3a101b]/40'
            : 'bg-[#e2f4f9] dark:bg-[#0f2f3a]/40'
        }`}>
          <svg className={`w-5 h-5 ${isTimefreeMode ? 'text-[#e73c64]' : 'text-[#00a7e9]'}`} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          {isTimefreeMode ? (
            <svg className="w-3 h-3 text-[#e73c64] flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          ) : (
            <span className="w-1.5 h-1.5 bg-[#00a7e9] rounded-full animate-pulse flex-shrink-0" />
          )}
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${
            isTimefreeMode
              ? 'text-[#e73c64]'
              : 'text-[#00a7e9]'
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
// Wrapped in React.memo so that parent re-renders (e.g. from context isLoading
// toggling every few seconds during HLS streaming) don't cascade into this
// heavy subtree when none of its props have actually changed.
const ProgramDetail = memo(function ProgramDetail({
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
        <div className="animate-spin w-8 h-8 border-2 border-gray-300 border-t-[#00a7e9] rounded-full" />
      </div>
    );
  }

  const isThisProgramPlaying = program && currentInfo?.stationId === station.id && isPlaying &&
    ((currentInfo?.type === 'timefree' && currentInfo?.ft === program.startTime) ||
     (currentInfo?.type === 'live' && program.isOnAir));

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <Card className="overflow-hidden border-border/70 py-0 shadow-sm sm:shadow-md">
        <CardHeader className="flex flex-row items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <img
            src={station.logoUrl}
            alt={station.name}
            className="size-12 rounded-xl border bg-white object-contain p-1 shadow-xs dark:bg-gray-950"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{station.name}</h1>
              {isStationLive && (
                <Badge className="border-[#00a7e9]/20 bg-[#00a7e9] text-white">
                  <span className="size-1.5 rounded-full bg-white animate-pulse" />
                  Live
                </Badge>
              )}
            </div>
            {station.asciiName && (
              <p className="truncate text-xs text-muted-foreground">{station.asciiName}</p>
            )}
          </div>
          <Button
            onClick={onPlayLive}
            className={cn(
              'h-11 rounded-full px-4 shadow-sm',
              isStationLive ? 'bg-[#00a7e9] text-white hover:bg-[#50cdff]' : 'bg-[#00a7e9] text-white hover:bg-[#50cdff]'
            )}
          >
            {isStationLive ? <Radio className="size-4" /> : <Play className="size-4 fill-current" />}
            {isStationLive ? 'On Air' : 'Live'}
          </Button>
        </CardHeader>
      </Card>

      {/* Now playing song bar — isolated component to avoid time-tick re-renders */}
      <NowPlayingSongBar playingSongs={playingSongs} noaItems={noaItems} stationId={stationId} />

      {/* Selected program detail */}
      {program ? (
        <>
        <Card className="overflow-hidden border-border/70 py-0 shadow-sm sm:shadow-md">
          <div className="flex flex-col sm:flex-row">
            <div className="relative bg-muted sm:w-[240px] md:w-[300px] lg:w-[356px] sm:flex-shrink-0">
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
                  <ImageIcon className="size-12 text-muted-foreground/50" />
                </div>
              )}
              {program.isOnAir && (
                <Badge className="absolute left-3 top-3 border-[#00a7e9]/30 bg-[#00a7e9] text-white shadow-lg">
                  <span className="size-1.5 rounded-full bg-white animate-pulse" />
                  LIVE
                </Badge>
              )}
            </div>

            <CardContent className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-4 sm:px-5 sm:py-5">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {program.isTimefree && <Badge variant="secondary">Timefree</Badge>}
                  <Badge variant="outline" className="gap-1 text-muted-foreground">
                    <CalendarDays className="size-3" />
                    {formatTime(program.startTime)} - {formatTime(program.endTime)}
                  </Badge>
                </div>
                <h2 className="text-xl font-bold leading-tight tracking-tight sm:text-2xl">{program.title}</h2>
              </div>
              {program.subtitle && (
                <p className="text-sm leading-relaxed text-muted-foreground">{program.subtitle}</p>
              )}
              {program.performer && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <UserRound className="size-4 flex-shrink-0" />
                  {program.performer}
                </p>
              )}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 className="size-3.5" />
                <span>{formatDuration(program.duration)}</span>
              </div>

              {(program.isTimefree || program.isOnAir) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {program.isOnAir ? (
                    <Button
                      onClick={onPlayLive}
                      className={cn('h-11 rounded-full px-5 bg-[#00a7e9] hover:bg-[#50cdff]')}
                    >
                      <Play className="size-4 fill-current" />
                      {isStationLive ? 'Listening Live' : 'Listen Live'}
                    </Button>
                  ) : program.isTimefree && (
                    <Button
                      onClick={() => onPlayTimefree(program)}
                      variant={isThisProgramPlaying ? 'default' : 'secondary'}
                      className={cn('h-11 rounded-full px-5', isThisProgramPlaying && 'bg-[#e73c64] hover:bg-[#f25b7f]')}
                    >
                      <Play className="size-4 fill-current" />
                      {isThisProgramPlaying ? 'Playing' : 'Timefree'}
                    </Button>
                  )}
                  {program.url && (
                    <Button asChild variant="outline" className="h-11 rounded-full px-5">
                      <a href={program.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="size-4" />
                      Website
                      </a>
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </div>

          {(program.description || program.info) && (
            <CardContent className="space-y-3 border-t px-4 py-4 text-sm leading-relaxed text-muted-foreground sm:px-5">
              {program.description && (
                <div className="whitespace-pre-wrap break-words">{program.description}</div>
              )}
              {program.info && (
                <div className="whitespace-pre-wrap break-words">{program.info}</div>
              )}
            </CardContent>
          )}
        </Card>

        <Card className="border-border/70 py-0 shadow-sm">
          <CardContent className="px-4 py-4 sm:px-5">
          <SongList
            stationId={stationId}
            ft={program.startTime}
            to={program.endTime}
            liveNoaItems={program.isOnAir ? noaItems : undefined}
          />
          </CardContent>
        </Card>
        </>
      ) : (
        <Card className="border-dashed py-12 text-center text-muted-foreground">
          <Disc3 className="mx-auto mb-4 size-16 text-muted-foreground/40" />
          <p className="text-sm">Select a program from the schedule</p>
        </Card>
      )}
    </div>
  );
});

// --- Compact schedule list (used in sidebar and drawer) ---
const ScheduleList = memo(function ScheduleList({
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
    <div className="space-y-2 p-3 lg:space-y-1 lg:p-1.5">
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
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-2.5 shadow-sm transition-all active:scale-[0.99] lg:rounded-lg lg:border-transparent lg:bg-transparent lg:p-2 lg:shadow-none',
              isSelected && 'border-[#00a7e9] bg-[#e2f4f9] ring-1 ring-[#00a7e9]/30 dark:bg-[#0f2f3a]/40',
              !isSelected && program.isOnAir && 'border-[#00a7e9]/30 bg-[#e2f4f9]/70 dark:bg-[#0f2f3a]/30',
              !isSelected && isNowPlaying && 'border-[#e73c64]/30 bg-[#fdf2f2]/70 dark:bg-[#3a101b]/30',
              !isSelected && !program.isOnAir && !isNowPlaying && 'hover:bg-accent/70'
            )}
            onClick={() => onSelectProgram(program)}
          >
            {program.imageUrl ? (
              <img
                src={program.imageUrl}
                alt=""
                className="h-14 w-20 flex-shrink-0 rounded-lg bg-muted object-cover lg:h-[42px] lg:w-16"
              />
            ) : (
              <div className="flex h-14 w-20 flex-shrink-0 items-center justify-center rounded-lg bg-muted lg:h-[42px] lg:w-16">
                <ImageIcon className="size-5 text-muted-foreground/50" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="font-mono text-[11px] leading-none text-muted-foreground">
                  {formatTime(program.startTime)}
                </span>
                {program.isOnAir && (
                  <Badge className="h-5 border-[#00a7e9]/30 bg-[#00a7e9] px-1.5 text-[10px] text-white">
                    <span className="size-1.5 rounded-full bg-white animate-pulse" />
                    Live
                  </Badge>
                )}
              </div>
              <p className="truncate text-sm font-semibold leading-tight lg:text-xs">{program.title}</p>
              {program.performer && (
                <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground lg:text-[11px]">
                  {program.performer}
                </p>
              )}
            </div>

            <div className="flex flex-shrink-0 items-center gap-1">
              {program.isTimefree && (
                <Button
                  size="icon"
                  variant={isNowPlaying ? 'default' : 'ghost'}
                  onClick={(e) => { e.stopPropagation(); onPlayTimefree(program); }}
                  className={cn('size-10 rounded-full lg:size-8', isNowPlaying && 'bg-[#e73c64] hover:bg-[#f25b7f]')}
                  title="Play timefree"
                >
                  <Play className="size-4 fill-current" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});

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
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-3xl border bg-background shadow-2xl animate-slide-up">
        <div className="flex flex-shrink-0 items-center justify-center pt-3">
          <div className="h-1.5 w-12 rounded-full bg-muted-foreground/25" />
        </div>
        <div className="flex flex-shrink-0 items-center justify-between px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Schedule</h3>
            <p className="text-xs text-muted-foreground">Pick a program or start timefree playback</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="size-10 rounded-full"
            aria-label="Close schedule"
          >
            <X className="size-5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-safe">
          {children}
        </div>
      </div>
    </div>
  );
}

// --- URL sync component (isolated to avoid high-frequency re-renders in parent) ---
// Updates the browser URL with the current playback position every 10s.
// Works for both timefree and behind-live modes.
// Every write is recorded in selfWriteRef so the parent can tell its own writes
// apart from a real navigation (Next patches history.replaceState into the
// router state, so useSearchParams() fires for our own writes too).
function UrlSync({
  stationId,
  selfWriteRef,
}: {
  stationId: string;
  selfWriteRef: React.RefObject<string | null>;
}) {
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
        selfWriteRef.current = '';
        window.history.replaceState(null, '', window.location.pathname);
      }
      return;
    }

    const t = Math.floor(currentTime);
    // Throttle: only write if at least 10s since last write and position changed meaningfully
    if (Math.abs(t - lastWrittenRef.current) < 10) return;
    lastWrittenRef.current = t;

    const params = new URLSearchParams({ ft, ...(t > 0 ? { t: String(t) } : {}) });
    selfWriteRef.current = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }, [isPlaying, currentInfo, stationId, currentTime, isBehindLive, selfWriteRef]);

  return null;
}

// --- Main component ---
export default function ProgramSchedule({ stationId }: { stationId: string }) {
  const searchParams = useSearchParams();
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
  const [deepLinkVersion, setDeepLinkVersion] = useState(0);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const { playLive, playTimefree, seekLive, currentInfo, isPlaying, isBehindLive } = usePlayer();

  const scheduleRef = useRef<HTMLDivElement>(null);
  const onAirRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);
  const deepLinkRef = useRef<{ ft: string; t?: number } | null>(null);
  const preparedDeepLinkRef = useRef<string | null>(null);
  const lastLiveFtRef = useRef<string | null>(null);
  const consumedPlaybackSyncRef = useRef<string | null>(null);
  // Query string of the last URL we wrote ourselves (playback position sync,
  // play actions). Used to ignore the resulting useSearchParams() update.
  const selfUrlWriteRef = useRef<string | null>(null);
  const fetchedKeyRef = useRef<string | null>(null);
  const selectedProgram = data?.programs.find((p) => p.id === selectedProgramId) || null;

  const playbackSyncKey = currentInfo?.stationId === stationId && currentInfo.ft &&
    (currentInfo.type === 'timefree' || (currentInfo.type === 'live' && isBehindLive))
    ? `${stationId}:${currentInfo.type}:${currentInfo.ft}:${isBehindLive}`
    : null;

  const handleSelectDate = useCallback((date: string) => {
    deepLinkRef.current = null;
    preparedDeepLinkRef.current = null;
    consumedPlaybackSyncRef.current = playbackSyncKey;
    setSelectedDate(date);
  }, [playbackSyncKey]);

  // Read deep-link params whenever App Router search params change.
  // Skip updates caused by our own history.replaceState calls — otherwise the
  // 10s playback-position sync would keep re-fetching the schedule.
  useEffect(() => {
    if (selfUrlWriteRef.current !== null && selfUrlWriteRef.current === searchParams.toString()) {
      selfUrlWriteRef.current = null;
      return;
    }
    selfUrlWriteRef.current = null;
    const ft = searchParams.get('ft');
    if (ft) {
      const t = searchParams.get('t');
      deepLinkRef.current = { ft, t: t ? parseInt(t, 10) : undefined };
      preparedDeepLinkRef.current = null;
    } else {
      deepLinkRef.current = null;
    }
    setDeepLinkVersion((v) => v + 1);
  }, [searchParams]);

  // Fetch program schedule
  useEffect(() => {
    let active = true;
    // Only show the spinner (and re-arm auto-scroll) for a genuinely new
    // station/date. Re-runs for the same schedule keep the current list
    // visible instead of flashing a loading state.
    const fetchKey = `${stationId}:${selectedDate}`;
    const isNewSchedule = fetchedKeyRef.current !== fetchKey;
    fetchedKeyRef.current = fetchKey;
    if (isNewSchedule) {
      setLoading(true);
      hasScrolledRef.current = false;
    }
    setError(null);
    setPlaybackNotice(null);
    const params = new URLSearchParams({ stationId, date: selectedDate });
    fetch(`/api/programs?${params}`)
      .then((res) => res.json())
      .then((d) => {
        if (!active) return;
        if (d.error) throw new Error(d.error);

        const dl = deepLinkRef.current;
        if (dl) {
          // Deep-link: find the program whose time range contains ft
          const match = d.programs?.find((p: Program) => p.startTime === dl.ft)
            || d.programs?.find((p: Program) => p.startTime <= dl.ft && dl.ft < p.endTime);
          if (match) {
            setData(d);
            setSelectedProgramId(match.id);
            return;
          }
          // If not found on this date, the deep-link ft may belong to a different broadcast date.
          // Extract the broadcast date from ft (radiko day starts at 05:00 JST).
          const dateFromFt = getBroadcastDateFromFt(dl.ft);
          if (dateFromFt !== selectedDate) {
            // Switch to the correct date — this effect will re-run
            setSelectedDate(dateFromFt);
            return;
          }
          // Program not found even on correct date — clear deep-link, fall through
          deepLinkRef.current = null;
        }

        const playbackFt = playbackSyncKey && consumedPlaybackSyncRef.current !== playbackSyncKey &&
          currentInfo?.stationId === stationId &&
          (currentInfo.type === 'timefree' || (currentInfo.type === 'live' && isBehindLive))
          ? currentInfo.ft
          : undefined;
        if (playbackFt) {
          const dateFromPlayback = getBroadcastDateFromFt(playbackFt);
          if (dateFromPlayback !== selectedDate) {
            setSelectedDate(dateFromPlayback);
            return;
          }

          const match = d.programs?.find((p: Program) => p.startTime === playbackFt)
            || d.programs?.find((p: Program) => p.startTime <= playbackFt && playbackFt < p.endTime);
          if (match) {
            setData(d);
            setSelectedProgramId(match.id);
            consumedPlaybackSyncRef.current = playbackSyncKey;
            return;
          }
        }

        // Default: auto-select on-air program for today, or first program for past dates
        setData(d);
        if (selectedDate === todayStr) {
          const onAir = d.programs?.find((p: Program) => p.isOnAir);
          setSelectedProgramId(onAir?.id || d.programs?.[0]?.id || null);
        } else {
          setSelectedProgramId(d.programs?.[0]?.id || null);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [stationId, selectedDate, todayStr, currentInfo?.stationId, currentInfo?.type, currentInfo?.ft, isBehindLive, deepLinkVersion, playbackSyncKey]);

  // Deep links prepare the player bar without starting playback.
  useEffect(() => {
    const dl = deepLinkRef.current;
    if (!dl || !data || !selectedProgram) return;
    const inRange = selectedProgram.startTime <= dl.ft && dl.ft < selectedProgram.endTime;
    if (selectedProgram.startTime !== dl.ft && !inRange) return;
    const seekTo = dl.t || 0;
    const key = `${data.station.id}:${selectedProgram.startTime}:${seekTo}`;
    if (preparedDeepLinkRef.current === key) return;
    preparedDeepLinkRef.current = key;

    if (selectedProgram.isOnAir) return;

    if (!isTimefreeAvailable(selectedProgram)) {
      setPlaybackNotice(TIMEFREE_EXPIRED_MESSAGE);
      deepLinkRef.current = null;
      return;
    }

    const isAlreadyCurrentPlayback = currentInfo?.stationId === stationId &&
      currentInfo.ft === selectedProgram.startTime &&
      (currentInfo.type === 'timefree' || (currentInfo.type === 'live' && isBehindLive));
    if (isAlreadyCurrentPlayback) {
      deepLinkRef.current = null;
      return;
    }

    playTimefree({
      stationId: data.station.id,
      stationName: data.station.name,
      stationLogo: data.station.logoUrl,
      artworkUrl: selectedProgram.imageUrl || data.station.logoUrl,
      type: 'timefree',
      title: selectedProgram.title,
      performer: selectedProgram.performer || data.station.name,
      ft: selectedProgram.startTime,
      to: selectedProgram.endTime,
      duration: selectedProgram.duration,
    }, seekTo, false);
    deepLinkRef.current = null;
  }, [data, selectedProgram, playTimefree, currentInfo, stationId, isBehindLive]);

  // Fetch NOA (now-on-air) for live display.
  // Only poll when viewing today AND the selected program is on-air (10s interval).
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
    const interval = setInterval(fetchNoa, 10000);
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
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const endDate = parseRadikoDate(p.endTime);
        const isTimefree = !isOnAir && endDate < now && endDate > oneWeekAgo;
        if (isOnAir !== p.isOnAir || isTimefree !== p.isTimefree) changed = true;
        return { ...p, isOnAir, isTimefree };
      });
      if (changed) {
        setData({ ...data, programs: updated });
        // Update selected program to new on-air if current selection was on-air
        const previouslySelected = data.programs.find((p) => p.id === selectedProgramId);
        const newOnAir = updated.find((p) => p.isOnAir);
        if (newOnAir && previouslySelected?.isOnAir) {
          setSelectedProgramId(newOnAir.id);
        }
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [selectedDate, todayStr, data, selectedProgramId]);

  const handlePlayLive = useCallback(() => {
    if (!data) return;
    const onAir = data.programs.find((p) => p.isOnAir);
    const dl = deepLinkRef.current;
    const matchesDeepLink = !!(onAir && dl?.ft && onAir.startTime <= dl.ft && dl.ft < onAir.endTime);
    const seekTo = matchesDeepLink ? dl?.t : undefined;
    if (matchesDeepLink) {
      deepLinkRef.current = null;
    }
    playLive({
      stationId: data.station.id,
      stationName: data.station.name,
      stationLogo: data.station.logoUrl,
      artworkUrl: onAir?.imageUrl || data.station.logoUrl,
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
    if (seekTo && seekTo > 0) {
      setTimeout(() => seekLive(seekTo), 1500);
    }
    // Clear timefree params from URL
    selfUrlWriteRef.current = '';
    window.history.replaceState(null, '', window.location.pathname);
  }, [data, playLive, seekLive]);

  const handlePlayTimefree = useCallback(
    (program: Program) => {
      if (!data) return;
      if (!isTimefreeAvailable(program)) {
        setPlaybackNotice(TIMEFREE_EXPIRED_MESSAGE);
        return;
      }
      setPlaybackNotice(null);
      const dl = deepLinkRef.current;
      const inRange = dl?.ft && program.startTime <= dl.ft && dl.ft < program.endTime;
      const matchesDeepLink = !!(dl && (program.startTime === dl.ft || inRange));
      const seekTo = matchesDeepLink ? dl?.t : undefined;
      if (matchesDeepLink) {
        deepLinkRef.current = null;
      }
      // Start playback
      playTimefree({
        stationId: data.station.id,
        stationName: data.station.name,
        stationLogo: data.station.logoUrl,
        artworkUrl: program.imageUrl || data.station.logoUrl,
        type: 'timefree',
        title: program.title,
        performer: program.performer || data.station.name,
        ft: program.startTime,
        to: program.endTime,
        duration: program.duration,
      }, seekTo || 0);
      // Select the program so details are shown on the left
      setSelectedProgramId(program.id);
      // Update URL with timefree params
      const params = new URLSearchParams({ ft: program.startTime, ...(seekTo && seekTo > 0 ? { t: String(seekTo) } : {}) });
      selfUrlWriteRef.current = params.toString();
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
      <div className="sticky top-0 z-10 flex-shrink-0 overflow-x-auto border-b bg-background/95 px-3 py-2 backdrop-blur scrollbar-none">
        <div className="flex min-w-max gap-1.5">
          {dates.map((d) => (
            <Button
              key={d}
              onClick={() => handleSelectDate(d)}
              variant={d === selectedDate ? 'default' : 'secondary'}
              size="sm"
              className={cn('h-8 rounded-full px-3 text-xs', d === selectedDate && 'bg-[#00a7e9] text-white hover:bg-[#50cdff]')}
            >
              {formatDateLabel(d, todayStr)}
            </Button>
          ))}
        </div>
      </div>

      {/* Schedule list */}
      {playbackNotice && (
        <div className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {playbackNotice}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-[#00a7e9] rounded-full" />
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
      <UrlSync stationId={stationId} selfWriteRef={selfUrlWriteRef} />
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
      <Button
        onClick={() => setDrawerOpen(true)}
        size="icon"
        className="fixed right-4 z-40 size-14 rounded-full bg-[#00a7e9] text-white shadow-xl shadow-[#00a7e9]/20 hover:bg-[#50cdff] lg:hidden"
        style={{ bottom: 'calc(var(--player-bar-h, 0px) + 16px)' }}
        aria-label="Open schedule"
      >
        <ListMusic className="size-6" />
      </Button>

      {/* === Mobile: Schedule drawer === */}
      <ScheduleDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)}>
        {scheduleContent}
      </ScheduleDrawer>
    </>
  );
}
