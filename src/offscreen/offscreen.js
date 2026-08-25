import { POLL_INTERVAL_MS } from '../lib/constants.js';

/**
 * This document exists only to hold two things the service worker cannot: the
 * 30-second poll timer, and an <audio> element for the chime.
 */

const chimeUrl = chrome.runtime.getURL('sounds/chime.wav');

setInterval(() => {
  chrome.runtime.sendMessage({ type: 'kanm:heartbeat' }).catch(() => {
    // The worker is asleep or restarting; the next tick will reach it.
  });
}, POLL_INTERVAL_MS);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'kanm:play-chime') return;

  const audio = new Audio(chimeUrl);
  audio.volume = Math.min(1, Math.max(0, message.volume ?? 0.6));
  audio.play().catch((error) => console.warn('[KA Notify Me] could not play chime', error));
});
