import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProgramSchedule from './ProgramSchedule';

type MockPlaybackInfo = {
  stationId: string;
  stationName: string;
  stationLogo?: string;
  artworkUrl?: string;
  type: 'live' | 'timefree';
  title?: string;
  performer?: string;
  ft?: string;
  to?: string;
  duration?: number;
};

type MockPlayerState = {
  isPlaying: boolean;
  isLoading: boolean;
  currentInfo: MockPlaybackInfo | null;
  volume: number;
  duration: number;
  error: string | null;
  isBehindLive: boolean;
};

const { mockSearchParams, mockPlayerState, mockPlayerTime, mockPlayLive, mockPlayTimefree, mockSeekLive } = vi.hoisted(() => ({
  mockSearchParams: new URLSearchParams(),
  mockPlayerState: {
    isPlaying: false,
    isLoading: false,
    currentInfo: null,
    volume: 1,
    duration: 0,
    error: null,
    isBehindLive: false,
  } as MockPlayerState,
  mockPlayerTime: {
    currentTime: 0,
    liveElapsed: 0,
  },
  mockPlayLive: vi.fn(),
  mockPlayTimefree: vi.fn(),
  mockSeekLive: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/lib/player-context', () => ({
  usePlayer: () => ({
    ...mockPlayerState,
    playLive: mockPlayLive,
    playTimefree: mockPlayTimefree,
    seekLive: mockSeekLive,
  }),
  usePlayerTime: () => mockPlayerTime,
}));

function program(overrides: Partial<{
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
}>) {
  const startTime = overrides.startTime ?? liveFt;
  return {
    id: `YFM_${startTime}`,
    stationId: 'YFM',
    title: 'Program',
    subtitle: '',
    performer: 'Host',
    description: '',
    info: '',
    url: '',
    imageUrl: '',
    endTime: overrides.endTime ?? liveTo,
    duration: 7200,
    isOnAir: false,
    isTimefree: false,
    ...overrides,
    startTime,
  };
}

const station = {
  id: 'YFM',
  name: 'YFM',
  asciiName: 'YFM',
  href: '',
  logoUrl: 'https://example.com/yfm.png',
};

const TEST_NOW = new Date('2026-04-28T04:00:00Z');

