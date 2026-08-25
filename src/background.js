import {
  BADGE_COLOR,
  KEEPALIVE_ALARM,
  PROFILE_REFRESH_MS,
  MAX_NOTIFICATIONS,
  OFFSCREEN_PATH,
  SESSION_COOKIE,
  UPDATE_ALARM,
  UPDATE_CHECK_MINUTES,
} from './lib/constants.js';
import {
  createRoomComment,
  fetchNotificationPage,
  fetchProfile,
  fetchReplies,
  findRoomComment,
  getFKey,
  getSessionToken,
  markAllRead,
  postReply,
} from './lib/ka-api.js';
import {
  chatId,
  countUnread,
  decodeRoomCode,
  encodeRoomCode,
  makeRoomId,
  membersFrom,
  parseProgramId,
  roomMarker,
} from './lib/chat.js';
import { checkForUpdate, compareVersions } from './lib/update.js';
import * as store from './lib/storage.js';

/* ------------------------------ offscreen ------------------------------ */

let creatingOffscreen = null;

/**
 * The offscreen document does two things a service worker cannot: keep the poll
 * timer running, and play audio.
 */
async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;

  // Concurrent callers must share one creation, or the second one throws.
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Polls for new notifications every few seconds and plays the alert chime.',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

/** @param source 'notifications' | 'chat' | 'test' */
async function playChime(source = 'test') {
  const settings = await store.read('soundEnabled', 'volume', 'soundName', 'soundOnNotifications', 'soundOnChat');
  if (!settings.soundEnabled) return;
  if (source === 'notifications' && !settings.soundOnNotifications) return;
  if (source === 'chat' && !settings.soundOnChat) return;

  await ensureOffscreen();
  chrome.runtime
    .sendMessage({
      type: 'kanm:play-chime',
      volume: settings.volume,
      sound: settings.soundName,
    })
    .catch(() => {});
}

/* -------------------------------- badge -------------------------------- */

/** The badge counts everything waiting for you: notifications plus chat. */
async function paintBadge() {
  const { unreadCount, chats } = await store.read('unreadCount', 'chats');
  const total = unreadCount + chats.reduce((sum, chat) => sum + (chat.unread ?? 0), 0);

  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({
    text: total === 0 ? '' : total > 99 ? '99+' : String(total),
  });
}

/* ---------------------------- notifications ---------------------------- */

/** Walks back from the top until we have seen every brand-new notification. */
async function collectNotifications() {
  const collected = [];
  let cursor = '';
  let hasMore = true;

  while (collected.length < MAX_NOTIFICATIONS) {
    const page = await fetchNotificationPage(cursor);
    if (!page) break;

    collected.push(...page.notifications);
    cursor = page.cursor;
    hasMore = Boolean(cursor);

    // Once a page contains something already read, everything older is read too.
    if (!cursor || page.notifications.some((n) => !n.brandNew)) break;
  }

  return { notifications: collected.slice(0, MAX_NOTIFICATIONS), cursor, hasMore };
}

/** Appends the next page for the popup's infinite scroll. */
async function loadMoreNotifications() {
  const { notifications, cursor, hasMore } = await store.read('notifications', 'cursor', 'hasMore');

  if (!hasMore || !cursor) {
    await store.write({ hasMore: false });
    return { added: 0 };
  }

  const page = await fetchNotificationPage(cursor);
  if (!page) {
    await store.write({ hasMore: false });
    return { added: 0 };
  }

  // Cursors can overlap across pages, so drop anything we already hold.
  const known = new Set(notifications.map((n) => n.urlsafeKey));
  const fresh = page.notifications.filter((n) => !known.has(n.urlsafeKey));
  const merged = [...notifications, ...fresh];

  await store.write({
    notifications: merged.slice(0, MAX_NOTIFICATIONS),
    cursor: page.cursor,
    hasMore: Boolean(page.cursor) && merged.length < MAX_NOTIFICATIONS,
  });

  return { added: fresh.length };
}

/* --------------------------------- chat -------------------------------- */

