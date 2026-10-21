/**
 * Unit tests for the shared settings helpers in ../lib/settings.js.
 *
 * lib/settings.js is a classic (non-module) script that attaches its API to
 * globalThis. Importing it for its side effect populates
 * globalThis.YTShortsSettings, which we then exercise here.
 *
 * Copyright (C) 2026 hawkff
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import "../lib/settings.js";

const Settings = globalThis.YTShortsSettings;

test("API is exposed on globalThis and frozen", () => {
  assert.deepEqual(typeof Settings, "object");
  assert(Object.isFrozen(Settings));
  assert(Object.isFrozen(Settings.DEFAULT_SETTINGS));
  assert.deepEqual(Settings.DEFAULT_SETTINGS, { enableOnWatch: false });
});

test("normalizeSettings returns defaults for non-object input", () => {
  assert.deepEqual(Settings.normalizeSettings(undefined), {
    enableOnWatch: false,
  });
  assert.deepEqual(Settings.normalizeSettings(null), { enableOnWatch: false });
  assert.deepEqual(Settings.normalizeSettings({}), { enableOnWatch: false });
  assert.deepEqual(Settings.normalizeSettings("string"), {
    enableOnWatch: false,
  });
});

test("normalizeSettings adopts a boolean enableOnWatch", () => {
  assert.deepEqual(Settings.normalizeSettings({ enableOnWatch: true }), {
    enableOnWatch: true,
  });
});

test("normalizeSettings filters wrongly-typed enableOnWatch", () => {
  assert.deepEqual(Settings.normalizeSettings({ enableOnWatch: "yes" }), {
    enableOnWatch: false,
  });
});

test("normalizeSettings strips unknown keys", () => {
  assert.deepEqual(
    Settings.normalizeSettings({ enableOnWatch: true, evil: 1 }),
    { enableOnWatch: true },
  );
});
