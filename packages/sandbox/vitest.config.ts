import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "sandbox",
    include: ["src/**/*.test.ts", "src/**/*.pbt.test.ts"],
    environment: "node",
  },
});
