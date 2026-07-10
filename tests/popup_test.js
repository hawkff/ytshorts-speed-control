/**
 * Tests for the real popup script (src/popup.js) via the popup harness.
 *
 * Copyright (C) 2026 hawkff
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { deferred, startPopup } from "./helpers/popup_harness.js";

function storageSetCalls(env) {
  return env.calls.filter((call) => call.api === "storage.set");
}

Deno.test("bootstrap renders the stored speed and all presets", async () => {
  let env;
  try {
    env = await startPopup({ stored: { speed: 1.5 } });

    assertEquals(env.els["current-speed"].textContent, "1.5x");
    assertEquals(env.els["slider"].value, "1.5");
    assertEquals(env.presetButtons().length, 10);
  } finally {
    env?.restore();
  }
});

Deno.test("speed: storage and live success report full success", async () => {
  let env;
  try {
    env = await startPopup({ stored: { speed: 1.5 } });

    await env.submitCustom(2);

    assertEquals(env.els["current-speed"].textContent, "2x");
    assertEquals(env.els["custom-input"].value, "");
    assertEquals(env.status(), { text: "Playing at 2x.", warn: false });
  } finally {
    env?.restore();
  }
});

Deno.test("speed: total failure reverts and warns, keeps input", async () => {
  let env;
  try {
    env = await startPopup({
      stored: { speed: 1.5 },
      onStorageSet() {
        throw new Error("storage down");
      },
      onOperationMessage() {
        throw new Error("no receiver");
      },
    });

    await env.submitCustom(2);

    assertEquals(env.els["current-speed"].textContent, "1.5x");
    assertEquals(env.els["custom-input"].value, "2");
    assertEquals(env.status(), {
      text: "Couldn't save or apply that speed.",
      warn: true,
    });
  } finally {
    env?.restore();
  }
});

Deno.test("speed: live-only success keeps state and warns about saving", async () => {
  let env;
  try {
    env = await startPopup({
      stored: { speed: 1.5 },
      onStorageSet() {
        throw new Error("storage down");
      },
    });

    await env.submitCustom(2);

    assertEquals(env.els["current-speed"].textContent, "2x");
    assertEquals(env.els["custom-input"].value, "");
    assertEquals(env.status(), {
      text: "Applied for this tab, but couldn't save the speed.",
      warn: true,
    });
  } finally {
    env?.restore();
  }
});

Deno.test("speed: storage-only success keeps state and asks to reload", async () => {
  let env;
  try {
    env = await startPopup({
      stored: { speed: 1.5 },
      onOperationMessage() {
        throw new Error("no receiver");
      },
    });

    await env.submitCustom(2);

    assertEquals(env.els["current-speed"].textContent, "2x");
    assertEquals(env.els["custom-input"].value, "");
    assertEquals(env.status(), {
      text: "Saved 2x. Open or reload YouTube to apply it.",
      warn: true,
    });
  } finally {
    env?.restore();
  }
});

Deno.test("settings: storage and live success report saved", async () => {
  let env;
  try {
    env = await startPopup({
      stored: { settings: { enableOnWatch: false } },
    });
    assertFalse(env.els["enable-on-watch"].checked);

    await env.toggleEnableOnWatch(true);

    assert(env.els["enable-on-watch"].checked);
    assertEquals(env.status(), { text: "Setting saved.", warn: false });
  } finally {
    env?.restore();
  }
});

Deno.test("settings: total failure reverts checkbox and warns", async () => {
  let env;
  try {
    env = await startPopup({
      stored: { settings: { enableOnWatch: false } },
      onStorageSet() {
        throw new Error("storage down");
      },
      onOperationMessage() {
        throw new Error("no receiver");
      },
    });

    await env.toggleEnableOnWatch(true);

    assertFalse(env.els["enable-on-watch"].checked);
    assertEquals(env.status(), {
      text: "Couldn't save or apply that setting.",
      warn: true,
    });
  } finally {
    env?.restore();
  }
});

Deno.test("settings: storage-only success stays checked and asks to reload", async () => {
  let env;
  try {
    env = await startPopup({
      stored: { settings: { enableOnWatch: false } },
      onOperationMessage() {
        throw new Error("no receiver");
      },
    });

    await env.toggleEnableOnWatch(true);

    assert(env.els["enable-on-watch"].checked);
    assertEquals(env.status(), {
      text: "Setting saved. Open or reload YouTube to apply it.",
      warn: true,
    });
  } finally {
    env?.restore();
  }
});

Deno.test("settings: live-only success stays checked and warns about saving", async () => {
  let env;
  try {
    env = await startPopup({
      stored: { settings: { enableOnWatch: false } },
      onStorageSet() {
        throw new Error("storage down");
      },
    });

    await env.toggleEnableOnWatch(true);

    assert(env.els["enable-on-watch"].checked);
    assertEquals(env.status(), {
      text: "Applied for this tab, but couldn't save the setting.",
      warn: true,
    });
  } finally {
    env?.restore();
  }
});

Deno.test("speed: overlapping requests are serialized and stale failure cannot touch the UI", async () => {
  const olderStorage = deferred();
  const newerStorage = deferred();
  let env;
  try {
    env = await startPopup({
      stored: { speed: 1.5 },
      onStorageSet(_value, call) {
        return call === 1 ? olderStorage.promise : newerStorage.promise;
      },
      onOperationMessage(_message, call) {
        if (call === 1) throw new Error("no receiver");
        return { ok: true };
      },
    });
    const bootstrapStatus = env.status();

    // Older operation: storage stays pending, so its side effects block the
    // queue.
    const older = env.submitCustom(2);
    await env.flush();
    assertEquals(storageSetCalls(env).length, 1);
    assertEquals(storageSetCalls(env)[0].value, { speed: 2 });

    // Newer operation renders optimistically but must not reach storage yet.
    const newer = env.submitCustom(3);
    await env.flush();
    assertEquals(storageSetCalls(env).length, 1);
    assertEquals(env.els["current-speed"].textContent, "3x");

    // Older fails completely, but it is stale: no rollback, no status, and
    // it must not clear the newer input.
    olderStorage.reject(new Error("storage down"));
    await older;
    assertEquals(env.els["current-speed"].textContent, "3x");
    assertEquals(env.els["custom-input"].value, "3");
    assertEquals(env.status(), bootstrapStatus);

    // Newer proceeds only after the older settled, and wins the UI.
    await env.flush();
    assertEquals(storageSetCalls(env).length, 2);
    assertEquals(storageSetCalls(env)[1].value, { speed: 3 });
    newerStorage.resolve();
    await newer;
    assertEquals(env.els["current-speed"].textContent, "3x");
    assertEquals(env.els["custom-input"].value, "");
    assertEquals(env.status(), { text: "Playing at 3x.", warn: false });
  } finally {
    env?.restore();
  }
});

Deno.test("settings: overlapping requests are serialized and stale failure cannot revert", async () => {
  const olderStorage = deferred();
  const newerStorage = deferred();
  let env;
  try {
    env = await startPopup({
      stored: { settings: { enableOnWatch: false } },
      onStorageSet(_value, call) {
        return call === 1 ? olderStorage.promise : newerStorage.promise;
      },
      onOperationMessage(_message, call) {
        if (call === 1) throw new Error("no receiver");
        return { ok: true };
      },
    });
    const bootstrapStatus = env.status();

    // Older operation turns the setting on; storage stays pending.
    const older = env.toggleEnableOnWatch(true);
    await env.flush();
    assertEquals(storageSetCalls(env).length, 1);
    assertEquals(storageSetCalls(env)[0].value, {
      settings: { enableOnWatch: true },
    });

    // Newer operation flips it back off; must not reach storage yet.
    const newer = env.toggleEnableOnWatch(false);
    await env.flush();
    assertEquals(storageSetCalls(env).length, 1);
    assertFalse(env.els["enable-on-watch"].checked);

    // Older fails completely but is stale: no revert, no status change.
    olderStorage.reject(new Error("storage down"));
    await older;
    assertFalse(env.els["enable-on-watch"].checked);
    assertEquals(env.status(), bootstrapStatus);

    // Newer proceeds and reports success.
    await env.flush();
    assertEquals(storageSetCalls(env).length, 2);
    assertEquals(storageSetCalls(env)[1].value, {
      settings: { enableOnWatch: false },
    });
    newerStorage.resolve();
    await newer;
    assertFalse(env.els["enable-on-watch"].checked);
    assertEquals(env.status(), { text: "Setting saved.", warn: false });
  } finally {
    env?.restore();
  }
});

Deno.test("raw API error details never reach the status line", async () => {
  let env;
  try {
    env = await startPopup({
      stored: { speed: 1.5, settings: { enableOnWatch: false } },
      onStorageSet() {
        throw new Error("SENTINEL_STORAGE_FAILURE");
      },
      onOperationMessage() {
        throw new Error("SENTINEL_MESSAGE_FAILURE");
      },
    });

    await env.submitCustom(2);
    assertFalse(env.els["status"].textContent.includes("SENTINEL"));

    await env.toggleEnableOnWatch(true);
    assertFalse(env.els["status"].textContent.includes("SENTINEL"));
  } finally {
    env?.restore();
  }
});
