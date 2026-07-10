/**
 * Popup UI logic for YT Shorts Speed Control.
 *
 * Copyright (C) 2026 hawkff
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Talks to the active tab's content script through the WebExtension API and
 * persists the chosen speed in local extension storage (the content script
 * also listens to storage changes, so the popup and page stay in sync).
 */
(function () {
  "use strict";

  const Speed = globalThis.YTShortsSpeed;
  const Settings = globalThis.YTShortsSettings;
  const extensionApi = globalThis.browser ?? globalThis.chrome;

  const els = {
    status: document.getElementById("status"),
    current: document.getElementById("current-speed"),
    slider: document.getElementById("slider"),
    presets: document.getElementById("presets"),
    customForm: document.getElementById("custom-form"),
    customInput: document.getElementById("custom-input"),
    reset: document.getElementById("reset"),
    enableOnWatch: document.getElementById("enable-on-watch"),
    hintUp: document.getElementById("hint-up"),
    hintDown: document.getElementById("hint-down"),
    hintReset: document.getElementById("hint-reset"),
  };

  let currentSpeed = Speed.DEFAULT_SPEED;
  // Last speed that reached storage or the live page; rollback target when an
  // operation fails completely.
  let settledSpeed = Speed.DEFAULT_SPEED;
  let speedRequestId = 0;
  // Serializes speed side effects so an older operation can never reach
  // storage or the content script after a newer one.
  let speedQueue = Promise.resolve();

  let settings = { ...Settings.DEFAULT_SETTINGS };
  let settledSettings = { ...Settings.DEFAULT_SETTINGS };
  let settingsRequestId = 0;
  let settingsQueue = Promise.resolve();

  /** Query the active tab; returns the tab or null. */
  async function getActiveTab() {
    try {
      const tabs = await extensionApi.tabs.query({
        active: true,
        currentWindow: true,
      });
      return (tabs && tabs[0]) || null;
    } catch (_err) {
      return null;
    }
  }

  function isYouTubeUrl(url) {
    return /^https:\/\/(www|m)\.youtube\.com\//.test(url || "");
  }

  /**
   * Send a message to the content script. Resolves to the response, or null
   * if there's no content script listening (e.g. not a YouTube tab).
   */
  async function sendToTab(message) {
    const tab = await getActiveTab();
    if (!tab || typeof tab.id !== "number") return null;
    try {
      return await extensionApi.tabs.sendMessage(tab.id, message);
    } catch (_err) {
      return null;
    }
  }

  function setStatus(text, isWarn) {
    els.status.textContent = text;
    els.status.classList.toggle("warn", !!isWarn);
  }

  /** Reflect a speed value across all controls. */
  function render(speed) {
    currentSpeed = Speed.clampSpeed(speed);
    els.current.textContent = Speed.formatSpeed(currentSpeed);

    // Slider is bounded to [0.25, 4]; clamp the thumb without losing the value.
    const sliderMin = Number(els.slider.min);
    const sliderMax = Number(els.slider.max);
    els.slider.value = String(
      Math.min(sliderMax, Math.max(sliderMin, currentSpeed)),
    );

    const buttons = els.presets.querySelectorAll(".preset-btn");
    buttons.forEach((btn) => {
      const val = Number(btn.dataset.speed);
      btn.classList.toggle("active", Math.abs(val - currentSpeed) < 1e-9);
    });
  }

  /**
   * Apply a new speed: persist, tell the page, and update the UI.
   * Renders optimistically, then reports exactly how far the change got
   * (saved and applied / partial / neither). On total failure the UI rolls
   * back to the last settled speed. Only the latest in-flight request may
   * touch the UI after its side effects settle.
   * @param {unknown} value
   * @returns {Promise<boolean>} true if this is still the latest request and
   * at least one side effect (storage or live page) succeeded.
   */
  async function applySpeed(value) {
    const parsed = Speed.parseSpeed(value);
    if (parsed === null) {
      setStatus("Enter a speed between 0.1 and 16.", true);
      return false;
    }
    speedRequestId += 1;
    const requestId = speedRequestId;
    render(parsed);

    const run = speedQueue.then(async () => {
      let saved = false;
      // Persist first so the value survives even if no content script is
      // present.
      try {
        await extensionApi.storage.local.set({ speed: parsed });
        saved = true;
      } catch (_err) {
        // Non-fatal: the message below may still apply it live.
      }
      const res = await sendToTab({ type: "SET_SPEED", value: parsed });
      const applied = !!(res && res.ok === true);
      // Queue order matches invocation order, so even a stale success may
      // advance the settled snapshot.
      if (saved || applied) settledSpeed = parsed;
      return { saved, applied };
    });
    // Keep the queue tail resolved so one failure cannot poison later ops.
    speedQueue = run.then(() => undefined, () => undefined);
    const { saved, applied } = await run;

    // A newer request took over while we awaited; leave the UI to it.
    if (requestId !== speedRequestId) return false;

    if (saved && applied) {
      setStatus(`Playing at ${Speed.formatSpeed(parsed)}.`, false);
    } else if (applied) {
      setStatus("Applied for this tab, but couldn't save the speed.", true);
    } else if (saved) {
      setStatus(
        `Saved ${
          Speed.formatSpeed(parsed)
        }. Open or reload YouTube to apply it.`,
        true,
      );
    } else {
      render(settledSpeed);
      setStatus("Couldn't save or apply that speed.", true);
    }
    return saved || applied;
  }

  /** Reflect current settings onto the controls. */
  function renderSettings() {
    els.enableOnWatch.checked = settings.enableOnWatch;
  }

  /**
   * Fill the keyboard-shortcut hints from the shared constants so the popup
   * text can never drift from the runtime step / reset values.
   */
  function renderShortcutHints() {
    const step = Speed.formatSpeed(Speed.KEYBOARD_STEP);
    // Reset target shown with one decimal (e.g. "1.0x") for readability.
    const resetTarget = `${Speed.DEFAULT_SPEED.toFixed(1)}x`;
    els.hintUp.textContent = `Increase speed by ${step}`;
    els.hintDown.textContent = `Decrease speed by ${step}`;
    els.hintReset.textContent = `Reset speed to ${resetTarget}`;
  }

  /**
   * Persist settings and notify the page so it applies them live.
   * Same outcome contract as applySpeed: optimistic render, exact
   * success/partial/failure status, rollback to the last settled settings on
   * total failure, and only the latest request may touch the UI post-await.
   * @returns {Promise<boolean>}
   */
  async function applySettings(next) {
    const requested = Settings.normalizeSettings(next);
    settingsRequestId += 1;
    const requestId = settingsRequestId;
    settings = { ...requested };
    renderSettings();

    const run = settingsQueue.then(async () => {
      let saved = false;
      try {
        await extensionApi.storage.local.set({
          settings: { ...requested },
        });
        saved = true;
      } catch (_err) {
        // Non-fatal: the message below may still apply it live.
      }
      const res = await sendToTab({
        type: "SET_SETTINGS",
        settings: { ...requested },
      });
      const applied = !!(res && res.ok === true);
      if (saved || applied) settledSettings = { ...requested };
      return { saved, applied };
    });
    settingsQueue = run.then(() => undefined, () => undefined);
    const { saved, applied } = await run;

    if (requestId !== settingsRequestId) return false;

    if (saved && applied) {
      setStatus("Setting saved.", false);
    } else if (applied) {
      setStatus("Applied for this tab, but couldn't save the setting.", true);
    } else if (saved) {
      setStatus("Setting saved. Open or reload YouTube to apply it.", true);
    } else {
      settings = { ...settledSettings };
      renderSettings();
      setStatus("Couldn't save or apply that setting.", true);
    }
    return saved || applied;
  }

  function buildPresets() {
    Speed.SPEED_PRESETS.forEach((value) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "preset-btn";
      btn.dataset.speed = String(value);
      btn.textContent = Speed.formatSpeed(value);
      btn.addEventListener("click", () => applySpeed(value));
      els.presets.appendChild(btn);
    });
  }

  function wireControls() {
    // Live preview while dragging; commit on release.
    els.slider.addEventListener("input", () => {
      const v = Speed.clampSpeed(Number(els.slider.value));
      els.current.textContent = Speed.formatSpeed(v);
    });
    els.slider.addEventListener("change", () => {
      applySpeed(Number(els.slider.value));
    });

    els.customForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      // Only clear the field once the value is accepted, so invalid input is
      // preserved for the user to correct.
      const applied = await applySpeed(els.customInput.value);
      if (applied) els.customInput.value = "";
    });

    els.reset.addEventListener("click", () => applySpeed(Speed.DEFAULT_SPEED));

    els.enableOnWatch.addEventListener("change", async () => {
      await applySettings({ enableOnWatch: els.enableOnWatch.checked });
    });
  }

  /** Determine the starting speed and page status on open. */
  async function bootstrap() {
    buildPresets();
    wireControls();
    renderShortcutHints();

    // Prefer the live state from the content script; fall back to storage.
    const tab = await getActiveTab();
    const onYouTube = tab && isYouTubeUrl(tab.url);

    let speed = Speed.DEFAULT_SPEED;
    try {
      const data = await extensionApi.storage.local.get([
        "speed",
        "settings",
      ]);
      const stored = Speed.parseSpeed(data && data.speed);
      if (stored !== null) speed = stored;
      settings = Settings.normalizeSettings(data && data.settings);
    } catch (_err) {
      // ignore; keep defaults
    }

    const state = await sendToTab({ type: "GET_STATE" });
    if (state && Speed.isValidSpeed(state.speed)) {
      speed = state.speed;
    }
    if (state && state.settings) {
      settings = Settings.normalizeSettings(state.settings);
    }

    render(speed);
    renderSettings();
    settledSpeed = currentSpeed;
    settledSettings = { ...settings };

    if (!onYouTube) {
      setStatus("Open a YouTube tab to control playback.", true);
    } else if (state && state.isShorts) {
      setStatus(`Playing at ${Speed.formatSpeed(speed)}.`, false);
    } else if (state && state.isWatch) {
      if (settings.enableOnWatch) {
        setStatus(`Playing at ${Speed.formatSpeed(speed)}.`, false);
      } else {
        setStatus("Enable below to control regular videos.", false);
      }
    } else if (state) {
      setStatus("Speed applies on Shorts (and videos, if enabled).", false);
    } else {
      setStatus("Ready.", false);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
