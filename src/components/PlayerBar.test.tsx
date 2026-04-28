import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PlayerBar from './PlayerBar';

type MockPlayerState = {
  isPlaying: boolean;
  isLoading: boolean;
  currentInfo: {
    stationId: string;
    stationName: string;
    stationLogo?: string;
    artworkUrl?: string;
    type: 'live' | 'timefree';
    title?: string;
    performer?: string;
    ft?: string;
    to?: string;
  } | null;
  volume: number;
  duration: number;
  error: string | null;
  isBehindLive: boolean;
};

const { mockPush, mockSeekLive, mockPlayerState, mockPlayerTime } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockSeekLive: vi.fn(),
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
    liveSeekableUntil: 0,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/player-context', () => ({
  usePlayer: () => ({
    ...mockPlayerState,
    pause: vi.fn(),
    resume: vi.fn(),
    setVolume: vi.fn(),
    seek: vi.fn(),
    seekLive: mockSeekLive,
    backToLive: vi.fn(),
    skipForward: vi.fn(),
    skipBackward: vi.fn(),
  }),
  usePlayerTime: () => mockPlayerTime,
}));

describe('PlayerBar', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockSeekLive.mockClear();
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
      liveSeekableUntil: 0,
    });
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--player-bar-h');
  });

  it('keeps hook order stable when the player appears after initial empty state', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<PlayerBar />);

    expect(screen.queryByLabelText('Open current program')).not.toBeInTheDocument();

    Object.assign(mockPlayerState, {
      currentInfo: {
        stationId: 'YFM',
        stationName: 'YFM',
        stationLogo: 'https://example.com/yfm.png',
        type: 'timefree',
        title: 'Archived Program',
        performer: 'Host',
        ft: '20260428090000',
        to: '20260428110000',
      },
      duration: 7200,
    });
    Object.assign(mockPlayerTime, { currentTime: 4859 });

    rerender(<PlayerBar />);

    expect(screen.getByLabelText('Open current program')).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('React has detected a change in the order of Hooks'),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );

    consoleError.mockRestore();
  });

  it('opens the current timefree program from the info area', () => {
    Object.assign(mockPlayerState, {
      currentInfo: {
        stationId: 'YFM',
        stationName: 'YFM',
        stationLogo: 'https://example.com/yfm.png',
        type: 'timefree',
        title: 'Archived Program',
        performer: 'Host',
        ft: '20260428090000',
        to: '20260428110000',
      },
      duration: 7200,
    });
    Object.assign(mockPlayerTime, { currentTime: 4859 });

    render(<PlayerBar />);
    fireEvent.click(screen.getByLabelText('Open current program'));

    expect(mockPush).toHaveBeenCalledWith('/station/YFM?ft=20260428090000&t=4859', { scroll: false });
  });

  it('uses the scheduled live program duration for behind-live seek range', () => {
    Object.assign(mockPlayerState, {
      currentInfo: {
        stationId: 'YFM',
        stationName: 'YFM',
        stationLogo: 'https://example.com/yfm.png',
        type: 'live',
        title: 'Live Program',
        performer: 'Host',
        ft: '20260428150000',
        to: '20260428170000',
      },
      isBehindLive: true,
    });
    Object.assign(mockPlayerTime, {
      currentTime: 0,
      liveElapsed: 40,
      liveSeekableUntil: 3600,
    });

    render(<PlayerBar />);
    const seekBar = screen.getByLabelText('Seek playback');
    seekBar.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 20,
      right: 100,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.mouseDown(seekBar, { clientX: 50 });
    fireEvent.mouseUp(window, { clientX: 50 });

    expect(mockSeekLive).toHaveBeenCalledWith(1800);
  });

  it('keeps normal live seek range based on live elapsed time', () => {
    Object.assign(mockPlayerState, {
      currentInfo: {
        stationId: 'YFM',
        stationName: 'YFM',
        stationLogo: 'https://example.com/yfm.png',
        type: 'live',
        title: 'Live Program',
        performer: 'Host',
        ft: '20260428150000',
        to: '20260428170000',
      },
      isBehindLive: false,
    });
    Object.assign(mockPlayerTime, {
      currentTime: 0,
      liveElapsed: 40,
    });

    render(<PlayerBar />);
    const seekBar = screen.getByLabelText('Seek playback');
    seekBar.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 20,
      right: 100,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.mouseDown(seekBar, { clientX: 50 });
    fireEvent.mouseUp(window, { clientX: 50 });

    expect(mockSeekLive).toHaveBeenCalledWith(20);
  });
});
