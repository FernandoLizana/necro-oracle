import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "grimoires-lovers-js",
    include: ["src/**/*.test.ts", "src/**/*.pbt.test.ts"],
    environment: "node",
  },
});
