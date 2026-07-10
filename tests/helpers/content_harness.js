import "../../lib/speed.js";
import "../../lib/settings.js";

// Deno only grants permission-free dynamic imports it can see statically, so
// this fixed pool of literal import specifiers is the only way to re-import
// the content script per test. It must hold at least one entry for every
// startContentScript() call across the suite; adding tests that start the
// content script requires adding entries here, or the pool-exhausted error fires.
const contentScriptImports = [
  () => import("../../src/content.js?content-harness=0"),
  () => import("../../src/content.js?content-harness=1"),
  () => import("../../src/content.js?content-harness=2"),
  () => import("../../src/content.js?content-harness=3"),
  () => import("../../src/content.js?content-harness=4"),
  () => import("../../src/content.js?content-harness=5"),
  () => import("../../src/content.js?content-harness=6"),
  () => import("../../src/content.js?content-harness=7"),
  () => import("../../src/content.js?content-harness=8"),
  () => import("../../src/content.js?content-harness=9"),
  () => import("../../src/content.js?content-harness=10"),
  () => import("../../src/content.js?content-harness=11"),
  () => import("../../src/content.js?content-harness=12"),
  () => import("../../src/content.js?content-harness=13"),
  () => import("../../src/content.js?content-harness=14"),
  () => import("../../src/content.js?content-harness=15"),
  () => import("../../src/content.js?content-harness=16"),
  () => import("../../src/content.js?content-harness=17"),
  () => import("../../src/content.js?content-harness=18"),
  () => import("../../src/content.js?content-harness=19"),
  () => import("../../src/content.js?content-harness=20"),
  () => import("../../src/content.js?content-harness=21"),
  () => import("../../src/content.js?content-harness=22"),
  () => import("../../src/content.js?content-harness=23"),
  () => import("../../src/content.js?content-harness=24"),
  () => import("../../src/content.js?content-harness=25"),
  () => import("../../src/content.js?content-harness=26"),
  () => import("../../src/content.js?content-harness=27"),
  () => import("../../src/content.js?content-harness=28"),
  () => import("../../src/content.js?content-harness=29"),
  () => import("../../src/content.js?content-harness=30"),
  () => import("../../src/content.js?content-harness=31"),
];

let nextContentScriptImport = 0;

/**
 * Build a configurable video double for the real content script.
 * @param {object} [options]
 * @returns {object}
 */
export function createFakeVideo(options = {}) {
  const listeners = new Map();
  const rect = {
    left: options.rect?.left ?? 0,
    top: options.rect?.top ?? 0,
    width: options.rect?.width ?? 0,
    height: options.rect?.height ?? 0,
  };
  rect.right = options.rect?.right ?? rect.left + rect.width;
  rect.bottom = options.rect?.bottom ?? rect.top + rect.height;

  let playbackRate = options.playbackRate ?? 1;
  const video = {
    paused: options.paused ?? true,
    ended: options.ended ?? false,
    readyState: options.readyState ?? 4,
    currentSrc: options.currentSrc ?? "",
    src: options.src ?? "",
    rateWrites: [],
    pauseCalls: 0,
    playCalls: 0,
    rectReads: 0,
    addEventListener(type, listener) {
      const entries = listeners.get(type) ?? [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) ?? [];
      listeners.set(type, entries.filter((entry) => entry !== listener));
    },
    getBoundingClientRect() {
      video.rectReads += 1;
      return { ...rect };
    },
    closest(selector) {
      return typeof options.closest === "function"
        ? options.closest(selector)
        : options.closest ?? null;
    },
    pause() {
      video.pauseCalls += 1;
      video.paused = true;
    },
    play() {
      video.playCalls += 1;
      video.paused = false;
      return Promise.resolve();
    },
    emit(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener.call(video);
      }
    },
    clearEventListeners() {
      listeners.clear();
    },
  };

  Object.defineProperty(video, "playbackRate", {
    configurable: true,
    enumerable: true,
    get() {
      return playbackRate;
    },
    set(value) {
      playbackRate = value;
      video.rateWrites.push(value);
    },
  });

  return video;
}

