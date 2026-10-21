/**
 * Dependency-free harness that runs the REAL popup script (src/popup.js)
 * against fake DOM and WebExtension doubles.
 *
 * Copyright (C) 2026 hawkff
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import "../../lib/speed.js";
import "../../lib/settings.js";

// Each start imports the script under a new query string, which makes the
// module loader evaluate a fresh copy, like opening the popup.
let popupRuns = 0;

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
      listeners.set(
        type,
        entries.filter((entry) => entry !== listener),
      );
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
 * Options:
 * - `tab`: active tab (default a YouTube Shorts tab); pass `null` for none.
 * - `stored`: object resolved by the bootstrap storage.local.get.
 * - `storageGetError`: reject the bootstrap storage.local.get.
 * - `onStorageGet(keys)`: override the startup read, including delayed results.
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
  els.slider.min = "0.25";
  els.slider.max = "4";

  const tab =
    "tab" in options
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
            options.onOperationMessage(message, call),
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
          if (options.onStorageGet) {
            return Promise.resolve().then(() => options.onStorageGet(keys));
          }
          return Promise.resolve({ ...(options.stored ?? {}) });
        },
        set(value) {
          calls.push({ api: "storage.set", value });
          setCalls += 1;
          if (options.onStorageSet) {
            const call = setCalls;
            return Promise.resolve().then(() =>
              options.onStorageSet(value, call),
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

  try {
    await import(`../../src/popup.js?run=${++popupRuns}`);
    // Drain startup unless a test deliberately holds an API response pending.
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
      return els.presets.querySelectorAll(".preset-btn");
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
      return els.reset.click();
    },
    status() {
      return {
        text: els.status.textContent,
        warn: els.status.classList.contains("warn"),
      };
    },
    restore() {
      restoreDescriptors();
    },
  };
}
