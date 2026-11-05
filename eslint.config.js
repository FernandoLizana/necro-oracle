// @ts-check
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  // ── Type-aware rules: src files only ────────────────────────────────────────
  // These files are covered by their package tsconfig.json (include: src/**/*).
  {
    files: [
      "packages/*/src/**/*.ts",
      "packages/*/src/**/*.tsx",
      "packages/grimoires/**/*.ts",
      "apps/*/src/**/*.ts",
      "apps/*/src/**/*.tsx",
    ],
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            // Allow vitest config files to fall back to default project
            "packages/*/vitest.config.ts",
            "apps/*/vitest.config.ts",
            "vitest.config.ts",
          ],
          defaultProject: "./tsconfig.eslint.json",
        },
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs["eslint-recommended"]?.overrides?.[0]?.rules,
      ...tsPlugin.configs["recommended"]?.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },

  // ── Config files: syntax-only (no type-aware rules) ─────────────────────────
  // vitest.config.ts files and the root config are not part of any composite
  // project, so we lint them without type information.
  {
    files: [
      "vitest.config.ts",
      "packages/*/vitest.config.ts",
      "apps/*/vitest.config.ts",
      // Package-level test dirs sit outside the src-only tsconfig; parse them
      // with the TS parser but without type information.
      "packages/config/test/**/*.ts",
    ],
    ignores: ["**/node_modules/**", "**/dist/**"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        // No `project` — syntax-only parse for config files.
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs["eslint-recommended"]?.overrides?.[0]?.rules,
      ...tsPlugin.configs["recommended"]?.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // No type-aware rules here (no project).
    },
  },

  // ── @necro/github purity policy (R9.1, R9.2, R9.3, R3.2, R6.1) ──────────────
  // Package logic is pure: no ambient clock, network, env, fs, child processes
  // or dynamic code. Side effects live in adapters/ (and testing/ helpers).
  // Parser setup is inherited from the type-aware src block above.
  {
    files: ["packages/github/src/**/*.ts"],
    ignores: [
      "packages/github/src/adapters/**",
      "packages/github/src/testing/**",
      "**/*.test.ts",
      "**/*.pbt.test.ts",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Use an injected port/adapter; no ambient network in package logic." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.object.name='Date'][callee.property.name='now']",
          message: "Date.now() is banned; inject a clock.",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "new Date() without arguments is banned; inject a clock.",
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: "Bare Date() is banned; inject a clock.",
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "process.env is banned; take config via @necro/config.",
        },
        {
          selector: "CallExpression[callee.name='eval']",
          message: "eval is banned.",
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: "new Function is banned.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: ["node:fs", "node:child_process", "node:vm"].map((name) => ({
            name,
            message: "Side-effecting Node modules belong in adapters/.",
          })),
        },
      ],
    },
  },

  // ── Client boundary: @necro/ui-crt source (R14.1, R14.8, R16.2–R16.4, R16.7) ─
  // Everything under packages/ui-crt/src is client-safe code bundled into the
  // browser. It must never import a server-only package (@necro/github,
  // @necro/config), the oracle MAIN entry (only @necro/oracle/client is
  // allowed), or a Node builtin (node:*), and it must never use a dangerous DOM
  // sink (dangerouslySetInnerHTML / eval / new Function / postMessage) or a
  // non-literal dynamic import. A string-literal import("./engine.js") is fine
  // (deliberate lazy chunk) and is not a MemberExpression/Identifier argument,
  // so the ImportExpression rule below only fires on non-literal arguments.
  {
    files: ["packages/ui-crt/src/**/*.ts", "packages/ui-crt/src/**/*.tsx"],
    ignores: [
      "packages/ui-crt/src/**/*.test.ts",
      "packages/ui-crt/src/**/*.test.tsx",
      "packages/ui-crt/src/**/*.pbt.test.ts",
      "packages/ui-crt/src/**/*.conformance.test.ts",
      "packages/ui-crt/src/testing/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@necro/github", message: "Client code must not import @necro/github (server-only)." },
            { name: "@necro/config", message: "Client code must not import @necro/config (server-only env)." },
            {
              name: "@necro/oracle",
              message: "Client code must import from @necro/oracle/client, never the main entry.",
            },
          ],
          patterns: [
            {
              group: ["node:*"],
              message: "Client code must not import Node builtins (node:*).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='eval']",
          message: "eval is banned in client code.",
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: "new Function is banned in client code.",
        },
        {
          selector: "CallExpression[callee.property.name='postMessage']",
          message: "postMessage is banned in client code.",
        },
        {
          selector: "CallExpression[callee.name='postMessage']",
          message: "postMessage is banned in client code.",
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML is banned in client code.",
        },
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML is banned in client code.",
        },
        {
          selector: "ImportExpression[source.type!='Literal']",
          message: "Dynamic import() must use a string literal path (deliberate lazy chunk only).",
        },
      ],
    },
  },

  // ── Client boundary: apps/web client-safe modules (R14.1, R14.8, R16.2–R16.4) ─
  // Only the modules that are bundled into the browser are scoped here: the
  // Terminal browser adapters, the client screen, and the demo-bundle loader.
  // The server-only trees (server/**, app/api/**, demo/build-demo.ts) are NOT
  // matched, so they keep their legitimate @necro/github / node:* imports.
  {
    files: [
      "apps/web/src/terminal/api-client.ts",
      "apps/web/src/terminal/browser-ports.ts",
      "apps/web/src/terminal/ndjson.ts",
      "apps/web/src/components/TerminalScreen.tsx",
      "apps/web/src/demo/load-bundle.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@necro/github", message: "Client code must not import @necro/github (server-only)." },
            { name: "@necro/config", message: "Client code must not import @necro/config (server-only env)." },
            {
              name: "@necro/oracle",
              message: "Client code must import from @necro/oracle/client, never the main entry.",
            },
          ],
          patterns: [
            {
              group: ["node:*"],
              message: "Client code must not import Node builtins (node:*).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='eval']",
          message: "eval is banned in client code.",
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: "new Function is banned in client code.",
        },
        {
          selector: "CallExpression[callee.property.name='postMessage']",
          message: "postMessage is banned in client code.",
        },
        {
          selector: "CallExpression[callee.name='postMessage']",
          message: "postMessage is banned in client code.",
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML is banned in client code.",
        },
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML is banned in client code.",
        },
        {
          selector: "ImportExpression[source.type!='Literal']",
          message: "Dynamic import() must use a string literal path (deliberate lazy chunk only).",
        },
      ],
    },
  },

  // ── @necro/oracle tests: excluded from its src tsconfig, parse without types ─
  {
    files: ["packages/oracle/src/**/*.test.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },

  // ── Test files: relax no-explicit-any ────────────────────────────────────────
  {
    files: ["**/*.test.ts", "**/*.pbt.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
