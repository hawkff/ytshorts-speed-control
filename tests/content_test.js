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
