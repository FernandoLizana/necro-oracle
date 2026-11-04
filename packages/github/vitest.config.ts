import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "github",
    include: ["src/**/*.test.ts", "src/**/*.pbt.test.ts"],
    environment: "node",
  },
});
