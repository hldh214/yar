// GET /api/noa?stationId=YFM
// GET /api/noa?stationId=YFM&ft=20260401120000&to=20260401150000
//
// Returns now-on-air song list using radiko Music API:
//   - Live (no ft/to): /music/api/v1/noas/{stationId}/latest?size=20
//   - Timefree (with ft/to): /music/api/v1/noas/{stationId}?start_time_gte=...&end_time_lt=...
import { NextRequest } from "next/server";

export interface NoaItem {
  title: string;
  artist: string;
  stamp: string; // ISO 8601 JST e.g. "2026-04-01T12:00:28+09:00"
  img: string;
  imgLarge: string;
  amazon: string;
  itunes: string;
  recochoku: string;
  id: string;
}

// Convert radiko YYYYMMDDHHmmss to ISO 8601 JST string
function radikoToISO(ft: string): string {
  const y = ft.substring(0, 4);
  const mo = ft.substring(4, 6);
  const d = ft.substring(6, 8);
  const h = ft.substring(8, 10);
  const min = ft.substring(10, 12);
  const sec = ft.substring(12, 14);
  return `${y}-${mo}-${d}T${h}:${min}:${sec}+09:00`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapItems(data: any[]): NoaItem[] {
  return data.map((item: any) => ({
    title: item.title || "",
    artist: item.artist_name || item.artist?.name || "",
    stamp: item.displayed_start_time || "",
    img: item.music?.image?.medium || "",
    imgLarge: item.music?.image?.large || "",
    amazon: item.music?.shops?.amazon || "",
    itunes: item.music?.shops?.itunes || "",
    recochoku: item.music?.shops?.recochoku || "",
    id: item.id || "",
  }));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const stationId = searchParams.get("stationId");
    const ft = searchParams.get("ft");
    const to = searchParams.get("to");

    if (!stationId) {
      return Response.json(
        { error: "stationId is required" },
        { status: 400 }
      );
    }

    let url: string;
    if (ft && to) {
      // Timefree mode: fetch songs within the program's time range
      const gte = encodeURIComponent(radikoToISO(ft));
      const lt = encodeURIComponent(radikoToISO(to));
      url = `https://api.radiko.jp/music/api/v1/noas/${stationId}?start_time_gte=${gte}&end_time_lt=${lt}`;
    } else {
      // Live mode: fetch latest songs
      url = `https://api.radiko.jp/music/api/v1/noas/${stationId}/latest?size=20`;
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      // Some stations have no NOA data, return empty
      if (res.status === 404) {
        return Response.json({ stationId, items: [] });
      }
      throw new Error(`NOA fetch failed: ${res.status}`);
    }

    const json = await res.json();
    const items = mapItems(json.data || []);

    return Response.json({ stationId, items });
  } catch (e) {
    const message = e instanceof Error ? e.message : "NOA fetch failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
