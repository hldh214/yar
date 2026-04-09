const STREAM_SESSION_COOKIE = "yar_stream_session";
const STREAM_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function toBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toBufferSource(value: string): ArrayBuffer {
  const bytes = toBytes(value);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = toBytes(left);
  const rightBytes = toBytes(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < leftBytes.length; i += 1) {
    diff |= leftBytes[i] ^ rightBytes[i];
  }
  return diff === 0;
}

async function signTarget(
  sessionId: string,
  targetUrl: string,
  areaId: string | undefined
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toBufferSource(sessionId),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const payload = toBufferSource(`${areaId || ""}\n${targetUrl}`);
  const signature = await crypto.subtle.sign("HMAC", key, payload);
  return toBase64Url(new Uint8Array(signature));
}

export function getStreamSessionCookieName(): string {
  return STREAM_SESSION_COOKIE;
}

export function getStreamSessionMaxAgeSeconds(): number {
  return STREAM_SESSION_MAX_AGE_SECONDS;
}

export function ensureStreamSessionId(current?: string): string {
  const trimmed = current?.trim();
  return trimmed || crypto.randomUUID();
}

export async function buildSignedProxyPath(
  sessionId: string,
  targetUrl: string,
  areaId?: string
): Promise<string> {
  const signature = await signTarget(sessionId, targetUrl, areaId);
  const params = new URLSearchParams({
    url: btoa(targetUrl),
    sig: signature,
  });
  if (areaId) params.set("areaId", areaId);
  return `/api/stream/proxy?${params.toString()}`;
}

export async function verifySignedProxyRequest(options: {
  sessionId: string;
  targetUrl: string;
  areaId?: string;
  signature: string;
}): Promise<boolean> {
  const { sessionId, targetUrl, areaId, signature } = options;
  const expectedSignature = await signTarget(sessionId, targetUrl, areaId);
  return constantTimeEqual(expectedSignature, signature);
}
