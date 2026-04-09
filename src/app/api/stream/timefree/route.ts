// GET /api/stream/timefree?stationId=TBS&ft=20260402060000&to=20260402083000&seek=20260402070000
// Returns the HLS playlist URL for timefree (catch-up) streaming
// areaId is auto-resolved from stationId
// The seek parameter allows starting from a specific position within the program
import { NextRequest, NextResponse } from "next/server";
import { getRadikoAuth } from "@/lib/radiko-auth";
import { getAreaIdForStation } from "@/lib/radiko-parser";
import { findPlaylistCreateUrl } from "@/lib/radiko-stream";
import {
  isChronologicalRange,
  isTimestampInRange,
  isValidRadikoTimestamp,
  isValidStationId,
  normalizeStationId,
} from "@/lib/request-validation";
import {
  buildSignedProxyPath,
  ensureStreamSessionId,
  getStreamSessionCookieName,
  getStreamSessionMaxAgeSeconds,
} from "@/lib/stream-signing";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const stationIdParam = searchParams.get("stationId");
    const ft = searchParams.get("ft");
    const to = searchParams.get("to");
    const seekParam = searchParams.get("seek"); // YYYYMMDDHHmmss, optional

    if (!stationIdParam || !ft || !to) {
      return Response.json(
        { error: "stationId, ft, and to are required" },
        { status: 400 }
      );
    }

    const stationId = normalizeStationId(stationIdParam);
    if (!isValidStationId(stationId)) {
      return Response.json({ error: "invalid stationId" }, { status: 400 });
    }
    if (!isValidRadikoTimestamp(ft) || !isValidRadikoTimestamp(to)) {
      return Response.json({ error: "invalid ft/to" }, { status: 400 });
    }
    if (!isChronologicalRange(ft, to)) {
      return Response.json({ error: "ft must be before to" }, { status: 400 });
    }
    if (seekParam) {
      if (!isValidRadikoTimestamp(seekParam)) {
        return Response.json({ error: "invalid seek" }, { status: 400 });
      }
      if (!isTimestampInRange(seekParam, ft, to)) {
        return Response.json({ error: "seek must be within ft/to" }, { status: 400 });
      }
    }

    const areaId = await getAreaIdForStation(stationId);
    const auth = await getRadikoAuth(areaId);

    // Get stream URL metadata
    const streamRes = await fetch(
      `https://radiko.jp/v3/station/stream/pc_html5/${stationId}.xml`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!streamRes.ok) {
      throw new Error(`stream info fetch failed: ${streamRes.status}`);
    }

    const xml = await streamRes.text();
    const baseUrl = findPlaylistCreateUrl(xml, {
      timefree: true,
      areafree: false,
    });
    const lsid = crypto.randomUUID().replace(/-/g, "");

    // Use l=300 (max allowed, 5 minutes of audio per request)
    // If seek is specified, use it as the start position
    const seekStr = seekParam || ft;
    const playlistUrl = `${baseUrl}?station_id=${stationId}&l=300&lsid=${lsid}&type=b&start_at=${ft}&ft=${ft}&seek=${seekStr}&end_at=${to}&to=${to}`;

    const sessionId = ensureStreamSessionId(
      request.cookies.get(getStreamSessionCookieName())?.value
    );

    const response = NextResponse.json({
      proxyUrl: await buildSignedProxyPath(sessionId, playlistUrl, auth.areaId),
      areaId: auth.areaId,
      stationId,
      ft,
      to,
      type: "timefree",
    });
    response.cookies.set(getStreamSessionCookieName(), sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: getStreamSessionMaxAgeSeconds(),
    });
    return response;
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "timefree stream fetch failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
