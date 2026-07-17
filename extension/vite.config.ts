// M4  Vite + @crxjs/vite-plugin (HMR - without it the build loop is 300 manual reloads).

import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [crx({ manifest: manifest as any })],
  server: {
    port: 5175,
    strictPort: true,
    hmr: { port: 5175 },
  },
});
