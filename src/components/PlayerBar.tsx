'use client';

import { usePlayer } from '@/lib/player-context';
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
    <div className="flex items-center gap-1.5 sm:gap-3 w-full">
      {/* Elapsed time */}
      <span className="text-[11px] font-mono text-gray-400 w-14 text-right flex-shrink-0 select-none tabular-nums">
        {ft ? absoluteTime(ft, displayTime) : formatSeconds(displayTime)}
      </span>

      {/* Track container: tall hit area, thin visible track */}
      <div
        ref={trackRef}
        className="relative flex-1 h-5 flex items-center cursor-pointer touch-none group"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setInteracting(true)}
        onMouseLeave={() => { if (!draggingRef.current) setInteracting(false); }}
      >
        {/* Track background */}
        <div className={`w-full rounded-full bg-gray-600/80 transition-[height] duration-150 ${
          interacting || dragging ? 'h-1.5' : 'h-1'
        }`}>
          {/* Fill */}
          <div
            className="h-full rounded-full transition-[width] duration-100"
            style={{ width: `${displayRatio * 100}%`, backgroundColor: accentColor }}
          />
        </div>

        {/* Thumb */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full transition-[width,height,opacity] duration-150 shadow-sm ${
            interacting || dragging
              ? 'w-3.5 h-3.5 opacity-100'
              : 'w-2.5 h-2.5 opacity-80'
          }`}
          style={{ left: `${displayRatio * 100}%`, backgroundColor: accentColor }}
        />

        {/* Hover/drag tooltip */}
        {(interacting || dragging) && ft && (
          <div
            className="absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none"
            style={{ left: `${tooltipRatio * 100}%` }}
          >
            <div className="bg-gray-800 text-white text-[11px] font-mono px-2 py-0.5 rounded shadow-lg whitespace-nowrap border border-gray-600/50">
              {absoluteTime(ft, tooltipTime)}
            </div>
          </div>
        )}
      </div>

      {/* Total / end time */}
      {hideEndTime ? (
        <span className="w-14 flex-shrink-0" />
      ) : (
        <span className="text-[11px] font-mono text-gray-400 w-14 text-left flex-shrink-0 select-none tabular-nums">
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
        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        aria-label={volume > 0 ? 'Mute' : 'Unmute'}
      >
        {volume === 0 ? (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
          </svg>
        ) : volume < 0.5 ? (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
          </svg>
        ) : (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
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
        <div className="relative w-full h-1 rounded-full bg-gray-600">
          <div
            className={`absolute left-0 top-0 h-full rounded-full transition-colors ${active ? 'bg-white' : 'bg-gray-400'}`}
            style={{ width: pct }}
          />
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
            style={{ left: pct }}
          />
        </div>
      </div>
    </div>
  );
}

// --- Main player bar ---

export default function PlayerBar() {
  const {
    isPlaying,
    isLoading,
    currentInfo,
    volume,
    currentTime,
    duration,
    error,
    isBehindLive,
    liveElapsed,
    pause,
    resume,
    setVolume,
    seek,
    seekLive,
    backToLive,
    skipForward,
    skipBackward,
  } = usePlayer();

  if (!currentInfo && !error) return null;

  const isTimefree = currentInfo?.type === 'timefree';
  const isLive = currentInfo?.type === 'live';
  const hasLiveBar = isLive && !!currentInfo?.ft;

  // Determine bar parameters
  const barCurrentTime = isLive
    ? (isBehindLive ? currentTime : liveElapsed)
    : currentTime;
  const barDuration = isLive ? liveElapsed : duration;
  const barColor = isLive
    ? (isBehindLive ? '#f97316' : '#ef4444') // orange-500 : red-500
    : '#3b82f6'; // blue-500
  const showBar = (isTimefree && duration > 0) || (hasLiveBar && liveElapsed > 0);
  const handleSeek = isLive ? seekLive : seek;

  // Hide end time for live (always growing) and timefree of still-airing programs
  const barHideEndTime = isLive || (isTimefree && isOnAirProgram(currentInfo?.to));

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 text-white shadow-lg">
      {/* Live-only pulse bar when no ft available */}
      {isLive && !hasLiveBar && (
        <div className="h-0.5 bg-red-500 animate-pulse" />
      )}

      <div className="max-w-screen-xl mx-auto px-3 sm:px-4">
        {/* Progress bar row */}
        {showBar && (
          <div className="pt-2">
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
        <div className="flex items-center gap-2 sm:gap-3 py-2 sm:py-2.5">
          {/* Station logo */}
          {currentInfo?.stationLogo && (
            <img
              src={currentInfo.stationLogo}
              alt={currentInfo.stationName}
              className="w-8 h-8 sm:w-10 sm:h-10 rounded object-contain bg-white flex-shrink-0"
            />
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {isLive && !isBehindLive && (
                <span className="text-[10px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded flex-shrink-0">
                  LIVE
                </span>
              )}
              {isLive && isBehindLive && (
                <span className="text-[10px] font-bold bg-orange-500 text-white px-1.5 py-0.5 rounded flex-shrink-0">
                  BEHIND
                </span>
              )}
              {isTimefree && (
                <span className="text-[10px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded flex-shrink-0">
                  TF
                </span>
              )}
              <span className="text-sm font-medium truncate">
                {currentInfo?.title || currentInfo?.stationName || 'Unknown'}
              </span>
            </div>
            <p className="text-xs text-gray-400 truncate">
              {currentInfo?.performer || currentInfo?.stationName}
            </p>
            {error && <p className="text-xs text-red-400 mt-0.5">{error}</p>}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-0.5 sm:gap-1.5 flex-shrink-0">
            {/* Back to Live */}
            {isLive && isBehindLive && (
              <button
                onClick={backToLive}
                className="flex items-center gap-1 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-medium bg-red-600 text-white hover:bg-red-500 active:bg-red-700 transition-colors"
                aria-label="Back to live"
              >
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                Live
              </button>
            )}

            {/* Skip backward */}
            {(isTimefree || hasLiveBar) && (
              <button
                onClick={skipBackward}
                className="w-7 h-7 sm:w-9 sm:h-9 flex items-center justify-center rounded-full text-gray-300 hover:text-white hover:bg-gray-700 active:bg-gray-600 transition-colors"
                aria-label="Back 10 seconds"
              >
                <SkipBackIcon className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
            )}

            {/* Play/Pause */}
            <button
              onClick={isPlaying ? pause : resume}
              disabled={isLoading && !isPlaying}
              className="w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center rounded-full bg-white text-gray-900 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-50 transition-colors"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isLoading ? (
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" />
                </svg>
              ) : isPlaying ? (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Skip forward */}
            {(isTimefree || (hasLiveBar && isBehindLive)) && (
              <button
                onClick={skipForward}
                className="w-7 h-7 sm:w-9 sm:h-9 flex items-center justify-center rounded-full text-gray-300 hover:text-white hover:bg-gray-700 active:bg-gray-600 transition-colors"
                aria-label="Forward 10 seconds"
              >
                <SkipForwardIcon className="w-5 h-5 sm:w-6 sm:h-6" />
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
