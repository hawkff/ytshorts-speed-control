import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  createFakeVideo,
  startContentScript,
} from "./helpers/content_harness.js";

test("stored speed is applied to a playing video after init", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/smoke.mp4",
  });
  let env;
  try {
    env = await startContentScript({
      pathname: "/shorts/example",
      href: "https://www.youtube.com/shorts/example",
      videos: [video],
      stored: { speed: 2 },
    });
    await env.ready;

    assert.deepEqual(video.playbackRate, 2);
    assert.deepEqual(video.rateWrites, [2]);
  } finally {
    await env?.restore();
  }
});

test("visible video wins over an earlier off-screen playing video", async () => {
  const offscreen = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/offscreen.mp4",
    rect: { left: 1100, top: 0, width: 400, height: 400 },
  });
  const visible = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/visible.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({
      videos: [offscreen, visible],
      stored: { speed: 2 },
    });
    await env.ready;

    assert.deepEqual(offscreen.rateWrites, []);
    assert.deepEqual(visible.rateWrites, [2]);
  } finally {
    await env?.restore();
  }
});

test("largest qualifying visible video wins", async () => {
  const smaller = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/smaller.mp4",
    rect: { left: 50, top: 50, width: 200, height: 200 },
  });
  const larger = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/larger.mp4",
    rect: { left: 300, top: 100, width: 500, height: 500 },
  });
  let env;
  try {
    env = await startContentScript({
      videos: [smaller, larger],
      stored: { speed: 2 },
    });
    await env.ready;

    assert.deepEqual(smaller.rateWrites, []);
    assert.deepEqual(larger.rateWrites, [2]);
  } finally {
    await env?.restore();
  }
});

test("zero-layout videos fall back to genuinely playing before sourced", async () => {
  const sourced = createFakeVideo({
    paused: true,
    currentSrc: "https://example.test/sourced.mp4",
  });
  const playing = createFakeVideo({
    paused: false,
    readyState: 4,
  });
  let env;
  try {
    env = await startContentScript({
      videos: [sourced, playing],
      stored: { speed: 2 },
    });
    await env.ready;

    assert.deepEqual(sourced.rateWrites, []);
    assert.deepEqual(playing.rateWrites, [2]);
  } finally {
    await env?.restore();
  }
});

test("popup updates during startup beat the older storage snapshot", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/watch.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({
      pathname: "/watch",
      href: "https://www.youtube.com/watch?v=example",
      videos: [video],
      deferStorageGet: true,
    });
    await env.listenersReady;

    const speedResponse = env.sendMessage({ type: "SET_SPEED", value: 2 });
    assert.deepEqual(speedResponse, { ok: true, speed: 2 });
    const settingsResponse = env.sendMessage({
      type: "SET_SETTINGS",
      settings: { enableOnWatch: true },
    });
    assert.deepEqual(settingsResponse.ok, true);

    // The pending init read now resolves with older values; they must not
    // clobber the newer live state above.
    env.resolveStorageGet({
      speed: 1,
      settings: { enableOnWatch: false },
    });
    await env.ready;

    const state = env.sendMessage({ type: "GET_STATE" });
    assert.deepEqual(state.speed, 2);
    assert.deepEqual(state.settings.enableOnWatch, true);
  } finally {
    await env?.restore();
  }
});

test("storage speed event equal to the default supersedes the snapshot", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/equal.mp4",
  });
  let env;
  try {
    env = await startContentScript({
      videos: [video],
      deferStorageGet: true,
    });
    await env.listenersReady;

    // A newer cross-context write sets speed 1, equal to the in-memory
    // default; the stale snapshot's speed 2 must still be discarded.
    env.emitStorageChange({ speed: { oldValue: 2, newValue: 1 } });
    env.resolveStorageGet({ speed: 2 });
    await env.ready;

    const state = env.sendMessage({ type: "GET_STATE" });
    assert.deepEqual(state.speed, 1);
  } finally {
    await env?.restore();
  }
});

test("mutations on an inactive route queue no frame and no scan", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/home.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({
      pathname: "/",
      href: "https://www.youtube.com/",
      videos: [video],
      stored: { speed: 2 },
    });
    await env.ready;

    const baseline = env.queryCount;
    env.triggerMutation();
    env.triggerMutation();

    assert.deepEqual(env.queryCount, baseline);
    assert.deepEqual(env.pendingAnimationFrames, 0);
    assert.deepEqual(video.rateWrites, []);
  } finally {
    await env?.restore();
  }
});

