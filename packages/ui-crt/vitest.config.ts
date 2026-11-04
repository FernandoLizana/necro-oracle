import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ui-crt",
    include: [
      "src/**/*.test.ts",
      "src/**/*.pbt.test.ts",
      "src/**/*.conformance.test.ts",
    ],
    environment: "node",
  },
});
