import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "github",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});
