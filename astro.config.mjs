import edgeone from "@edgeone/astro";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: edgeone(),
  security: {
    allowedDomains: [
      {
        protocol: "https",
        hostname: "lili-space-dpxse1ge54wx.edgeone.cool",
      },
    ],
  },
  integrations: [react()],
});
