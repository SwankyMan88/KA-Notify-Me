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
  deleteMessage,
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
  cleanName,
  countUnread,
  decodeRoomCode,
  encodeRoomCode,
  makeRoomId,
  membersFrom,
  parseProgramId,
  roomMarker,
} from './lib/chat.js';
import { isGameMessage, readGame } from './lib/chess-protocol.js';
import { checkForUpdate, compareVersions, fetchLatestVersion } from './lib/update.js';
import * as store from './lib/storage.js';

/* ------------------------------ offscreen ------------------------------ */

let creatingOffscreen = null;

/**
 * The offscreen document does two things a service worker cannot: keep the poll
 * timer running, and play audio.
 */
async function ensureOffscreen({ verify = false } = {}) {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });

  if (existing.length) {
    // Being listed is not the same as being alive: a document whose timer has
    // stopped still shows up here, and that looked exactly like a slow poll.
    if (!verify || (await offscreenResponds())) return;
    await chrome.offscreen.closeDocument().catch(() => {});
  }

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

/** @param source 'notifications' | 'chat' */
/** Pings the offscreen document; false means it is there but not answering. */
async function offscreenResponds() {
  try {
    const reply = await Promise.race([
      chrome.runtime.sendMessage({ type: 'kanm:ping' }),
      new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    return reply?.alive === true;
  } catch {
    return false;
  }
}

async function playChime(source) {
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
  const snapshot = await store.readOne('chats');
  if (!snapshot.length) return false;

  // All the network work happens outside the lock, so a poll in progress never
  // blocks a message being sent.
  const results = await Promise.all(
    snapshot.map(async (chat) => {
      try {
        // A key that worked before is tried first; the others are the fallback.
        const { messages, keyUsed } = await fetchReplies([
          chat.replyKey,
          chat.roomKey,
          chat.expandKey,
        ]);
        return { id: chat.id, messages, keyUsed, error: null };
      } catch (error) {
        // A room whose comment was deleted should not break the others.
        return { id: chat.id, error: String(error.message ?? error) };
      }
    }),
  );

  const byId = new Map(results.map((r) => [r.id, r]));
  let anyNew = false;

  await withChats((current) =>
    current.map((chat) => {
      const result = byId.get(chat.id);
      // A room joined while we were fetching has no result yet; leave it alone.
      if (!result) return chat;
      if (result.error) return { ...chat, error: result.error };

      const messages = mergeMessages(result.messages, chat.messages);

      // Nothing came back, but we know there were messages -- that is a read
      // problem, not an empty room, so keep what we have rather than blanking it.
      if (!messages.length && (chat.messages ?? []).length) {
        return {
          ...chat,
          error:
            'Cannot read this room back from Khan Academy right now. Messages you send may not appear for a while.',
        };
      }

      const unread = countUnread(messages, chat.lastSeenKey, selfKaid);
      if (unread > (chat.unread ?? 0)) anyNew = true;

      return {
        ...chat,
        messages,
        replyKey: result.keyUsed ?? chat.replyKey,
        members: membersFrom(messages, selfKaid),
        unread,
        error: null,
      };
    }),
  );

  return anyNew;
}

/**
 * Every change to `chats` is a read-modify-write, and several of them can be
 * in flight at once: a poll finishing, a message being sent, a room being
 * renamed. Unserialised, the slowest one wins and silently discards the others
 * -- which is how a sent message could vanish. This queues them instead.
 */
let chatQueue = Promise.resolve();

function withChats(update) {
  const run = chatQueue.then(async () => {
    const chats = await store.readOne('chats');
    const next = await update(chats);
    await store.write({ chats: next });
    return next;
  });

  // One failed link must not break the chain for everything queued behind it.
  chatQueue = run.then(
    () => {},
    () => {},
  );
  return run;
}

/** How long to keep showing a sent message Khan Academy has not echoed back. */
const PENDING_GRACE_MS = 120_000;

/**
 * Khan Academy does not always return a reply on the very next read, so a
 * just-sent message is kept until the server catches up rather than being
 * wiped by the poll that lands in between.
 */
function mergeMessages(fetched, current, now = Date.now()) {
  const arrived = new Set(fetched.map((m) => m.key));

  const stillPending = (current ?? []).filter(
    (m) => m.pending && !arrived.has(m.key) && now - (m.postedAt ?? 0) < PENDING_GRACE_MS,
  );

  if (!stillPending.length) return fetched;

  return [...fetched, ...stillPending].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
}

async function createChat(programInput, { shareCode = false, name = '' } = {}) {
  const programId = parseProgramId(programInput);

  // The room id goes into the comment text, which is how it is found later.
  // The name goes in beside it, so whoever joins sees the same room name.
  const roomId = makeRoomId();
  const code = encodeRoomCode({ programId, roomId });
  const roomName = cleanName(name);
  const comment = await createRoomComment(
    programId,
    roomMarker(roomId, { name: roomName, code: shareCode ? code : null }),
  );

  const chat = await adoptRoom({
    programId,
    roomId,
    name: roomName,
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
    name: found.name ?? '',
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
  const { messages, keyUsed } = await fetchReplies([room.roomKey, room.expandKey]).catch(() => ({
    messages: [],
    keyUsed: null,
  }));

  const chat = {
    ...room,
    id,
    code: encodeRoomCode(room),
    messages,
    replyKey: keyUsed,
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

  // The mutation hands back the reply it created, so the message can be shown
  // without depending on the read path working at all.
  const created = await postReply(chat.roomKey, text);
  const selfKaid = (await store.readOne('profile'))?.kaid ?? null;

  const posted = {
    key: created.key,
    expandKey: created.expandKey ?? null,
    content: created.content ?? text,
    date: created.date ?? new Date().toISOString(),
    // Marks it as ours-but-not-yet-echoed, so a poll cannot wipe it.
    pending: true,
    postedAt: Date.now(),
    author: {
      kaid: created.author?.kaid ?? selfKaid,
      nickname: created.author?.nickname ?? 'You',
      avatarSrc: null,
    },
  };

  // Read it back if we can; fall back to appending what we just posted.
  const { messages: fetched, keyUsed } = await fetchReplies([
    chat.replyKey,
    chat.roomKey,
    chat.expandKey,
  ]).catch(() => ({ messages: [], keyUsed: null }));

  const seen = fetched.some((m) => m.key === posted.key);

  await withChats((current) =>
    current.map((c) => {
      if (c.id !== id) return c;

      // Merge against the freshest list, not the snapshot read before posting.
      const messages = seen
        ? mergeMessages(fetched, c.messages)
        : [...(c.messages ?? []).filter((m) => m.key !== posted.key), posted];

      return {
        ...c,
        messages,
        replyKey: keyUsed ?? c.replyKey,
        members: membersFrom(messages, selfKaid),
        lastSeenKey: messages.at(-1)?.key ?? c.lastSeenKey,
        unread: 0,
        error: null,
      };
    }),
  );
}

/**
 * Renaming only changes what you see. Khan Academy's safelist has no mutation
 * for editing a posted comment, so the name written into the anchor when the
 * room was created is fixed; this sits on top of it for you alone.
 */
async function renameChat(id, name) {
  const clean = cleanName(name);
  await withChats((chats) =>
    chats.map((chat) => (chat.id === id ? { ...chat, customTitle: clean } : chat)),
  );
  return { name: clean };
}

async function deleteChatMessage(id, messageKey) {
  const chats = await store.readOne('chats');
  const chat = chats.find((c) => c.id === id);
  if (!chat) throw new Error('That chat is no longer on this device.');

  await deleteMessage(messageKey);

  // Drop it locally rather than waiting for the next poll to notice.
  await withChats((current) =>
    current.map((c) =>
      c.id === id ? { ...c, messages: c.messages.filter((m) => m.key !== messageKey) } : c,
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
    const { latest, remoteVersion, source } = await checkForUpdate();
    const dismissed = await store.readOne('updateDismissedVersion');

    await store.write({
      updateAvailable: latest,
      updateRemoteVersion: remoteVersion,
      updateSource: source,
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
      updateSource: null,
      updateError: String(error.message ?? error),
    });
    return { version: await store.readOne('updateAvailable') };
  }
}

/* ------------------------------ chess tidy ------------------------------ */

/**
 * Clears a finished game's messages out of the thread.
 *
 * Khan Academy only lets you delete your own posts, so each player can remove
 * their own half. Both sides run this, so between them the game disappears --
 * but until your opponent's extension has also polled, some of their moves are
 * still there. Runs once per finished game, tracked by a signature, so a poll
 * every few seconds does not retry deletions forever.
 */
async function tidyFinishedGames(selfKaid) {
  if (!selfKaid) return;
  if (!(await store.readOne('clearChessOnEnd'))) return;

  const chats = await store.readOne('chats');

  for (const chat of chats) {
    const game = readGame(chat.messages, selfKaid);
    if (game.phase !== 'over') continue;

    const signature = `${game.moveCount}:${game.result}:${game.reason}`;
    if (chat.chessCleared === signature) continue;

    const mine = (chat.messages ?? []).filter(
      (m) => isGameMessage(m.content) && m.author?.kaid === selfKaid,
    );

    const removed = [];
    for (const message of mine) {
      try {
        await deleteMessage(message.key);
        removed.push(message.key);
      } catch (error) {
        console.warn('[KA Notify Me] could not delete a finished game message', error);
      }
    }

    const gone = new Set(removed);
    await withChats((current) =>
      current.map((c) =>
        c.id === chat.id
          ? {
              ...c,
              chessCleared: signature,
              messages: (c.messages ?? []).filter((m) => !gone.has(m.key)),
            }
          : c,
      ),
    );
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

  await step('Reach an update source', async () => {
    const { source, attempts } = await fetchLatestVersion();
    const failed = attempts.filter((a) => !a.ok);
    return failed.length
      ? `${source} (after ${failed.map((a) => a.id).join(', ')} failed)`
      : source;
  });

  // Per-room check. The anchor comment reports how many replies Khan Academy
  // thinks exist, which is the only way to tell "nobody has posted" apart from
  // "we are reading the thread with the wrong key".
  const chats = await store.readOne('chats');
  if (!chats.length) lines.push('--   No rooms on this device to check');

  for (const chat of chats) {
    await step(`Room ${chat.roomId} (${chat.title})`, async () => {
      const anchor = await findRoomComment(chat.programId, chat.roomId);
      if (!anchor) throw new Error('anchor comment not found on the program');

      const attempts = [];
      for (const [name, key] of [
        ['key', chat.roomKey],
        ['expandKey', chat.expandKey],
      ]) {
        if (!key) continue;
        try {
          const { messages } = await fetchReplies([key]);
          attempts.push(`${name}->${messages.length}`);
        } catch {
          attempts.push(`${name}->error`);
        }
      }

      const summary = `KA reports ${anchor.replyCount} replies; read ${attempts.join(', ')}`;
      if (anchor.replyCount > 0 && attempts.every((a) => a.endsWith('->0'))) {
        throw new Error(`${summary} — replies exist but neither key reads them`);
      }
      return summary;
    });
  }

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
let chatInFlight = null;

/**
 * Chats poll on their own clock.
 *
 * They used to ride along inside the notification sync, and `sync()` collapses
 * overlapping calls into one in-flight promise -- so however long a full
 * notification pass took became the real chat interval, not the one in
 * Settings. Kept separate, a room updates every poll regardless of how slow
 * the notification side is being.
 */
async function runChatSync() {
  const token = await getSessionToken();
  if (!token) return;

  const profile = await store.readOne('profile');
  const somethingNew = await syncChats(profile?.kaid ?? null).catch((error) => {
    console.error('[KA Notify Me] chat sync failed', error);
    return false;
  });

  await paintBadge();
  if (somethingNew) await playChime('chat');

  // After the messages are up to date, not before, or the game looks unfinished.
  await tidyFinishedGames(profile?.kaid ?? null).catch((error) =>
    console.error('[KA Notify Me] tidying a finished game failed', error),
  );
}

function syncChatsNow() {
  if (!chatInFlight) {
    chatInFlight = runChatSync().finally(() => {
      chatInFlight = null;
    });
  }
  return chatInFlight;
}

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

  await paintBadge();

  if (!firstSync && freshCount > 0) await playChime('notifications');
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
  syncChatsNow();
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
  ensureOffscreen({ verify: true }).then(() => {
    syncChatsNow();
    sync();
  });
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
      // Both, separately guarded: a slow notification pass must not delay chat.
      syncChatsNow();
      return respond(sendResponse, () => sync());

    case 'kanm:sync':
      syncChatsNow();
      return respond(sendResponse, () => sync());

    case 'kanm:load-more':
      return respond(sendResponse, () => loadMoreNotifications());

    case 'kanm:mark-all-read':
      return respond(sendResponse, () => markAllRead().then(sync));

    case 'kanm:chat-create':
      return respond(sendResponse, async () => ({
        chat: await createChat(message.program, {
          shareCode: message.shareCode,
          name: message.name,
        }),
      }));

    case 'kanm:chat-join':
      return respond(sendResponse, async () => ({ chat: await joinChat(message.code) }));

    case 'kanm:chat-send':
      return respond(sendResponse, () => sendChatMessage(message.id, message.text));

    case 'kanm:chat-seen':
      return respond(sendResponse, () => markChatSeen(message.id));

    case 'kanm:chat-rename':
      return respond(sendResponse, () => renameChat(message.id, message.name));

    case 'kanm:chat-delete-message':
      return respond(sendResponse, () => deleteChatMessage(message.id, message.messageKey));

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
      return respond(sendResponse, () => syncChatsNow());

    default:
      return false;
  }
});

start();