/** Refreshes every room's messages. Returns true if anything new arrived. */
async function syncChats(selfKaid) {
  const chats = await store.readOne('chats');
  if (!chats.length) return false;

  let anyNew = false;

  const refreshed = await Promise.all(
    chats.map(async (chat) => {
      try {
        const messages = await fetchReplies(chat.roomKey);
        const unread = countUnread(messages, chat.lastSeenKey, selfKaid);
        if (unread > (chat.unread ?? 0)) anyNew = true;

        return {
          ...chat,
          messages,
          members: membersFrom(messages, selfKaid),
          unread,
          error: null,
        };
      } catch (error) {
        // A room whose comment was deleted should not break the others.
        return { ...chat, error: String(error.message ?? error) };
      }
    }),
  );

  await store.write({ chats: refreshed });
  return anyNew;
}

async function withChats(update) {
  const chats = await store.readOne('chats');
  const next = await update(chats);
  await store.write({ chats: next });
  return next;
}

async function createChat(programInput, { shareCode = false } = {}) {
  const programId = parseProgramId(programInput);

  // The room id goes into the comment text, which is how it is found later.
  const roomId = makeRoomId();
  const code = encodeRoomCode({ programId, roomId });
  const comment = await createRoomComment(
    programId,
    roomMarker(roomId, shareCode ? code : null),
  );

  const chat = await adoptRoom({
    programId,
    roomId,
    roomKey: comment.key,
    expandKey: comment.expandKey ?? '',
    title: comment.focus?.translatedTitle ?? 'Khan Academy program',
    url: comment.permalink ?? comment.focusUrl ?? null,
  });

  // Read the comment back the same way a joining buddy would. If we cannot see
  // it, the room is unusable to them, and saying so now beats them finding out.
  const visible = await findRoomComment(programId, roomId).catch(() => null);
  if (!visible) {
    await withChats((chats) =>
      chats.map((c) =>
        c.id === chat.id
          ? {
              ...c,
              error:
                'The room comment was created but is not showing on the program yet. ' +
                'Check the program on khanacademy.org — if the comment is not there, ' +
                'your buddy will not be able to join.',
            }
          : c,
      ),
    );
  }

  return chat;
}

async function joinChat(code) {
  const { programId, roomId } = decodeRoomCode(code);

  // The code carries only the program and the room id, so the anchor comment
  // has to be found by its stamp before we know what to reply to.
  const found = await findRoomComment(programId, roomId);
  if (!found) {
    throw new Error(
      `No room ${roomId} on that program. It may have been deleted, or the code is for a different program.`,
    );
  }

  return adoptRoom({
    programId,
    roomId,
    roomKey: found.key,
    expandKey: found.expandKey,
    title: found.title,
    url: found.url,
  });
}

/** Adds a room (or returns the existing one) and marks it already caught up. */
async function adoptRoom(room) {
  const id = chatId(room);
  const existing = (await store.readOne('chats')).find((chat) => chat.id === id);
  if (existing) {
    await store.write({ activeChatId: id });
    return existing;
  }

  const selfKaid = (await store.readOne('profile'))?.kaid ?? null;
  const messages = await fetchReplies(room.roomKey).catch(() => []);

  const chat = {
    ...room,
    id,
    code: encodeRoomCode(room),
    messages,
    members: membersFrom(messages, selfKaid),
    // Joining an existing room should not arrive with a pile of unread.
    lastSeenKey: messages.at(-1)?.key ?? null,
    unread: 0,
    error: null,
    createdAt: Date.now(),
  };

  await withChats((chats) => [...chats, chat]);
  await store.write({ activeChatId: id });
  return chat;
}

async function sendChatMessage(id, text) {
  const chats = await store.readOne('chats');
  const chat = chats.find((c) => c.id === id);
  if (!chat) throw new Error('That chat is no longer on this device.');

  await postReply(chat.roomKey, text);

  // Re-read so our own message appears with its real key and timestamp.
  const messages = await fetchReplies(chat.roomKey);
  const selfKaid = (await store.readOne('profile'))?.kaid ?? null;

  await withChats((current) =>
    current.map((c) =>
      c.id === id
        ? {
            ...c,
            messages,
            members: membersFrom(messages, selfKaid),
            lastSeenKey: messages.at(-1)?.key ?? c.lastSeenKey,
            unread: 0,
            error: null,
          }
        : c,
    ),
  );
}

