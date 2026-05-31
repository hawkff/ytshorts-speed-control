/**
 * Unit tests for the pure speed helpers in ../lib/speed.js.
 *
 * lib/speed.js is a classic (non-module) script that attaches its API to
 * globalThis. Importing it for its side effect under Deno populates
 * globalThis.YTShortsSpeed, which we then exercise here.
 */
import { assertEquals, assertStrictEquals } from "@std/assert";
import "../lib/speed.js";

const Speed = globalThis.YTShortsSpeed;

Deno.test("API is exposed on globalThis", () => {
  assertEquals(typeof Speed, "object");
  assertEquals(Speed.DEFAULT_SPEED, 1);
  assertEquals(Speed.SPEED_MIN, 0.1);
  assertEquals(Speed.SPEED_MAX, 16);
  assertEquals(Speed.KEYBOARD_STEP, 0.25);
});

Deno.test("roundSpeed kills floating-point dust", () => {
  assertEquals(Speed.roundSpeed(0.1 + 0.2), 0.3);
  assertEquals(Speed.roundSpeed(1.255), 1.25);
  assertEquals(Speed.roundSpeed(2), 2);
  // The speeds this extension actually uses (0.05 / 0.25 steps) round cleanly.
  assertEquals(Speed.roundSpeed(1.25 + 0.25), 1.5);
});

Deno.test("isValidSpeed distinguishes usable speeds", () => {
  assertStrictEquals(Speed.isValidSpeed(1), true);
  assertStrictEquals(Speed.isValidSpeed(0.25), true);
  assertStrictEquals(Speed.isValidSpeed(0), false);
  assertStrictEquals(Speed.isValidSpeed(-1), false);
  assertStrictEquals(Speed.isValidSpeed(NaN), false);
  assertStrictEquals(Speed.isValidSpeed(Infinity), false);
  assertStrictEquals(Speed.isValidSpeed("1"), false);
  assertStrictEquals(Speed.isValidSpeed(null), false);
  assertStrictEquals(Speed.isValidSpeed(undefined), false);
});

Deno.test("clampSpeed constrains to bounds", () => {
  assertEquals(Speed.clampSpeed(1), 1);
  assertEquals(Speed.clampSpeed(100), 16);
  assertEquals(Speed.clampSpeed(0.01), 0.1);
  assertEquals(Speed.clampSpeed(2.5), 2.5);
});

Deno.test("clampSpeed falls back to default on non-finite input", () => {
  assertEquals(Speed.clampSpeed(NaN), 1);
  assertEquals(Speed.clampSpeed(Infinity), 1);
  assertEquals(Speed.clampSpeed(-Infinity), 1);
});

Deno.test("clampSpeed respects custom bounds", () => {
  assertEquals(Speed.clampSpeed(5, 0.5, 3), 3);
  assertEquals(Speed.clampSpeed(0.1, 0.5, 3), 0.5);
});

Deno.test("parseSpeed handles numbers", () => {
  assertEquals(Speed.parseSpeed(1.5), 1.5);
  assertEquals(Speed.parseSpeed(100), 16); // clamped
  assertEquals(Speed.parseSpeed(0), null);
  assertEquals(Speed.parseSpeed(-2), null);
});

Deno.test("parseSpeed handles strings, including trailing x", () => {
  assertEquals(Speed.parseSpeed("1.5"), 1.5);
  assertEquals(Speed.parseSpeed("1.5x"), 1.5);
  assertEquals(Speed.parseSpeed("2X"), 2);
  assertEquals(Speed.parseSpeed("  0.75  "), 0.75);
  assertEquals(Speed.parseSpeed(""), null);
  assertEquals(Speed.parseSpeed("abc"), null);
  assertEquals(Speed.parseSpeed("x"), null);
});

Deno.test("parseSpeed rejects non-string/number input", () => {
  assertEquals(Speed.parseSpeed(null), null);
  assertEquals(Speed.parseSpeed(undefined), null);
  assertEquals(Speed.parseSpeed({}), null);
  assertEquals(Speed.parseSpeed([]), null);
});

Deno.test("formatSpeed trims trailing zeros and appends x", () => {
  assertEquals(Speed.formatSpeed(1), "1x");
  assertEquals(Speed.formatSpeed(1.5), "1.5x");
  assertEquals(Speed.formatSpeed(1.25), "1.25x");
  assertEquals(Speed.formatSpeed(2.0), "2x");
  assertEquals(Speed.formatSpeed(0.5), "0.5x");
  assertEquals(Speed.formatSpeed(NaN), "1x");
});

Deno.test("adjustSpeed adds delta then clamps", () => {
  assertEquals(Speed.adjustSpeed(1, 0.25), 1.25);
  assertEquals(Speed.adjustSpeed(1, -0.25), 0.75);
  assertEquals(Speed.adjustSpeed(16, 1), 16); // saturates at max
  assertEquals(Speed.adjustSpeed(0.1, -1), 0.1); // saturates at min
  assertEquals(Speed.adjustSpeed(NaN, 0.25), 1.25); // base falls back to default
});

Deno.test("nextPreset steps up and saturates", () => {
  assertEquals(Speed.nextPreset(1), 1.25);
  assertEquals(Speed.nextPreset(0.25), 0.5);
  assertEquals(Speed.nextPreset(2), 2.5);
  assertEquals(Speed.nextPreset(4), 4); // already highest
  assertEquals(Speed.nextPreset(10), 4); // beyond highest
});

Deno.test("prevPreset steps down and saturates", () => {
  assertEquals(Speed.prevPreset(1), 0.75);
  assertEquals(Speed.prevPreset(4), 3);
  assertEquals(Speed.prevPreset(0.25), 0.25); // already lowest
  assertEquals(Speed.prevPreset(0.1), 0.25); // below lowest -> lowest
});

Deno.test("SPEED_PRESETS is frozen and ascending", () => {
  const presets = Speed.SPEED_PRESETS;
  assertEquals(Object.isFrozen(presets), true);
  for (let i = 1; i < presets.length; i++) {
    assertStrictEquals(presets[i] > presets[i - 1], true);
  }
});
