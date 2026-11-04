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

  // ── Test files: relax no-explicit-any ────────────────────────────────────────
  {
    files: ["**/*.test.ts", "**/*.pbt.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
