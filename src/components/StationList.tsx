'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePlayer } from '@/lib/player-context';

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
  const { playLive, currentInfo, isPlaying } = usePlayer();

  useEffect(() => {
    fetch('/api/stations')
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRegions(data.regions);
        // Auto-expand first region
        if (data.regions.length > 0) {
          setExpandedRegion(data.regions[0].regionId);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handlePlayLive = useCallback(
    (station: Station) => {
      playLive({
        stationId: station.id,
        stationName: station.name,
        stationLogo: station.logoUrl,
        type: 'live',
        title: `${station.name} Live`,
        performer: station.name,
      });
    },
    [playLive]
  );

  const toggleRegion = useCallback((regionId: string) => {
    setExpandedRegion((prev) => (prev === regionId ? null : regionId));
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
      <div className="mb-6">
        <h2 className="text-xl font-bold">Stations</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {regions.length} regions - {totalStations} stations
        </p>
      </div>

      <div className="space-y-2">
        {regions.map((region) => {
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
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {region.regionId}
                  </span>
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
                            onClick={() => handlePlayLive(station)}
                            className={`w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0 transition-colors ${
                              isCurrentLive
                                ? 'bg-red-500 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-500 hover:text-white'
                            }`}
                            aria-label={`Play ${station.name} live`}
                            title="Play live"
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
