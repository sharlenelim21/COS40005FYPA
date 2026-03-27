import { defineConfig } from "eslint/config";
import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default defineConfig([
  // Global ignores - add the dist directory to prevent linting compiled files
  {
    ignores: ["dist/**", "node_modules/**", "__tests__/**", "src/tests/**"],
  },

  // Base configurations
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,

  // Configuration for TypeScript files
  {
    files: ["**/*.ts"], // Fixed: Removed curly braces around extension
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs", // Changed to CommonJS to match your tsconfig
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
      },
      globals: {
        ...globals.node, // Changed from browser to node globals
      },
    },
    rules: {
      // Node.js specific rules
      "no-console": "warn", // Prefer using your custom logger instead of console
      "no-unused-vars": "off", // TypeScript handles this
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "no-return-await": "off",
      "@typescript-eslint/return-await": "error",
    },
  },

  // Configuration for test files with relaxed rules
  {
    files: ["**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },

  // Prettier config must be last
  eslintConfigPrettier,
]);
