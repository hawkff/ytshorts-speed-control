/**
 * Dependency-free harness that runs the REAL popup script (src/popup.js)
 * against fake DOM and WebExtension doubles.
 *
 * Copyright (C) 2026 hawkff
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import "../../lib/speed.js";

const popupImports = [
  () => import("../../src/popup.js?popup-harness=0"),
  () => import("../../src/popup.js?popup-harness=1"),
  () => import("../../src/popup.js?popup-harness=2"),
  () => import("../../src/popup.js?popup-harness=3"),
  () => import("../../src/popup.js?popup-harness=4"),
  () => import("../../src/popup.js?popup-harness=5"),
  () => import("../../src/popup.js?popup-harness=6"),
  () => import("../../src/popup.js?popup-harness=7"),
  () => import("../../src/popup.js?popup-harness=8"),
  () => import("../../src/popup.js?popup-harness=9"),
  () => import("../../src/popup.js?popup-harness=10"),
  () => import("../../src/popup.js?popup-harness=11"),
  () => import("../../src/popup.js?popup-harness=12"),
  () => import("../../src/popup.js?popup-harness=13"),
  () => import("../../src/popup.js?popup-harness=14"),
  () => import("../../src/popup.js?popup-harness=15"),
  () => import("../../src/popup.js?popup-harness=16"),
  () => import("../../src/popup.js?popup-harness=17"),
  () => import("../../src/popup.js?popup-harness=18"),
  () => import("../../src/popup.js?popup-harness=19"),
  () => import("../../src/popup.js?popup-harness=20"),
  () => import("../../src/popup.js?popup-harness=21"),
  () => import("../../src/popup.js?popup-harness=22"),
  () => import("../../src/popup.js?popup-harness=23"),
];

let nextPopupImport = 0;

/** Create a manually-settled promise for scripting async outcomes. */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** IDs the popup collects via document.getElementById. */
const ELEMENT_IDS = [
  "status",
  "current-speed",
  "slider",
  "presets",
  "custom-form",
  "custom-input",
  "reset",
  "enable-on-watch",
  "hint-up",
  "hint-down",
  "hint-reset",
];

/**
 * Minimal element double covering everything the popup script touches:
 * textContent, value, min/max, checked, dataset, classList.toggle/contains,
 * querySelectorAll, appendChild, and async-aware event dispatch.
 */
function createFakeElement(tagName = "div") {
  const listeners = new Map();
  const classes = new Set();
  const el = {
    tagName: String(tagName).toUpperCase(),
    textContent: "",
    value: "",
    min: "",
    max: "",
    checked: false,
    type: "",
    className: "",
    dataset: {},
    children: [],
    classList: {
      toggle(name, force) {
        const target = force === undefined ? !classes.has(name) : !!force;
        if (target) classes.add(name);
        else classes.delete(name);
        return target;
      },
      contains(name) {
        return classes.has(name);
      },
    },
    querySelectorAll(selector) {
      const cls = String(selector).replace(/^\./, "");
      const matches = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (child.className === cls || child.classList.contains(cls)) {
            matches.push(child);
          }
          walk(child);
        }
      };
      walk(el);
      return matches;
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    addEventListener(type, listener) {
      const entries = listeners.get(type) ?? [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) ?? [];
      listeners.set(type, entries.filter((entry) => entry !== listener));
    },
    /**
     * Fire an event and await every (possibly async) handler. Callers that
     * script overlapping operations can hold the returned promise instead of
     * awaiting it immediately.
     */
    dispatch(type, init = {}) {
      const event = { type, preventDefault() {}, target: el, ...init };
      const results = [];
      for (const listener of [...(listeners.get(type) ?? [])]) {
        results.push(listener(event));
      }
      return Promise.all(results).then(() => undefined);
    },
    click() {
      return el.dispatch("click");
    },
  };
  return el;
}