/** Called when you open a room: everything in it counts as seen. */
async function markChatSeen(id) {
  await withChats((chats) =>
    chats.map((chat) =>
      chat.id === id
        ? { ...chat, lastSeenKey: chat.messages.at(-1)?.key ?? chat.lastSeenKey, unread: 0 }
        : chat,
    ),
  );
  await paintBadge();
}

async function leaveChat(id) {
  await withChats((chats) => chats.filter((chat) => chat.id !== id));
  if ((await store.readOne('activeChatId')) === id) {
    await store.write({ activeChatId: null });
  }
  await paintBadge();
}

/* -------------------------------- updates ------------------------------- */

async function runUpdateCheck() {
  try {
    const latest = await checkForUpdate();
    const dismissed = await store.readOne('updateDismissedVersion');

    await store.write({
      updateAvailable: latest,
      updateCheckedAt: Date.now(),
      updateError: null,
      // "Not now" applies to one version only; a newer one speaks up again.
      ...(latest && dismissed && compareVersions(latest, dismissed) > 0
        ? { updateDismissedVersion: null }
        : {}),
    });
    return { version: latest };
  } catch (error) {
    // Being offline is not worth shouting about; keep the last known answer.
    await store.write({
      updateCheckedAt: Date.now(),
      updateError: String(error.message ?? error),
    });
    return { version: await store.readOne('updateAvailable') };
  }
}

/* ----------------------------- diagnostics ----------------------------- */

/**
 * Walks the same path creating a room takes, reporting each step, so a failure
 * can be pinned to one place instead of guessed at.
 */
async function diagnose(programInput) {
  const lines = [];
  const step = async (label, work) => {
    try {
      const detail = await work();
      lines.push(`OK   ${label}${detail ? ` — ${detail}` : ''}`);
      return true;
    } catch (error) {
      lines.push(`FAIL ${label} — ${String(error.message ?? error)}`);
      return false;
    }
  };

  await step('Signed in (KAAS cookie)', async () => {
    const token = await getSessionToken();
    if (!token) throw new Error('not found; sign in to khanacademy.org in this browser');
    return `${token.length} chars`;
  });

  await step('CSRF token (fkey cookie)', async () => {
    const fkey = await getFKey();
    if (!fkey) {
      throw new Error('not found; open khanacademy.org in a tab once, then retry');
    }
    return `${fkey.length} chars`;
  });

  await step('Read your profile', async () => {
    const profile = await fetchProfile();
    if (!profile) throw new Error('no profile returned');
    return profile.nickname;
  });

  if (!programInput?.trim()) {
    lines.push('--   Program checks skipped (no program link given)');
    return { report: lines.join('\n') };
  }

  let programId = null;
  await step('Read the program link', async () => {
    programId = parseProgramId(programInput);
    return programId;
  });

  if (programId) {
    await step('Read that program’s Tips & Thanks', async () => {
      // A read that returns nothing is fine; a throw is what matters here.
      const found = await findRoomComment(programId, '______');
      return found ? 'readable' : 'readable, no room comment matched';
    });
  }

  return { report: lines.join('\n') };
}

/* --------------------------------- sync -------------------------------- */

let syncInFlight = null;

async function signedOut() {
  await store.write({
    signedIn: false,
    loaded: true,
    notifications: [],
    cursor: '',
    hasMore: true,
    unreadCount: 0,
    announcedKeys: [],
    profile: null,
    profileFetchedAt: 0,
    lastSync: Date.now(),
    lastError: null,
  });
  await chrome.action.setBadgeText({ text: '' });
}

