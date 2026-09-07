import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Deliberately not type-aware: the type errors are typescript's job (`pnpm typecheck` already
 * runs in CI), and a second full type-check per lint would double the wait for rules that mostly
 * catch typos. What is left is the small set worth failing a build over.
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly", NodeJS: "readonly", setTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", clearTimeout: "readonly", fetch: "readonly", URL: "readonly", AbortController: "readonly", TextDecoder: "readonly", TextEncoder: "readonly", __dirname: "readonly" },
    },
    rules: {
      // An argument named _ or a caught error nobody reads is intent, not an oversight.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // Nest's DI and drizzle's inference both produce shapes that are genuinely awkward to name;
      // an explicit `any` in those places is a decision, and typecheck still guards the rest.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
