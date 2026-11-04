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

  // ── Test files: relax no-explicit-any ────────────────────────────────────────
  {
    files: ["**/*.test.ts", "**/*.pbt.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
