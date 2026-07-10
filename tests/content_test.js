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