test("active-page mutation bursts coalesce into one frame and one scan", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/short.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({
      videos: [video],
      stored: { speed: 2 },
    });
    await env.ready;

    env.triggerMutation();
    env.triggerMutation();
    env.triggerMutation();
    assert.deepEqual(env.pendingAnimationFrames, 1);

    const baseline = env.queryCount;
    await env.flushAnimationFrames();

    assert.deepEqual(env.queryCount, baseline + 1);
  } finally {
    await env?.restore();
  }
});

test("a queued frame re-checks activity before scanning", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/short.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({
      videos: [video],
      stored: { speed: 2 },
    });
    await env.ready;

    env.triggerMutation();
    assert.deepEqual(env.pendingAnimationFrames, 1);

    // The route becomes inactive before the frame fires, with no further
    // mutation to re-route through the URL-change branch.
    env.location.pathname = "/";

    const baseline = env.queryCount;
    await env.flushAnimationFrames();

    assert.deepEqual(env.queryCount, baseline);
  } finally {
    await env?.restore();
  }
});

test("enabling watch via settings applies speed without DOM churn", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/watch.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({
      pathname: "/watch",
      href: "https://www.youtube.com/watch?v=example",
      videos: [video],
      stored: { speed: 2, settings: { enableOnWatch: false } },
    });
    await env.ready;
    assert.deepEqual(video.rateWrites, []);

    const response = env.sendMessage({
      type: "SET_SETTINGS",
      settings: { enableOnWatch: true },
    });
    assert.deepEqual(response.ok, true);

    // No mutation or animation frame needed: activation applies directly.
    assert.deepEqual(video.playbackRate, 2);
    assert.deepEqual(video.rateWrites, [2]);
  } finally {
    await env?.restore();
  }
});

/** Active 100ms pause-sweep timeouts; other 0/250ms timers are unrelated. */
function pauseSweepTimers(env) {
  return env.pendingTimers.filter(
    (timer) => timer.kind === "timeout" && timer.delay === 100,
  );
}

test("releasing a pause cancels the pending sweep timer", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/pause.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
    closest: null,
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;

    env.dispatchKey({ key: "p", code: "KeyP" });
    assert.deepEqual(video.pauseCalls, 1);
    assert.deepEqual(pauseSweepTimers(env).length, 1);

    // P again resumes playback; releasePause must cancel the pending sweep
    // so the stale callback can never fire or enqueue a successor.
    env.dispatchKey({ key: "p", code: "KeyP" });
    assert.deepEqual(video.playCalls, 1);
    assert.deepEqual(pauseSweepTimers(env).length, 0);
  } finally {
    await env?.restore();
  }
});

test("rapid re-pause keeps exactly one sweep chain", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/repause.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
    closest: null,
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;

    // Pause, play, and re-pause before the first sweep tick ever fires.
    env.dispatchKey({ key: "p", code: "KeyP" });
    env.dispatchKey({ key: "p", code: "KeyP" });
    env.dispatchKey({ key: "p", code: "KeyP" });
    assert.deepEqual(video.pauseCalls, 2);

    const sweeps = pauseSweepTimers(env);
    assert.deepEqual(sweeps.length, 1);

    // Flushing the one sweep tick must enqueue exactly one successor, not a
    // second chain from the pre-play pause.
    env.runTimer(sweeps[0].handle);
    assert.deepEqual(pauseSweepTimers(env).length, 1);
  } finally {
    await env?.restore();
  }
});

test("navigation releases the pause and cancels the sweep", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/navigate.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
    closest: null,
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;

    env.dispatchKey({ key: "p", code: "KeyP" });
    assert.deepEqual(pauseSweepTimers(env).length, 1);

    // The real SPA navigation handler must release the pause intent and
    // cancel the pending sweep along with it.
    env.dispatchGlobalEvent("yt-navigate-finish");
    assert.deepEqual(pauseSweepTimers(env).length, 0);
  } finally {
    await env?.restore();
  }
});

test("P and speed target the same visible video", async () => {
  const offscreen = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/offscreen.mp4",
    rect: { left: 1100, top: 0, width: 400, height: 400 },
    closest: null,
  });
  const visible = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/visible.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
    closest: null,
  });
  let env;
  try {
    env = await startContentScript({
      videos: [offscreen, visible],
      stored: { speed: 2 },
    });
    await env.ready;
    env.dispatchKey({ key: "p", code: "KeyP" });

    assert.deepEqual(offscreen.rateWrites, []);
    assert.deepEqual(visible.rateWrites, [2]);
    assert.deepEqual(offscreen.pauseCalls, 0);
    assert.deepEqual(visible.pauseCalls, 1);
  } finally {
    await env?.restore();
  }
});

