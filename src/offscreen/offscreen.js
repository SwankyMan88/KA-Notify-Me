import { DEFAULT_POLL_SECONDS } from '../lib/constants.js';

/**
 * This document exists only to hold two things the service worker cannot: the
 * poll timer, and an <audio> element for the alert sound.
 */

let timer = null;
let currentSeconds = null;

function beat() {
  chrome.runtime.sendMessage({ type: 'kanm:heartbeat' }).catch(() => {
    // The worker is asleep or restarting; the next tick will reach it.
  });
}

/** Rebuilds the timer only when the interval actually changed. */
function setInterval_(seconds) {
  if (seconds === currentSeconds) return;
  currentSeconds = seconds;
  if (timer) clearInterval(timer);
  timer = setInterval(beat, seconds * 1000);
}

async function applySettings() {
  const { pollSeconds } = await chrome.storage.local.get(['pollSeconds']);
  setInterval_(Number(pollSeconds) || DEFAULT_POLL_SECONDS);
}

applySettings();

// Changing the interval in Settings takes effect without a reload.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.pollSeconds) applySettings();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Proof of life for the worker, which cannot otherwise tell a running timer
  // from a document that is merely still listed.
  if (message?.type === 'kanm:ping') {
    sendResponse({ alive: true, seconds: currentSeconds });
    return;
  }

  if (message?.type !== 'kanm:play-chime') return;

  // Reported back rather than swallowed: "no sound" is impossible to diagnose
  // when the one place that knows why keeps it to itself.
  const url = chrome.runtime.getURL(`sounds/${message.sound ?? 'chime'}.wav`);
  const audio = new Audio(url);
  audio.volume = Math.min(1, Math.max(0, message.volume ?? 0.6));

  audio
    .play()
    .then(() => sendResponse({ played: true, url }))
    .catch((error) => {
      console.warn('[KA Notify Me] could not play sound', error);
      sendResponse({ played: false, url, error: `${error.name}: ${error.message}` });
    });

  return true; // the response comes after play() settles
});
