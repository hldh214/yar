// XML parser utility for radiko API responses
// Radiko returns XML for most endpoints; we parse them into typed objects

export interface Station {
  id: string;
  name: string;
  asciiName: string;
  areaId: string;
  href: string;
  logoUrl: string;
}

export interface Region {
  regionId: string;
  regionName: string;
  stations: Station[];
}

export interface Program {
  id: string;
  stationId: string;
  title: string;
  subtitle: string;
  performer: string;
  description: string;
  info: string;
  url: string;
  imageUrl: string;
  startTime: string; // YYYYMMDDHHmmss
  endTime: string; // YYYYMMDDHHmmss
  duration: number; // seconds
  isOnAir: boolean;
  isTimefree: boolean;
}

export interface StationWithPrograms {
  station: Station;
  programs: Program[];
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function unwrapCdata(str: string): string {
  const cdataMatch = str.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  return cdataMatch ? cdataMatch[1] : str;
}

function htmlToPlainText(str: string): string {
  return decodeXmlEntities(str)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|section|article|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeExternalUrl(url: string): string {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function getTextContent(parent: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = parent.match(regex);
  return match ? decodeXmlEntities(unwrapCdata(match[1].trim())) : "";
}

function getAttr(tag: string, attr: string): string {
  const regex = new RegExp(`${attr}="([^"]*)"`, "i");
  const match = tag.match(regex);
  return match ? match[1] : "";
}

export function parseStationsXml(xml: string): Region[] {
  const regions: Region[] = [];

  // Match each <stations> block
  const stationsBlocks = xml.match(
    /<stations[^>]*>[\s\S]*?<\/stations>/gi
  );
  if (!stationsBlocks) return regions;

  for (const block of stationsBlocks) {
    const regionId = getAttr(block, "region_id");
    const regionName = getAttr(block, "region_name");

    const stations: Station[] = [];
    const stationBlocks = block.match(
      /<station>[\s\S]*?<\/station>/gi
    );
    if (stationBlocks) {
      for (const sBlock of stationBlocks) {
        const id = getTextContent(sBlock, "id");
        const name = getTextContent(sBlock, "name");
        const asciiName = getTextContent(sBlock, "ascii_name");
        const areaId = getTextContent(sBlock, "area_id");
        const href = getTextContent(sBlock, "href");
        // Pick a suitable logo URL
        const logoMatch = sBlock.match(
          /<logo[^>]*width="128"[^>]*>([^<]*)<\/logo>/i
        );
        const logoUrl = logoMatch
          ? logoMatch[1].trim()
          : `https://radiko.jp/v2/static/station/logo/${id}/lrtrim/688x160.png`;

        stations.push({ id, name, asciiName, areaId, href, logoUrl });
      }
    }

    regions.push({ regionId, regionName, stations });
  }

  return regions;
}

export function parseProgramsXml(xml: string): StationWithPrograms[] {
  const result: StationWithPrograms[] = [];
  const now = new Date();
  const nowStr = formatDateToRadiko(now);

  // Match each <station> block in the schedule
  const stationBlocks = xml.match(
    /<station id="[^"]*">[\s\S]*?<\/station>/gi
  );
  if (!stationBlocks) return result;

  for (const block of stationBlocks) {
    const stationId = getAttr(block, "id");
    const stationName = getTextContent(block, "name");

    const station: Station = {
      id: stationId,
      name: stationName,
      asciiName: "",
      areaId: "",
      href: "",
      logoUrl: `https://radiko.jp/v2/static/station/logo/${stationId}/lrtrim/688x160.png`,
    };

    const programs: Program[] = [];
    const progBlocks = block.match(/<prog[\s\S]*?<\/prog>/gi);
    if (progBlocks) {
      for (const pBlock of progBlocks) {
        const ft = getAttr(pBlock, "ft");
        const to = getAttr(pBlock, "to");
        const dur = parseInt(getAttr(pBlock, "dur") || "0", 10);
        const title = getTextContent(pBlock, "title");
        const subtitle = getTextContent(pBlock, "sub_title");
        const performer = getTextContent(pBlock, "pfm");
        const desc = htmlToPlainText(getTextContent(pBlock, "desc"));
        const info = htmlToPlainText(getTextContent(pBlock, "info"));
        const url = sanitizeExternalUrl(getTextContent(pBlock, "url"));
        const img = sanitizeExternalUrl(getTextContent(pBlock, "img"));

        const isOnAir = ft <= nowStr && nowStr < to;
        // Timefree: program has ended and is within 1 week
        const endDate = parseRadikoDate(to);
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const isTimefree = endDate < now && endDate > oneWeekAgo;

        programs.push({
          id: `${stationId}_${ft}`,
          stationId,
          title,
          subtitle,
          performer,
          description: desc,
          info,
          url,
          imageUrl: img,
          startTime: ft,
          endTime: to,
          duration: dur,
          isOnAir,
          isTimefree,
        });
      }
    }

    result.push({ station, programs });
  }

  return result;
}

export function formatDateToRadiko(date: Date): string {
  // Convert to JST (UTC+9)
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const h = String(jst.getUTCHours()).padStart(2, "0");
  const min = String(jst.getUTCMinutes()).padStart(2, "0");
  const sec = String(jst.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}${h}${min}${sec}`;
}

export function parseRadikoDate(str: string): Date {
  // Parse YYYYMMDDHHmmss in JST
  const y = parseInt(str.substring(0, 4), 10);
  const m = parseInt(str.substring(4, 6), 10) - 1;
  const d = parseInt(str.substring(6, 8), 10);
  const h = parseInt(str.substring(8, 10), 10);
  const min = parseInt(str.substring(10, 12), 10);
  const sec = parseInt(str.substring(12, 14), 10);
  // Create date in JST by subtracting 9 hours from UTC
  return new Date(Date.UTC(y, m, d, h - 9, min, sec));
}

export function formatTime(radikoTime: string): string {
  const h = radikoTime.substring(8, 10);
  const m = radikoTime.substring(10, 12);
  return `${h}:${m}`;
}

// --- Station-to-areaId mapping (cached) ---

let stationAreaMap: Map<string, string> | null = null;
let stationAreaMapTimestamp = 0;
const STATION_MAP_TTL = 1000 * 60 * 60; // 1 hour

export async function getAreaIdForStation(stationId: string): Promise<string> {
  // Rebuild map if stale or missing
  if (!stationAreaMap || Date.now() - stationAreaMapTimestamp > STATION_MAP_TTL) {
    const res = await fetch("https://radiko.jp/v3/station/region/full.xml", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`station list fetch failed: ${res.status}`);
    }
    const xml = await res.text();
    const regions = parseStationsXml(xml);
    const map = new Map<string, string>();
    for (const region of regions) {
      for (const station of region.stations) {
        map.set(station.id, station.areaId);
      }
    }
    stationAreaMap = map;
    stationAreaMapTimestamp = Date.now();
  }

  const areaId = stationAreaMap.get(stationId);
  if (!areaId) {
    throw new Error(`unknown station: ${stationId}`);
  }
  return areaId;
}
