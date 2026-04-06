'use client';

import React, { createContext, useContext, useCallback, useRef, useState, useEffect } from 'react';
import Hls from 'hls.js';
import { getVolume, saveVolume as persistVolume, recordStationPlay } from '@/lib/storage';

// Parse YYYYMMDDHHmmss (JST) into a UTC Date
function parseRadikoDate(str: string): Date {
  const y = parseInt(str.substring(0, 4), 10);
  const m = parseInt(str.substring(4, 6), 10) - 1;
  const d = parseInt(str.substring(6, 8), 10);
  const h = parseInt(str.substring(8, 10), 10);
  const min = parseInt(str.substring(10, 12), 10);
  const sec = parseInt(str.substring(12, 14), 10);
  return new Date(Date.UTC(y, m, d, h - 9, min, sec));
}

// Format a UTC Date back to YYYYMMDDHHmmss in JST
function formatDateToRadiko(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const h = String(jst.getUTCHours()).padStart(2, '0');
  const min = String(jst.getUTCMinutes()).padStart(2, '0');
  const sec = String(jst.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${d}${h}${min}${sec}`;
}

export interface PlaybackInfo {
  stationId: string;
  stationName: string;
  stationLogo: string;
  type: 'live' | 'timefree';
  title: string;
  performer: string;
  // For timefree, and also for live (current program boundaries)
  ft?: string;
  to?: string;
  duration?: number; // total duration in seconds
}

interface PlayerContextType {
  isPlaying: boolean;
  isLoading: boolean;
  currentInfo: PlaybackInfo | null;
  volume: number;
  currentTime: number;
  duration: number;
  error: string | null;
  // Live seek-back: when true, we're playing timefree behind the live edge
  isBehindLive: boolean;
  // Live elapsed: seconds since program start (real-time, ticks every second)
  liveElapsed: number;
  playLive: (info: PlaybackInfo) => Promise<void>;
  playTimefree: (info: PlaybackInfo) => Promise<void>;
  pause: () => void;
  resume: () => void;
  setVolume: (v: number) => void;
  seek: (time: number) => void;
  seekLive: (time: number) => void;
  backToLive: () => void;
  skipForward: () => void;
  skipBackward: () => void;
}

const PlayerContext = createContext<PlayerContextType | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be inside PlayerProvider');
  return ctx;
}

const SKIP_SECONDS = 10;

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentInfo, setCurrentInfo] = useState<PlaybackInfo | null>(null);
  const currentInfoRef = useRef<PlaybackInfo | null>(null);
  const [volume, setVolumeState] = useState(() => getVolume());
  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);
  const [duration, setDuration] = useState(0);
  // For timefree: the known fixed duration from program metadata (seconds)
  const knownDurationRef = useRef<number>(0);
  // For timefree seeking: offset in seconds from program start
  const seekOffsetRef = useRef<number>(0);
  // Guard against concurrent seek/resume requests
  const seekIdRef = useRef<number>(0);
  // When paused, store the logical time to resume from (-1 = not paused)
  const pausedAtRef = useRef<number>(-1);
  const [error, setError] = useState<string | null>(null);
  // Live seek-back state: true when playing timefree behind the live edge
  const [isBehindLive, setIsBehindLive] = useState(false);
  const isBehindLiveRef = useRef(false);
  // Live elapsed: seconds since program ft (real-time clock)
  const [liveElapsed, setLiveElapsed] = useState(0);
  const liveElapsedRef = useRef(0);

  // Keep refs in sync with state
  useEffect(() => { currentInfoRef.current = currentInfo; }, [currentInfo]);
  useEffect(() => { isBehindLiveRef.current = isBehindLive; }, [isBehindLive]);
  useEffect(() => { liveElapsedRef.current = liveElapsed; }, [liveElapsed]);

  // Tick liveElapsed every second for live mode
  useEffect(() => {
    if (!currentInfo || currentInfo.type !== 'live' || !currentInfo.ft) return;
    if (isBehindLive) return; // Don't tick when behind live
    const ftDate = parseRadikoDate(currentInfo.ft);
    const tick = () => {
      const elapsed = (Date.now() - ftDate.getTime()) / 1000;
      setLiveElapsed(Math.max(0, elapsed));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [currentInfo, isBehindLive]);

  // Ensure audio element exists
  useEffect(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.volume = volume;
      audioRef.current = audio;
    }

    const audio = audioRef.current;

    const onTimeUpdate = () => {
      // Ignore events after intentional pause (HLS destroyed)
      if (pausedAtRef.current >= 0) return;
      const offset = seekOffsetRef.current;
      const raw = audio.currentTime;
      const t = offset + raw;
      currentTimeRef.current = t;
      setCurrentTime(t);
    };
    const onDurationChange = () => {
      if (knownDurationRef.current > 0) return;
      if (isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    // Guard all state-changing handlers: after intentional pause,
    // hls.destroy() can fire spurious events on the audio element.
    const onPlay = () => {
      if (pausedAtRef.current >= 0) return;
      setIsPlaying(true);
    };
    const onPause = () => {
      if (pausedAtRef.current >= 0) return;
      setIsPlaying(false);
    };
    const onError = () => {
      if (pausedAtRef.current >= 0) return;
      setError('Playback error');
    };
    const onWaiting = () => {
      if (pausedAtRef.current >= 0) return;
      setIsLoading(true);
    };
    const onCanPlay = () => {
      if (pausedAtRef.current >= 0) return;
      setIsLoading(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('canplay', onCanPlay);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, [volume]);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  const updateMediaSession = useCallback((info: PlaybackInfo) => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: info.title || `${info.stationName} Live`,
        artist: info.performer || info.stationName,
        album: info.stationName,
        artwork: info.stationLogo
          ? [{ src: info.stationLogo, sizes: '256x256', type: 'image/png' }]
          : [],
      });
    }
  }, []);

  const loadHlsStream = useCallback(
    async (proxyPlaylistUrl: string, info: PlaybackInfo, seekOffset = 0) => {
      const audio = audioRef.current;
      if (!audio) return;

      destroyHls();
      setError(null);
      setIsLoading(true);
      setCurrentInfo(info);
      setIsBehindLive(false);
      seekOffsetRef.current = seekOffset;
      currentTimeRef.current = seekOffset;
      setCurrentTime(seekOffset);
      pausedAtRef.current = -1;

      if (info.type === 'timefree' && info.duration && info.duration > 0) {
        knownDurationRef.current = info.duration;
        setDuration(info.duration);
      } else {
        knownDurationRef.current = 0;
        setDuration(0);
      }

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          xhrSetup: () => {},
        });
        hlsRef.current = hls;

        hls.loadSource(proxyPlaylistUrl);
        hls.attachMedia(audio);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          audio.play().catch(() => {
            setError('Autoplay blocked. Click play to start.');
            setIsLoading(false);
          });
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setError(`HLS error: ${data.details}`);
            setIsLoading(false);
          }
        });
      } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = proxyPlaylistUrl;
        audio.play().catch(() => {
          setError('Autoplay blocked. Click play to start.');
          setIsLoading(false);
        });
      } else {
        setError('HLS playback is not supported in this browser');
        setIsLoading(false);
      }

      updateMediaSession(info);
    },
    [destroyHls, updateMediaSession]
  );

  // Helper: fetch timefree playlist URL with optional seek
  // Returns { proxyUrl, areaId } where areaId comes from the stream API
  const fetchTimefreeProxyUrl = useCallback(
    async (info: PlaybackInfo, seekTime?: number): Promise<string> => {
      const params = new URLSearchParams({
        stationId: info.stationId,
        ft: info.ft || '',
        to: info.to || '',
      });
      if (seekTime !== undefined && seekTime > 0 && info.ft) {
        const ftDate = parseRadikoDate(info.ft);
        const seekDate = new Date(ftDate.getTime() + seekTime * 1000);
        params.set('seek', formatDateToRadiko(seekDate));
      }
      const res = await fetch(`/api/stream/timefree?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const proxyParams = new URLSearchParams({ url: btoa(data.playlistUrl) });
      if (data.areaId) proxyParams.set('areaId', data.areaId);
      return `/api/stream/proxy?${proxyParams}`;
    },
    []
  );

  // Helper: fetch live playlist URL
  // Returns proxy URL with areaId from the stream API response
  const fetchLiveProxyUrl = useCallback(
    async (info: PlaybackInfo): Promise<string> => {
      const params = new URLSearchParams({ stationId: info.stationId });
      const res = await fetch(`/api/stream/live?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const proxyParams = new URLSearchParams({ url: btoa(data.playlistUrl) });
      if (data.areaId) proxyParams.set('areaId', data.areaId);
      return `/api/stream/proxy?${proxyParams}`;
    },
    []
  );

  const playLive = useCallback(
    async (info: PlaybackInfo) => {
      try {
        recordStationPlay({
          id: info.stationId,
          name: info.stationName,
          logoUrl: info.stationLogo,
        });
        const proxyUrl = await fetchLiveProxyUrl(info);
        await loadHlsStream(proxyUrl, { ...info, type: 'live' });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to start live stream');
        setIsLoading(false);
      }
    },
    [fetchLiveProxyUrl, loadHlsStream]
  );

  const playTimefree = useCallback(
    async (info: PlaybackInfo) => {
      try {
        recordStationPlay({
          id: info.stationId,
          name: info.stationName,
          logoUrl: info.stationLogo,
        });
        const proxyUrl = await fetchTimefreeProxyUrl(info);
        await loadHlsStream(proxyUrl, { ...info, type: 'timefree' });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to start timefree stream');
        setIsLoading(false);
      }
    },
    [fetchTimefreeProxyUrl, loadHlsStream]
  );

  // Pause: destroy HLS to stop all network requests, remember position
  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    pausedAtRef.current = currentTimeRef.current;
    audio.pause();
    destroyHls();
    // Explicitly set state - don't rely solely on audio element events
    // because hls.destroy() can interfere with event ordering
    setIsPlaying(false);
    setIsLoading(false);
  }, [destroyHls]);

  // Resume: re-request the stream from the paused position
  const resume = useCallback(() => {
    const info = currentInfoRef.current;
    if (!info) return;
    const pausedAt = pausedAtRef.current;
    if (pausedAt < 0) {
      // Not paused via our pause(), just try audio.play()
      audioRef.current?.play();
      return;
    }

    const thisSeekId = ++seekIdRef.current;
    setIsLoading(true);
    pausedAtRef.current = -1;

    (async () => {
      try {
        if (info.type === 'live' && isBehindLiveRef.current && info.ft) {
          // Behind live: resume via timefree seek-back
          const toDate = new Date(Date.now());
          const toStr = formatDateToRadiko(toDate);
          const ftDate = parseRadikoDate(info.ft);
          const seekDate = new Date(ftDate.getTime() + pausedAt * 1000);
          const seekStr = formatDateToRadiko(seekDate);
          const params = new URLSearchParams({
            stationId: info.stationId,
            ft: info.ft,
            to: toStr,
            seek: seekStr,
          });
          const res = await fetch(`/api/stream/timefree?${params}`);
          if (seekIdRef.current !== thisSeekId) return;
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          const proxyParams = new URLSearchParams({ url: btoa(data.playlistUrl) });
          if (data.areaId) proxyParams.set('areaId', data.areaId);
          const proxyUrl = `/api/stream/proxy?${proxyParams}`;
          if (seekIdRef.current !== thisSeekId) return;
          await loadHlsStream(proxyUrl, info, pausedAt);
          setIsBehindLive(true);
        } else if (info.type === 'live') {
          const proxyUrl = await fetchLiveProxyUrl(info);
          if (seekIdRef.current !== thisSeekId) return;
          await loadHlsStream(proxyUrl, info);
        } else if (info.type === 'timefree') {
          const proxyUrl = await fetchTimefreeProxyUrl(info, pausedAt);
          if (seekIdRef.current !== thisSeekId) return;
          await loadHlsStream(proxyUrl, info, pausedAt);
        }
      } catch (e) {
        if (seekIdRef.current !== thisSeekId) return;
        setError(e instanceof Error ? e.message : 'Failed to resume');
        setIsLoading(false);
      }
    })();
  }, [fetchLiveProxyUrl, fetchTimefreeProxyUrl, loadHlsStream]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    persistVolume(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  const seek = useCallback(
    (time: number) => {
      const info = currentInfoRef.current;
      if (!info) return;
      if (info.type === 'live') return;

      if (info.type === 'timefree' && info.ft && info.to && info.duration) {
        const clampedTime = Math.max(0, Math.min(time, info.duration));
        const ftDate = parseRadikoDate(info.ft);
        const seekDate = new Date(ftDate.getTime() + clampedTime * 1000);
        const seekStr = formatDateToRadiko(seekDate);
        const thisSeekId = ++seekIdRef.current;

        currentTimeRef.current = clampedTime;
        setCurrentTime(clampedTime);
        setIsLoading(true);
        pausedAtRef.current = -1;

        (async () => {
          try {
            const params = new URLSearchParams({
              stationId: info.stationId,
              ft: info.ft!,
              to: info.to!,
              seek: seekStr,
            });
            const res = await fetch(`/api/stream/timefree?${params}`);
            if (seekIdRef.current !== thisSeekId) return;

            const data = await res.json();
            if (data.error) throw new Error(data.error);

            const proxyParams = new URLSearchParams({ url: btoa(data.playlistUrl) });
            if (data.areaId) proxyParams.set('areaId', data.areaId);
            const proxyUrl = `/api/stream/proxy?${proxyParams}`;
            if (seekIdRef.current !== thisSeekId) return;

            await loadHlsStream(proxyUrl, info, clampedTime);
          } catch (e) {
            if (seekIdRef.current !== thisSeekId) return;
            setError(e instanceof Error ? e.message : 'Seek failed');
            setIsLoading(false);
          }
        })();
        return;
      }

      if (audioRef.current) {
        audioRef.current.currentTime = time;
        setCurrentTime(time);
      }
    },
    [loadHlsStream]
  );

  // Seek within a live program (seek-back via timefree)
  // time = seconds since program ft
  const seekLive = useCallback(
    (time: number) => {
      const info = currentInfoRef.current;
      if (!info || !info.ft) return;
      const ftDate = parseRadikoDate(info.ft);
      const nowElapsed = (Date.now() - ftDate.getTime()) / 1000;
      const clampedTime = Math.max(0, Math.min(time, nowElapsed));

      // If seeking close to the live edge (within 5s), go back to live
      if (clampedTime >= nowElapsed - 5) {
        // Inline back-to-live logic to avoid circular dependency
        setIsBehindLive(false);
        const thisSeekId = ++seekIdRef.current;
        setIsLoading(true);
        (async () => {
          try {
            const proxyUrl = await fetchLiveProxyUrl(info);
            if (seekIdRef.current !== thisSeekId) return;
            await loadHlsStream(proxyUrl, { ...info, type: 'live' });
          } catch (e) {
            if (seekIdRef.current !== thisSeekId) return;
            setError(e instanceof Error ? e.message : 'Failed to resume live');
            setIsLoading(false);
          }
        })();
        return;
      }

      // Build a "to" that is "now" so timefree API works for the current program
      const toDate = new Date(Date.now());
      const toStr = formatDateToRadiko(toDate);
      const thisSeekId = ++seekIdRef.current;

      currentTimeRef.current = clampedTime;
      setCurrentTime(clampedTime);
      setIsLoading(true);
      setIsBehindLive(true);
      pausedAtRef.current = -1;

      (async () => {
        try {
          const seekDate = new Date(ftDate.getTime() + clampedTime * 1000);
          const seekStr = formatDateToRadiko(seekDate);
          const params = new URLSearchParams({
            stationId: info.stationId,
            ft: info.ft!,
            to: toStr,
            seek: seekStr,
          });
          const res = await fetch(`/api/stream/timefree?${params}`);
          if (seekIdRef.current !== thisSeekId) return;

          const data = await res.json();
          if (data.error) throw new Error(data.error);

          const proxyParams = new URLSearchParams({ url: btoa(data.playlistUrl) });
          if (data.areaId) proxyParams.set('areaId', data.areaId);
          const proxyUrl = `/api/stream/proxy?${proxyParams}`;
          if (seekIdRef.current !== thisSeekId) return;

          // Load as the original live info (keep type=live), but set seekOffset
          const liveInfo = { ...info, type: 'live' as const };
          await loadHlsStream(proxyUrl, liveInfo, clampedTime);
          // Re-set isBehindLive after loadHlsStream (which resets it to false)
          setIsBehindLive(true);
        } catch (e) {
          if (seekIdRef.current !== thisSeekId) return;
          setError(e instanceof Error ? e.message : 'Seek failed');
          setIsLoading(false);
        }
      })();
    },
    [fetchLiveProxyUrl, loadHlsStream]
  );

  // Back to live edge: re-request the live stream
  const backToLive = useCallback(() => {
    const info = currentInfoRef.current;
    if (!info) return;
    setIsBehindLive(false);
    const thisSeekId = ++seekIdRef.current;
    setIsLoading(true);

    (async () => {
      try {
        const proxyUrl = await fetchLiveProxyUrl(info);
        if (seekIdRef.current !== thisSeekId) return;
        await loadHlsStream(proxyUrl, { ...info, type: 'live' });
      } catch (e) {
        if (seekIdRef.current !== thisSeekId) return;
        setError(e instanceof Error ? e.message : 'Failed to resume live');
        setIsLoading(false);
      }
    })();
  }, [fetchLiveProxyUrl, loadHlsStream]);

  const skipForward = useCallback(() => {
    const info = currentInfoRef.current;
    if (!info) return;
    if (info.type === 'live' && !isBehindLiveRef.current) return;
    if (info.type === 'live' && isBehindLiveRef.current) {
      seekLive(currentTimeRef.current + SKIP_SECONDS);
      return;
    }
    seek(currentTimeRef.current + SKIP_SECONDS);
  }, [seek, seekLive]);

  const skipBackward = useCallback(() => {
    const info = currentInfoRef.current;
    if (!info) return;
    if (info.type === 'live') {
      // When not behind live, currentTimeRef is the HLS audio.currentTime (small number),
      // not the offset from program start. Use liveElapsedRef instead.
      const pos = isBehindLiveRef.current ? currentTimeRef.current : liveElapsedRef.current;
      seekLive(pos - SKIP_SECONDS);
      return;
    }
    seek(currentTimeRef.current - SKIP_SECONDS);
  }, [seek, seekLive]);

  // Media Session handlers
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => resume());
    navigator.mediaSession.setActionHandler('pause', () => pause());
    navigator.mediaSession.setActionHandler('seekforward', () => skipForward());
    navigator.mediaSession.setActionHandler('seekbackward', () => skipBackward());
    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
      navigator.mediaSession.setActionHandler('seekbackward', null);
    };
  }, [resume, pause, skipForward, skipBackward]);

  return (
    <PlayerContext.Provider
      value={{
        isPlaying,
        isLoading,
        currentInfo,
        volume,
        currentTime,
        duration,
        error,
        isBehindLive,
        liveElapsed,
        playLive,
        playTimefree,
        pause,
        resume,
        setVolume,
        seek,
        seekLive,
        backToLive,
        skipForward,
        skipBackward,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}
