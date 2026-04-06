// GET /api/stream/proxy?url=<base64>&areaId=JP13
// Proxy HLS playlist and segment requests to radiko with auth token
// The url parameter is base64-encoded to prevent CF Workers from decoding nested URL parameters
// areaId is passed through from stream endpoints (auto-resolved from stationId there)
import { NextRequest } from "next/server";
import { getRadikoAuth, invalidateAuthCache } from "@/lib/radiko-auth";

export async function GET(request: NextRequest) {
  try {
    const reqUrl = new URL(request.url);
    const urlParam = reqUrl.searchParams.get("url");
    const areaId = reqUrl.searchParams.get("areaId") || undefined;

    if (!urlParam) {
      return Response.json({ error: "url is required" }, { status: 400 });
    }

    // Decode base64-encoded target URL
    let targetUrl: string;
    try {
      targetUrl = atob(urlParam);
    } catch {
      // Fallback: treat as plain URL for backwards compatibility
      targetUrl = urlParam;
    }

    const auth = await getRadikoAuth(areaId);

    const res = await fetch(targetUrl, {
      headers: {
        "X-Radiko-AuthToken": auth.token,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!res.ok) {
      // If auth expired, invalidate cache and retry once
      if (res.status === 401 || res.status === 403) {
        invalidateAuthCache(areaId);
        const newAuth = await getRadikoAuth(areaId);
        const retryRes = await fetch(targetUrl, {
          headers: {
            "X-Radiko-AuthToken": newAuth.token,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        if (!retryRes.ok) {
          return new Response(`proxy failed after retry: ${retryRes.status}`, {
            status: retryRes.status,
          });
        }
        return handleProxyResponse(retryRes, targetUrl, request, areaId);
      }
      return new Response(`proxy failed: ${res.status}`, {
        status: res.status,
      });
    }

    return handleProxyResponse(res, targetUrl, request, areaId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "proxy failed";
    return new Response(message, { status: 500 });
  }
}

async function handleProxyResponse(
  res: Response,
  targetUrl: string,
  request: NextRequest,
  areaId: string | undefined
): Promise<Response> {
  const contentType = res.headers.get("content-type") || "";

  // If this is an m3u8 playlist, rewrite the URLs to go through our proxy
  if (
    contentType.includes("mpegurl") ||
    contentType.includes("x-mpegURL") ||
    targetUrl.endsWith(".m3u8")
  ) {
    let body = await res.text();

    // Rewrite relative URLs to absolute, then base64-encode and proxy them
    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
    const origin = new URL(request.url).origin;
    body = body.replace(/^(?!#)(.+)$/gm, (line) => {
      if (line.trim() === "") return line;
      let absoluteUrl = line.trim();
      if (!absoluteUrl.startsWith("http")) {
        absoluteUrl = baseUrl + absoluteUrl;
      }
      const proxyBase = new URL("/api/stream/proxy", origin);
      proxyBase.searchParams.set("url", btoa(absoluteUrl));
      if (areaId) proxyBase.searchParams.set("areaId", areaId);
      return proxyBase.toString();
    });

    return new Response(body, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      },
    });
  }

  // For media segments, stream them through
  return new Response(res.body, {
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    },
  });
}
