// scripts/demo-bundle/css-stub-loader.mjs
//
// A tiny Node ESM resolve/load hook used ONLY by the demo-bundle generator.
//
// `scripts/demo-bundle/generate.ts` imports `@necro/ui-crt` (for the pure
// `DEMO_CATALOG` value), whose barrel re-exports the CRT React components, and
// those pull in `src/crt.css`. Under plain Node/tsx a `.css` import has no
// loader and throws ERR_UNKNOWN_FILE_EXTENSION. The generator never touches the
// stylesheet, so this hook resolves any `.css` specifier to an empty module.
//
// This is a build-time generator concern only; it is not part of the shipped
// web bundle (Next handles CSS there).

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return {
      url: new URL(specifier, context.parentURL ?? "file:///").href,
      shortCircuit: true,
      format: "css-stub",
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (context.format === "css-stub" || url.endsWith(".css")) {
    return { format: "module", shortCircuit: true, source: "export default {};" };
  }
  return nextLoad(url, context);
}