async function runSync() {
  const token = await getSessionToken();
  if (!token) {
    await signedOut();
    return;
  }

  const previous = await store.read('announcedKeys', 'signedIn');

  let notifications;
  let cursor;
  let hasMore;
  let profile = null;

  const cached = await store.read('profile', 'profileFetchedAt');
  const profileIsStale = Date.now() - (cached.profileFetchedAt ?? 0) > PROFILE_REFRESH_MS;

  try {
    [{ notifications, cursor, hasMore }, profile] = await Promise.all([
      collectNotifications(),
      profileIsStale ? fetchProfile().catch(() => null) : Promise.resolve(cached.profile),
    ]);
  } catch (error) {
    // A dropped connection is routine; keep whatever we last showed.
    await store.write({ lastError: String(error.message ?? error), lastSync: Date.now() });
    return;
  }

  const unread = notifications.filter((n) => n.brandNew);
  const unreadKeys = unread.map((n) => n.urlsafeKey);

  // Only chime for keys we have never chimed for. On the very first sync after
  // sign-in we adopt the backlog silently instead of ringing for old items.
  const alreadyAnnounced = new Set(previous.announcedKeys);
  const firstSync = !previous.signedIn;
  const freshCount = unreadKeys.filter((key) => !alreadyAnnounced.has(key)).length;

  const resolvedProfile = profile ?? cached.profile;

  await store.write({
    signedIn: true,
    loaded: true,
    notifications,
    cursor,
    hasMore,
    unreadCount: unread.length,
    announcedKeys: unreadKeys,
    profile: resolvedProfile,
    ...(profileIsStale && profile ? { profileFetchedAt: Date.now() } : {}),
    lastSync: Date.now(),
    lastError: null,
  });

  const newChatMessages = await syncChats(resolvedProfile?.kaid ?? null).catch(() => false);

  await paintBadge();

  if (!firstSync) {
    if (freshCount > 0) await playChime('notifications');
    else if (newChatMessages) await playChime('chat');
  }
}

/** Collapses overlapping triggers (alarm + heartbeat + popup) into one run. */
function sync() {
  if (!syncInFlight) {
    syncInFlight = runSync()
      .catch((error) => console.error('[KA Notify Me] sync failed', error))
      .finally(() => {
        syncInFlight = null;
      });
  }
  return syncInFlight;
}

/* -------------------------------- wiring ------------------------------- */

async function start() {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  await chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_CHECK_MINUTES });
  await ensureOffscreen();
  await sync();
  runUpdateCheck();
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) {
    runUpdateCheck();
    return;
  }
  if (alarm.name !== KEEPALIVE_ALARM) return;
  // Revive the heartbeat first -- the worker may have been asleep for a while.
  ensureOffscreen().then(sync);
});

// Signing in or out of Khan Academy in any tab takes effect immediately.
chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (cookie.name !== SESSION_COOKIE) return;
  if (removed) {
    signedOut();
  } else {
    store.write({ announcedKeys: [], signedIn: false }).then(sync);
  }
});

/** Wraps a handler so every reply has the same {ok, ...} / {ok:false, error} shape. */
function respond(sendResponse, work) {
  Promise.resolve()
    .then(work)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case 'kanm:heartbeat':
    case 'kanm:sync':
      return respond(sendResponse, () => sync());

    case 'kanm:load-more':
      return respond(sendResponse, () => loadMoreNotifications());

    case 'kanm:mark-all-read':
      return respond(sendResponse, () => markAllRead().then(sync));

    case 'kanm:test-sound':
      return respond(sendResponse, () => playChime('test'));

    case 'kanm:chat-create':
      return respond(sendResponse, async () => ({
        chat: await createChat(message.program, { shareCode: message.shareCode }),
      }));

    case 'kanm:chat-join':
      return respond(sendResponse, async () => ({ chat: await joinChat(message.code) }));

    case 'kanm:chat-send':
      return respond(sendResponse, () => sendChatMessage(message.id, message.text));

    case 'kanm:chat-seen':
      return respond(sendResponse, () => markChatSeen(message.id));

    case 'kanm:chat-leave':
      return respond(sendResponse, () => leaveChat(message.id));

    case 'kanm:check-update':
      return respond(sendResponse, () => runUpdateCheck());

    // Reloading re-reads the folder from disk, which is how a pulled update
    // actually takes effect without visiting chrome://extensions.
    case 'kanm:reload-extension':
      chrome.runtime.reload();
      return false;

    case 'kanm:diagnose':
      return respond(sendResponse, () => diagnose(message.program));

    case 'kanm:chat-refresh':
      return respond(sendResponse, async () => {
        const profile = await store.readOne('profile');
        await syncChats(profile?.kaid ?? null);
        await paintBadge();
      });

    default:
      return false;
  }
});

start();
