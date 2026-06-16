import edgeone from "@edgeone/astro";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

const DEFAULT_SITE_ALLOWED_ORIGINS = "https://lili-space-only-mainland-k5jdl5gj.zh-cn.edgeone.cool";
const allowedOrigins = parseAllowedOrigins(process.env.SITE_ALLOWED_ORIGINS ?? DEFAULT_SITE_ALLOWED_ORIGINS);

export default defineConfig({
  output: "server",
  adapter: edgeone(),
  security: {
    checkOrigin: false,
    allowedDomains: allowedOrigins.map((origin) => ({
      protocol: origin.protocol.replace(":", ""),
      hostname: origin.hostname,
      ...(origin.port ? { port: origin.port } : {}),
    })),
  },
  integrations: [react()],
});

function parseAllowedOrigins(value) {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .flatMap((origin) => {
      try {
        return [new URL(origin)];
      } catch {
        console.warn(`[astro] Ignored invalid SITE_ALLOWED_ORIGINS entry: ${origin}`);
        return [];
      }
    });
  return origins.length ? origins : [new URL(DEFAULT_SITE_ALLOWED_ORIGINS)];
}
