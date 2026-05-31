/**
 * Content script for YT Shorts Speed Control.
 *
 * Responsibilities:
 *  - Track the currently active <video> element on a Shorts page.
 *  - Apply the user's chosen playback speed and keep re-applying it, because
 *    YouTube resets playbackRate to 1x whenever it swaps to a new Short.
 *  - React to popup/background messages and chrome.storage changes.
 *  - Show a brief on-screen indicator when the speed changes.
 *
 * Pure math lives in lib/speed.js (loaded first), exposed as
 * globalThis.YTShortsSpeed.
 */
(function () {
  "use strict";

  const Speed = globalThis.YTShortsSpeed;
  if (!Speed) {
    // lib/speed.js failed to load; bail loudly but harmlessly.
    console.error("[YTShortsSpeed] speed helpers missing; content script idle");
    return;
  }

  const STORAGE_KEY = "speed";
  const KEYBOARD_STEP = 0.25;
  const INDICATOR_ID = "yt-shorts-speed-indicator";
  const INDICATOR_TIMEOUT_MS = 1200;

  /** Current desired speed; mirrors chrome.storage.local[STORAGE_KEY]. */
  let desiredSpeed = Speed.DEFAULT_SPEED;
  /** The video we are currently managing, if any. */
  let managedVideo = null;
  let indicatorTimer = null;

  /** Tolerance for comparing playback rates (browsers may round slightly). */
  const RATE_EPSILON = 1e-3;

  /**
   * Whether two playback rates are effectively equal.
   * @param {number} a
   * @param {number} b
   * @returns {boolean}
   */
  function ratesEqual(a, b) {
    return Math.abs(a - b) < RATE_EPSILON;
  }

  /** True only on actual Shorts pages (/shorts/...). */
  function isShortsPage() {
    return location.pathname.startsWith("/shorts/");
  }

  /**
   * Find the most relevant video element. On Shorts there can be several
   * recycled <video> nodes; prefer one that is playing, else the first that
   * has a source, else the first present.
   * @returns {HTMLVideoElement | null}
   */
  function findActiveVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return null;
    const playing = videos.find((v) =>
      !v.paused && !v.ended && v.readyState > 2
    );
    if (playing) return playing;
    const withSrc = videos.find((v) => v.currentSrc || v.src);
    return withSrc || videos[0];
  }

  /**
   * Apply desiredSpeed to a video element.
   *
   * No timing-based "is this our own write" guard is needed: the decision is
   * deterministic. We only write when the current rate differs from the
   * target, and onRateChange only reasserts when the rate drifts away from the
   * target. Because clampSpeed keeps targets inside the browser's supported
   * rate range, a written value reads back equal to the target, so the
   * ratesEqual guard reliably stops any feedback loop.
   * @param {HTMLVideoElement | null} video
   */
  function applySpeedTo(video) {
    if (!video) return;
    const target = Speed.clampSpeed(desiredSpeed);
    if (ratesEqual(video.playbackRate, target)) return;
    try {
      video.playbackRate = target;
    } catch (err) {
      console.error("[YTShortsSpeed] failed to set playbackRate", err);
    }
  }

  /** Re-apply to whatever the active video currently is. */
  function reapply() {
    if (!isShortsPage()) return;
    const video = findActiveVideo();
    if (video && video !== managedVideo) {
      attachTo(video);
    }
    applySpeedTo(managedVideo);
  }

  /**
   * Begin managing a video: set its speed and watch for YouTube resetting it.
   * @param {HTMLVideoElement} video
   */
  function attachTo(video) {
    if (managedVideo === video) return;
    detach();
    managedVideo = video;
    video.addEventListener("ratechange", onRateChange);
    video.addEventListener("play", onPlay);
    applySpeedTo(video);
  }

  /** Stop managing the current video and remove its listeners. */
  function detach() {
    if (!managedVideo) return;
    managedVideo.removeEventListener("ratechange", onRateChange);
    managedVideo.removeEventListener("play", onPlay);
    managedVideo = null;
  }

  function onRateChange() {
    if (!managedVideo) return;
    const target = Speed.clampSpeed(desiredSpeed);
    // If the rate already matches our target, this event came from our own
    // write (or is a no-op) and needs no action. Otherwise YouTube or the user
    // changed it, so reassert our chosen speed.
    if (ratesEqual(managedVideo.playbackRate, target)) return;
    applySpeedTo(managedVideo);
  }

  function onPlay() {
    applySpeedTo(managedVideo);
  }

  /**
   * Persist + apply a new desired speed.
   * @param {number} value
   * @param {boolean} [showOverlay]
   */
  function setSpeed(value, showOverlay = true) {
    desiredSpeed = Speed.clampSpeed(value);
    reapply();
    if (showOverlay) showIndicator(desiredSpeed);
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: desiredSpeed });
    } catch (err) {
      console.error("[YTShortsSpeed] storage.set failed", err);
    }
  }

  /** Render a transient speed badge over the player. */
  function showIndicator(value) {
    if (!document.body) return;
    let el = document.getElementById(INDICATOR_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = INDICATOR_ID;
      // Inline styles keep us independent of YouTube's CSS and CSP for styles.
      Object.assign(el.style, {
        position: "fixed",
        top: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: "2147483647",
        padding: "8px 16px",
        borderRadius: "999px",
        background: "rgba(0, 0, 0, 0.82)",
        color: "#fff",
        font: "600 16px/1 system-ui, -apple-system, sans-serif",
        letterSpacing: "0.02em",
        pointerEvents: "none",
        transition: "opacity 0.18s ease",
        opacity: "0",
      });
      document.body.appendChild(el);
    }
    el.textContent = `\u26A1 ${Speed.formatSpeed(value)}`;
    // Force reflow so the opacity transition runs on repeated triggers.
    void el.offsetWidth;
    el.style.opacity = "1";
    if (indicatorTimer) clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => {
      el.style.opacity = "0";
    }, INDICATOR_TIMEOUT_MS);
  }

  // ---- Message handling (popup + background) ----------------------------

  function handleMessage(msg, _sender, sendResponse) {
    if (!msg || typeof msg.type !== "string") return undefined;
    switch (msg.type) {
      case "GET_STATE": {
        sendResponse({
          speed: desiredSpeed,
          isShorts: isShortsPage(),
          hasVideo: !!findActiveVideo(),
        });
        return true;
      }
      case "SET_SPEED": {
        const parsed = Speed.parseSpeed(msg.value);
        if (parsed === null) {
          sendResponse({ ok: false, error: "invalid speed" });
          return true;
        }
        setSpeed(parsed);
        sendResponse({ ok: true, speed: desiredSpeed });
        return true;
      }
      case "STEP_UP": {
        setSpeed(Speed.adjustSpeed(desiredSpeed, KEYBOARD_STEP));
        sendResponse({ ok: true, speed: desiredSpeed });
        return true;
      }
      case "STEP_DOWN": {
        setSpeed(Speed.adjustSpeed(desiredSpeed, -KEYBOARD_STEP));
        sendResponse({ ok: true, speed: desiredSpeed });
        return true;
      }
      case "RESET": {
        setSpeed(Speed.DEFAULT_SPEED);
        sendResponse({ ok: true, speed: desiredSpeed });
        return true;
      }
      default:
        return undefined;
    }
  }

  // ---- SPA navigation + DOM churn handling ------------------------------

  function onNavigate() {
    // New Short: managed video is likely stale. Detach and re-resolve.
    detach();
    // Give YouTube a tick to mount the new <video>, then reassert.
    setTimeout(reapply, 0);
    setTimeout(reapply, 250);
  }

  let lastHref = location.href;
  let scheduledRaf = false;

  /**
   * Coalesce the expensive "did a new video mount?" check to at most once per
   * animation frame. YouTube fires DOM mutations very frequently, so running
   * findActiveVideo() (a querySelectorAll + scan) on every mutation is wasteful.
   */
  function scheduleVideoCheck() {
    if (scheduledRaf) return;
    scheduledRaf = true;
    const run = () => {
      scheduledRaf = false;
      const active = findActiveVideo();
      if (active && active !== managedVideo) reapply();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
    } else {
      setTimeout(run, 16);
    }
  }

  function startObservers() {
    // YouTube fires this custom event on SPA navigation.
    globalThis.addEventListener("yt-navigate-finish", onNavigate, true);
    document.addEventListener("yt-navigate-finish", onNavigate, true);

    // Fallback: detect URL changes and DOM mutations (video recycling).
    const mo = new MutationObserver(() => {
      // URL-change handling stays synchronous so navigation reacts instantly.
      if (location.href !== lastHref) {
        lastHref = location.href;
        onNavigate();
        return;
      }
      // A new video element may have been mounted without a URL change.
      // Defer the expensive lookup and coalesce bursts of mutations.
      scheduleVideoCheck();
    });
    if (document.documentElement) {
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }

    // Low-frequency safety net in case events/mutations are missed.
    setInterval(reapply, 1000);
  }

  // ---- Init -------------------------------------------------------------

  function init() {
    try {
      chrome.runtime.onMessage.addListener(handleMessage);
    } catch (err) {
      console.error("[YTShortsSpeed] cannot register message listener", err);
    }

    // React to changes from the popup made while we're alive.
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[STORAGE_KEY]) return;
        const next = Speed.parseSpeed(changes[STORAGE_KEY].newValue);
        if (next !== null && next !== desiredSpeed) {
          desiredSpeed = next;
          reapply();
        }
      });
    } catch (err) {
      console.error("[YTShortsSpeed] cannot watch storage", err);
    }

    // Load the persisted speed, then start managing.
    try {
      chrome.storage.local.get(STORAGE_KEY, (data) => {
        const stored = Speed.parseSpeed(data && data[STORAGE_KEY]);
        if (stored !== null) desiredSpeed = stored;
        startObservers();
        reapply();
      });
    } catch (err) {
      console.error("[YTShortsSpeed] storage.get failed; using default", err);
      startObservers();
      reapply();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
