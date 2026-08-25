import * as store from '../lib/storage.js';
import { send } from './messaging.js';
import * as chatView from './chat-view.js';
import * as notificationsView from './notifications-view.js';

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

  // Signed-out replaces both panels, so respect that first.
  const signedOut = latestState?.loaded && !latestState.signedIn;
  ui.panelChat.hidden = signedOut || !onChat;
  ui.panelNotifications.hidden = signedOut || onChat;

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

/* -------------------------------- render ------------------------------- */

async function render() {
  const state = await store.read();
  latestState = state;

  ui.soundToggle.setAttribute('aria-pressed', String(state.soundEnabled));
  ui.soundGlyph.textContent = state.soundEnabled ? '🔔' : '🔕';
  ui.soundToggle.title = state.soundEnabled ? 'Sound on — click to mute' : 'Muted — click to unmute';

  renderHeader(state);
  renderStatus(state);

  const signedOut = state.loaded && !state.signedIn;
  ui.signedOut.hidden = !signedOut;

  if (signedOut) {
    ui.panelChat.hidden = true;
    ui.panelNotifications.hidden = true;
    return;
  }

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
  const enabled = !(await store.readOne('soundEnabled'));
  await store.write({ soundEnabled: enabled });
  if (enabled) send({ type: 'kanm:test-sound' });
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

// The background writes straight to storage, so watching it keeps the popup live.
chrome.storage.onChanged.addListener(render);

await chatView.restore();
await render();
send({ type: 'kanm:sync' });
