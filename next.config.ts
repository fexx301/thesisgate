import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // Self-hosted deploys (deploy/) run the minimal traced server; Vercel ignores this setting.
  output: "standalone",
  // The acceptance browser reaches the dev server through loopback rather
  // than the hostname used to start Next. Allow its dev-only HMR requests.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
