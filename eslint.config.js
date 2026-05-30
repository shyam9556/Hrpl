import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

/**
 * ESLint flat config for solar-app.
 *
 * i18n (internationalization) rules are intentionally disabled.
 * This is a single-language (English) internal B2B application
 * for Indian solar dealers. Multi-language support is not a project
 * requirement and will never be added. The i18n warnings produced by
 * IDE static analysis are therefore false positives for this codebase.
 */
export default [
  // ─── Global ignores ───────────────────────────────────
  {
    ignores: ["dist/**", "node_modules/**", "server/**"],
  },

  // ─── Source files ─────────────────────────────────────
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // ─── ESLint core ──────────────────────────────────
      ...js.configs.recommended.rules,

      // ─── React Hooks ──────────────────────────────────
      ...reactHooks.configs.recommended.rules,

      // ─── React Refresh ────────────────────────────────
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // ─── i18n — intentionally OFF ─────────────────────
      // This project is a single-language English application.
      // Multi-language support is not a requirement.
      "i18n-text/no-en": "off",
      "i18next/no-literal-string": "off",
      "react/jsx-no-literals": "off",
    },
  },
];
