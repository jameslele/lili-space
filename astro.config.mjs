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
        hostname: "lili-space-only-mainland-k5jdl5gj.zh-cn.edgeone.cool",
      },
    ],
  },
  integrations: [react()],
});
