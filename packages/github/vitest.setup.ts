// Offline guard (R9.1): any accidental use of the real network fails loudly.
// Tests must inject the fixture-backed FetchPort instead.
globalThis.fetch = (() => {
  throw new Error(
    "global fetch is disabled in @necro/github tests; use the fixture FetchPort",
  );
}) as typeof fetch;
