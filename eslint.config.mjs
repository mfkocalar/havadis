import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // PLAT-06: every network call leaves through src/lib/egress (see test/egressBoundary.test.ts).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/egress/**", "**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Use src/lib/egress/safeFetch: it applies the egress policy, proxy handling and resolve-and-pin." },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: ["undici", "http", "https", "dns", "tls", "node:http", "node:https", "node:dns", "node:tls"].map((name) => ({
            name,
            message: "Network modules live in src/lib/egress only; call safeFetch instead.",
          })),
          patterns: [
            {
              group: ["undici/*", "dns/*", "node:dns/*"],
              message: "Network modules live in src/lib/egress only; call safeFetch instead.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
