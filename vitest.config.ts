import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "../projet-totem-ancestral") } },
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
  },
});
