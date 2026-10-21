/**
 * Unit tests for the pure speed helpers in ../lib/speed.js.
 *
 * lib/speed.js is a classic (non-module) script that attaches its API to
 * globalThis. Importing it for its side effect populates
 * globalThis.YTShortsSpeed, which we then exercise here.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import "../lib/speed.js";

const Speed = globalThis.YTShortsSpeed;

test("API is exposed on globalThis", () => {
  assert.deepEqual(typeof Speed, "object");
  assert.deepEqual(Speed.DEFAULT_SPEED, 1);
  assert.deepEqual(Speed.SPEED_MIN, 0.1);
  assert.deepEqual(Speed.SPEED_MAX, 16);
  assert.deepEqual(Speed.KEYBOARD_STEP, 0.25);
});

test("roundSpeed kills floating-point dust", () => {
  assert.deepEqual(Speed.roundSpeed(0.1 + 0.2), 0.3);
  assert.deepEqual(Speed.roundSpeed(1.255), 1.25);
  assert.deepEqual(Speed.roundSpeed(2), 2);
  // The speeds this extension actually uses (0.05 / 0.25 steps) round cleanly.
  assert.deepEqual(Speed.roundSpeed(1.25 + 0.25), 1.5);
});

test("clampSpeed constrains to bounds", () => {
  assert.deepEqual(Speed.clampSpeed(1), 1);
  assert.deepEqual(Speed.clampSpeed(100), 16);
  assert.deepEqual(Speed.clampSpeed(0.01), 0.1);
  assert.deepEqual(Speed.clampSpeed(2.5), 2.5);
});

test("clampSpeed falls back to default on non-finite input", () => {
  assert.deepEqual(Speed.clampSpeed(NaN), 1);
  assert.deepEqual(Speed.clampSpeed(Infinity), 1);
  assert.deepEqual(Speed.clampSpeed(-Infinity), 1);
});

test("clampSpeed respects custom bounds", () => {
  assert.deepEqual(Speed.clampSpeed(5, 0.5, 3), 3);
  assert.deepEqual(Speed.clampSpeed(0.1, 0.5, 3), 0.5);
});

test("parseSpeed handles numbers", () => {
  assert.deepEqual(Speed.parseSpeed(1.5), 1.5);
  assert.deepEqual(Speed.parseSpeed(100), 16); // clamped
  assert.deepEqual(Speed.parseSpeed(0), null);
  assert.deepEqual(Speed.parseSpeed(-2), null);
});

test("parseSpeed handles strings, including trailing x", () => {
  assert.deepEqual(Speed.parseSpeed("1.5"), 1.5);
  assert.deepEqual(Speed.parseSpeed("1.5x"), 1.5);
  assert.deepEqual(Speed.parseSpeed("2X"), 2);
  assert.deepEqual(Speed.parseSpeed("  0.75  "), 0.75);
  assert.deepEqual(Speed.parseSpeed(""), null);
  assert.deepEqual(Speed.parseSpeed("abc"), null);
  assert.deepEqual(Speed.parseSpeed("x"), null);
});

test("parseSpeed rejects non-string/number input", () => {
  assert.deepEqual(Speed.parseSpeed(null), null);
  assert.deepEqual(Speed.parseSpeed(undefined), null);
  assert.deepEqual(Speed.parseSpeed({}), null);
  assert.deepEqual(Speed.parseSpeed([]), null);
});

test("formatSpeed trims trailing zeros and appends x", () => {
  assert.deepEqual(Speed.formatSpeed(1), "1x");
  assert.deepEqual(Speed.formatSpeed(1.5), "1.5x");
  assert.deepEqual(Speed.formatSpeed(1.25), "1.25x");
  assert.deepEqual(Speed.formatSpeed(2.0), "2x");
  assert.deepEqual(Speed.formatSpeed(0.5), "0.5x");
  assert.deepEqual(Speed.formatSpeed(NaN), "1x");
});

test("adjustSpeed adds delta then clamps", () => {
  assert.deepEqual(Speed.adjustSpeed(1, 0.25), 1.25);
  assert.deepEqual(Speed.adjustSpeed(1, -0.25), 0.75);
  assert.deepEqual(Speed.adjustSpeed(16, 1), 16); // saturates at max
  assert.deepEqual(Speed.adjustSpeed(0.1, -1), 0.1); // saturates at min
  assert.deepEqual(Speed.adjustSpeed(NaN, 0.25), 1.25); // base falls back to default
});

test("SPEED_PRESETS is frozen and ascending", () => {
  const presets = Speed.SPEED_PRESETS;
  assert.deepEqual(Object.isFrozen(presets), true);
  for (let i = 1; i < presets.length; i++) {
    assert.equal(presets[i] > presets[i - 1], true);
  }
});
