import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The React plugin gives the automatic JSX runtime to every `.tsx` component
  // and test file (matching Next's React 19 automatic runtime), so a `.tsx`
  // rendered in a test needs no in-scope `React` import. It is inert for the
  // pure `.ts` suites.
  plugins: [react()],
  // Keep the previous esbuild JSX setting for the pure `.ts` suites that never
  // load a component; the React plugin owns `.tsx` transform.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    name: "web",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.pbt.test.ts"],
    // A few heavy cold-reimport composition PBT suites (e.g.
    // `src/server/wiring-overrides.pbt.test.ts` Property 28) legitimately take
    // ~3.4 s per test because each case re-imports the server composition
    // graph from a clean module registry. In ISOLATION they pass 7/7 reliably,
    // but under the FULL web suite the shared ~30 s transform/collect pressure
    // starves Vitest's 5 s default per-test budget and they intermittently
    // fail with "Test timed out in 5000ms". Raising the wall-clock to 30 s
    // removes that starvation WITHOUT changing a single assertion or any
    // `numRuns`: the tests do exactly the same work and check exactly the same
    // thing — they are just given enough real time to finish under load.
    // `hookTimeout` is raised to match so their `beforeEach`/`afterEach`
    // module-registry resets get the same budget.
    testTimeout: 30000,
    hookTimeout: 30000,
    // The default stays `node` so the existing pure protocol/server/demo suites
    // keep their fast, DOM-free environment. The component / axe suites opt into
    // jsdom per file with a `// @vitest-environment jsdom` docblock.
    environment: "node",
    // Registers the jest-dom matchers (DOM assertions). It only extends
    // `expect`, so it is inert for the pure node suites.
    setupFiles: ["src/testing/setup-dom.ts"],
    // The component suites import a scoped `.css` for its side effect only; the
    // DOM/axe tests never read computed styles. Disabling CSS processing skips
    // vite's PostCSS config search (which otherwise trips over BOM-prefixed
    // package.json files in the monorepo) and makes `import "./lovers-view.css"`
    // a no-op in jsdom. Production bundling (Next.js) handles the CSS itself.
    css: false,
  },
});
