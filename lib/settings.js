/**
 * Shared settings defaults + normalizer for the YT Shorts Speed Control
 * extension.
 *
 * Copyright (C) 2026 hawkff
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is intentionally dependency-free and side-effect-free (apart from
 * attaching its API to `globalThis`). That lets the EXACT same file be:
 *   1. Loaded as a classic content script in the browser (no ES-module build
 *      step, which MV3 content scripts do not support natively), and
 *   2. Imported for unit tests under Deno via a side-effect import that reads
 *      `globalThis.YTShortsSettings`.
 */
(function (root) {
  "use strict";

  /**
   * Default extension settings; single source of truth for content + popup.
   */
  const DEFAULT_SETTINGS = Object.freeze({
    // When true, the same speed control also applies to regular YouTube
    // watch pages (/watch). Off by default: Shorts only.
    enableOnWatch: false,
  });

  /**
   * Coerce arbitrary input (stored data, messages) into a valid settings
   * object: only known keys, correct types, defaults for everything else.
   * Handles null/undefined/non-object input, so callers need no pre-checks.
   * @param {unknown} incoming
   * @returns {{ enableOnWatch: boolean }}
   */
  function normalizeSettings(incoming) {
    const next = { ...DEFAULT_SETTINGS };
    if (
      incoming && typeof incoming === "object" &&
      typeof (/** @type {Record<string, unknown>} */ (incoming))
          .enableOnWatch === "boolean"
    ) {
      next.enableOnWatch = incoming.enableOnWatch;
    }
    return next;
  }

  const api = Object.freeze({ DEFAULT_SETTINGS, normalizeSettings });

  // Browser (content script / popup) global + test harness handle.
  root.YTShortsSettings = api;

  // CommonJS interop, harmless under Deno/ESM where `module` is undefined.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
