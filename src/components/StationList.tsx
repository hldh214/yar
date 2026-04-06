'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { usePlayer } from '@/lib/player-context';
import {
  getFrequentStations,
  getStationPlayCounts,
  getLastRegion,
  saveLastRegion,
  type StationRecord,
} from '@/lib/storage';

interface Station {
  id: string;
  name: string;
  asciiName: string;
  href: string;
  logoUrl: string;
}

interface Region {
  regionId: string;
  regionName: string;
  stations: Station[];
}

export default function StationList() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRegion, setExpandedRegion] = useState<string | null>(null);
  const [frequentStations, setFrequentStations] = useState<StationRecord[]>([]);
  const { playLive, pause, currentInfo, isPlaying } = usePlayer();

  // Load frequent stations from localStorage on mount
  useEffect(() => {
    setFrequentStations(getFrequentStations(8));
  }, []);

  // Sort regions: regions containing frequently-played stations come first
  const sortedRegions = useMemo(() => {
    if (regions.length === 0) return [];
    const playCounts = getStationPlayCounts();
    if (playCounts.size === 0) return regions;

    // For each region, compute total play count of its stations
    const regionScores = regions.map((region) => {
      let score = 0;
      for (const station of region.stations) {
        score += playCounts.get(station.id) || 0;
      }
      return { region, score };
    });

    // Stable sort: regions with plays first (by score desc), then original order
    regionScores.sort((a, b) => b.score - a.score);
    return regionScores.map((r) => r.region);
  }, [regions]);

  useEffect(() => {
    fetch('/api/stations')
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRegions(data.regions);

        // Auto-expand: last used region, or the first region with played stations, or first region
        const lastRegion = getLastRegion();
        const playCounts = getStationPlayCounts();

        if (lastRegion && data.regions.some((r: Region) => r.regionId === lastRegion)) {
          setExpandedRegion(lastRegion);
        } else if (playCounts.size > 0) {
          // Find region with most plays
          let bestRegion = data.regions[0]?.regionId || null;
          let bestScore = 0;
          for (const region of data.regions) {
            let score = 0;
            for (const station of region.stations) {
              score += playCounts.get(station.id) || 0;
            }
            if (score > bestScore) {
              bestScore = score;
              bestRegion = region.regionId;
            }
          }
          setExpandedRegion(bestRegion);
        } else if (data.regions.length > 0) {
          setExpandedRegion(data.regions[0].regionId);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handlePlayLive = useCallback(
    async (station: Station | StationRecord) => {
      // Fetch current on-air program to get ft/to for progress bar & seek
      let title = `${station.name} Live`;
      let performer = station.name;
      let ft: string | undefined;
      let to: string | undefined;
      try {
        const res = await fetch(`/api/programs?stationId=${station.id}`);
        const data = await res.json();
        if (data.programs) {
          const onAir = data.programs.find((p: { isOnAir: boolean }) => p.isOnAir);
          if (onAir) {
            title = onAir.title || title;
            performer = onAir.performer || performer;
            ft = onAir.startTime;
            to = onAir.endTime;
          }
        }
      } catch {
        // Proceed without ft/to — player still works, just no progress bar
      }
      playLive({
        stationId: station.id,
        stationName: station.name,
        stationLogo: station.logoUrl,
        type: 'live',
        title,
        performer,
        ft,
        to,
      });
    },
    [playLive]
  );

  const handleTogglePlay = useCallback(
    (station: Station | StationRecord) => {
      const isCurrentLive =
        currentInfo?.stationId === station.id &&
        currentInfo?.type === 'live' &&
        isPlaying;
      if (isCurrentLive) {
        pause();
      } else {
        handlePlayLive(station);
      }
    },
    [currentInfo, isPlaying, pause, handlePlayLive]
  );

  const toggleRegion = useCallback((regionId: string) => {
    setExpandedRegion((prev) => {
      const next = prev === regionId ? null : regionId;
      if (next) saveLastRegion(next);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-2">Failed to load stations</p>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    );
  }

  const totalStations = regions.reduce((sum, r) => sum + r.stations.length, 0);

  return (
    <div>
      {/* Frequent stations */}
      {frequentStations.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-bold mb-3">Recent Stations</h2>
          <div className="flex gap-2.5 overflow-x-auto scrollbar-none pb-1">
            {frequentStations.map((station) => {
              const isCurrentLive =
                currentInfo?.stationId === station.id &&
                currentInfo?.type === 'live' &&
                isPlaying;

              return (
                <Link
                  key={station.id}
                  href={`/station/${station.id}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl flex-shrink-0 transition-colors border ${
                    isCurrentLive
                      ? 'border-red-400 bg-red-50 dark:bg-red-950/20 dark:border-red-800'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <img
                    src={station.logoUrl}
                    alt={station.name}
                    className="w-10 h-10 rounded-lg object-contain bg-white flex-shrink-0"
                  />
                  <div className="flex flex-col min-w-0 max-w-24">
                    <span className="text-xs font-semibold truncate">{station.name}</span>
                    {isCurrentLive ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-500">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                        ON AIR
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                        {station.asciiName || station.name}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleTogglePlay(station); }}
                    className={`w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0 transition-colors ${
                      isCurrentLive
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-500 hover:text-white'
                    }`}
                    aria-label={isCurrentLive ? `Pause ${station.name}` : `Play ${station.name} live`}
                  >
                    {isCurrentLive ? (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* All stations header */}
      <div className="mb-4">
        <h2 className="text-lg font-bold">All Stations</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {regions.length} regions · {totalStations} stations
        </p>
      </div>

      {/* Region list */}
      <div className="space-y-2">
        {sortedRegions.map((region) => {
          const isExpanded = expandedRegion === region.regionId;

          return (
            <div
              key={region.regionId}
              className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
            >
              {/* Region header (collapsible) */}
              <button
                onClick={() => toggleRegion(region.regionId)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{region.regionName}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                    {region.stations.length}
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                </svg>
              </button>

              {/* Station grid */}
              {isExpanded && (
                <div className="border-t border-gray-200 dark:border-gray-700 p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {region.stations.map((station) => {
                      const isCurrentLive =
                        currentInfo?.stationId === station.id &&
                        currentInfo?.type === 'live' &&
                        isPlaying;

                      return (
                        <div
                          key={station.id}
                          className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                            isCurrentLive
                              ? 'border border-red-500 bg-red-50 dark:bg-red-950/30'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                          }`}
                        >
                          <img
                            src={station.logoUrl}
                            alt={station.name}
                            className="w-12 h-12 rounded-lg object-contain bg-white flex-shrink-0 border border-gray-100 dark:border-gray-700"
                          />

                          <div className="flex-1 min-w-0">
                            <Link
                              href={`/station/${station.id}`}
                              className="text-sm font-semibold hover:underline truncate block"
                            >
                              {station.name}
                            </Link>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {station.asciiName}
                            </p>
                            {isCurrentLive && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 mt-0.5">
                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                                ON AIR
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => handleTogglePlay(station)}
                            className={`w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0 transition-colors ${
                              isCurrentLive
                                ? 'bg-red-500 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-500 hover:text-white'
                            }`}
                            aria-label={isCurrentLive ? `Pause ${station.name}` : `Play ${station.name} live`}
                            title={isCurrentLive ? 'Pause' : 'Play live'}
                          >
                            {isCurrentLive ? (
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="4" width="4" height="16" rx="1" />
                                <rect x="14" y="4" width="4" height="16" rx="1" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
