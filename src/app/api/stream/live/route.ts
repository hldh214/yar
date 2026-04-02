// GET /api/stream/live?stationId=TBS
// Returns the HLS playlist URL for live streaming
// areaId is auto-resolved from stationId
import { NextRequest } from "next/server";
import { getRadikoAuth } from "@/lib/radiko-auth";
import { getAreaIdForStation } from "@/lib/radiko-parser";

export async function GET(request: NextRequest) {
  try {
    const stationId = request.nextUrl.searchParams.get("stationId");
    if (!stationId) {
      return Response.json(
        { error: "stationId is required" },
        { status: 400 }
      );
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

    // Find the live (timefree="0", areafree="0") playlist URL
    const urlBlocks = xml.match(/<url[^>]*>[\s\S]*?<\/url>/gi);
    if (!urlBlocks) {
      throw new Error("no stream URLs found in XML");
    }

    const liveBlock = urlBlocks.find((block) => {
      const tag = block.match(/<url[^>]*>/i)?.[0] || "";
      return (
        /timefree="0"/i.test(tag) && /areafree="0"/i.test(tag)
      );
    });
    if (!liveBlock) {
      throw new Error("no live stream URL found");
    }

    const playlistMatch = liveBlock.match(
      /<playlist_create_url>([^<]+)<\/playlist_create_url>/i
    );
    if (!playlistMatch) {
      throw new Error("no playlist_create_url found");
    }

    const baseUrl = playlistMatch[1].trim();
    const lsid = crypto.randomUUID().replace(/-/g, "");

    // Build the full playlist URL
    const playlistUrl = `${baseUrl}?station_id=${stationId}&l=15&lsid=${lsid}&type=b`;

    return Response.json({
      playlistUrl,
      token: auth.token,
      areaId: auth.areaId,
      stationId,
      type: "live",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "stream fetch failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