/**
 * Run a fresh instance of the real popup script.
 *
 * Deno only grants permission-free access to dynamic imports it can see in
 * the static module graph, hence the bounded literal import list above: each
 * start consumes one unique query-token module.
 *
 * Options:
 * - `tab`: active tab (default a YouTube Shorts tab); pass `null` for none.
 * - `stored`: object resolved by the bootstrap storage.local.get.
 * - `storageGetError`: reject the bootstrap storage.local.get.
 * - `state`: GET_STATE response; when omitted GET_STATE rejects (no content
 *   script), which the popup treats as "no live page".
 * - `onStorageSet(value, call)`: outcome for each storage.local.set call
 *   (return/resolve for success, throw/reject for failure). Defaults to
 *   success.
 * - `onOperationMessage(message, call)`: outcome for each non-GET_STATE
 *   tabs.sendMessage call. Defaults to `{ ok: true }`.
 *
 * Every fake API call is recorded (in invocation order) in `env.calls`.
 *
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function startPopup(options = {}) {
  const globalKeys = ["browser", "chrome", "document"];
  const descriptors = new Map(
    globalKeys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  let restored = false;

  const calls = [];
  const els = {};
  for (const id of ELEMENT_IDS) {
    els[id] = createFakeElement(
      id === "slider" || id === "custom-input" || id === "enable-on-watch"
        ? "input"
        : id === "custom-form"
        ? "form"
        : "div",
    );
  }
  // Mirror the slider bounds from popup.html; render() reads them.
  els["slider"].min = "0.25";
  els["slider"].max = "4";

  const tab = "tab" in options
    ? options.tab
    : { id: 1, url: "https://www.youtube.com/shorts/example" };

  let setCalls = 0;
  let messageCalls = 0;

  const extensionApi = {
    tabs: {
      query(query) {
        calls.push({ api: "tabs.query", query });
        return Promise.resolve(tab ? [tab] : []);
      },
      sendMessage(_tabId, message) {
        calls.push({ api: "sendMessage", message });
        if (message && message.type === "GET_STATE") {
          return "state" in options
            ? Promise.resolve(options.state)
            : Promise.reject(new Error("no content script"));
        }
        messageCalls += 1;
        if (options.onOperationMessage) {
          const call = messageCalls;
          return Promise.resolve().then(() =>
            options.onOperationMessage(message, call)
          );
        }
        return Promise.resolve({ ok: true });
      },
    },
    storage: {
      local: {
        get(keys) {
          calls.push({ api: "storage.get", keys });
          if (options.storageGetError) {
            return Promise.reject(new Error("storage get failed"));
          }
          return Promise.resolve({ ...(options.stored ?? {}) });
        },
        set(value) {
          calls.push({ api: "storage.set", value });
          setCalls += 1;
          if (options.onStorageSet) {
            const call = setCalls;
            return Promise.resolve().then(() =>
              options.onStorageSet(value, call)
            );
          }
          return Promise.resolve();
        },
      },
    },
  };

  const fakeDocument = {
    readyState: "complete",
    getElementById(id) {
      return els[id] ?? null;
    },
    createElement(tag) {
      return createFakeElement(tag);
    },
    addEventListener() {},
    removeEventListener() {},
  };

  function defineGlobal(key, value) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  function restoreDescriptors() {
    if (restored) return;
    restored = true;
    for (const key of [...globalKeys].reverse()) {
      const descriptor = descriptors.get(key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  }

  defineGlobal("browser", extensionApi);
  defineGlobal("chrome", undefined);
  defineGlobal("document", fakeDocument);

  /**
   * Drain the microtask queue deterministically. Every fake API resolves in
   * microtasks (no timers), so a bounded number of turns settles any chain
   * that is not intentionally deferred by the test.
   */
  async function flush(turns = 100) {
    for (let i = 0; i < turns; i++) await Promise.resolve();
  }

  const importPopup = popupImports[nextPopupImport++];
  if (!importPopup) {
    restoreDescriptors();
    throw new Error("popup harness literal import pool exhausted");
  }

  try {
    await importPopup();
    // Bootstrap runs synchronously at import (readyState "complete") and only
    // awaits immediately-resolving fakes; drain it before exposing controls.
    await flush();
  } catch (error) {
    restoreDescriptors();
    throw error;
  }

  return {
    els,
    calls,
    flush,
    presetButtons() {
      return els["presets"].querySelectorAll(".preset-btn");
    },
    /** Click a preset button; returns the handler completion promise. */
    clickPreset(speed) {
      const btn = this.presetButtons().find(
        (candidate) => candidate.dataset.speed === String(speed),
      );
      if (!btn) throw new Error(`no preset button for ${speed}`);
      return btn.click();
    },
    /** Type into the custom field and submit; returns handler promise. */
    submitCustom(value) {
      els["custom-input"].value = String(value);
      return els["custom-form"].dispatch("submit");
    },
    /** Flip the enable-on-watch checkbox; returns handler promise. */
    toggleEnableOnWatch(checked) {
      els["enable-on-watch"].checked = checked;
      return els["enable-on-watch"].dispatch("change");
    },
    clickReset() {
      return els["reset"].click();
    },
    status() {
      return {
        text: els["status"].textContent,
        warn: els["status"].classList.contains("warn"),
      };
    },
    restore() {
      restoreDescriptors();
    },
  };
}
