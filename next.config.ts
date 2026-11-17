import type { NextConfig } from "next";
import { fixtureEditionEnabled } from "./src/lib/config/fixtureMode.ts";

// A disallowed HAVADIS_FIXTURE_EDITION must fail `next build`, `next start` and
// `next dev` before anything compiles. The result is unused; the call throws.
fixtureEditionEnabled();

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentUpgrade: "security",
  },
};

export default nextConfig;
