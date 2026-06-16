import edgeone from "@edgeone/astro";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: edgeone(),
  security: {
    checkOrigin: false,
    allowedDomains: [
      {
        protocol: "https",
        hostname: "*.edgeone.cool",
      },
    ],
  },
  integrations: [react()],
});
