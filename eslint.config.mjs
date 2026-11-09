// @ts-check
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/dist/", "**/.next/", "**/coverage/", "**/next-env.d.ts"]),
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        // Each workspace's tsconfig.json tells ESLint which files belong to it,
        // so type-aware rules see exactly what the compiler sees.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Readability over brevity: this codebase is also teaching material.
      "one-var": ["error", "never"],
      "no-nested-ternary": "error",
      eqeqeq: ["error", "always"],
      // Use the injected logger; console output bypasses redaction and log levels.
      "no-console": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // NestJS modules are empty classes that exist for their decorator.
      "@typescript-eslint/no-extraneous-class": [
        "error",
        { allowWithDecorator: true },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    // Plain JavaScript config files have no type information to check.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Last, so formatting rules never fight Prettier.
  prettier,
]);
