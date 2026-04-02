// Radiko authentication module
// Uses Android app mode (aSmartPhone8) to bypass IP-based area restriction.
// Each area gets its own auth token via fake GPS coordinates.

import { readFileSync } from "fs";
import { join } from "path";

// Load the Android full auth key (base64-encoded JPEG)
let FULL_KEY_BYTES: Buffer | null = null;

function getFullKeyBytes(): Buffer {
  if (!FULL_KEY_BYTES) {
    const b64 = readFileSync(
      join(process.cwd(), "src/lib/auth-key.txt"),
      "utf-8"
    ).trim();
    FULL_KEY_BYTES = Buffer.from(b64, "base64");
  }
  return FULL_KEY_BYTES;
}

// GPS coordinates for all 47 prefectures (JP1 ~ JP47)
const AREA_GPS: Record<string, [number, number]> = {
  JP1: [43.064615, 141.346807],
  JP2: [40.824308, 140.739998],
  JP3: [39.703619, 141.152684],
  JP4: [38.268837, 140.8721],
  JP5: [39.718614, 140.102364],
  JP6: [38.240436, 140.363633],
  JP7: [37.750299, 140.467551],
  JP8: [36.341811, 140.446793],
  JP9: [36.565725, 139.883565],
  JP10: [36.390668, 139.060406],
  JP11: [35.856999, 139.648849],
  JP12: [35.605057, 140.123306],
  JP13: [35.689488, 139.691706],
  JP14: [35.447507, 139.642345],
  JP15: [37.902552, 139.023095],
  JP16: [36.695291, 137.211338],
  JP17: [36.594682, 136.625573],
  JP18: [36.065178, 136.221527],
  JP19: [35.664158, 138.568449],
  JP20: [36.651299, 138.180956],
  JP21: [35.391227, 136.722291],
  JP22: [34.97712, 138.383084],
  JP23: [35.180188, 136.906565],
  JP24: [34.730283, 136.508588],
  JP25: [35.004531, 135.86859],
  JP26: [35.021247, 135.755597],
  JP27: [34.686297, 135.519661],
  JP28: [34.691269, 135.183071],
  JP29: [34.685334, 135.832742],
  JP30: [34.225987, 135.167509],
  JP31: [35.503891, 134.237736],
  JP32: [35.472295, 133.0505],
  JP33: [34.661751, 133.934406],
  JP34: [34.39656, 132.459622],
  JP35: [34.185956, 131.470649],
  JP36: [34.065718, 134.55936],
  JP37: [34.340149, 134.043444],
  JP38: [33.841624, 132.765681],
  JP39: [33.559706, 133.531079],
  JP40: [33.606576, 130.418297],
  JP41: [33.249442, 130.299794],
  JP42: [32.744839, 129.873756],
  JP43: [32.789827, 130.741667],
  JP44: [33.238172, 131.612619],
  JP45: [31.911096, 131.423893],
  JP46: [31.560146, 130.557978],
  JP47: [26.2124, 127.680932],
};

// Generate fake GPS string with random jitter (~2.5km)
function genGPS(areaId: string): string {
  const coords = AREA_GPS[areaId];
  if (!coords) {
    // Fallback to Tokyo
    return genGPS("JP13");
  }
  const jitterLat =
    (Math.random() / 40.0) * (Math.random() > 0.5 ? 1 : -1);
  const jitterLng =
    (Math.random() / 40.0) * (Math.random() > 0.5 ? 1 : -1);
  const lat = (coords[0] + jitterLat).toFixed(6);
  const lng = (coords[1] + jitterLng).toFixed(6);
  return `${lat},${lng},gps`;
}

// Generate random 32-char hex user ID
function genUserId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Android device models for User-Agent
const DEVICES = [
  { sdk: "34", model: "SC-02H", build: "R16NW" },
  { sdk: "33", model: "Pixel 7", build: "TQ3A.230805.001" },
  { sdk: "31", model: "SM-G991B", build: "TP1A.220624.014" },
  { sdk: "30", model: "SOG01", build: "30.1.E.0.540" },
];

function genDevice(): { device: string; userAgent: string } {
  const d = DEVICES[Math.floor(Math.random() * DEVICES.length)];
  return {
    device: `${d.sdk}.${d.model}`,
    userAgent: `Dalvik/2.1.0 (Linux; U; Android ${d.sdk}; ${d.model} Build/${d.build})`,
  };
}

export interface AuthResult {
  token: string;
  areaId: string;
}

// Per-area token cache
const tokenCache = new Map<
  string,
  { result: AuthResult; timestamp: number }
>();
const CACHE_TTL = 1000 * 60 * 70; // 70 minutes (tokens last ~90 min)

export async function getRadikoAuth(
  targetAreaId?: string
): Promise<AuthResult> {
  // Default area if not specified
  const areaId = targetAreaId || "JP13";

  // Check cache
  const cached = tokenCache.get(areaId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  const userId = genUserId();
  const { device, userAgent } = genDevice();
  const appVersion = "8.2.4";
  const appName = "aSmartPhone8";

  // Step 1: auth1
  const auth1Res = await fetch("https://radiko.jp/v2/api/auth1", {
    headers: {
      "X-Radiko-App": appName,
      "X-Radiko-App-Version": appVersion,
      "X-Radiko-Device": device,
      "X-Radiko-User": userId,
      "User-Agent": userAgent,
    },
  });

  if (!auth1Res.ok) {
    throw new Error(`auth1 failed: ${auth1Res.status}`);
  }

  const token = auth1Res.headers.get("x-radiko-authtoken");
  const keyLength = parseInt(
    auth1Res.headers.get("x-radiko-keylength") || "0",
    10
  );
  const keyOffset = parseInt(
    auth1Res.headers.get("x-radiko-keyoffset") || "0",
    10
  );

  if (!token) {
    throw new Error("auth1 did not return a token");
  }

  // Compute partial key from the Android full key
  const fullKey = getFullKeyBytes();
  const partialBytes = fullKey.subarray(keyOffset, keyOffset + keyLength);
  const partialKey = partialBytes.toString("base64");

  // Step 2: auth2 with fake GPS for the target area
  const auth2Res = await fetch("https://radiko.jp/v2/api/auth2", {
    headers: {
      "X-Radiko-App": appName,
      "X-Radiko-App-Version": appVersion,
      "X-Radiko-Device": device,
      "X-Radiko-User": userId,
      "X-Radiko-AuthToken": token,
      "X-Radiko-Partialkey": partialKey,
      "X-Radiko-Location": genGPS(areaId),
      "X-Radiko-Connection": "wifi",
      "User-Agent": userAgent,
    },
  });

  if (!auth2Res.ok) {
    const body = await auth2Res.text();
    throw new Error(`auth2 failed: ${auth2Res.status} - ${body}`);
  }

  const body = await auth2Res.text();
  // Response format: "JP13,東京都,tokyo Japan\n"
  const returnedAreaId = body.trim().split(",")[0];

  const result: AuthResult = { token, areaId: returnedAreaId };

  // Cache the token for this area
  tokenCache.set(areaId, { result, timestamp: Date.now() });

  return result;
}

export function invalidateAuthCache(areaId?: string) {
  if (areaId) {
    tokenCache.delete(areaId);
  } else {
    tokenCache.clear();
  }
}
