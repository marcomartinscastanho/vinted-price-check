import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: "src/content.ts",
      formats: ["iife"],
      name: "VintedPriceExtractor",
      fileName: () => "content.js",
    },
  },
});
