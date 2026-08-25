import { ACCENTS, POLL_CHOICES, SOUNDS, THEMES } from '../lib/constants.js';
import { DEFAULTS } from '../lib/storage.js';
import * as store from '../lib/storage.js';
import { installedVersion } from '../lib/update.js';
import { send } from './messaging.js';

const el = (id) => document.getElementById(id);

const ui = {
  panel: el('panel-settings'),
  back: el('settings-back'),
  open: el('open-settings'),

  theme: el('set-theme'),
  accent: el('set-accent'),
  sound: el('set-sound'),
  soundName: el('set-sound-name'),
  volume: el('set-volume'),
  soundNotifications: el('set-sound-notifications'),
  soundChat: el('set-sound-chat'),
  poll: el('set-poll'),
  autoMessages: el('set-auto-messages'),
  updateState: el('set-update-state'),
  checkUpdate: el('set-check-update'),
  reset: el('set-reset'),
  version: el('set-version'),
};

/** Which settings this page owns, for Restore defaults. */
const OWNED = [
  'theme',
  'accent',
  'soundEnabled',
  'soundName',
  'volume',
  'soundOnNotifications',
  'soundOnChat',
  'pollSeconds',
  'autoMessages',
];

let onClose = () => {};
let onOpen = () => {};
/** Suppresses writes while we are populating the controls from storage. */
let loading = false;

/* ------------------------------- previews ------------------------------ */

/**
 * Previews play straight from the popup rather than going through the service
 * worker and its offscreen document. The popup is already a document with
 * audio, so this drops two hops and a storage round-trip, and it cannot be
 * thrown off by a stale offscreen document still holding the previous sound.
 */
let preview = null;

export function playPreview(name, volume) {
  // Cut off whatever is still ringing, so flicking through the list is quick.
  preview?.pause();
  preview = new Audio(chrome.runtime.getURL(`sounds/${name}.wav`));
  preview.volume = Math.min(1, Math.max(0, volume));
  preview.play().catch((error) => console.warn('[KA Notify Me] preview failed', error));
}

/* -------------------------------- theme -------------------------------- */

/**
 * Applied to <html> so the CSS variables switch. Called before first paint as
 * well as on change, otherwise the popup flashes the wrong theme on open.
 */
export function applyAppearance({ theme, accent }) {
  const root = document.documentElement;

  if (theme && theme !== 'system') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');

  if (accent && accent !== 'violet') root.setAttribute('data-accent', accent);
  else root.removeAttribute('data-accent');
}

/* -------------------------------- build -------------------------------- */

function fillSelect(select, options) {
  select.replaceChildren(
    ...options.map(({ value, label }) => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = label;
      return option;
    }),
  );
}

function buildSwatches() {
  ui.accent.replaceChildren(
    ...ACCENTS.map(({ value, label, swatch }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.style.background = swatch;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.dataset.accent = value;
      button.addEventListener('click', () => store.write({ accent: value }));
      return button;
    }),
  );
}

/* -------------------------------- render ------------------------------- */

export function render(state) {
  loading = true;

  ui.theme.value = state.theme;
  ui.sound.checked = state.soundEnabled;
  ui.soundName.value = state.soundName;
  ui.volume.value = Math.round(state.volume * 100);
  ui.soundNotifications.checked = state.soundOnNotifications;
  ui.soundChat.checked = state.soundOnChat;
  ui.poll.value = String(state.pollSeconds);
  ui.autoMessages.checked = state.autoMessages;

  for (const swatch of ui.accent.children) {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.accent === state.accent));
  }

  // Sound choices only matter when sound is on at all.
  for (const control of [ui.soundName, ui.volume, ui.soundNotifications, ui.soundChat]) {
    control.disabled = !state.soundEnabled;
  }

  ui.updateState.textContent = updateSentence(state);
  ui.updateState.classList.toggle('setting-note--bad', Boolean(state.updateError));
  ui.version.textContent = `v${installedVersion()}`;

  loading = false;
}

function updateSentence(state) {
  if (state.updateError) return state.updateError;
  if (state.updateAvailable) return `Version ${state.updateAvailable} is available.`;
  if (!state.updateCheckedAt) return 'Not checked yet.';

  const via = state.updateSource ? ` via ${state.updateSource}` : '';
  return `Up to date. Checked ${timeAgo(state.updateCheckedAt)}${via}.`;
}

function timeAgo(stamp) {
  const seconds = Math.round((Date.now() - stamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

/* ------------------------------ visibility ----------------------------- */

export function isOpen() {
  return !ui.panel.hidden;
}

export function open() {
  ui.panel.hidden = false;
  onOpen();
}

export function close() {
  ui.panel.hidden = true;
  onClose();
}

/* -------------------------------- setup -------------------------------- */

export function setup(options = {}) {
  onClose = options.onClose ?? (() => {});
  onOpen = options.onOpen ?? (() => {});

  fillSelect(ui.theme, THEMES);
  fillSelect(ui.soundName, SOUNDS);
  fillSelect(ui.poll, POLL_CHOICES);
  buildSwatches();

  ui.open.addEventListener('click', open);
  ui.back.addEventListener('click', close);

  const write = (patch) => {
    if (!loading) store.write(patch);
  };

  ui.theme.addEventListener('change', () => write({ theme: ui.theme.value }));
  ui.sound.addEventListener('change', () => write({ soundEnabled: ui.sound.checked }));
  ui.soundNotifications.addEventListener('change', () =>
    write({ soundOnNotifications: ui.soundNotifications.checked }),
  );
  ui.soundChat.addEventListener('change', () => write({ soundOnChat: ui.soundChat.checked }));
  ui.autoMessages.addEventListener('change', () =>
    write({ autoMessages: ui.autoMessages.checked }),
  );
  ui.poll.addEventListener('change', () => write({ pollSeconds: Number(ui.poll.value) }));

  // Picking a sound plays it immediately -- that is how you choose one.
  ui.soundName.addEventListener('change', () => {
    if (loading) return;
    const name = ui.soundName.value;
    store.write({ soundName: name });
    playPreview(name, Number(ui.volume.value) / 100);
  });

  let volumeTimer = null;
  ui.volume.addEventListener('input', () => {
    if (loading) return;
    const volume = Number(ui.volume.value) / 100;
    store.write({ volume });
    // One preview after the slider settles, not one per pixel of travel.
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => playPreview(ui.soundName.value, volume), 350);
  });

  // Turning sound back on confirms it with the current choice.
  ui.sound.addEventListener('change', () => {
    if (!loading && ui.sound.checked) {
      playPreview(ui.soundName.value, Number(ui.volume.value) / 100);
    }
  });

  ui.checkUpdate.addEventListener('click', async () => {
    ui.checkUpdate.disabled = true;
    ui.checkUpdate.textContent = 'Checking…';
    await send({ type: 'kanm:check-update' });
    ui.checkUpdate.textContent = 'Check now';
    ui.checkUpdate.disabled = false;
  });

  ui.reset.addEventListener('click', async () => {
    await store.write(Object.fromEntries(OWNED.map((key) => [key, DEFAULTS[key]])));
  });
}
