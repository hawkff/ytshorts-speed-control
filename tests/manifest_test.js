import { test } from "bun:test";
import assert from "node:assert/strict";
import firefoxManifest from "../manifest.firefox.json" with { type: "json" };
import chromeManifest from "../manifest.json" with { type: "json" };

test("browser manifests share the same extension definition", () => {
  const { browser_specific_settings: _firefoxSettings, ...firefoxShared } =
    firefoxManifest;

  assert.deepEqual(firefoxShared, chromeManifest);
  assert.match(chromeManifest.version, /^\d+\.\d+\.\d+$/);
});

test("Firefox manifest declares signing and privacy metadata", () => {
  const gecko = firefoxManifest.browser_specific_settings.gecko;

  assert.deepEqual(gecko.id, "ytshorts-speed-control@hawkff.github.io");
  assert.deepEqual(gecko.strict_min_version, "140.0");
  assert.deepEqual(gecko.data_collection_permissions, { required: ["none"] });
  assert.deepEqual(firefoxManifest.browser_specific_settings.gecko_android, {
    strict_min_version: "142.0",
  });
});
