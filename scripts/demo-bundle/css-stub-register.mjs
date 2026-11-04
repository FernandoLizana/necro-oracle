// scripts/demo-bundle/css-stub-register.mjs
//
// Registers the CSS-stub loader hooks (css-stub-loader.mjs) for the current
// process. Used ONLY by the demo-bundle generator via `node --import` so that
// importing the `@necro/ui-crt` barrel — which transitively pulls `crt.css` —
// does not throw ERR_UNKNOWN_FILE_EXTENSION. The generator never reads the
// stylesheet; this is a build-time generator concern, not part of the shipped
// web bundle.

import { register } from "node:module";

register("./css-stub-loader.mjs", import.meta.url);
