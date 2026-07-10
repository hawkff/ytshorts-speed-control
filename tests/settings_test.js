/**
 * Unit tests for the shared settings helpers in ../lib/settings.js.
 *
 * lib/settings.js is a classic (non-module) script that attaches its API to
 * globalThis. Importing it for its side effect under Deno populates
 * globalThis.YTShortsSettings, which we then exercise here.
 *
 * Copyright (C) 2026 hawkff
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { assert, assertEquals } from "@std/assert";
import "../lib/settings.js";

const Settings = globalThis.YTShortsSettings;

Deno.test("API is exposed on globalThis and frozen", () => {
  assertEquals(typeof Settings, "object");
  assert(Object.isFrozen(Settings));
  assert(Object.isFrozen(Settings.DEFAULT_SETTINGS));
  assertEquals(Settings.DEFAULT_SETTINGS, { enableOnWatch: false });
});

Deno.test("normalizeSettings returns defaults for non-object input", () => {
  assertEquals(Settings.normalizeSettings(undefined), { enableOnWatch: false });
  assertEquals(Settings.normalizeSettings(null), { enableOnWatch: false });
  assertEquals(Settings.normalizeSettings({}), { enableOnWatch: false });
  assertEquals(Settings.normalizeSettings("string"), { enableOnWatch: false });
});

Deno.test("normalizeSettings adopts a boolean enableOnWatch", () => {
  assertEquals(Settings.normalizeSettings({ enableOnWatch: true }), {
    enableOnWatch: true,
  });
});

Deno.test("normalizeSettings filters wrongly-typed enableOnWatch", () => {
  assertEquals(Settings.normalizeSettings({ enableOnWatch: "yes" }), {
    enableOnWatch: false,
  });
});

Deno.test("normalizeSettings strips unknown keys", () => {
  assertEquals(Settings.normalizeSettings({ enableOnWatch: true, evil: 1 }), {
    enableOnWatch: true,
  });
});
