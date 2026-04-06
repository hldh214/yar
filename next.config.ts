import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Only initialize OpenNext Cloudflare dev server when running `next dev` locally.
// Skip during `next build` (Vercel, CF, or self-hosted) to avoid EPIPE / missing module errors.
if (process.env.NODE_ENV === 'development') {
  import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev()).catch(() => {});
}
