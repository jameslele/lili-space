import edgeone from "@edgeone/astro";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: edgeone(),
  integrations: [react()],
});
