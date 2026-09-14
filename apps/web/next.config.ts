import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { securityHeaders } from "./src/lib/security-headers";

/**
 * Where the API lives from the Next server's point of view (compose: http://api:4000).
 *
 * Read at BUILD time: `rewrites()` is baked into the routes manifest, so the value in the image is
 * whatever this was when `next build` ran — infra/docker/web.Dockerfile sets it. The runtime
 * variable still matters for server-side fetches in lib/api-server.ts, which read it per request.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const buildConfig = (dev: boolean): NextConfig => ({
  // Required by infra/docker/web.Dockerfile: self-contained server.js + minimal node_modules.
  output: "standalone",
  transpilePackages: ["@harbor/shared"],
  // The browser only ever talks to this origin; /api/* is proxied to the Nest API so the session
  // cookie stays first-party and no CORS is involved (spec §3.2: one host on the tailnet).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_INTERNAL_URL}/:path*` }];
  },
  // Spec §3.2: applied to everything the app serves, including the /api rewrite, so an API
  // response opened directly in a tab is under the same policy as a page.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(dev) }];
  },
  experimental: {
    // proxy.ts never matches /api/*, but keep the buffered-body ceiling above the API's 200 MB limit.
    proxyClientMaxBodySize: "220mb",
  },
});

/**
 * Function form so the phase is known: only the dev server's policy allows `eval` and a websocket,
 * and it is the phase that says which server this is, not an ambient NODE_ENV.
 */
const config = (phase: string): NextConfig => buildConfig(phase === PHASE_DEVELOPMENT_SERVER);

export default config;
