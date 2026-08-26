/**
 * This document exists only to hold two things the service worker cannot: the
 * poll timer, and an <audio> element for the alert sound.
 *
 * Two rules here, both learned the hard way:
 *
 * 1. The message listener is registered FIRST, before anything else runs. If
 *    any earlier line throws, module evaluation stops and the listener never
 *    registers -- and from the worker's side that is indistinguishable from a
 *    document that will not start. Nothing above it may be allowed to fail.
 *
 * 2. Nothing here touches an extension API other than `chrome.runtime`. An
 *    offscreen document is given a restricted surface, and reading
 *    `chrome.storage` at the top level is what silently killed this file: the
 *    poll timer never started and no sound ever played, because evaluation
 *    aborted before the listener existed. The poll interval is pushed in by the
 *    worker instead.
 */

const DEFAULT_SECONDS = 5;

let timer = null;
let currentSeconds = null;

function beat() {
  chrome.runtime.sendMessage({ type: 'kanm:heartbeat' }).catch(() => {
    // The worker is asleep or restarting; the next tick will reach it.
  });
}

function setPoll(seconds) {
  const next = Number(seconds) || DEFAULT_SECONDS;
  if (next === currentSeconds) return;

  currentSeconds = next;
  if (timer) clearInterval(timer);
  timer = setInterval(beat, next * 1000);
}

/* ------------------------- listener, first of all ----------------------- */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Proof of life. The worker cannot otherwise tell a running document from one
  // that is merely still listed.
  if (message?.type === 'kanm:ping') {
    sendResponse({ alive: true, seconds: currentSeconds });
    return;
  }

  if (message?.type === 'kanm:set-poll') {
    setPoll(message.seconds);
    sendResponse({ seconds: currentSeconds });
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

// Start beating immediately at the default; the worker corrects it straight
// after, and again whenever the setting changes.
setPoll(DEFAULT_SECONDS);
