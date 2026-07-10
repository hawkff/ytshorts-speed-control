import { assertEquals, assertMatch } from "@std/assert";
import chromeManifest from "../manifest.json" with { type: "json" };
import firefoxManifest from "../manifest.firefox.json" with { type: "json" };

Deno.test("browser manifests share the same extension definition", () => {
  const { browser_specific_settings: _firefoxSettings, ...firefoxShared } =
    firefoxManifest;

  assertEquals(firefoxShared, chromeManifest);
  assertMatch(chromeManifest.version, /^\d+\.\d+\.\d+$/);
});

Deno.test("Firefox manifest declares signing and privacy metadata", () => {
  const gecko = firefoxManifest.browser_specific_settings.gecko;

  assertEquals(gecko.id, "ytshorts-speed-control@hawkff.github.io");
  assertEquals(gecko.strict_min_version, "140.0");
  assertEquals(gecko.data_collection_permissions, { required: ["none"] });
  assertEquals(
    firefoxManifest.browser_specific_settings.gecko_android,
    { strict_min_version: "142.0" },
  );
});
