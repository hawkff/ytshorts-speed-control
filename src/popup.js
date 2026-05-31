/**
 * Popup UI logic for YT Shorts Speed Control.
 *
 * Copyright (C) 2026 hawkff
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Talks to the active tab's content script via chrome.tabs.sendMessage and
 * persists the chosen speed through chrome.storage.local (the content script
 * also listens to storage changes, so the popup and page stay in sync).
 */
(function () {
  "use strict";

  const Speed = globalThis.YTShortsSpeed;

  const els = {
    status: document.getElementById("status"),
    current: document.getElementById("current-speed"),
    slider: document.getElementById("slider"),
    presets: document.getElementById("presets"),
    customForm: document.getElementById("custom-form"),
    customInput: document.getElementById("custom-input"),
    reset: document.getElementById("reset"),
  };

  let currentSpeed = Speed.DEFAULT_SPEED;

  /** Query the active tab; returns the tab or null. */
  async function getActiveTab() {
    try {
      const tabs = await chrome.tabs.query({
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
      return await chrome.tabs.sendMessage(tab.id, message);
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
   * @param {unknown} value
   * @returns {Promise<boolean>} true if the value parsed and was applied.
   */
  async function applySpeed(value) {
    const parsed = Speed.parseSpeed(value);
    if (parsed === null) {
      setStatus("Enter a speed between 0.1 and 16.", true);
      return false;
    }
    render(parsed);
    // Persist first so the value survives even if no content script is present.
    try {
      await chrome.storage.local.set({ speed: parsed });
    } catch (_err) {
      // Non-fatal: the message below may still apply it live.
    }
    const res = await sendToTab({ type: "SET_SPEED", value: parsed });
    if (res && res.ok) {
      setStatus(`Playing at ${Speed.formatSpeed(parsed)}.`, false);
    }
    return true;
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
  }

  /** Determine the starting speed and page status on open. */
  async function bootstrap() {
    buildPresets();
    wireControls();

    // Prefer the live state from the content script; fall back to storage.
    const tab = await getActiveTab();
    const onYouTube = tab && isYouTubeUrl(tab.url);

    let speed = Speed.DEFAULT_SPEED;
    try {
      const data = await chrome.storage.local.get("speed");
      const stored = Speed.parseSpeed(data && data.speed);
      if (stored !== null) speed = stored;
    } catch (_err) {
      // ignore; keep default
    }

    const state = await sendToTab({ type: "GET_STATE" });
    if (state && Speed.isValidSpeed(state.speed)) {
      speed = state.speed;
    }

    render(speed);

    if (!onYouTube) {
      setStatus("Open a YouTube tab to control playback.", true);
    } else if (state && !state.isShorts) {
      setStatus("Not on a Short. Speed will apply when you open one.", false);
    } else if (state && state.isShorts) {
      setStatus(`Playing at ${Speed.formatSpeed(speed)}.`, false);
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
