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

const TOUCH_DRAG_THRESHOLD = 5;

// Skip backward icon (circular arrow with "10" inside)
function SkipBackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
      <text x="12" y="16" textAnchor="middle" fontSize="7.5" fontWeight="bold" fontFamily="sans-serif">10</text>
    </svg>
  );
}

// Skip forward icon (circular arrow with "10" inside)
function SkipForwardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
      <text x="12" y="16" textAnchor="middle" fontSize="7.5" fontWeight="bold" fontFamily="sans-serif">10</text>
    </svg>
  );
}

// Custom volume slider with fill, hover expand, and drag support
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

  // Mouse drag
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

      {/* Custom track */}
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
          {/* Filled portion */}
          <div
            className={`absolute left-0 top-0 h-full rounded-full transition-colors ${active ? 'bg-white' : 'bg-gray-400'}`}
            style={{ width: pct }}
          />
          {/* Thumb */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
            style={{ left: pct }}
          />
        </div>
      </div>
    </div>
  );
}

export default function PlayerBar() {
  const {
    isPlaying,
    isLoading,
    currentInfo,
    volume,
    currentTime,
    duration,
    error,
    pause,
    resume,
    setVolume,
    seek,
    skipForward,
    skipBackward,
  } = usePlayer();

  const progressRef = useRef<HTMLDivElement>(null);

  // --- Shared drag state (mouse + touch) ---
  const draggingRef = useRef(false);
  const dragTimeRef = useRef(0);
  const dragXRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const [dragX, setDragX] = useState(0);

  // --- Touch-specific refs for YouTube-style relative drag ---
  const touchStartXRef = useRef(0);
  const touchStartTimeRef = useRef(0);
  const touchMovedRef = useRef(false);

  const getTimeFromClientX = useCallback(
    (clientX: number): number | null => {
      const bar = progressRef.current;
      if (!bar || !duration) return null;
      const rect = bar.getBoundingClientRect();
      const x = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  const getClampedX = useCallback((clientX: number): number => {
    const bar = progressRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(clientX - rect.left, rect.width));
  }, []);

  const pxToTimeDelta = useCallback(
    (px: number): number => {
      const bar = progressRef.current;
      if (!bar || !duration) return 0;
      return (px / bar.getBoundingClientRect().width) * duration;
    },
    [duration]
  );

  const updateDragPreview = useCallback((time: number, x: number) => {
    const clamped = Math.max(0, time);
    dragTimeRef.current = clamped;
    dragXRef.current = x;
    setDragTime(clamped);
    setDragX(x);
  }, []);

  // Mouse events (PC)
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const time = getTimeFromClientX(e.clientX);
      if (time !== null) {
        updateDragPreview(time, getClampedX(e.clientX));
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      const time = getTimeFromClientX(e.clientX);
      seek(time ?? dragTimeRef.current);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [getTimeFromClientX, getClampedX, updateDragPreview, seek]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!currentInfo || currentInfo.type === 'live') return;
      const time = getTimeFromClientX(e.clientX);
      if (time === null) return;
      e.preventDefault();
      draggingRef.current = true;
      setDragging(true);
      updateDragPreview(time, getClampedX(e.clientX));
    },
    [currentInfo, getTimeFromClientX, getClampedX, updateDragPreview]
  );

  // Touch events (Mobile)
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!currentInfo || currentInfo.type === 'live') return;
      const touch = e.touches[0];
      if (!touch) return;
      const time = getTimeFromClientX(touch.clientX);
      if (time === null) return;
      touchStartXRef.current = touch.clientX;
      touchStartTimeRef.current = currentTime;
      touchMovedRef.current = false;
      draggingRef.current = true;
      setDragging(true);
      updateDragPreview(time, getClampedX(touch.clientX));
    },
    [currentInfo, currentTime, getTimeFromClientX, getClampedX, updateDragPreview]
  );

  useEffect(() => {
    const bar = progressRef.current;
    if (!bar) return;
    const onTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      e.preventDefault();
      const deltaX = touch.clientX - touchStartXRef.current;
      if (!touchMovedRef.current && Math.abs(deltaX) >= TOUCH_DRAG_THRESHOLD) {
        touchMovedRef.current = true;
      }
      if (touchMovedRef.current) {
        const timeDelta = pxToTimeDelta(deltaX);
        const newTime = Math.max(0, Math.min(touchStartTimeRef.current + timeDelta, duration));
        updateDragPreview(newTime, getClampedX(touch.clientX));
      } else {
        const time = getTimeFromClientX(touch.clientX);
        if (time !== null) updateDragPreview(time, getClampedX(touch.clientX));
      }
    };
    const onTouchEnd = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      seek(dragTimeRef.current);
    };
    bar.addEventListener('touchmove', onTouchMove, { passive: false });
    bar.addEventListener('touchend', onTouchEnd);
    bar.addEventListener('touchcancel', onTouchEnd);
    return () => {
      bar.removeEventListener('touchmove', onTouchMove);
      bar.removeEventListener('touchend', onTouchEnd);
      bar.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [duration, getTimeFromClientX, getClampedX, pxToTimeDelta, updateDragPreview, seek]);

  if (!currentInfo && !error) return null;

  const displayTime = dragging ? dragTime : currentTime;
  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;
  const isTimefree = currentInfo?.type === 'timefree';
  const isLive = currentInfo?.type === 'live';

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 text-white border-t border-gray-700 shadow-lg">
      {/* Progress bar - only for timefree */}
      {isTimefree && duration > 0 && (
        <div
          ref={progressRef}
          className="h-2 bg-gray-700 cursor-pointer group relative touch-none"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        >
          <div
            className="h-full bg-blue-500 transition-[width] duration-150 relative"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          {dragging && (
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full shadow-md pointer-events-none"
              style={{ left: `${dragX}px` }}
            />
          )}
          {dragging && currentInfo?.ft && (
            <div
              className="absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none"
              style={{ left: `${dragX}px` }}
            >
              <div className="bg-gray-800 text-white text-xs font-mono px-2 py-1 rounded shadow-lg whitespace-nowrap border border-gray-600">
                {absoluteTime(currentInfo.ft, dragTime)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live indicator bar */}
      {isLive && (
        <div className="h-1 bg-red-500 animate-pulse" />
      )}

      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 max-w-screen-xl mx-auto">
        {/* Station logo */}
        {currentInfo?.stationLogo && (
          <img
            src={currentInfo.stationLogo}
            alt={currentInfo.stationName}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded object-contain bg-white flex-shrink-0"
          />
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2">
            {isLive && (
              <span className="text-[10px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded flex-shrink-0">
                LIVE
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
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="truncate">
              {currentInfo?.performer || currentInfo?.stationName}
            </span>
            {isTimefree && duration > 0 && (
              <span className="flex-shrink-0 font-mono">
                {formatSeconds(displayTime)} / {formatSeconds(duration)}
              </span>
            )}
          </div>
          {error && <div className="text-xs text-red-400 mt-0.5">{error}</div>}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
          {/* Skip backward 10s (timefree only) */}
          {isTimefree && (
            <button
              onClick={skipBackward}
              className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full text-gray-300 hover:text-white hover:bg-gray-700 active:bg-gray-600 transition-colors"
              aria-label="Back 10 seconds"
            >
              <SkipBackIcon className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}

          {/* Play/Pause */}
          <button
            onClick={isPlaying ? pause : resume}
            disabled={isLoading && !isPlaying}
            className="w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-full bg-white text-gray-900 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-50 transition-colors"
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

          {/* Skip forward 10s (timefree only) */}
          {isTimefree && (
            <button
              onClick={skipForward}
              className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full text-gray-300 hover:text-white hover:bg-gray-700 active:bg-gray-600 transition-colors"
              aria-label="Forward 10 seconds"
            >
              <SkipForwardIcon className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}

          {/* Volume (PC only) */}
          <VolumeSlider volume={volume} onVolumeChange={setVolume} />
        </div>
      </div>
    </div>
  );
}
