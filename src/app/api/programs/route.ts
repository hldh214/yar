// GET /api/programs?stationId=TBS&date=20260402
// Get program schedule for a station on a given date
// areaId is auto-resolved from stationId
import { NextRequest } from "next/server";
import { parseProgramsXml, getAreaIdForStation } from "@/lib/radiko-parser";
import {
  isValidRadikoDate,
  isValidStationId,
  normalizeStationId,
} from "@/lib/request-validation";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const stationIdParam = searchParams.get("stationId");
    const date = searchParams.get("date");

    if (!stationIdParam) {
      return Response.json(
        { error: "stationId is required" },
        { status: 400 }
      );
    }

    const stationId = normalizeStationId(stationIdParam);
    if (!isValidStationId(stationId)) {
      return Response.json({ error: "invalid stationId" }, { status: 400 });
    }

    if (date && !isValidRadikoDate(date)) {
      return Response.json({ error: "invalid date" }, { status: 400 });
    }

    const areaId = await getAreaIdForStation(stationId);

    // Current radiko broadcast day (starts at 5:00 JST)
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    if (jst.getUTCHours() < 5) {
      jst.setUTCDate(jst.getUTCDate() - 1);
    }
    const todayStr =
      jst.getUTCFullYear().toString() +
      String(jst.getUTCMonth() + 1).padStart(2, "0") +
      String(jst.getUTCDate()).padStart(2, "0");

    const dateStr = date || todayStr;

    const url = `https://radiko.jp/v3/program/date/${dateStr}/${areaId}.xml`;

    // Radiko publishes the schedule per broadcast day as a static document.
    // Past days never change; today's may be edited, so refresh it hourly.
    const revalidate = dateStr < todayStr ? 86400 : 3600;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      next: { revalidate },
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
