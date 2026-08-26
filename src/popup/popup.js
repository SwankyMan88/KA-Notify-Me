import { REPO_URL, UPDATE_COMMAND } from '../lib/constants.js';
import { installedVersion } from '../lib/update.js';
import * as store from '../lib/storage.js';
import { send } from './messaging.js';
import * as chatView from './chat-view.js';
import * as notificationsView from './notifications-view.js';
import * as settingsView from './settings-view.js';
import * as tooltip from './tooltip.js';

const el = (id) => document.getElementById(id);

const ui = {
  avatar: el('avatar'),
  nickname: el('nickname'),
  subtitle: el('subtitle'),
  soundToggle: el('sound-toggle'),
  soundGlyph: el('sound-glyph'),

  tabChat: el('tab-chat'),
  tabNotifications: el('tab-notifications'),
  chatDot: el('chat-dot'),
  notifDot: el('notif-dot'),
  panelChat: el('panel-chat'),
  panelNotifications: el('panel-notifications'),

  updateBar: el('update-bar'),
  updateText: el('update-text'),
  updateCommand: el('update-command'),
  updateCopy: el('update-copy'),
  updateReload: el('update-reload'),
  updateRepo: el('update-repo'),
  updateDismiss: el('update-dismiss'),

  tabs: document.querySelector('.tabs'),
  signedOut: el('signed-out'),
  status: el('status'),
};

const TAB_KEY = 'kanm:last-tab';
let activeTab = sessionStorage.getItem(TAB_KEY) ?? 'notifications';
let latestState = null;

/* --------------------------------- tabs -------------------------------- */

function selectTab(tab) {
  activeTab = tab;
  sessionStorage.setItem(TAB_KEY, tab);

  const onChat = tab === 'chat';
  ui.tabChat.setAttribute('aria-selected', String(onChat));
  ui.tabNotifications.setAttribute('aria-selected', String(!onChat));

  // Settings and signed-out both replace the panels entirely.
  const signedOut = latestState?.loaded && !latestState.signedIn;
  const covered = signedOut || settingsView.isOpen();
  ui.panelChat.hidden = covered || !onChat;
  ui.panelNotifications.hidden = covered || onChat;
  ui.tabs.hidden = covered;

  if (!onChat && latestState) notificationsView.topUp(latestState);
}

/* -------------------------------- header ------------------------------- */

function renderHeader(state) {
  if (!state.signedIn) {
    ui.nickname.textContent = 'KA Notify Me';
    ui.subtitle.textContent = state.loaded ? 'Not signed in' : 'Checking your session…';
    return;
  }

  const { profile } = state;
  ui.nickname.textContent = profile?.nickname ?? 'Signed in';
  ui.subtitle.textContent = profile
    ? [profile.username && `@${profile.username}`, `${profile.points.toLocaleString()} points`]
        .filter(Boolean)
        .join(' · ')
    : 'Signed in';
  if (profile?.avatarSrc) ui.avatar.src = profile.avatarSrc;
}

/**
 * The status bar says what is waiting for you rather than when we last looked --
 * at a five second cadence "checked just now" was true almost always and told
 * you nothing.
 */
function renderStatus(state) {
  if (state.lastError) {
    ui.status.textContent = state.lastError;
    ui.status.classList.add('statusbar--bad');
    return;
  }

  ui.status.classList.remove('statusbar--bad');

  if (!state.signedIn) {
    ui.status.textContent = 'Waiting for a Khan Academy session';
    return;
  }

  const chatUnread = state.chats.reduce((sum, chat) => sum + (chat.unread ?? 0), 0);
  const parts = [];
  if (state.unreadCount) {
    parts.push(`${state.unreadCount} new notification${state.unreadCount === 1 ? '' : 's'}`);
  }
  if (chatUnread) {
    parts.push(`${chatUnread} new message${chatUnread === 1 ? '' : 's'}`);
  }

  ui.status.textContent = parts.length
    ? parts.join(' · ')
    : `Up to date · ${state.chats.length} room${state.chats.length === 1 ? '' : 's'}`;
}

function renderUpdate(state) {
  const latest = state.updateAvailable;

  ui.updateBar.hidden =
    !latest ||
    !state.autoMessages ||
    latest === state.updateDismissedVersion ||
    settingsView.isOpen();
  if (ui.updateBar.hidden) return;

  ui.updateText.textContent = `Version ${latest} is available — you have ${installedVersion()}`;
  ui.updateCommand.textContent = UPDATE_COMMAND;
  ui.updateRepo.href = REPO_URL;
}

