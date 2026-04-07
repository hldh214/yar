import type { NextConfig } from "next";
import { execSync } from "child_process";

function gitVersion(): string {
  try {
    return execSync("git describe --tags --always 2>/dev/null").toString().trim();
  } catch {
    try {
      return execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      return "dev";
    }
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_VERSION: gitVersion(),
  },
};

export default nextConfig;

// Only initialize OpenNext Cloudflare dev server when running `next dev` locally.
// Skip during `next build` (Vercel, CF, or self-hosted) to avoid EPIPE / missing module errors.
if (process.env.NODE_ENV === 'development') {
  import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev()).catch(() => {});
}