test("] steps the speed up and persists it", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/up.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;

    const event = env.dispatchKey({ key: "]", code: "BracketRight" });

    assert.deepEqual(event.defaultPrevented, true);
    assert.deepEqual(video.playbackRate, 2.25);
    assert.deepEqual(video.rateWrites[video.rateWrites.length - 1], 2.25);
    assert.deepEqual(
      env.storageWrites.some((write) => write.speed === 2.25),
      true,
    );
  } finally {
    await env?.restore();
  }
});

test("[ steps the speed down and persists it", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/down.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;

    const event = env.dispatchKey({ key: "[", code: "BracketLeft" });

    assert.deepEqual(event.defaultPrevented, true);
    assert.deepEqual(video.playbackRate, 1.75);
    assert.deepEqual(video.rateWrites[video.rateWrites.length - 1], 1.75);
    assert.deepEqual(
      env.storageWrites.some((write) => write.speed === 1.75),
      true,
    );
  } finally {
    await env?.restore();
  }
});

test("Backspace resets the speed to 1x", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/reset.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;

    const event = env.dispatchKey({ key: "Backspace", code: "Backspace" });

    assert.deepEqual(event.defaultPrevented, true);
    assert.deepEqual(video.playbackRate, 1);
    assert.deepEqual(
      env.storageWrites.some((write) => write.speed === 1),
      true,
    );
  } finally {
    await env?.restore();
  }
});

/** Minimal DOM parent that records appended children. */
function fakeContainer() {
  const node = {
    children: [],
    appendChild(child) {
      node.children.push(child);
      child.parentNode = node;
      return child;
    },
  };
  return node;
}

test("the speed badge shows inside a fullscreen player", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/fullscreen.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  const body = fakeContainer();
  const player = fakeContainer();
  let env;
  try {
    env = await startContentScript({
      videos: [video],
      stored: { speed: 2 },
      body,
      fullscreenElement: player,
    });
    await env.ready;

    env.dispatchKey({ key: "]", code: "BracketRight" });

    // The top layer hides body content, so the badge must sit in the player.
    assert.equal(body.children.length, 0);
    assert.equal(player.children.length, 1);
    assert.equal(player.children[0].textContent, "\u26A1 2.25x");
  } finally {
    await env?.restore();
  }
});

test("modified combos are left to the browser", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/modified.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;

    const events = [
      env.dispatchKey({ key: "]", code: "BracketRight", metaKey: true }),
      env.dispatchKey({ key: "[", code: "BracketLeft", ctrlKey: true }),
      env.dispatchKey({ key: "Backspace", code: "Backspace", altKey: true }),
    ];

    for (const event of events) {
      assert.deepEqual(event.defaultPrevented, false);
    }
    assert.deepEqual(video.rateWrites, [2]);
    assert.deepEqual(
      env.storageWrites.some((write) => "speed" in write),
      false,
    );
  } finally {
    await env?.restore();
  }
});

test("AltGr brackets still step (AltGr reports as Ctrl+Alt)", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/altgr.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;

    const event = env.dispatchKey({
      key: "[",
      code: "BracketLeft",
      ctrlKey: true,
      altKey: true,
      altGraphKey: true,
    });

    assert.deepEqual(event.defaultPrevented, true);
    assert.deepEqual(video.playbackRate, 1.75);
  } finally {
    await env?.restore();
  }
});

test("keys are ignored while typing in a field", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/editable.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;

    const input = new globalThis.Element();
    input.tagName = "INPUT";
    const event = env.dispatchKey({
      key: "]",
      code: "BracketRight",
      target: input,
    });

    assert.deepEqual(event.defaultPrevented, false);
    assert.deepEqual(video.rateWrites, [2]);
  } finally {
    await env?.restore();
  }
});

test("key repeat does not step again", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/repeat.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;

    const event = env.dispatchKey({
      key: "]",
      code: "BracketRight",
      repeat: true,
    });

    assert.deepEqual(event.defaultPrevented, false);
    assert.deepEqual(video.rateWrites, [2]);
  } finally {
    await env?.restore();
  }
});