/**
 * Execute a fresh instance of the real content script against dependency-free
 * browser and DOM doubles.
 *
 * Deno only grants permission-free access to dynamic imports it can see in the
 * static module graph. The bounded literal import list above therefore gives
 * every harness start a fresh query-token module without widening test
 * permissions.
 *
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function startContentScript(options = {}) {
  const globalKeys = [
    "browser",
    "chrome",
    "document",
    "location",
    "MutationObserver",
    "Element",
    "HTMLElement",
    "KeyboardEvent",
    "innerWidth",
    "innerHeight",
    "requestAnimationFrame",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "addEventListener",
    "removeEventListener",
  ];
  const descriptors = new Map(
    globalKeys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const videos = options.videos ?? [];
  const stored = options.stored ?? {};
  const runtimeListeners = [];
  const storageListeners = [];
  const documentListeners = new Map();
  const globalListeners = new Map();
  const mutationObservers = [];
  const animationFrames = new Map();
  const timers = new Map();
  const storageWrites = [];
  let queryCount = 0;
  let nextHandle = 1;
  let restored = false;
  let storageSettled = !options.deferStorageGet;

  const listenersReadyDeferred = deferred();
  const readyDeferred = deferred();
  const storageDeferred = deferred();

  class FakeElement {
    constructor() {
      this.tagName = "DIV";
      this.isContentEditable = false;
    }

    getAttribute() {
      return null;
    }
  }

  class FakeHTMLElement extends FakeElement {
    constructor() {
      super();
      this.style = {};
    }
  }

  class FakeKeyboardEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.key = init.key ?? "";
      this.code = init.code ?? "";
      this.target = init.target ?? null;
      this.repeat = init.repeat ?? false;
      this.ctrlKey = init.ctrlKey ?? false;
      this.metaKey = init.metaKey ?? false;
      this.altKey = init.altKey ?? false;
      this.altGraphKey = init.altGraphKey ?? false;
      this.defaultPrevented = false;
      this.immediatePropagationStopped = false;
    }

    getModifierState(name) {
      return name === "AltGraph" && !!this.altGraphKey;
    }

    preventDefault() {
      this.defaultPrevented = true;
    }

    stopImmediatePropagation() {
      this.immediatePropagationStopped = true;
    }

    stopPropagation() {}
  }

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      mutationObservers.push(this);
    }

    observe() {
      this.connected = true;
    }

    disconnect() {
      this.connected = false;
    }
  }

  const documentElement = {
    clientWidth: options.innerWidth ?? 1000,
    clientHeight: options.innerHeight ?? 1000,
  };
  const document = {
    readyState: options.readyState ?? "complete",
    body: options.body ?? null,
    documentElement,
    querySelectorAll(selector) {
      if (selector === "video") queryCount += 1;
      return selector === "video" ? [...videos] : [];
    },
    addEventListener(type, listener) {
      addListener(documentListeners, type, listener);
    },
    removeEventListener(type, listener) {
      removeListener(documentListeners, type, listener);
    },
    getElementById() {
      return null;
    },
    createElement() {
      return new FakeHTMLElement();
    },
  };

  const extensionApi = {
    runtime: {
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
          resolveListenersReady();
        },
      },
    },
    storage: {
      local: {
        get() {
          return options.deferStorageGet
            ? storageDeferred.promise
            : Promise.resolve({ ...stored });
        },
        set(value) {
          storageWrites.push(value);
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
          resolveListenersReady();
        },
      },
    },
  };

  function resolveListenersReady() {
    if (runtimeListeners.length > 0 && storageListeners.length > 0) {
      listenersReadyDeferred.resolve();
    }
  }

  function fakeSetTimeout(callback, delay = 0, ...args) {
    const handle = nextHandle++;
    timers.set(handle, { kind: "timeout", callback, delay, args });
    return handle;
  }

  function fakeSetInterval(callback, delay = 0, ...args) {
    const handle = nextHandle++;
    timers.set(handle, { kind: "interval", callback, delay, args });
    queueMicrotask(() => readyDeferred.resolve());
    return handle;
  }

  function fakeClearTimer(handle) {
    timers.delete(handle);
  }

  function fakeRequestAnimationFrame(callback) {
    const handle = nextHandle++;
    animationFrames.set(handle, callback);
    return handle;
  }

  function globalAddEventListener(type, listener) {
    addListener(globalListeners, type, listener);
  }

  function globalRemoveEventListener(type, listener) {
    removeListener(globalListeners, type, listener);
  }

  defineGlobal("browser", extensionApi);
  defineGlobal("chrome", undefined);
  defineGlobal("document", document);
  const fakeLocation = {
    pathname: options.pathname ?? "/shorts/example",
    href: options.href ?? "https://www.youtube.com/shorts/example",
  };
  defineGlobal("location", fakeLocation);
  defineGlobal("MutationObserver", FakeMutationObserver);
  defineGlobal("Element", FakeElement);
  defineGlobal("HTMLElement", FakeHTMLElement);
  defineGlobal("KeyboardEvent", FakeKeyboardEvent);
  defineGlobal("innerWidth", options.innerWidth ?? 1000);
  defineGlobal("innerHeight", options.innerHeight ?? 1000);
  defineGlobal("requestAnimationFrame", fakeRequestAnimationFrame);
  defineGlobal("setTimeout", fakeSetTimeout);
  defineGlobal("clearTimeout", fakeClearTimer);
  defineGlobal("setInterval", fakeSetInterval);
  defineGlobal("clearInterval", fakeClearTimer);
  defineGlobal("addEventListener", globalAddEventListener);
  defineGlobal("removeEventListener", globalRemoveEventListener);

  function defineGlobal(key, value) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  function restoreDescriptors() {
    for (const key of [...globalKeys].reverse()) {
      const descriptor = descriptors.get(key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  }

  const env = {
    listenersReady: listenersReadyDeferred.promise,
    ready: readyDeferred.promise,
    storageWrites,
    get queryCount() {
      return queryCount;
    },
    get pendingTimers() {
      return [...timers.entries()].map(([handle, { kind, delay }]) => ({
        handle,
        kind,
        delay,
      }));
    },
    runTimer(handle) {
      const timer = timers.get(handle);
      if (!timer) throw new Error(`timer ${handle} is not active`);
      if (timer.kind === "timeout") timers.delete(handle);
      timer.callback(...timer.args);
    },
    dispatchGlobalEvent(type) {
      for (const listener of [...(globalListeners.get(type) ?? [])]) {
        listener({ type });
      }
    },
    get pendingAnimationFrames() {
      return animationFrames.size;
    },
    location: fakeLocation,
    resolveStorageGet(value = stored) {
      if (storageSettled) return;
      storageSettled = true;
      storageDeferred.resolve({ ...value });
    },
    sendMessage(message) {
      let response;
      for (const listener of runtimeListeners) {
        listener(message, {}, (value) => {
          response = value;
        });
      }
      return response;
    },
    dispatchKey(init = {}) {
      const event = new FakeKeyboardEvent("keydown", init);
      for (const listener of [...(globalListeners.get("keydown") ?? [])]) {
        listener(event);
        if (event.immediatePropagationStopped) break;
      }
      return event;
    },
    triggerMutation(records = []) {
      for (const observer of mutationObservers) {
        if (observer.connected) observer.callback(records, observer);
      }
    },
    async flushAnimationFrames() {
      while (animationFrames.size > 0) {
        const callbacks = [...animationFrames.values()];
        animationFrames.clear();
        for (const callback of callbacks) callback(performance.now());
        await Promise.resolve();
      }
    },
    emitStorageChange(changes, area = "local") {
      for (const listener of storageListeners) listener(changes, area);
    },
    async restore() {
      if (restored) return;
      restored = true;
      if (!storageSettled) env.resolveStorageGet();
      await env.ready;
      for (const observer of mutationObservers) observer.disconnect();
      for (const video of videos) video.clearEventListeners?.();
      runtimeListeners.length = 0;
      storageListeners.length = 0;
      documentListeners.clear();
      globalListeners.clear();
      animationFrames.clear();
      timers.clear();
      restoreDescriptors();
    },
  };

  const importContentScript = contentScriptImports[nextContentScriptImport++];
  if (!importContentScript) {
    restoreDescriptors();
    throw new Error("content harness literal import pool exhausted");
  }

  try {
    await importContentScript();
  } catch (error) {
    restoreDescriptors();
    throw error;
  }

  return env;
}

function addListener(listeners, type, listener) {
  const entries = listeners.get(type) ?? [];
  entries.push(listener);
  listeners.set(type, entries);
}

function removeListener(listeners, type, listener) {
  const entries = listeners.get(type) ?? [];
  listeners.set(type, entries.filter((entry) => entry !== listener));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
