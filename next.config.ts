import type { NextConfig } from "next";
import { execSync } from "child_process";
import packageJson from "./package.json";

function gitCommitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

function appVersion(): string {
  try {
    return packageJson.version?.trim() || gitCommitHash();
  } catch {
    return gitCommitHash();
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_VERSION: appVersion(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

// Only initialize OpenNext Cloudflare dev server when running `next dev` locally.
// Skip during `next build` (Vercel, CF, or self-hosted) to avoid EPIPE / missing module errors.
if (process.env.NODE_ENV === 'development') {
  import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev()).catch(() => {});
}
