import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "relay-server"] },
  {
    // Don't error on eslint-disable comments left for rules we've turned off.
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Traditional hooks rules only — React Compiler rules (react-hooks v7+) require
      // the React 19 compiler, which this project does not use.
      "react-hooks/rules-of-hooks": "error",
      // exhaustive-deps produces too many false positives with the Zustand
      // subscription pattern (stable action refs, version-counter deps).
      "react-hooks/exhaustive-deps": "off",

      // `any` is unavoidable at Tauri IPC boundaries; suppress globally.
      "@typescript-eslint/no-explicit-any": "off",

      // Unused vars are errors; args/vars prefixed with _ are intentionally unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Empty catch blocks are common in fire-and-forget Tauri event handlers.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