function formatRadikoJst(date: Date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}${String(jst.getUTCHours()).padStart(2, '0')}${String(jst.getUTCMinutes()).padStart(2, '0')}${String(jst.getUTCSeconds()).padStart(2, '0')}`;
}

function atJstHour(daysFromNow: number, hour: number) {
  const date = new Date(TEST_NOW.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  jst.setUTCHours(hour, 0, 0, 0);
  return new Date(jst.getTime() - 9 * 60 * 60 * 1000);
}

const liveFt = formatRadikoJst(atJstHour(0, 12));
const liveTo = formatRadikoJst(atJstHour(0, 14));
const archivedFt = formatRadikoJst(atJstHour(-1, 9));
const archivedTo = formatRadikoJst(atJstHour(-1, 11));
const archivedDate = archivedFt.substring(0, 8);
const expiredFt = formatRadikoJst(atJstHour(-8, 9));
const expiredTo = formatRadikoJst(atJstHour(-8, 11));
const expiredDate = expiredFt.substring(0, 8);

const todayData = {
  station,
  programs: [
    program({
      title: 'Live Show',
      startTime: liveFt,
      endTime: liveTo,
      isOnAir: true,
    }),
  ],
};

const previousData = {
  station,
  programs: [
    program({
      title: 'Archived Show',
      startTime: archivedFt,
      endTime: archivedTo,
      isTimefree: true,
    }),
  ],
};

const expiredData = {
  station,
  programs: [
    program({
      title: 'Expired Show',
      startTime: expiredFt,
      endTime: expiredTo,
      isTimefree: false,
    }),
  ],
};

function mockProgramsFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/noa')) {
      return { json: async () => ({}) } as Response;
    }

    const requestUrl = new URL(url, 'http://localhost');
    const date = requestUrl.searchParams.get('date');
    return {
      json: async () => (date === archivedDate ? previousData : date === expiredDate ? expiredData : todayData),
    } as Response;
  });
}

describe('ProgramSchedule playback navigation state', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(TEST_NOW);
    mockSearchParams.delete('ft');
    mockSearchParams.delete('t');
    Object.assign(mockPlayerState, {
      isPlaying: false,
      isLoading: false,
      currentInfo: null,
      volume: 1,
      duration: 0,
      error: null,
      isBehindLive: false,
    });
    Object.assign(mockPlayerTime, {
      currentTime: 0,
      liveElapsed: 0,
    });
    mockPlayLive.mockClear();
    mockPlayTimefree.mockClear();
    mockSeekLive.mockClear();
    mockProgramsFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('selects the currently playing timefree program when entering the station page', async () => {
    Object.assign(mockPlayerState, {
      isPlaying: true,
      currentInfo: {
        stationId: 'YFM',
        stationName: 'YFM',
        type: 'timefree',
        title: 'Archived Show',
        performer: 'Host',
        ft: archivedFt,
        to: archivedTo,
        duration: 7200,
      },
    });

    render(<ProgramSchedule stationId="YFM" />);

    expect(await screen.findByRole('heading', { name: 'Archived Show' })).toBeInTheDocument();
    expect(screen.queryByText('Select a program from the schedule')).not.toBeInTheDocument();
  });

  it('does not force the user back to the playback date after manual date selection', async () => {
    Object.assign(mockPlayerState, {
      isPlaying: true,
      currentInfo: {
        stationId: 'YFM',
        stationName: 'YFM',
        type: 'timefree',
        title: 'Archived Show',
        performer: 'Host',
        ft: archivedFt,
        to: archivedTo,
        duration: 7200,
      },
    });

    render(<ProgramSchedule stationId="YFM" />);

    expect(await screen.findByRole('heading', { name: 'Archived Show' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    expect(await screen.findByRole('heading', { name: 'Live Show' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Archived Show' })).not.toBeInTheDocument());
  });

  it('prepares a deep-linked timefree player without autoplay', async () => {
    mockSearchParams.set('ft', archivedFt);
    mockSearchParams.set('t', '4859');

    render(<ProgramSchedule stationId="YFM" />);

    expect(await screen.findByRole('heading', { name: 'Archived Show' })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockPlayTimefree).toHaveBeenCalledWith(
        expect.objectContaining({ stationId: 'YFM', title: 'Archived Show', ft: archivedFt }),
        4859,
        false
      );
    });
  });

  it('does not restart playback when the deep link matches the current timefree stream', async () => {
    mockSearchParams.set('ft', archivedFt);
    mockSearchParams.set('t', '4859');
    Object.assign(mockPlayerState, {
      isPlaying: true,
      currentInfo: {
        stationId: 'YFM',
        stationName: 'YFM',
        type: 'timefree',
        title: 'Archived Show',
        performer: 'Host',
        ft: archivedFt,
        to: archivedTo,
        duration: 7200,
      },
    });

    render(<ProgramSchedule stationId="YFM" />);

    expect(await screen.findByRole('heading', { name: 'Archived Show' })).toBeInTheDocument();
    await waitFor(() => expect(mockPlayTimefree).not.toHaveBeenCalled());
  });

  it('shows an expiry notice and does not prepare playback for an old deep link', async () => {
    mockSearchParams.set('ft', expiredFt);
    mockSearchParams.set('t', '60');

    render(<ProgramSchedule stationId="YFM" />);

    expect(await screen.findByRole('heading', { name: 'Expired Show' })).toBeInTheDocument();
    expect(await screen.findByText('Timefree playback is only available for programs from the last 7 days.')).toBeInTheDocument();
    expect(mockPlayTimefree).not.toHaveBeenCalled();
  });

  it('keeps current live deep-link offsets for live seek-back instead of treating them as expired', async () => {
    mockSearchParams.set('ft', liveFt);
    mockSearchParams.set('t', '1200');

    render(<ProgramSchedule stationId="YFM" />);

    expect(await screen.findByRole('heading', { name: 'Live Show' })).toBeInTheDocument();
    expect(screen.queryByText('Timefree playback is only available for programs from the last 7 days.')).not.toBeInTheDocument();
    expect(mockPlayTimefree).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Live' }));

    expect(mockPlayLive).toHaveBeenCalledWith(expect.objectContaining({ stationId: 'YFM', title: 'Live Show', ft: liveFt }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockSeekLive).toHaveBeenCalledWith(1200);
  });
});
