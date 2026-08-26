import { findChatForNotification } from '../lib/chat.js';
import { isGameMessage } from '../lib/chess-protocol.js';
import { describe, linkFor, relativeTime } from './format.js';
import { send } from './messaging.js';

const el = (id) => document.getElementById(id);

const ui = {
  scroll: el('notif-scroll'),
  list: el('list'),
  empty: el('empty'),
  loading: el('loading'),
  sentinel: el('sentinel'),
  sentinelText: el('sentinel-text'),
  markRead: el('mark-read'),
  refresh: el('refresh'),
};

/** Keys currently in the DOM, so we can append instead of rebuilding. */
let rendered = [];
let loadingMore = false;
let openChat = () => {};
/**
 * Keys that were unread when this popup opened. Auto-marking clears the flag on
 * Khan Academy immediately, so without this you would never get to see what
 * actually arrived.
 */
const arrivedThisSession = new Set();

export function rememberArrived(keys) {
  for (const key of keys) arrivedThisSession.add(key);
}

function buildItem(notification, chat) {
  const { icon, title, body } = describe(notification);

  const classes = ['item'];
  if (looksNew(notification)) classes.push('item--new');
  if (chat) classes.push('item--chat');

  // A notification about one of your rooms opens the room; everything else is
  // an ordinary link out to khanacademy.org.
  const item = document.createElement(chat ? 'button' : 'a');
  item.className = classes.join(' ');

  if (chat) {
    item.type = 'button';
    item.addEventListener('click', () => openChat(chat.id));
  } else {
    item.href = linkFor(notification);
    item.target = '_blank';
    item.rel = 'noreferrer';
  }

  const image = document.createElement('img');
  image.className = 'item-icon';
  image.src = icon;
  image.alt = '';
  // Khan Academy avatars 404 often enough that a broken image is worth guarding.
  image.addEventListener('error', () => {
    image.src = '../../icons/48.png';
  });

  const text = document.createElement('div');
  text.className = 'item-text';

  const heading = document.createElement('p');
  heading.className = 'item-title';
  heading.textContent = title;
  text.append(heading);

  if (body) {
    const paragraph = document.createElement('p');
    paragraph.className = 'item-body';
    paragraph.textContent = body;
    text.append(paragraph);
  }

  const time = document.createElement('p');
  time.className = 'item-time';
  time.textContent = relativeTime(notification.date);
  text.append(time);

  item.append(image, text);

  const wrapper = document.createElement('li');
  wrapper.append(item);
  return wrapper;
}

/**
 * Appends when the incoming list merely extends what we already show, which is
 * the common case while scrolling -- a full rebuild would throw away the scroll
 * position mid-gesture.
 */
function looksNew(notification) {
  return notification.brandNew || arrivedThisSession.has(notification.urlsafeKey);
}

function renderList(notifications, chats) {
  const match = (n) => findChatForNotification(n, chats);
  const keys = notifications.map(
    (n) => `${n.urlsafeKey}:${match(n)?.id ?? ''}:${looksNew(n) ? 1 : 0}`,
  );

  // Identical to what is already on screen: leave the DOM alone entirely.
  if (keys.length === rendered.length && rendered.every((key, i) => key === keys[i])) return;

  const isExtension =
    keys.length > rendered.length && rendered.every((key, i) => key === keys[i]);

  const fragment = document.createDocumentFragment();

  if (isExtension && rendered.length) {
    for (const notification of notifications.slice(rendered.length)) {
      fragment.append(buildItem(notification, match(notification)));
    }
    ui.list.append(fragment);
  } else {
    for (const notification of notifications) {
      fragment.append(buildItem(notification, match(notification)));
    }
    ui.list.replaceChildren(fragment);
  }

  rendered = keys;
}

/**
 * Chat replies arrive as ordinary Khan Academy notifications too. They are
 * already in the Chat menu, so by default they are kept out of this list.
 */
function visible(state) {
  // Game traffic is never worth showing as a notification, whatever the chat
  // setting says -- "[chess] e2e4" is not a message anyone wants to read.
  const withoutGames = state.notifications.filter((n) => !isGameMessage(n.content));

  if (!state.hideChatNotifications) return withoutGames;
  return withoutGames.filter((n) => !findChatForNotification(n, state.chats));
}

export function render(state) {
  ui.markRead.disabled = state.unreadCount === 0;

  if (!state.loaded) {
    ui.loading.hidden = false;
    ui.list.hidden = true;
    ui.empty.hidden = true;
    ui.sentinel.hidden = true;
    return;
  }

  ui.loading.hidden = true;

  const shown = visible(state);

  if (!shown.length) {
    ui.list.hidden = true;
    ui.sentinel.hidden = true;
    ui.empty.hidden = false;
    rendered = [];
    ui.list.replaceChildren();
    return;
  }

  ui.empty.hidden = true;
  ui.list.hidden = false;
  renderList(shown, state.chats);

  ui.sentinel.hidden = false;
  ui.sentinelText.textContent = state.hasMore
    ? loadingMore
      ? 'Loading more…'
      : 'Scroll for more'
    : 'That’s everything.';
}

/* ---------------------------- infinite scroll --------------------------- */

async function maybeLoadMore(state) {
  if (loadingMore || !state.hasMore || !state.signedIn) return;

  const { scrollTop, clientHeight, scrollHeight } = ui.scroll;
  if (scrollHeight - (scrollTop + clientHeight) > 120) return;

  loadingMore = true;
  ui.sentinelText.textContent = 'Loading more…';
  try {
    const result = await send({ type: 'kanm:load-more' });
    if (!result?.ok) ui.sentinelText.textContent = result?.error ?? 'Could not load more.';
  } finally {
    loadingMore = false;
  }
}

export function setup({ getState, onStatus, onOpenChat }) {
  openChat = onOpenChat;

  ui.scroll.addEventListener('scroll', () => maybeLoadMore(getState()), { passive: true });

  ui.refresh.addEventListener('click', async () => {
    ui.refresh.disabled = true;
    ui.refresh.textContent = 'Checking…';
    await send({ type: 'kanm:sync' });
    ui.refresh.textContent = 'Refresh';
    ui.refresh.disabled = false;
  });

  ui.markRead.addEventListener('click', async () => {
    ui.markRead.disabled = true;
    ui.markRead.textContent = 'Marking…';
    const result = await send({ type: 'kanm:mark-all-read' });
    ui.markRead.textContent = 'Mark all read';
    if (!result?.ok) onStatus(result?.error ?? 'Could not mark as read.');
  });
}

/** Called after a render so a short first page still fills the panel. */
export function topUp(state) {
  maybeLoadMore(state);
}
