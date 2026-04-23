import type { NextRequest } from "next/server";
import { ImageResponse } from "next/og";

const ALLOWED_SIZES = new Set([96, 128, 192, 256, 384, 512]);

function parseIpv4(host: string): number[] | null {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

  const parts = host.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return null;

  return parts;
}

function isPrivateIpv4(host: string): boolean {
  const parts = parseIpv4(host);
  if (!parts) return false;

  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;

  return false;
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb");
}

function isBlockedHostname(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".home")
    || normalized.endsWith(".lan");
}

function sanitizeExternalUrl(raw: string): string {
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";

    const host = parsed.hostname.toLowerCase();
    if (isBlockedHostname(host) || isPrivateIpv4(host) || isPrivateIpv6(host)) return "";

    return parsed.toString();
  } catch {
    return "";
  }
}

export function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url") || "";
  const imageUrl = sanitizeExternalUrl(rawUrl);
  if (!imageUrl) {
    return Response.json({ error: "invalid url" }, { status: 400 });
  }

  const sizeParam = Number.parseInt(request.nextUrl.searchParams.get("size") || "256", 10);
  const size = ALLOWED_SIZES.has(sizeParam) ? sizeParam : 256;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: "#101010",
          position: "relative",
        }}
      >
        <img
          src={imageUrl}
          alt=""
          width={size}
          height={size}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(18px)",
            opacity: 0.45,
            transform: "scale(1.08)",
            position: "absolute",
          }}
        />
        <img
          src={imageUrl}
          alt=""
          width={size}
          height={size}
          style={{
            width: "88%",
            height: "88%",
            objectFit: "contain",
            position: "relative",
          }}
        />
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=86400",
      },
    }
  );
}
