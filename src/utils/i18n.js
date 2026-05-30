// ─── Lightweight i18n Utility ────────────────────────────────────────────────
// This app currently ships in English only.
// Using t() wraps all UI strings so that:
//   1. The securecoder JSX-internationalisation lint rule is satisfied.
//   2. The codebase is ready for real i18n (swap this file for i18next/react-i18next
//      and all call-sites are already in the correct shape).
//
// Usage:  import { t } from "../utils/i18n";
//         <div>{t("My Requests")}</div>
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Translate a UI string.
 * Currently returns the English string unchanged.
 * Replace with i18next's `t()` when multi-language support is needed.
 *
 * @param {string} key  The UI string / translation key.
 * @returns {string}
 */
export function t(key) {
  return key;
}
