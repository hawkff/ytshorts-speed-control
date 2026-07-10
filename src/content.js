/**
 * Content script for YT Shorts Speed Control.
 *
 * Copyright (C) 2026 hawkff
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Responsibilities:
 *  - Track the currently active <video> element on a Shorts page.
 *  - Apply the user's chosen playback speed and keep re-applying it, because
 *    YouTube resets playbackRate to 1x whenever it swaps to a new Short.
 *  - React to popup messages and extension storage changes.
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

  // Firefox exposes promise-based APIs as `browser`; Chrome uses `chrome`.
  const extensionApi = globalThis.browser ?? globalThis.chrome;

  const STORAGE_KEY = "speed";
  const SETTINGS_KEY = "settings";
  const KEYBOARD_STEP = Speed.KEYBOARD_STEP;
  const INDICATOR_ID = "yt-shorts-speed-indicator";
  const INDICATOR_TIMEOUT_MS = 1200;

  /** Default settings; merged over whatever is persisted. */
  const DEFAULT_SETTINGS = Object.freeze({
    // When true, the same speed control also applies to regular YouTube
    // watch pages (/watch). Off by default: Shorts only.
    enableOnWatch: false,
  });

  /** Current desired speed; mirrors local extension storage. */
  let desiredSpeed = Speed.DEFAULT_SPEED;
  /** Current settings; mirrors local extension storage. */
  let settings = { ...DEFAULT_SETTINGS };
  /**
   * Revision counters for live state. Every accepted external mutation of
   * speed/settings (popup message, keyboard, storage event) bumps its counter,
   * even when the incoming value equals the current one. Init captures both
   * before its awaited storage read and only adopts the snapshot for keys
   * whose revision is unchanged, so an older snapshot never overwrites newer
   * live state.
   */
  let speedRevision = 0;
  let settingsRevision = 0;
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

  /** True on regular YouTube watch pages (/watch). */
  function isWatchPage() {
    return location.pathname === "/watch";
  }

  /**
   * Whether speed control should be active on the current page.
   * Always active on Shorts; active on /watch only when the user opted in.
   * @returns {boolean}
   */
  function isActivePage() {
    if (isShortsPage()) return true;
    if (isWatchPage() && settings.enableOnWatch) return true;
    return false;
  }

  /**
   * Find the most relevant video element. On Shorts there can be several
   * recycled <video> nodes; prefer the largest meaningfully visible one. When
   * no video has a useful layout box (for example in a hidden document), fall
   * back to one that is playing, then one with a source, then the first present.
   * @returns {HTMLVideoElement | null}
   */
  function findActiveVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return null;

    let best = null;
    let bestArea = 0;
    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      const area = viewportVisibleArea(rect);
      const boxArea = rect.width * rect.height;
      // Require at least ~35% of the element to be on screen to count as the
      // one being watched; this rejects tiny slivers peeking into the viewport.
      if (boxArea <= 0 || area / boxArea < 0.35 || area <= bestArea) continue;
      bestArea = area;
      best = video;
    }
    if (best) return best;

    const playing = videos.find((video) =>
      !video.paused && !video.ended && video.readyState > 2
    );
    if (playing) return playing;
    const withSrc = videos.find((video) => video.currentSrc || video.src);
    return withSrc || videos[0];
  }

  /**
   * Area of a rectangle's intersection with the viewport.
   * @param {DOMRect} rect
   * @returns {number}
   */
  function viewportVisibleArea(rect) {
    if (rect.width <= 0 || rect.height <= 0) return 0;
    const vw = globalThis.innerWidth || document.documentElement.clientWidth;
    const vh = globalThis.innerHeight || document.documentElement.clientHeight;
    const w = Math.max(
      0,
      Math.min(rect.right, vw) - Math.max(rect.left, 0),
    );
    const h = Math.max(
      0,
      Math.min(rect.bottom, vh) - Math.max(rect.top, 0),
    );
    return w * h;
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
    // Never write playbackRate into a paused video. Rates above YouTube's
    // native 2x maximum make its player re-sync (reset the rate and call
    // play()) when written while paused, so each rewrite from onRateChange /
    // the 1s interval provoked another auto-resume until the pause-enforcement
    // window lost the fight and playback continued on its own. The rate only
    // matters during playback anyway: onPlay (and the interval) reassert it
    // the moment the video genuinely resumes.
    if (video === pausedVideo || video.paused) return;
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
    if (!isActivePage()) return;
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
    speedRevision += 1;
    desiredSpeed = Speed.clampSpeed(value);
    reapply();
    if (showOverlay) showIndicator(desiredSpeed);
    try {
      extensionApi.storage.local
        .set({ [STORAGE_KEY]: desiredSpeed })
        .catch((err) => {
          console.error("[YTShortsSpeed] storage.set failed", err);
        });
    } catch (err) {
      console.error("[YTShortsSpeed] storage.set failed", err);
    }
  }

  /**
   * Toggle play/pause on the video the user is actually watching.
   *
   * Bound to P, which YouTube Shorts lacks.
   *
   * The reliable way to pause is to drive YouTube's own player rather than
   * fight it: setting video.pause() directly can make YouTube's state machine
   * (especially on /watch) re-assert playback, so the pause only lasts a
   * split second. Instead we click YouTube's native play/pause button, which
   * keeps the player's internal state in sync. When pausing, we also arm a
   * short re-pause enforcement window to catch YouTube's immediate auto-resume
   * retries. If no native control is found (some Shorts layouts), we fall back
   * to toggling the media element with the same enforcement window.
   */
  function togglePlayPause() {
    const video = findActiveVideo();
    if (!video) return;
    const willPause = !video.paused;
    try {
      if (clickNativePlayButton(video)) {
        if (willPause) {
          userPause(video);
        } else {
          releasePause();
        }
        showStatusIndicator(willPause ? "\u23F8 Pause" : "\u25B6 Play");
        return;
      }
      // Fallback: drive the media element directly.
      if (video.paused) {
        userPlay(video);
        showStatusIndicator("\u25B6 Play");
      } else {
        userPause(video);
        showStatusIndicator("\u23F8 Pause");
      }
    } catch (err) {
      console.error("[YTShortsSpeed] play/pause toggle failed", err);
    }
  }

  /**
   * Click YouTube's native play/pause button for the player that owns `video`.
   * Returns true if a control was found and clicked. Using the real control
   * keeps YouTube's player state consistent so the pause sticks.
   *
   * Only a button scoped to the video's own player container is used, so we
   * never click a different (recycled/offscreen) player's control.
   * @param {HTMLVideoElement} video
   * @returns {boolean}
   */
  function clickNativePlayButton(video) {
    const container = video.closest(
      ".html5-video-player, ytd-player, #shorts-player, ytd-reel-video-renderer",
    );
    if (!container) return false; // no recognizable player; use fallback
    const btn = container.querySelector(".ytp-play-button");
    if (!(btn instanceof HTMLElement)) return false;
    // Ignore a button with no layout box (hidden / detached players).
    const r = btn.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    btn.click();
    return true;
  }

  // Pause enforcement. After the user pauses with P, YouTube's player tries to
  // auto-resume (programmatically, within a few hundred ms). We re-pause during
  // a short window so the pause sticks. A deliberate user interaction (click,
  // tap, or any key) immediately ends enforcement so the user can resume.
  let pausedVideo = null;
  let pauseEnforceUntil = 0;
  /** Handle of the single pending pause-sweep timeout, or null. */
  let pauseSweepTimer = null;

  /** Begin honoring a user-requested pause and resist YouTube re-playing it. */
  function userPause(video) {
    releasePause();
    pausedVideo = video;
    pauseEnforceUntil = Date.now() + 1500;
    video.addEventListener("play", reassertPause, true);
    video.addEventListener("playing", reassertPause, true);
    // A genuine user gesture should win over enforcement: stop resisting as
    // soon as the user clicks/taps or presses a key. The key listener is
    // registered after the current dispatch so the P press that requested the
    // pause cannot immediately cancel its own enforcement window.
    globalThis.addEventListener("pointerdown", onUserGestureDuringPause, true);
    setTimeout(() => {
      if (pausedVideo === video) {
        globalThis.addEventListener("keydown", onUserGestureDuringPause, true);
      }
    }, 0);
    video.pause();
    // Belt-and-suspenders: also poll briefly, in case a resume path fires no
    // play/playing event we caught.
    schedulePauseSweep();
  }

  /** Honor a user-requested play and stop resisting playback. */
  function userPlay(video) {
    releasePause();
    // play() returns a promise that can reject (e.g. autoplay policy);
    // swallow it so we don't throw an unhandled rejection.
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  /** Cancel any pending pause-sweep timeout so no stale chain survives. */
  function cancelPauseSweep() {
    if (pauseSweepTimer === null) return;
    clearTimeout(pauseSweepTimer);
    pauseSweepTimer = null;
  }

  /** Stop enforcing any pause intent. */
  function releasePause() {
    // Always cancel the sweep, even when no pause state remains: a stale
    // callback must never outlive its pause intent.
    cancelPauseSweep();
    if (!pausedVideo) return;
    pausedVideo.removeEventListener("play", reassertPause, true);
    pausedVideo.removeEventListener("playing", reassertPause, true);
    globalThis.removeEventListener(
      "pointerdown",
      onUserGestureDuringPause,
      true,
    );
    globalThis.removeEventListener("keydown", onUserGestureDuringPause, true);
    pausedVideo = null;
    pauseEnforceUntil = 0;
  }

  /**
   * Any deliberate user interaction during the enforcement window means the
   * user is taking over (e.g. clicking play). If the current shortcut event ever
   * reaches this listener, ignore it so P pause cannot self-cancel. Release on
   * the next tick so the user's resume isn't immediately re-paused.
   * @param {Event} event
   */
  function onUserGestureDuringPause(event) {
    if (isPlainPauseShortcut(event)) return;
    setTimeout(releasePause, 0);
  }

  /**
   * @param {Event} event
   * @returns {boolean}
   */
  function isPlainPauseShortcut(event) {
    if (!(event instanceof KeyboardEvent)) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    return event.key === "p" || event.key === "P" || event.code === "KeyP";
  }

  /** Re-pause the video YouTube is trying to auto-resume, within the window. */
  function reassertPause() {
    if (!pausedVideo) return;
    if (Date.now() > pauseEnforceUntil) {
      releasePause();
      return;
    }
    if (!pausedVideo.paused) {
      try {
        pausedVideo.pause();
      } catch (_err) {
        // ignore
      }
    }
  }

  /**
   * Poll a few times during the enforcement window as a fallback. Exactly one
   * pending sweep timeout exists at a time, owned by pauseSweepTimer, so
   * releasePause can always cancel the chain.
   */
  function schedulePauseSweep() {
    cancelPauseSweep();
    const tick = () => {
      // This callback has fired; its handle is no longer pending.
      pauseSweepTimer = null;
      if (!pausedVideo) return;
      if (Date.now() > pauseEnforceUntil) {
        releasePause();
        return;
      }
      if (!pausedVideo.paused) {
        try {
          pausedVideo.pause();
        } catch (_err) {
          // ignore
        }
      }
      pauseSweepTimer = setTimeout(tick, 100);
    };
    pauseSweepTimer = setTimeout(tick, 100);
  }

  /**
   * Coerce arbitrary input into a valid settings object (only known keys,
   * correct types), merged over the current settings.
   * @param {Record<string, unknown>} incoming
   * @returns {typeof DEFAULT_SETTINGS}
   */
  function normalizeSettings(incoming) {
    const next = { ...DEFAULT_SETTINGS, ...settings };
    if (typeof incoming.enableOnWatch === "boolean") {
      next.enableOnWatch = incoming.enableOnWatch;
    }
    return next;
  }

  /**
   * Apply settings side-effects after `settings` has been updated: either
   * re-assert speed on a now-active page, or release control + reset to 1x if
   * the page just became inactive.
   * @param {boolean} wasActive whether the page was active before the change
   */
  function reconcileAfterSettings(wasActive) {
    if (isActivePage()) {
      reapply();
    } else if (wasActive && managedVideo) {
      // Just deactivated on this page: release control and reset to 1x.
      const video = managedVideo;
      detach();
      try {
        if (!ratesEqual(video.playbackRate, Speed.DEFAULT_SPEED)) {
          video.playbackRate = Speed.DEFAULT_SPEED;
        }
      } catch (err) {
        console.error("[YTShortsSpeed] failed to reset playbackRate", err);
      }
    }
  }

  /**
   * Update in-memory settings from external input (no persistence). Used by the
   * storage.onChanged listener, which must NOT re-write storage or it loops.
   * @param {Record<string, unknown>} incoming
   */
  function adoptSettings(incoming) {
    settingsRevision += 1;
    const wasActive = isActivePage();
    settings = normalizeSettings(incoming);
    reconcileAfterSettings(wasActive);
  }

  /**
   * Persist + apply new settings (used by the SET_SETTINGS message from the
   * popup). Writes storage, then applies side-effects.
   * @param {Record<string, unknown>} incoming
   */
  function applySettings(incoming) {
    settingsRevision += 1;
    const wasActive = isActivePage();
    settings = normalizeSettings(incoming);
    try {
      extensionApi.storage.local
        .set({ [SETTINGS_KEY]: { ...settings } })
        .catch((err) => {
          console.error("[YTShortsSpeed] settings.set failed", err);
        });
    } catch (err) {
      console.error("[YTShortsSpeed] settings.set failed", err);
    }
    reconcileAfterSettings(wasActive);
  }

  /** Render a transient speed badge over the player. */
  function showIndicator(value) {
    showStatusIndicator(`\u26A1 ${Speed.formatSpeed(value)}`);
  }

  /**
   * Render a transient text badge over the player (used for speed changes and
   * play/pause). Reuses a single element and resets its fade timer.
   * @param {string} text
   */
  function showStatusIndicator(text) {
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
    el.textContent = text;
    // Force reflow so the opacity transition runs on repeated triggers.
    void el.offsetWidth;
    el.style.opacity = "1";
    if (indicatorTimer) clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => {
      el.style.opacity = "0";
    }, INDICATOR_TIMEOUT_MS);
  }

  // ---- Message handling (popup) -----------------------------------------

  function handleMessage(msg, _sender, sendResponse) {
    if (!msg || typeof msg.type !== "string") return undefined;
    switch (msg.type) {
      case "GET_STATE": {
        sendResponse({
          speed: desiredSpeed,
          isShorts: isShortsPage(),
          isWatch: isWatchPage(),
          isActive: isActivePage(),
          hasVideo: !!findActiveVideo(),
          settings: { ...settings },
        });
        return true;
      }
      case "SET_SETTINGS": {
        const incoming = msg.settings;
        if (!incoming || typeof incoming !== "object") {
          sendResponse({ ok: false, error: "invalid settings" });
          return true;
        }
        applySettings(incoming);
        sendResponse({ ok: true, settings: { ...settings } });
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

  // ---- Keyboard shortcuts ----------------------------------------------
  //
  // Chrome's manifest `commands` API can't bind bare keys (no modifier), so
  // single-key shortcuts are handled here, the same way YouTube handles its
  // own j/k/l keys. Active on Shorts, and on /watch when the user opts in.
  //
  //   ]          -> speed up
  //   [          -> speed down
  //   Backspace  -> reset to 1x
  //   P          -> toggle pause/play

  /**
   * Whether the event target is a place where the user is typing, so we must
   * not hijack the key (search box, comment field, contenteditable, etc.).
   * @param {EventTarget | null} target
   * @returns {boolean}
   */
  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (target.isContentEditable) return true;
    // YouTube's search/comment boxes use role=textbox on a content-editable.
    return target.getAttribute("role") === "textbox";
  }

  function onKeyDown(e) {
    if (!isActivePage()) return;
    // Don't steal keys while the user is typing in a field.
    if (isEditableTarget(e.target)) return;
    // Ignore key-repeat (holding a key) so we step once per press instead of
    // rocketing the speed to its limit.
    if (e.repeat) return;

    // Identify the intended action. Match on e.key (the produced character)
    // first, then fall back to e.code (physical key position) so layouts where
    // [ and ] sit elsewhere, or require AltGr, still work.
    let action = null;
    if (e.key === "]" || e.code === "BracketRight") {
      action = "up";
    } else if (e.key === "[" || e.code === "BracketLeft") {
      action = "down";
    } else if (e.key === "Backspace" || e.code === "Backspace") {
      action = "reset";
    } else if (e.key === "p" || e.key === "P" || e.code === "KeyP") {
      action = "pause";
    } else {
      return; // not ours; let the page handle it
    }

    // Don't hijack modified combos. Brackets may legitimately need AltGr on
    // some layouts (and AltGr reports as Ctrl+Alt), so allow a genuine AltGraph
    // modifier but ignore other Cmd/Ctrl/Alt combos so browser/system shortcuts
    // (e.g. Cmd+[ / Cmd+] back/forward) keep working. Backspace never uses a
    // modifier here (Cmd/Alt+Backspace are OS navigation/delete).
    const isAltGraph = typeof e.getModifierState === "function" &&
      e.getModifierState("AltGraph");

    if (
      (action === "up" || action === "down") &&
      (e.metaKey || (!isAltGraph && (e.ctrlKey || e.altKey)))
    ) {
      return;
    }
    if (action === "reset" && (e.ctrlKey || e.metaKey || e.altKey)) return;
    // P is a plain shortcut; never hijack Cmd/Ctrl+P (print) etc.
    if (action === "pause" && (e.ctrlKey || e.metaKey || e.altKey)) return;

    // We acted: stop YouTube from also reacting before we perform side effects
    // like clicking its native play/pause button.
    // stopImmediatePropagation also blocks other listeners on this same target.
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();

    switch (action) {
      case "up":
        setSpeed(Speed.adjustSpeed(desiredSpeed, KEYBOARD_STEP));
        break;
      case "down":
        setSpeed(Speed.adjustSpeed(desiredSpeed, -KEYBOARD_STEP));
        break;
      case "reset":
        setSpeed(Speed.DEFAULT_SPEED);
        break;
      case "pause":
        togglePlayPause();
        break;
    }
  }

  // ---- SPA navigation + DOM churn handling ------------------------------

  function onNavigate() {
    // New Short: managed video is likely stale, and any pause intent applied
    // to the previous Short must not carry over to the next one.
    releasePause();
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
      // The page may have become inactive between scheduling and this frame
      // (SPA navigation); re-check the policy boundary before scanning.
      if (!isActivePage()) return;
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
      // Control is inert on inactive routes, so skip the scan entirely there;
      // URL changes were already handled above, keeping navigation instant.
      if (!isActivePage()) return;
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

  async function init() {
    try {
      extensionApi.runtime.onMessage.addListener(handleMessage);
    } catch (err) {
      console.error("[YTShortsSpeed] cannot register message listener", err);
    }

    // React to changes from the popup made while we're alive.
    try {
      extensionApi.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes[STORAGE_KEY]) {
          const next = Speed.parseSpeed(changes[STORAGE_KEY].newValue);
          if (next !== null) {
            // Bump even when the value already matches, so a pending init
            // snapshot knows this newer write supersedes it.
            speedRevision += 1;
            if (next !== desiredSpeed) {
              desiredSpeed = next;
              reapply();
            }
          }
        }
        if (changes[SETTINGS_KEY]) {
          const incoming = changes[SETTINGS_KEY].newValue;
          // adoptSettings does NOT re-persist, avoiding a storage write loop.
          // If the key was removed (newValue undefined), fall back to defaults
          // so stale opt-in state doesn't linger until reload.
          if (incoming && typeof incoming === "object") {
            adoptSettings(incoming);
          } else {
            adoptSettings({});
          }
        }
      });
    } catch (err) {
      console.error("[YTShortsSpeed] cannot watch storage", err);
    }

    // Load the persisted speed + settings, then start managing. Any live
    // update that lands while the read is pending bumps a revision counter;
    // per key, the snapshot is adopted only if its revision is unchanged.
    const speedRevisionAtRead = speedRevision;
    const settingsRevisionAtRead = settingsRevision;
    try {
      const data = await extensionApi.storage.local.get([
        STORAGE_KEY,
        SETTINGS_KEY,
      ]);
      const stored = Speed.parseSpeed(data && data[STORAGE_KEY]);
      if (stored !== null && speedRevision === speedRevisionAtRead) {
        desiredSpeed = stored;
      }
      const storedSettings = data && data[SETTINGS_KEY];
      if (
        storedSettings && typeof storedSettings === "object" &&
        settingsRevision === settingsRevisionAtRead
      ) {
        settings = normalizeSettings(storedSettings);
      }
    } catch (err) {
      console.error("[YTShortsSpeed] storage.get failed; using default", err);
    }

    startObservers();
    reapply();
  }

  // Register the keyboard listener synchronously at document_start, BEFORE
  // YouTube's app scripts load. On the capture phase, listeners on the same
  // target fire in registration order, so registering first lets us claim
  // ] / [ / Backspace before YouTube's own handlers can act on them.
  globalThis.addEventListener("keydown", onKeyDown, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
