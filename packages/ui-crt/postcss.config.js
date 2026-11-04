// Empty PostCSS config for @necro/ui-crt.
//
// The component test suites import `crt.css` for its side effect. Vite's CSS
// pipeline searches for a PostCSS config starting here; without this file it
// walks up and tries to JSON-parse a BOM-prefixed `package.json`, which throws.
// An explicit (empty) config short-circuits that search with no plugins, so the
// stylesheet imports cleanly in jsdom. Production bundling (Next.js) uses its
// own PostCSS setup, unaffected by this file.
export default { plugins: {} };
