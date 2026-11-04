import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The React plugin gives the automatic JSX runtime to every `.tsx`
  // component and test file. It has no effect on the pure `.ts` suites.
  plugins: [react()],
  test: {
    name: "ui-crt",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/*.pbt.test.ts",
      "src/**/*.conformance.test.ts",
    ],
    // The default stays `node` so the pure reducer/renderer/property suites
    // keep their fast, DOM-free environment. The component and hook tests opt
    // into jsdom per file with a `// @vitest-environment jsdom` docblock.
    environment: "node",
    // Registers the jest-dom matchers (DOM assertions). It only extends
    // `expect`, so it is inert for the pure node suites.
    setupFiles: ["src/testing/setup-dom.ts"],
    // The component suites import `crt.css` for its side effect only; the DOM
    // tests never read computed styles. Disabling CSS processing skips vite's
    // PostCSS config search (which otherwise trips over BOM-prefixed
    // package.json files in the monorepo) and makes `import "../crt.css"` a
    // no-op in jsdom. Production bundling (Next.js) handles the CSS itself.
    css: false,
  },
});
