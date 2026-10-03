import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image builds with NEXT_OUTPUT=standalone; `npm start` uses the regular server.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  // Native/WASM server-only packages are loaded with Node's require instead of being bundled.
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "web-push"],
  // The fonts and playbooks are read from disk at runtime by the agent and the video renderer.
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/**/*", "./playbooks/**/*", "./drizzle/**/*"],
  },
  // Runtime data (database, rendered media) and sources never belong in the server bundle.
  outputFileTracingExcludes: {
    "/**": ["./data/**/*", "./tests/**/*", "./scripts/**/*", "./src/**/*", "./.git/**/*"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
