import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use `projects` (replaces deprecated `workspace`) to discover all
    // packages in the monorepo.  Each package with a vitest.config.ts will
    // be picked up automatically; packages without one run with defaults.
    projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"],
    reporters: ["verbose"],
  },
});
