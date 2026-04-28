import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerProvider, usePlayer } from './player-context';

const { mockAudioPlay, mockAudioPause, mockHlsInstances } = vi.hoisted(() => ({
  mockAudioPlay: vi.fn(() => Promise.resolve()),
  mockAudioPause: vi.fn(),
  mockHlsInstances: [] as Array<{
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('hls.js', () => {
  class HlsMock {
    static Events = {
      MANIFEST_PARSED: 'manifestParsed',
      ERROR: 'error',
      FRAG_LOADED: 'fragLoaded',
      FRAG_CHANGED: 'fragChanged',
    };

    static ErrorTypes = {
      MEDIA_ERROR: 'mediaError',
      NETWORK_ERROR: 'networkError',
    };

    static isSupported() {
      return true;
    }

    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    recoverMediaError = vi.fn();
    on = vi.fn((event: string, callback: () => void) => {
      if (event === HlsMock.Events.MANIFEST_PARSED) {
        queueMicrotask(callback);
      }
    });

    constructor() {
      mockHlsInstances.push(this);
    }
  }

  return { default: HlsMock };
});

type PlayerApi = ReturnType<typeof usePlayer>;

function PlayerProbe({ onReady }: { onReady: (api: PlayerApi) => void }) {
  const player = usePlayer();

  onReady(player);

  return (
    <div>
      <div data-testid="type">{player.currentInfo?.type ?? 'none'}</div>
      <div data-testid="playing">{String(player.isPlaying)}</div>
      <div data-testid="loading">{String(player.isLoading)}</div>
      <div data-testid="error">{player.error ?? ''}</div>
    </div>
  );
}

const liveInfo = {
  stationId: 'YFM',
  stationName: 'YFM',
  stationLogo: 'https://example.com/yfm.png',
  type: 'live' as const,
  title: 'Live Show',
  performer: 'Host',
  ft: '20260428120000',
  to: '20260428140000',
};

const timefreeInfo = {
  stationId: 'YFM',
  stationName: 'YFM',
  stationLogo: 'https://example.com/yfm.png',
  type: 'timefree' as const,
  title: 'Archived Show',
  performer: 'Host',
  ft: '20260427090000',
  to: '20260427110000',
  duration: 7200,
};

const expiredInfo = {
  ...timefreeInfo,
  title: 'Expired Show',
  ft: '20260419090000',
  to: '20260419110000',
};

function renderPlayer() {
  let api: PlayerApi | null = null;
  render(
    <PlayerProvider>
      <PlayerProbe onReady={(next) => { api = next; }} />
    </PlayerProvider>
  );

  return {
    get api() {
      if (!api) throw new Error('Player API not ready');
      return api;
    },
  };
}

describe('PlayerProvider streaming behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-04-28T04:00:00Z'));
    mockAudioPlay.mockClear();
    mockAudioPause.mockClear();
    mockHlsInstances.length = 0;
    localStorage.clear();

    class AudioMock extends EventTarget {
      volume = 1;
      currentTime = 0;
      duration = 0;
      src = '';
      play = mockAudioPlay;
      pause = mockAudioPause;
      canPlayType = () => '';
      removeAttribute = vi.fn();
      load = vi.fn();
    }

    global.Audio = AudioMock as unknown as typeof Audio;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/stream/live')) {
        return { status: 200, json: async () => ({ proxyUrl: 'https://example.com/live.m3u8' }) } as Response;
      }
      if (url.startsWith('/api/stream/timefree')) {
        return { status: 200, json: async () => ({ proxyUrl: 'https://example.com/timefree.m3u8' }) } as Response;
      }
      if (url.startsWith('/api/programs')) {
        return { status: 200, json: async () => ({ programs: [] }) } as Response;
      }
      return { status: 404, json: async () => ({ error: 'not found' }) } as Response;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads a live HLS stream and starts audio playback', async () => {
    const player = renderPlayer();

    await act(async () => {
      await player.api.playLive(liveInfo);
    });

    expect(fetch).toHaveBeenCalledWith('/api/stream/live?stationId=YFM', undefined);
    expect(mockHlsInstances[0].loadSource).toHaveBeenCalledWith('https://example.com/live.m3u8');
    await waitFor(() => expect(mockAudioPlay).toHaveBeenCalled());
    expect(screen.getByTestId('type')).toHaveTextContent('live');
  });

  it('loads a timefree HLS stream with seek and starts audio playback', async () => {
    const player = renderPlayer();

    await act(async () => {
      await player.api.playTimefree(timefreeInfo, 4859);
    });

    const requestedUrl = vi.mocked(fetch).mock.calls[0][0].toString();
    expect(requestedUrl).toContain('/api/stream/timefree?');
    expect(requestedUrl).toContain('stationId=YFM');
    expect(requestedUrl).toContain('ft=20260427090000');
    expect(requestedUrl).toContain('to=20260427110000');
    expect(requestedUrl).toContain('seek=20260427102059');
    expect(mockHlsInstances[0].loadSource).toHaveBeenCalledWith('https://example.com/timefree.m3u8');
    await waitFor(() => expect(mockAudioPlay).toHaveBeenCalled());
    expect(screen.getByTestId('type')).toHaveTextContent('timefree');
  });

  it('can prepare a timefree stream without autoplay', async () => {
    const player = renderPlayer();

    await act(async () => {
      await player.api.playTimefree(timefreeInfo, 4859, false);
    });

    expect(fetch).toHaveBeenCalled();
    expect(mockHlsInstances[0].loadSource).toHaveBeenCalledWith('https://example.com/timefree.m3u8');
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(mockAudioPlay).not.toHaveBeenCalled();
    expect(screen.getByTestId('type')).toHaveTextContent('timefree');
  });

  it('rejects expired timefree playback before requesting the stream API', async () => {
    const player = renderPlayer();

    await act(async () => {
      await player.api.playTimefree(expiredInfo, 0);
    });

    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/stream/timefree'), undefined);
    expect(mockHlsInstances).toHaveLength(0);
    expect(mockAudioPlay).not.toHaveBeenCalled();
    expect(screen.getByTestId('error')).toHaveTextContent('Timefree playback is only available for programs from the last 7 days.');
  });

  it('seeks behind live through timefree when target is before the live edge', async () => {
    const player = renderPlayer();

    await act(async () => {
      await player.api.playLive(liveInfo);
    });
    vi.mocked(fetch).mockClear();

    act(() => {
      player.api.seekLive(1200);
    });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const requestedUrl = vi.mocked(fetch).mock.calls[0][0].toString();
    expect(requestedUrl).toContain('/api/stream/timefree?');
    expect(requestedUrl).toContain('stationId=YFM');
    expect(requestedUrl).toContain('ft=20260428120000');
    expect(requestedUrl).toContain('seek=20260428122000');
  });

  it('returns to live when live seek target is past the current live edge', async () => {
    const player = renderPlayer();

    await act(async () => {
      await player.api.playLive(liveInfo);
    });
    vi.mocked(fetch).mockClear();

    act(() => {
      player.api.seekLive(4000);
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/stream/live?stationId=YFM', undefined));
  });

  it('keeps behind-live seek bounds anchored to the live edge after seeking to the program start', async () => {
    const player = renderPlayer();

    await act(async () => {
      await player.api.playLive(liveInfo);
    });
    vi.mocked(fetch).mockClear();

    act(() => {
      player.api.seekLive(0);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/stream/timefree?'), undefined));
    vi.mocked(fetch).mockClear();

    act(() => {
      player.api.seekLive(1200);
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/stream/timefree?'), undefined));
    expect(fetch).not.toHaveBeenCalledWith('/api/stream/live?stationId=YFM', undefined);
  });
});
