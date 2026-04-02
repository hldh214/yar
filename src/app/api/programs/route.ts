// GET /api/programs?stationId=TBS&date=20260402
// Get program schedule for a station on a given date
// areaId is auto-resolved from stationId
import { NextRequest } from "next/server";
import { parseProgramsXml, getAreaIdForStation } from "@/lib/radiko-parser";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const stationId = searchParams.get("stationId");
    const date = searchParams.get("date");
    const areaId = await getAreaIdForStation(stationId || "");

    if (!stationId) {
      return Response.json(
        { error: "stationId is required" },
        { status: 400 }
      );
    }

    // Determine date string
    let dateStr: string;
    if (date) {
      dateStr = date;
    } else {
      const now = new Date();
      const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      // Radiko broadcast day starts at 5:00 JST
      if (jst.getUTCHours() < 5) {
        jst.setUTCDate(jst.getUTCDate() - 1);
      }
      const y = jst.getUTCFullYear();
      const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
      const d = String(jst.getUTCDate()).padStart(2, "0");
      dateStr = `${y}${m}${d}`;
    }

    const url = `https://radiko.jp/v3/program/date/${dateStr}/${areaId}.xml`;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!res.ok) {
      throw new Error(`program fetch failed: ${res.status}`);
    }

    const xml = await res.text();
    const allStations = parseProgramsXml(xml);

    // Filter to the requested station
    const stationData = allStations.find(
      (s) => s.station.id === stationId
    );

    if (!stationData) {
      return Response.json(
        { error: "station not found in schedule" },
        { status: 404 }
      );
    }

    return Response.json(stationData);
  } catch (e) {
    const message = e instanceof Error ? e.message : "programs fetch failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
