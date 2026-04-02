// GET /api/stations - Get all stations grouped by region (nationwide)
import { parseStationsXml } from "@/lib/radiko-parser";

export async function GET() {
  try {
    // Fetch the full nationwide station list
    const res = await fetch(
      "https://radiko.jp/v3/station/region/full.xml",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        next: { revalidate: 3600 }, // cache for 1 hour
      }
    );

    if (!res.ok) {
      throw new Error(`station list fetch failed: ${res.status}`);
    }

    const xml = await res.text();
    const regions = parseStationsXml(xml);

    return Response.json({ regions });
  } catch (e) {
    const message = e instanceof Error ? e.message : "station list failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
