/**
 * Shared, pure speed-math helpers for the YT Shorts Speed Control extension.
 *
 * This file is intentionally dependency-free and side-effect-free (apart from
 * attaching its API to `globalThis`). That lets the EXACT same file be:
 *   1. Loaded as a classic content script in the browser (no ES-module build
 *      step, which MV3 content scripts do not support natively), and
 *   2. Imported for unit tests under Deno via a side-effect import that reads
 *      `globalThis.YTShortsSpeed`.
 */
(function (root) {
  "use strict";

  // Hard limits. The HTMLMediaElement spec allows a wide range; browsers
  // commonly support ~0.0625x–16x. We expose a sane, useful window.
  const SPEED_MIN = 0.1;
  const SPEED_MAX = 16;
  const DEFAULT_SPEED = 1;

  // Preset rungs surfaced in the popup and stepped through via keyboard.
  // Kept sorted ascending; helpers rely on that ordering.
  const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

  /**
   * Round a speed to 2 decimal places to avoid floating-point dust
   * (e.g. 0.1 + 0.2 === 0.30000000000000004).
   * @param {number} value
   * @returns {number}
   */
  function roundSpeed(value) {
    return Math.round(value * 100) / 100;
  }

  /**
   * Whether a value is a usable, finite speed number.
   * @param {unknown} value
   * @returns {boolean}
   */
  function isValidSpeed(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }

  /**
   * Constrain a speed to [min, max] and round it. Non-finite input falls back
   * to DEFAULT_SPEED so callers never apply NaN to a media element.
   * @param {number} value
   * @param {number} [min]
   * @param {number} [max]
   * @returns {number}
   */
  function clampSpeed(value, min = SPEED_MIN, max = SPEED_MAX) {
    if (!Number.isFinite(value)) return DEFAULT_SPEED;
    return roundSpeed(Math.min(max, Math.max(min, value)));
  }

  /**
   * Parse arbitrary user input (string or number) into a valid clamped speed.
   * Strips a trailing "x" (e.g. "1.5x"). Returns null when unparseable so the
   * caller can decide how to handle bad input instead of silently coercing.
   * @param {unknown} input
   * @returns {number | null}
   */
  function parseSpeed(input) {
    let n;
    if (typeof input === "number") {
      n = input;
    } else if (typeof input === "string") {
      const cleaned = input.trim().replace(/x$/i, "").trim();
      if (cleaned === "") return null;
      n = Number(cleaned);
    } else {
      return null;
    }
    if (!Number.isFinite(n) || n <= 0) return null;
    return clampSpeed(n);
  }

  /**
   * Human-readable label for a speed, e.g. 1 -> "1x", 1.5 -> "1.5x".
   * Trailing zeros are trimmed (1.50 -> "1.5", 2.00 -> "2").
   * @param {number} value
   * @returns {string}
   */
  function formatSpeed(value) {
    if (!Number.isFinite(value)) return "1x";
    const rounded = roundSpeed(value);
    // toFixed(2) then strip trailing zeros and a trailing dot.
    const text = rounded.toFixed(2).replace(/\.?0+$/, "");
    return `${text}x`;
  }

  /**
   * Add `delta` to `current`, then clamp+round.
   * @param {number} current
   * @param {number} delta
   * @param {number} [min]
   * @param {number} [max]
   * @returns {number}
   */
  function adjustSpeed(current, delta, min = SPEED_MIN, max = SPEED_MAX) {
    const base = Number.isFinite(current) ? current : DEFAULT_SPEED;
    return clampSpeed(base + delta, min, max);
  }

  /**
   * The next preset strictly greater than `current`. If none is greater,
   * returns the highest preset (so stepping "up" saturates rather than wraps).
   * @param {number} current
   * @param {number[]} [presets]
   * @returns {number}
   */
  function nextPreset(current, presets = SPEED_PRESETS) {
    const sorted = [...presets].sort((a, b) => a - b);
    for (const p of sorted) {
      if (p > roundSpeed(current) + 1e-9) return p;
    }
    return sorted[sorted.length - 1];
  }

  /**
   * The next preset strictly less than `current`. If none is smaller,
   * returns the lowest preset (saturates rather than wraps).
   * @param {number} current
   * @param {number[]} [presets]
   * @returns {number}
   */
  function prevPreset(current, presets = SPEED_PRESETS) {
    const sorted = [...presets].sort((a, b) => a - b);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i] < roundSpeed(current) - 1e-9) return sorted[i];
    }
    return sorted[0];
  }

  const api = Object.freeze({
    SPEED_MIN,
    SPEED_MAX,
    DEFAULT_SPEED,
    SPEED_PRESETS: Object.freeze([...SPEED_PRESETS]),
    roundSpeed,
    isValidSpeed,
    clampSpeed,
    parseSpeed,
    formatSpeed,
    adjustSpeed,
    nextPreset,
    prevPreset,
  });

  // Browser (content script / popup) global + test harness handle.
  root.YTShortsSpeed = api;

  // CommonJS interop, harmless under Deno/ESM where `module` is undefined.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
