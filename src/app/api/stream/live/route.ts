// GET /api/stream/live?stationId=TBS
// Returns the HLS playlist URL for live streaming
// areaId is auto-resolved from stationId
import { NextRequest, NextResponse } from "next/server";
import { getRadikoAuth } from "@/lib/radiko-auth";
import { getAreaIdForStation } from "@/lib/radiko-parser";
import { findPlaylistCreateUrl } from "@/lib/radiko-stream";
import { isValidStationId, normalizeStationId } from "@/lib/request-validation";
import {
  buildSignedProxyPath,
  ensureStreamSessionId,
  getStreamSessionCookieName,
  getStreamSessionMaxAgeSeconds,
} from "@/lib/stream-signing";

export async function GET(request: NextRequest) {
  try {
    const stationIdParam = request.nextUrl.searchParams.get("stationId");
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
      timefree: false,
      areafree: false,
    });
    const lsid = crypto.randomUUID().replace(/-/g, "");

    // Build the full playlist URL
    const playlistUrl = `${baseUrl}?station_id=${stationId}&l=15&lsid=${lsid}&type=b`;

    const sessionId = ensureStreamSessionId(
      request.cookies.get(getStreamSessionCookieName())?.value
    );

    const response = NextResponse.json({
      proxyUrl: await buildSignedProxyPath(sessionId, playlistUrl, auth.areaId),
      areaId: auth.areaId,
      stationId,
      type: "live",
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
    const message = e instanceof Error ? e.message : "stream fetch failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
