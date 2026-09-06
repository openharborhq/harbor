import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required by infra/docker/web.Dockerfile: self-contained server.js + minimal node_modules.
  output: "standalone",
  transpilePackages: ["@trustworthier/shared"],
};

export default nextConfig;