test("keys are inert on a watch page without opt-in", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/inert.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({
      pathname: "/watch",
      href: "https://www.youtube.com/watch?v=example",
      videos: [video],
      stored: { speed: 2, settings: { enableOnWatch: false } },
    });
    await env.ready;

    const event = env.dispatchKey({ key: "]", code: "BracketRight" });

    assert.deepEqual(event.defaultPrevented, false);
    assert.deepEqual(video.rateWrites, []);
  } finally {
    await env?.restore();
  }
});

test("ratechange away from the target is reasserted; matching ratechange is a no-op", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/ratechange.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;
    assert.deepEqual(video.rateWrites, [2]);

    // Simulate YouTube resetting the rate back to 1x.
    video.playbackRate = 1;
    video.emit("ratechange");

    assert.deepEqual(video.playbackRate, 2);
    assert.deepEqual(video.rateWrites, [2, 1, 2]);

    // A ratechange that already matches the target must not write again.
    video.emit("ratechange");
    assert.deepEqual(video.rateWrites, [2, 1, 2]);
  } finally {
    await env?.restore();
  }
});

test("removing the settings key resets opt-in state and releases the video", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/watch.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
  });
  let env;
  try {
    env = await startContentScript({
      pathname: "/watch",
      href: "https://www.youtube.com/watch?v=example",
      videos: [video],
      stored: { speed: 2, settings: { enableOnWatch: true } },
    });
    await env.ready;
    assert.deepEqual(video.playbackRate, 2);

    // Simulate the settings key being removed from storage externally.
    env.emitStorageChange({
      settings: { oldValue: { enableOnWatch: true }, newValue: undefined },
    });

    // The page is no longer active: the video is released and reset to 1x.
    assert.deepEqual(video.playbackRate, 1);
    assert.deepEqual(video.rateWrites, [2, 1]);

    // Adoption must not re-persist settings (no storage write loop).
    assert.deepEqual(
      env.storageWrites.some((write) => "settings" in write),
      false,
    );

    const state = env.sendMessage({ type: "GET_STATE" });
    assert.deepEqual(state.settings.enableOnWatch, false);
  } finally {
    await env?.restore();
  }
});

test("navigating to an inactive route resets the managed video to 1x", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/navigate-away.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
    closest: null,
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;
    assert.deepEqual(video.playbackRate, 2);

    // Simulate SPA navigation to the home feed (an inactive route).
    env.location.pathname = "/";
    env.location.href = "https://www.youtube.com/";
    env.dispatchGlobalEvent("yt-navigate-finish");

    // The video is handed back at the default rate.
    assert.deepEqual(video.playbackRate, 1);
    assert.deepEqual(video.rateWrites, [2, 1]);

    // The persisted preference is untouched: the reset touches the element,
    // not storage.
    assert.deepEqual(
      env.storageWrites.some((write) => write.speed === 1),
      false,
    );
  } finally {
    await env?.restore();
  }
});

test("navigating between Shorts keeps the chosen speed", async () => {
  const video = createFakeVideo({
    paused: false,
    currentSrc: "https://example.test/short-to-short.mp4",
    rect: { left: 100, top: 100, width: 400, height: 400 },
    closest: null,
  });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;
    assert.deepEqual(video.playbackRate, 2);

    // Navigate to another Short (active -> active).
    env.location.pathname = "/shorts/next";
    env.location.href = "https://www.youtube.com/shorts/next";
    env.dispatchGlobalEvent("yt-navigate-finish");

    // Flush the deferred reapply timeouts scheduled by onNavigate.
    for (const timer of env.pendingTimers) {
      if (
        timer.kind === "timeout" &&
        (timer.delay === 0 || timer.delay === 250)
      ) {
        env.runTimer(timer.handle);
      }
    }

    // The chosen speed sticks; 1x was never written.
    assert.deepEqual(video.rateWrites.includes(1), false);
    assert.deepEqual(video.playbackRate, 2);
  } finally {
    await env?.restore();
  }
});

