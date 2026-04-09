// GET /api/stream/proxy?url=<base64>&areaId=JP13
// Proxy HLS playlist and segment requests to Radiko-owned hosts only.
// The url parameter is base64-encoded to prevent nested URL parsing issues.
// areaId is passed through from stream endpoints (auto-resolved from stationId there).
import { NextRequest } from "next/server";
import { getRadikoAuth, invalidateAuthCache } from "@/lib/radiko-auth";
import {
  buildSignedProxyPath,
  getStreamSessionCookieName,
  verifySignedProxyRequest,
} from "@/lib/stream-signing";

function isValidAreaId(areaId: string): boolean {
  return /^JP([1-9]|[1-3]\d|4[0-7])$/.test(areaId);
}

function isAllowedProxyHost(hostname: string): boolean {
  return (
    hostname === "radiko.jp" ||
    hostname.endsWith(".radiko.jp") ||
    hostname.endsWith(".radiko-cf.com") ||
    hostname.endsWith(".smartstream.ne.jp")
  );
}

function decodeTargetUrl(urlParam: string): string {
  try {
    return atob(urlParam);
  } catch {
    throw new Error("invalid url encoding");
  }
}

function validateProxyTarget(rawUrl: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("invalid target url");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("unsupported target protocol");
  }

  if (!isAllowedProxyHost(parsed.hostname)) {
    throw new Error("unsupported target host");
  }

  return parsed;
}

function resolvePlaylistUrl(baseUrl: string, value: string): string {
  return new URL(value, baseUrl).toString();
}

async function rewritePlaylist(
  body: string,
  baseUrl: string,
  sessionId: string,
  areaId?: string
): Promise<string> {
  const rewriteUrl = async (value: string) => {
    const absoluteUrl = resolvePlaylistUrl(baseUrl, value.trim());
    validateProxyTarget(absoluteUrl);
    return buildSignedProxyPath(sessionId, absoluteUrl, areaId);
  };

  const uriMatches = Array.from(body.matchAll(/URI="([^"]+)"/g));
  let rewritten = body;

  for (const match of uriMatches) {
    const fullMatch = match[0];
    const value = match[1];
    if (!value) continue;
    const signedUrl = await rewriteUrl(value);
    rewritten = rewritten.replace(fullMatch, `URI="${signedUrl}"`);
  }

  const lines = rewritten.split("\n");
  const rewrittenLines = await Promise.all(
    lines.map(async (line) => {
      if (line.trim() === "" || line.startsWith("#")) return line;
      return rewriteUrl(line);
    })
  );

  return rewrittenLines.join("\n");
}

async function fetchWithRadikoAuth(
  targetUrl: URL,
  token: string,
  redirectCount = 0
): Promise<{ response: Response; finalUrl: string }> {
  const response = await fetch(targetUrl, {
    redirect: "manual",
    headers: {
      "X-Radiko-AuthToken": token,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (response.status >= 300 && response.status < 400) {
    if (redirectCount >= 3) {
      throw new Error("too many upstream redirects");
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error("missing upstream redirect location");
    }

    const redirectedUrl = new URL(location, targetUrl);
    validateProxyTarget(redirectedUrl.toString());
    return fetchWithRadikoAuth(redirectedUrl, token, redirectCount + 1);
  }

  return { response, finalUrl: targetUrl.toString() };
}

export async function GET(request: NextRequest) {
  try {
    const reqUrl = new URL(request.url);
    const urlParam = reqUrl.searchParams.get("url");
    const signature = reqUrl.searchParams.get("sig");
    const areaId = reqUrl.searchParams.get("areaId") || undefined;
    const sessionId = request.cookies.get(getStreamSessionCookieName())?.value;

    if (!urlParam) {
      return Response.json({ error: "url is required" }, { status: 400 });
    }

    if (!sessionId) {
      return Response.json({ error: "missing stream session" }, { status: 403 });
    }

    if (!signature) {
      return Response.json({ error: "missing stream signature" }, { status: 403 });
    }

    if (areaId && !isValidAreaId(areaId)) {
      return Response.json({ error: "invalid areaId" }, { status: 400 });
    }

    const targetUrl = decodeTargetUrl(urlParam);
    const validatedTargetUrl = validateProxyTarget(targetUrl);

    const isAuthorized = await verifySignedProxyRequest({
      sessionId,
      targetUrl: validatedTargetUrl.toString(),
      areaId,
      signature,
    });
    if (!isAuthorized) {
      return Response.json({ error: "invalid stream signature" }, { status: 403 });
    }

    const auth = await getRadikoAuth(areaId);

    const initialFetch = await fetchWithRadikoAuth(validatedTargetUrl, auth.token);
    const res = initialFetch.response;

    if (!res.ok) {
      // If auth expired, invalidate cache and retry once
      if (res.status === 401 || res.status === 403) {
        invalidateAuthCache(areaId);
        const newAuth = await getRadikoAuth(areaId);
        const retryFetch = await fetchWithRadikoAuth(validatedTargetUrl, newAuth.token);
        const retryRes = retryFetch.response;
        if (!retryRes.ok) {
          return new Response(`proxy failed after retry: ${retryRes.status}`, {
            status: retryRes.status,
          });
        }
        return handleProxyResponse(retryRes, retryFetch.finalUrl, sessionId, areaId);
      }
      return new Response(`proxy failed: ${res.status}`, {
        status: res.status,
      });
    }

    return handleProxyResponse(res, initialFetch.finalUrl, sessionId, areaId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "proxy failed";
    const status = /invalid|unsupported/.test(message) ? 400 : 500;
    return new Response(message, { status });
  }
}

async function handleProxyResponse(
  res: Response,
  targetUrl: string,
  sessionId: string,
  areaId: string | undefined
): Promise<Response> {
  const contentType = res.headers.get("content-type") || "";

  // If this is an m3u8 playlist, rewrite the URLs to go through our proxy
  if (
    contentType.includes("mpegurl") ||
    contentType.includes("x-mpegURL") ||
    targetUrl.endsWith(".m3u8")
  ) {
    const baseUrl = new URL(targetUrl).toString();
    const body = await rewritePlaylist(await res.text(), baseUrl, sessionId, areaId);

    return new Response(body, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      },
    });
  }

  // For media segments, stream them through
  return new Response(res.body, {
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "Cache-Control": "no-cache",
    },
  });
}
