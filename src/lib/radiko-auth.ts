// Radiko authentication module
// Uses Android app mode (aSmartPhone8) to bypass IP-based area restriction.
// Each area gets its own auth token via fake GPS coordinates.

import { AUTH_KEY_BASE64 } from "./auth-key-data";

// Decode base64 to Uint8Array (works in both Node.js and CF Workers/Edge)
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

// Uint8Array to base64 (works in both Node.js and CF Workers/Edge)
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

// Load the Android full auth key (base64-encoded JPEG)
let FULL_KEY_BYTES: Uint8Array | null = null;

function getFullKeyBytes(): Uint8Array {
  if (!FULL_KEY_BYTES) {
    FULL_KEY_BYTES = base64ToBytes(AUTH_KEY_BASE64);
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

const APP_VERSIONS = [
  "8.2.4",
  "8.2.2",
  "8.2.1",
  "8.2.0",
  "8.1.11",
  "8.1.8",
  "8.1.7",
  "8.1.6",
  "8.1.5",
  "8.1.4",
  "8.1.2",
  "8.1.1",
  "8.1.0",
  "8.0.16",
  "8.0.15",
  "8.0.14",
  "8.0.12",
  "8.0.11",
  "8.0.10",
  "8.0.9",
  "8.0.7",
  "8.0.6",
  "8.0.5",
  "8.0.4",
  "8.0.3",
  "8.0.2",
] as const;

const VERSION_BUILDS: Record<string, { sdk: string; android: string; builds: string[] }> = {
  "8.0.0": { sdk: "26", android: "8.0.0", builds: ["5650811", "5796467", "5948681", "6107732", "6127070"] },
  "8.1.0": { sdk: "27", android: "8.1.0", builds: ["5794017", "6107733", "6037697"] },
  "9.0.0": { sdk: "28", android: "9", builds: ["5948683", "5794013", "6127072"] },
  "10.0.0": { sdk: "29", android: "10", builds: ["5933585", "6969601", "7023426", "7070703"] },
  "11.0.0": { sdk: "30", android: "11", builds: ["RP1A.201005.006", "RQ1A.201205.011", "RQ1A.210105.002"] },
  "12.0.0": { sdk: "31", android: "12", builds: ["SD1A.210817.015.A4", "SD1A.210817.019.B1", "SD1A.210817.037", "SQ1D.220105.007"] },
  "13.0.0": { sdk: "33", android: "13", builds: ["TQ3C.230805.001.B2", "TQ3A.230805.001.A2", "TQ3A.230705.001.A1", "TQ2B.230505.005.A1"] },
  "14.0.0": { sdk: "34", android: "14", builds: ["AP2A.240805.005.S4", "AD1A.240905.004", "AP2A.240905.003", "AD1A.240530.047"] },
  "15.0.0": { sdk: "35", android: "15", builds: ["AP4A.250105.002.B1", "AP4A.250105.002.A1", "AP4A.241205.013", "AP3A.241005.015"] },
};

const MODEL_LIST = [
  "SC-02H",
  "SC-02J",
  "SC-03J",
  "SM-G950F",
  "SM-G955F",
  "SM-G960F",
  "SM-G965F",
  "SC-01K",
  "SM-N950F",
  "SO-01H",
  "SO-02H",
  "SO-01J",
  "SO-01K",
  "SOV32",
  "SOV34",
  "SOV36",
  "Pixel 6",
  "Pixel 7",
  "Pixel 8",
  "G9FPL",
  "GWKK3",
  "GQML3",
  "GX7AS",
  "GB7N6",
] as const;

function getAndroidRelease(appVersion: string): string {
  if (appVersion.startsWith("8.0.")) return "8.0.0";
  if (appVersion.startsWith("8.1.")) return "8.1.0";
  if (appVersion.startsWith("8.2.")) return "15.0.0";
  return "14.0.0";
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function genDevice(): { appVersion: string; device: string; userAgent: string } {
  const appVersion = pickRandom(APP_VERSIONS);
  const release = getAndroidRelease(appVersion);
  const versionInfo = VERSION_BUILDS[release];
  const model = pickRandom(MODEL_LIST);
  const build = pickRandom(versionInfo.builds);

  return {
    appVersion,
    device: `${versionInfo.sdk}.${model}`,
    userAgent: `Dalvik/2.1.0 (Linux; U; Android ${versionInfo.android}; ${model} Build/${build})`,
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

function isValidAreaId(areaId: string): boolean {
  return /^JP([1-9]|[1-3]\d|4[0-7])$/.test(areaId);
}

export async function getRadikoAuth(
  targetAreaId?: string
): Promise<AuthResult> {
  // Default area if not specified
  const areaId = targetAreaId || "JP13";

  if (!isValidAreaId(areaId)) {
    throw new Error(`invalid areaId: ${areaId}`);
  }

  // Check cache
  const cached = tokenCache.get(areaId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  const userId = genUserId();
  const { appVersion, device, userAgent } = genDevice();
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
  const partialKey = bytesToBase64(partialBytes);

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
