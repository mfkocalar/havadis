import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The container image runs the traced standalone server (Dockerfile, D-01).
  output: "standalone",
  // The tracer copies only the build architecture's native prebuilds; keep all of them so the image runs on either (Pitfall 1).
  outputFileTracingIncludes: { "/**": ["./node_modules/better-sqlite3/prebuilds/**/*"] },
  poweredByHeader: false,
};

export default nextConfig;