test("pause opt-out: settings changes remove pause enforcement", async () => {
  for (const source of ["message", "storage", "removed"]) {
    const video = createFakeVideo({ paused: false });
    let env;
    try {
      env = await startContentScript({
        pathname: "/watch",
        href: "https://www.youtube.com/watch?v=example",
        videos: [video],
        stored: { speed: 3, settings: { enableOnWatch: true } },
      });
      await env.ready;
      env.dispatchKey({ key: "p", code: "KeyP" });
      assert.deepEqual(pauseSweepTimers(env).length, 1);

      if (source === "message") {
        env.sendMessage({
          type: "SET_SETTINGS",
          settings: { enableOnWatch: false },
        });
      } else {
        env.emitStorageChange({
          settings: {
            oldValue: { enableOnWatch: true },
            newValue:
              source === "removed" ? undefined : { enableOnWatch: false },
          },
        });
        assert.deepEqual(env.storageWrites, []);
      }

      assert.deepEqual(video.paused, true, source);
      assert.deepEqual(video.playbackRate, 1, source);
      assert.deepEqual(pauseSweepTimers(env).length, 0, source);
      for (const timer of env.pendingTimers) {
        if (timer.kind === "timeout" && timer.delay === 0) {
          env.runTimer(timer.handle);
        }
      }
      await video.play();
      video.emit("play");
      video.emit("playing");
      assert.deepEqual(video.paused, false, source);
      assert.deepEqual(video.pauseCalls, 1, source);
      assert.deepEqual(pauseSweepTimers(env).length, 0, source);
    } finally {
      await env?.restore();
    }
  }
});

test("inactive fallback: polling and media callbacks release control without scanning", async () => {
  for (const trigger of [
    "interval",
    "ratechange",
    "matching-ratechange",
    "play",
    "pause-play",
    "pause-playing",
    "pause-sweep",
    "frame",
  ]) {
    const video = createFakeVideo({ paused: false });
    let env;
    try {
      env = await startContentScript({ videos: [video], stored: { speed: 2 } });
      await env.ready;
      if (trigger.startsWith("pause-")) {
        env.dispatchKey({ key: "p", code: "KeyP" });
      }
      if (trigger === "frame") env.triggerMutation();
      const baseline = env.queryCount;
      const interval = env.pendingTimers.find(
        (timer) => timer.kind === "interval",
      );
      env.location.pathname = "/";
      env.location.href = "https://www.youtube.com/";

      if (trigger === "interval") env.runTimer(interval.handle);
      else if (trigger === "frame") await env.flushAnimationFrames();
      else if (trigger === "pause-sweep") {
        env.runTimer(pauseSweepTimers(env)[0].handle);
        assert.deepEqual(video.paused, true);
      } else {
        if (trigger === "ratechange") video.playbackRate = 1.25;
        if (trigger.startsWith("pause-")) await video.play();
        video.emit(trigger.replace(/^(pause-|matching-)/, ""));
        assert.deepEqual(video.paused, false, trigger);
      }

      assert.deepEqual(video.playbackRate, 1, trigger);
      assert.deepEqual(pauseSweepTimers(env).length, 0, trigger);
      assert.deepEqual(env.queryCount, baseline, trigger);
      video.playbackRate = 1.25;
      video.emit("ratechange");
      await video.play();
      video.emit("play");
      video.emit("playing");
      const writes = video.rateWrites.length;
      env.runTimer(interval.handle);
      assert.deepEqual(video.rateWrites.length, writes, trigger);
      assert.deepEqual(video.playbackRate, 1.25, trigger);
      assert.deepEqual(video.paused, false, trigger);
      assert.deepEqual(env.queryCount, baseline, trigger);
      assert.deepEqual(env.storageWrites, [], trigger);
      assert.deepEqual(
        env.sendMessage({ type: "GET_STATE" }).speed,
        2,
        trigger,
      );
    } finally {
      await env?.restore();
    }
  }
});

test("shortcut precedence: characters win over conflicting physical keys", async () => {
  const video = createFakeVideo({ paused: false });
  let env;
  try {
    env = await startContentScript({ videos: [video], stored: { speed: 2 } });
    await env.ready;
    for (const [key, code, expected] of [
      ["[", "BracketRight", 1.75],
      ["]", "BracketLeft", 2.25],
      ["Backspace", "BracketRight", 1],
      ["x", "BracketLeft", 1.75],
    ]) {
      env.sendMessage({ type: "SET_SPEED", value: 2 });
      const event = env.dispatchKey({ key, code });
      assert.deepEqual(event.defaultPrevented, true);
      assert.deepEqual(video.playbackRate, expected, `${key} / ${code}`);
    }
    env.dispatchKey({ key: "p", code: "BracketRight" });
    assert.deepEqual(video.paused, true);
    assert.deepEqual(video.playbackRate, 1.75);
  } finally {
    await env?.restore();
  }
});
