'use client';

import { usePlayer, usePlayerTime } from '@/lib/player-context';
import { Loader2, Pause, Play, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

function formatSeconds(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Convert ft (YYYYMMDDHHmmss JST) + offset seconds into "HH:MM:SS" absolute time string
function absoluteTime(ft: string, offsetSeconds: number): string {
  const h0 = parseInt(ft.substring(8, 10), 10);
  const m0 = parseInt(ft.substring(10, 12), 10);
  const s0 = parseInt(ft.substring(12, 14), 10);
  const totalSec = h0 * 3600 + m0 * 60 + s0 + Math.floor(offsetSeconds);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// --- Icons ---

// Check if a program end time (YYYYMMDDHHmmss JST) is in the future (program still airing)
function isOnAirProgram(to?: string): boolean {
  if (!to || to.length < 14) return false;
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const nowStr =
    jst.getUTCFullYear().toString() +
    String(jst.getUTCMonth() + 1).padStart(2, '0') +
    String(jst.getUTCDate()).padStart(2, '0') +
    String(jst.getUTCHours()).padStart(2, '0') +
    String(jst.getUTCMinutes()).padStart(2, '0') +
    String(jst.getUTCSeconds()).padStart(2, '0');
  return nowStr < to;
}

function SkipBackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
      <text x="12" y="16" textAnchor="middle" fontSize="7.5" fontWeight="bold" fontFamily="sans-serif">10</text>
    </svg>
  );
}

function SkipForwardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
      <text x="12" y="16" textAnchor="middle" fontSize="7.5" fontWeight="bold" fontFamily="sans-serif">10</text>
    </svg>
  );
}

// --- Unified progress/seek bar ---

