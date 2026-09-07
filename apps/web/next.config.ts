import type { NextConfig } from "next";

/** Where the API lives from the Next server's point of view (compose: http://api:4000). */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // Required by infra/docker/web.Dockerfile: self-contained server.js + minimal node_modules.
  output: "standalone",
  transpilePackages: ["@trustworthier/shared"],
  // The browser only ever talks to this origin; /api/* is proxied to the Nest API so the session
  // cookie stays first-party and no CORS is involved (spec §3.2: one host on the tailnet).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_INTERNAL_URL}/:path*` }];
  },
  experimental: {
    // proxy.ts never matches /api/*, but keep the buffered-body ceiling above the API's 200 MB limit.
    proxyClientMaxBodySize: "220mb",
  },
};

export default nextConfig;
