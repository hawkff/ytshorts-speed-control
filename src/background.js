/**
 * Background service worker for YT Shorts Speed Control.
 *
 * MV3 keyboard `commands` are delivered to the extension's service worker, not
 * to content scripts. This worker translates each command into a message for
 * the content script in the active YouTube tab.
 */
"use strict";

const COMMAND_TO_MESSAGE = Object.freeze({
  "speed-up": { type: "STEP_UP" },
  "speed-down": { type: "STEP_DOWN" },
  "speed-reset": { type: "RESET" },
});

/**
 * Send a message to the content script in the active tab, ignoring the
 * "no receiving end" error that happens when the active tab isn't YouTube.
 * @param {object} message
 */
async function messageActiveTab(message) {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    console.error("[YTShortsSpeed] tabs.query failed", err);
    return;
  }
  const tab = tabs && tabs[0];
  if (!tab || typeof tab.id !== "number") return;

  const url = tab.url || "";
  if (!/^https:\/\/(www|m)\.youtube\.com\//.test(url)) return;

  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (_err) {
    // Content script not present in this tab/frame; safe to ignore.
  }
}

chrome.commands.onCommand.addListener((command) => {
  const message = COMMAND_TO_MESSAGE[command];
  if (!message) return;
  void messageActiveTab(message);
});