function ProgressBar({
  currentTime,
  totalDuration,
  accentColor,
  ft,
  onSeek,
  hideEndTime,
}: {
  currentTime: number;
  totalDuration: number;
  accentColor: string; // CSS color value, e.g. "#3b82f6"
  ft?: string;
  onSeek: (time: number) => void;
  hideEndTime?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [interacting, setInteracting] = useState(false); // hover or drag
  const [dragging, setDragging] = useState(false);
  const [dragRatio, setDragRatio] = useState(0);
  const [hoverRatio, setHoverRatio] = useState(0);
  const dragRatioRef = useRef(0);

  // Touch relative-drag refs
  const touchStartXRef = useRef(0);
  const touchStartRatioRef = useRef(0);
  const touchMovedRef = useRef(false);

  const getRatioFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const commitSeek = useCallback((ratio: number) => {
    onSeek(ratio * totalDuration);
  }, [onSeek, totalDuration]);

  // Mouse events on window
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const r = getRatioFromClientX(e.clientX);
      dragRatioRef.current = r;
      setDragRatio(r);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      const r = getRatioFromClientX(e.clientX);
      commitSeek(r);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [getRatioFromClientX, commitSeek]);

  // Touch events on window
  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      e.preventDefault();
      const deltaX = touch.clientX - touchStartXRef.current;
      const track = trackRef.current;
      if (!track) return;
      const trackW = track.getBoundingClientRect().width;
      if (!touchMovedRef.current && Math.abs(deltaX) >= 5) {
        touchMovedRef.current = true;
      }
      let r: number;
      if (touchMovedRef.current) {
        r = Math.max(0, Math.min(1, touchStartRatioRef.current + deltaX / trackW));
      } else {
        r = getRatioFromClientX(touch.clientX);
      }
      dragRatioRef.current = r;
      setDragRatio(r);
    };
    const onTouchEnd = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      commitSeek(dragRatioRef.current);
    };
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [getRatioFromClientX, commitSeek]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const r = getRatioFromClientX(e.clientX);
    draggingRef.current = true;
    dragRatioRef.current = r;
    setDragging(true);
    setDragRatio(r);
  }, [getRatioFromClientX]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const r = getRatioFromClientX(touch.clientX);
    touchStartXRef.current = touch.clientX;
    touchStartRatioRef.current = totalDuration > 0 ? currentTime / totalDuration : 0;
    touchMovedRef.current = false;
    draggingRef.current = true;
    dragRatioRef.current = r;
    setDragging(true);
    setDragRatio(r);
  }, [getRatioFromClientX, totalDuration, currentTime]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingRef.current) return; // window handler takes over during drag
    setHoverRatio(getRatioFromClientX(e.clientX));
  }, [getRatioFromClientX]);

  const playRatio = totalDuration > 0 ? currentTime / totalDuration : 0;
  const displayRatio = dragging ? dragRatio : playRatio;
  const displayTime = dragging ? dragRatio * totalDuration : currentTime;
  const tooltipRatio = dragging ? dragRatio : hoverRatio;
  const tooltipTime = tooltipRatio * totalDuration;

  return (
    <div className="flex items-center gap-2 sm:gap-3 w-full">
      {/* Elapsed time */}
      <span className="text-xs sm:text-[11px] font-mono text-gray-500 dark:text-gray-400 w-12 sm:w-14 text-right flex-shrink-0 select-none tabular-nums">
        {ft ? absoluteTime(ft, displayTime) : formatSeconds(displayTime)}
      </span>

      {/* Track container: tall hit area, thin visible track */}
      <div
        ref={trackRef}
        role="slider"
        aria-label="Seek playback"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalDuration)}
        aria-valuenow={Math.round(displayTime)}
        className="relative flex-1 h-10 sm:h-5 flex items-center cursor-pointer touch-none group"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setInteracting(true)}
        onMouseLeave={() => { if (!draggingRef.current) setInteracting(false); }}
      >
        {/* Track background */}
        <div className={`w-full rounded-full bg-gray-200 dark:bg-gray-700 transition-[height] duration-150 ${
          interacting || dragging ? 'h-2.5 sm:h-1.5' : 'h-2 sm:h-1'
        }`}>
          {/* Fill */}
          <div
            className="h-full rounded-full transition-[width] duration-100"
            style={{ width: `${displayRatio * 100}%`, backgroundColor: accentColor }}
          />
        </div>

        {/* Thumb */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full ring-2 ring-white dark:ring-gray-900 transition-[width,height,opacity] duration-150 shadow-sm ${
            interacting || dragging
              ? 'w-5 h-5 sm:w-3.5 sm:h-3.5 opacity-100'
              : 'w-4 h-4 sm:w-2.5 sm:h-2.5 opacity-90 sm:opacity-80'
          }`}
          style={{ left: `${displayRatio * 100}%`, backgroundColor: accentColor }}
        />

        {/* Hover/drag tooltip */}
        {(interacting || dragging) && ft && (
          <div
            className="absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none"
            style={{ left: `${tooltipRatio * 100}%` }}
          >
            <div className="bg-gray-900 text-white text-[11px] font-mono px-2 py-0.5 rounded shadow-lg whitespace-nowrap border border-gray-700">
              {absoluteTime(ft, tooltipTime)}
            </div>
          </div>
        )}
      </div>

      {/* Total / end time */}
      {hideEndTime ? (
        <span className="w-12 sm:w-14 flex-shrink-0" />
      ) : (
        <span className="text-xs sm:text-[11px] font-mono text-gray-500 dark:text-gray-400 w-12 sm:w-14 text-left flex-shrink-0 select-none tabular-nums">
          {ft ? absoluteTime(ft, totalDuration) : formatSeconds(totalDuration)}
        </span>
      )}
    </div>
  );
}

// --- Volume slider ---

function VolumeSlider({ volume, onVolumeChange }: { volume: number; onVolumeChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const prevVolumeRef = useRef(0.8);
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);

  const getVolumeFromX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return volume;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, [volume]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      onVolumeChange(getVolumeFromX(e.clientX));
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      onVolumeChange(getVolumeFromX(e.clientX));
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [getVolumeFromX, onVolumeChange]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    onVolumeChange(getVolumeFromX(e.clientX));
  }, [getVolumeFromX, onVolumeChange]);

  const toggleMute = useCallback(() => {
    if (volume > 0) {
      prevVolumeRef.current = volume;
      onVolumeChange(0);
    } else {
      onVolumeChange(prevVolumeRef.current || 0.8);
    }
  }, [volume, onVolumeChange]);

  const active = hovering || dragging;
  const pct = `${Math.round(volume * 100)}%`;

  return (
    <div
      className="hidden sm:flex items-center gap-1.5 ml-1 group"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button
        onClick={toggleMute}
        className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
        aria-label={volume > 0 ? 'Mute' : 'Unmute'}
      >
        {volume === 0 ? (
          <VolumeX className="size-4" />
        ) : volume < 0.5 ? (
          <Volume1 className="size-4" />
        ) : (
          <Volume2 className="size-4" />
        )}
      </button>
      <div
        ref={trackRef}
        className="w-20 h-6 flex items-center cursor-pointer"
        onMouseDown={handleMouseDown}
        role="slider"
        aria-label="Volume"
        aria-valuenow={Math.round(volume * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="relative w-full h-1 rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className={`absolute left-0 top-0 h-full rounded-full transition-colors ${active ? 'bg-gray-900 dark:bg-white' : 'bg-gray-500 dark:bg-gray-400'}`}
            style={{ width: pct }}
          />
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-gray-900 dark:bg-white shadow ring-2 ring-white dark:ring-gray-950 transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
            style={{ left: pct }}
          />
        </div>
      </div>
    </div>
  );
}

// --- Main player bar ---

export default function PlayerBar() {
  const barRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const {
    isPlaying,
    isLoading,
    currentInfo,
    volume,
    duration,
    error,
    isBehindLive,
    pause,
    resume,
    setVolume,
    seek,
    seekLive,
    backToLive,
    skipForward,
    skipBackward,
  } = usePlayer();
  const { currentTime, liveElapsed, liveSeekableUntil } = usePlayerTime();

  // Set CSS variable for content padding to avoid overlap
  useEffect(() => {
    if (!currentInfo && !error) {
      document.documentElement.style.setProperty('--player-bar-h', '0px');
      return;
    }
    const el = barRef.current;
    if (!el) return;
    const update = () => {
      document.documentElement.style.setProperty('--player-bar-h', `${el.offsetHeight}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty('--player-bar-h', '0px');
    };
  }, [currentInfo, error]);

  const isTimefree = currentInfo?.type === 'timefree';
  const isLive = currentInfo?.type === 'live';
  const hasLiveBar = isLive && !!currentInfo?.ft;

  // Determine bar parameters
  const barCurrentTime = isLive
    ? (isBehindLive ? currentTime : liveElapsed)
    : currentTime;
  const barDuration = isLive ? (isBehindLive ? (liveSeekableUntil || liveElapsed) : liveElapsed) : duration;
  const barColor = isLive
    ? (isBehindLive ? '#e73c64' : '#00a7e9')
    : '#e73c64';
  const showBar = (isTimefree && duration > 0) || (hasLiveBar && liveElapsed > 0);
  const handleSeek = isLive ? seekLive : seek;

  // Hide end time for live (always growing) and timefree of still-airing programs
  const barHideEndTime = isLive || (isTimefree && isOnAirProgram(currentInfo?.to));

  const openCurrentProgram = useCallback(() => {
    if (!currentInfo?.stationId) return;

    const path = `/station/${encodeURIComponent(currentInfo.stationId)}`;
    if (!currentInfo.ft || (currentInfo.type === 'live' && !isBehindLive)) {
      router.push(path, { scroll: false });
      return;
    }

    const params = new URLSearchParams({ ft: currentInfo.ft });
    const t = Math.floor(currentTime);
    if (t > 0) params.set('t', String(t));
    router.push(`${path}?${params}`, { scroll: false });
  }, [currentInfo, currentTime, isBehindLive, router]);

  if (!currentInfo && !error) return null;

  return (
    <div
      ref={barRef}
      className={`fixed bottom-0 left-0 right-0 z-50 border-t-2 bg-white text-gray-900 shadow-[0_-2px_2px_rgba(0,0,0,0.10)] pb-safe dark:bg-gray-950 dark:text-gray-100 ${
        isLive && !isBehindLive
          ? 'border-t-[#00a7e9]'
          : (isLive && isBehindLive) || isTimefree
            ? 'border-t-[#e73c64]'
            : 'border-t-[#d9d9d9]'
      }`}
    >
      {/* Live-only pulse bar when no ft available */}
      {isLive && !hasLiveBar && (
        <div className="h-0.5 bg-[#00a7e9] animate-pulse" />
      )}
      <div className="max-w-screen-xl mx-auto px-3 sm:px-4">
        {/* Progress bar row */}
        {showBar && (
          <div className="pt-2.5 sm:pt-2">
            <ProgressBar
              currentTime={barCurrentTime}
              totalDuration={barDuration}
              accentColor={barColor}
              ft={currentInfo?.ft}
              onSeek={handleSeek}
              hideEndTime={barHideEndTime}
            />
          </div>
        )}

        {/* Controls row */}
        <div className="flex flex-col gap-2.5 py-2.5 sm:flex-row sm:items-center sm:gap-3 sm:py-2.5">
          <button
            type="button"
            onClick={openCurrentProgram}
            className="flex items-center gap-3 min-w-0 rounded text-left transition-colors hover:bg-[#f2f2f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a7e9] active:bg-[#f2f2f2] sm:flex-1 dark:hover:bg-gray-900 dark:active:bg-gray-900"
            aria-label="Open current program"
          >
            {/* Station logo */}
            {currentInfo?.stationLogo && (
              <img
                src={currentInfo.stationLogo}
                alt={currentInfo.stationName}
                className="size-11 sm:size-10 rounded object-contain bg-white flex-shrink-0 border border-gray-100 dark:border-gray-800"
              />
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                {isLive && !isBehindLive && (
                  <span className="inline-flex h-5 items-center gap-1 rounded bg-[#00a7e9] px-1.5 text-[10px] font-bold text-white flex-shrink-0">
                    <span className="size-1.5 rounded-full bg-white animate-pulse" />
                    LIVE
                  </span>
                )}
                {isLive && isBehindLive && (
                  <span className="inline-flex h-5 items-center rounded bg-[#e73c64] px-1.5 text-[10px] font-bold text-white flex-shrink-0">
                    BEHIND
                  </span>
                )}
                {isTimefree && (
                  <span className="inline-flex h-5 items-center rounded bg-[#e73c64] px-1.5 text-[10px] font-bold text-white flex-shrink-0">
                    TF
                  </span>
                )}
                <span className="text-sm font-semibold truncate">
                  {currentInfo?.title || currentInfo?.stationName || 'Unknown'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {currentInfo?.performer || currentInfo?.stationName}
              </p>
              {error && <p className="text-xs text-red-500 mt-0.5 line-clamp-2 sm:line-clamp-none">{error}</p>}
            </div>
          </button>

          {/* Controls */}
          <div className="flex items-center justify-center gap-2 sm:gap-1.5 w-full sm:w-auto flex-shrink-0 rounded-full border border-[#d9d9d9] bg-[#f2f2f2] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:border-gray-800 dark:bg-gray-900 sm:px-2 sm:py-1">
            {/* Back to Live */}
            {isLive && isBehindLive && (
              <button
                onClick={backToLive}
                className="h-10 rounded-full bg-[#00a7e9] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#50cdff] active:bg-[#008dc5] sm:h-8 sm:px-2.5"
                aria-label="Back to live"
              >
                Live
              </button>
            )}

            {/* Skip backward */}
            {(isTimefree || hasLiveBar) && (
              <button
                onClick={skipBackward}
                className="size-11 sm:size-9 flex items-center justify-center rounded-full border border-[#d9d9d9] bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                aria-label="Back 10 seconds"
              >
                <SkipBackIcon className="size-7 sm:size-6" />
              </button>
            )}

            {/* Play/Pause */}
            <button
              onClick={isPlaying ? pause : resume}
              disabled={isLoading && !isPlaying}
              className={`size-14 sm:size-11 flex items-center justify-center rounded-full text-white shadow-[0_1px_2px_rgba(0,0,0,0.16)] transition-colors disabled:opacity-50 ${
                isLive && !isBehindLive
                  ? 'bg-[#00a7e9] hover:bg-[#50cdff] active:bg-[#008dc5]'
                  : isLive && isBehindLive
                    ? 'bg-[#e73c64] hover:bg-[#f25b7f] active:bg-[#c50e39]'
                    : isTimefree
                      ? 'bg-[#e73c64] hover:bg-[#f25b7f] active:bg-[#c50e39]'
                      : 'bg-gray-900 hover:bg-gray-800 active:bg-black'
              }`}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isLoading ? (
                <Loader2 className="size-7 animate-spin sm:size-5" />
              ) : isPlaying ? (
                <Pause className="size-7 fill-current sm:size-5" />
              ) : (
                <Play className="ml-0.5 size-7 fill-current sm:size-5" />
              )}
            </button>

            {/* Skip forward */}
            {(isTimefree || (hasLiveBar && isBehindLive)) && (
              <button
                onClick={skipForward}
                className="size-11 sm:size-9 flex items-center justify-center rounded-full border border-[#d9d9d9] bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                aria-label="Forward 10 seconds"
              >
                <SkipForwardIcon className="size-7 sm:size-6" />
              </button>
            )}

            {/* Volume */}
            <VolumeSlider volume={volume} onVolumeChange={setVolume} />
          </div>
        </div>
      </div>
    </div>
  );
}
