import { assertEquals } from "@std/assert";
import {
  createFakeVideo,
  startContentScript,
} from "./helpers/content_harness.js";

Deno.test("stored speed is applied to a playing video after init", async () => {
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

    assertEquals(video.playbackRate, 2);
    assertEquals(video.rateWrites, [2]);
  } finally {
    await env?.restore();
  }
});

Deno.test("visible video wins over an earlier off-screen playing video", async () => {
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

    assertEquals(offscreen.rateWrites, []);
    assertEquals(visible.rateWrites, [2]);
  } finally {
    await env?.restore();
  }
});

Deno.test("largest qualifying visible video wins", async () => {
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

    assertEquals(smaller.rateWrites, []);
    assertEquals(larger.rateWrites, [2]);
  } finally {
    await env?.restore();
  }
});

Deno.test("zero-layout videos fall back to genuinely playing before sourced", async () => {
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

    assertEquals(sourced.rateWrites, []);
    assertEquals(playing.rateWrites, [2]);
  } finally {
    await env?.restore();
  }
});

Deno.test("popup updates during startup beat the older storage snapshot", async () => {
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
    assertEquals(speedResponse, { ok: true, speed: 2 });
    const settingsResponse = env.sendMessage({
      type: "SET_SETTINGS",
      settings: { enableOnWatch: true },
    });
    assertEquals(settingsResponse.ok, true);

    // The pending init read now resolves with older values; they must not
    // clobber the newer live state above.
    env.resolveStorageGet({
      speed: 1,
      settings: { enableOnWatch: false },
    });
    await env.ready;

    const state = env.sendMessage({ type: "GET_STATE" });
    assertEquals(state.speed, 2);
    assertEquals(state.settings.enableOnWatch, true);
    assertEquals(state.isActive, true);
  } finally {
    await env?.restore();
  }
});

Deno.test("storage speed event equal to the default supersedes the snapshot", async () => {
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
    assertEquals(state.speed, 1);
  } finally {
    await env?.restore();
  }
});

Deno.test("mutations on an inactive route queue no frame and no scan", async () => {
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

    assertEquals(env.queryCount, baseline);
    assertEquals(env.pendingAnimationFrames, 0);
    assertEquals(video.rateWrites, []);
  } finally {
    await env?.restore();
  }
});

Deno.test("active-page mutation bursts coalesce into one frame and one scan", async () => {
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
    assertEquals(env.pendingAnimationFrames, 1);

    const baseline = env.queryCount;
    await env.flushAnimationFrames();

    assertEquals(env.queryCount, baseline + 1);
  } finally {
    await env?.restore();
  }
});

Deno.test("a queued frame re-checks activity before scanning", async () => {
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
    assertEquals(env.pendingAnimationFrames, 1);

    // The route becomes inactive before the frame fires, with no further
    // mutation to re-route through the URL-change branch.
    env.location.pathname = "/";

    const baseline = env.queryCount;
    await env.flushAnimationFrames();

    assertEquals(env.queryCount, baseline);
  } finally {
    await env?.restore();
  }
});

Deno.test("enabling watch via settings applies speed without DOM churn", async () => {
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
    assertEquals(video.rateWrites, []);

    const response = env.sendMessage({
      type: "SET_SETTINGS",
      settings: { enableOnWatch: true },
    });
    assertEquals(response.ok, true);

    // No mutation or animation frame needed: activation applies directly.
    assertEquals(video.playbackRate, 2);
    assertEquals(video.rateWrites, [2]);
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

Deno.test("releasing a pause cancels the pending sweep timer", async () => {
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
    assertEquals(video.pauseCalls, 1);
    assertEquals(pauseSweepTimers(env).length, 1);

    // P again resumes playback; releasePause must cancel the pending sweep
    // so the stale callback can never fire or enqueue a successor.
    env.dispatchKey({ key: "p", code: "KeyP" });
    assertEquals(video.playCalls, 1);
    assertEquals(pauseSweepTimers(env).length, 0);
  } finally {
    await env?.restore();
  }
});

Deno.test("rapid re-pause keeps exactly one sweep chain", async () => {
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
    assertEquals(video.pauseCalls, 2);

    const sweeps = pauseSweepTimers(env);
    assertEquals(sweeps.length, 1);

    // Flushing the one sweep tick must enqueue exactly one successor, not a
    // second chain from the pre-play pause.
    env.runTimer(sweeps[0].handle);
    assertEquals(pauseSweepTimers(env).length, 1);
  } finally {
    await env?.restore();
  }
});

Deno.test("navigation releases the pause and cancels the sweep", async () => {
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
    assertEquals(pauseSweepTimers(env).length, 1);

    // The real SPA navigation handler must release the pause intent and
    // cancel the pending sweep along with it.
    env.dispatchGlobalEvent("yt-navigate-finish");
    assertEquals(pauseSweepTimers(env).length, 0);
  } finally {
    await env?.restore();
  }
});

Deno.test("P and speed target the same visible video", async () => {
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

    assertEquals(offscreen.rateWrites, []);
    assertEquals(visible.rateWrites, [2]);
    assertEquals(offscreen.pauseCalls, 0);
    assertEquals(visible.pauseCalls, 1);
  } finally {
    await env?.restore();
  }
});