/* -------------------------------- render ------------------------------- */

async function render() {
  const state = await store.read();
  latestState = state;

  ui.soundToggle.setAttribute('aria-pressed', String(state.soundEnabled));
  ui.soundGlyph.textContent = state.soundEnabled ? '🔔' : '🔕';
  ui.soundToggle.title = state.soundEnabled ? 'Sound on — click to mute' : 'Muted — click to unmute';

  renderHeader(state);
  renderStatus(state);
  renderUpdate(state);
  schedulePolling(state.pollSeconds);

  const signedOut = state.loaded && !state.signedIn;
  ui.signedOut.hidden = !signedOut;

  if (signedOut) {
    ui.panelChat.hidden = true;
    ui.panelNotifications.hidden = true;
    return;
  }

  settingsView.applyAppearance(state);
  settingsView.render(state);

  chatView.render(state);
  notificationsView.render(state);

  ui.chatDot.hidden = state.chats.every((chat) => !chat.unread);
  ui.notifDot.hidden = state.unreadCount === 0;

  selectTab(activeTab);
}

/* -------------------------------- setup -------------------------------- */

ui.tabChat.addEventListener('click', () => selectTab('chat'));
ui.tabNotifications.addEventListener('click', () => selectTab('notifications'));

ui.soundToggle.addEventListener('click', async () => {
  const { soundEnabled, soundName, volume } = await store.read(
    'soundEnabled',
    'soundName',
    'volume',
  );
  const enabled = !soundEnabled;
  await store.write({ soundEnabled: enabled });
  // Unmuting plays the current sound so you hear what you just turned on.
  if (enabled) settingsView.playPreview(soundName, volume);
});

ui.updateCopy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(UPDATE_COMMAND);
  ui.updateCopy.textContent = 'Copied';
  setTimeout(() => {
    ui.updateCopy.textContent = 'Copy command';
  }, 1500);
});

// Reloading re-reads the folder from disk, so this only helps after a pull.
ui.updateReload.addEventListener('click', () => {
  send({ type: 'kanm:reload-extension' });
  window.close();
});

// "Not now" hides this version for good; a newer one clears it and speaks up.
ui.updateDismiss.addEventListener('click', async () => {
  await store.write({ updateDismissedVersion: await store.readOne('updateAvailable') });
});

notificationsView.setup({
  getState: () => latestState ?? store.DEFAULTS,
  onStatus: (message) => {
    ui.status.textContent = message;
  },
  // Clicking a notification about one of your rooms opens the room.
  onOpenChat: async (chatId) => {
    await chatView.openRoomById(chatId);
    selectTab('chat');
  },
});
chatView.setup();
settingsView.setup({ onOpen: () => render(), onClose: () => render() });
tooltip.setup();

/**
 * While the popup is open it drives its own refresh, at the interval from
 * Settings.
 *
 * The background does poll on its own, but its timer lives in an offscreen
 * document and its worker is torn down whenever Chrome feels like it, so the
 * cadence you actually see could be far longer than the setting. The popup is
 * an ordinary live document: a plain setInterval here always fires, and it does
 * exactly what the Refresh button does.
 */
let pollTimer = null;
let pollSeconds = null;

function schedulePolling(seconds) {
  if (seconds === pollSeconds) return;
  pollSeconds = seconds;

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    send({ type: 'kanm:chat-refresh' });
    send({ type: 'kanm:sync' });
  }, seconds * 1000);
}

/**
 * Opening the popup counts as reading. The keys are remembered first so the
 * list still highlights what arrived, even though Khan Academy no longer
 * considers it new.
 */
async function autoMarkRead() {
  const state = await store.read('autoMarkRead', 'signedIn', 'unreadCount', 'notifications');
  if (!state.autoMarkRead || !state.signedIn || state.unreadCount === 0) return;

  notificationsView.rememberArrived(
    state.notifications.filter((n) => n.brandNew).map((n) => n.urlsafeKey),
  );
  await send({ type: 'kanm:mark-all-read' });
}

// The background writes straight to storage, so watching it keeps the popup live.
chrome.storage.onChanged.addListener(render);

settingsView.applyAppearance(await store.read('theme', 'accent'));
await chatView.restore();
await render();
send({ type: 'kanm:sync' });
send({ type: 'kanm:check-update' });
autoMarkRead();
