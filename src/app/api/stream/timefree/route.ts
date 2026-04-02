// GET /api/stream/timefree?stationId=TBS&ft=20260402060000&to=20260402083000&seek=20260402070000
// Returns the HLS playlist URL for timefree (catch-up) streaming
// areaId is auto-resolved from stationId
// The seek parameter allows starting from a specific position within the program
import { NextRequest } from "next/server";
import { getRadikoAuth } from "@/lib/radiko-auth";
import { getAreaIdForStation } from "@/lib/radiko-parser";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const stationId = searchParams.get("stationId");
    const ft = searchParams.get("ft");
    const to = searchParams.get("to");
    const seekParam = searchParams.get("seek"); // YYYYMMDDHHmmss, optional

    if (!stationId || !ft || !to) {
      return Response.json(
        { error: "stationId, ft, and to are required" },
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

    // Find the timefree (timefree="1", areafree="0") playlist URL
    const urlBlocks = xml.match(/<url[^>]*>[\s\S]*?<\/url>/gi);
    if (!urlBlocks) {
      throw new Error("no stream URLs found in XML");
    }

    const timefreeBlock = urlBlocks.find((block) => {
      const tag = block.match(/<url[^>]*>/i)?.[0] || "";
      return (
        /timefree="1"/i.test(tag) && /areafree="0"/i.test(tag)
      );
    });
    if (!timefreeBlock) {
      throw new Error("no timefree stream URL found");
    }

    const playlistMatch = timefreeBlock.match(
      /<playlist_create_url>([^<]+)<\/playlist_create_url>/i
    );
    if (!playlistMatch) {
      throw new Error("no playlist_create_url found");
    }

    const baseUrl = playlistMatch[1].trim();
    const lsid = crypto.randomUUID().replace(/-/g, "");

    // Use l=300 (max allowed, 5 minutes of audio per request)
    // If seek is specified, use it as the start position
    const seekStr = seekParam || ft;
    const playlistUrl = `${baseUrl}?station_id=${stationId}&l=300&lsid=${lsid}&type=b&start_at=${ft}&ft=${ft}&seek=${seekStr}&end_at=${to}&to=${to}`;

    return Response.json({
      playlistUrl,
      token: auth.token,
      areaId: auth.areaId,
      stationId,
      ft,
      to,
      type: "timefree",
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "timefree stream fetch failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
