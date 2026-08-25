import { GRAPHQL_URL, SAFELIST_URL, SESSION_COOKIE } from './constants.js';
import { findRoomId } from './chat.js';

/**
 * "Signing in" is really just borrowing the session you already have in this
 * browser: if you are logged into khanacademy.org, the KAAS cookie is there and
 * we are authenticated. We never see or store a password.
 */
export async function getSessionToken() {
  const cookie = await chrome.cookies.get({
    url: 'https://www.khanacademy.org',
    name: SESSION_COOKIE,
  });
  return cookie?.value ?? null;
}

const documentCache = new Map();

async function fetchDocument(name) {
  for (const kind of ['query', 'mutation']) {
    const response = await fetch(`${SAFELIST_URL}/${kind}/${name}`);
    if (response.ok) return response.text();
  }
  throw new Error(`"${name}" is not in the Khan Academy safelist.`);
}

async function loadDocument(name, { refresh = false } = {}) {
  if (refresh || !documentCache.has(name)) {
    documentCache.set(name, await fetchDocument(name));
  }
  return documentCache.get(name);
}

/**
 * Khan Academy's CSRF check compares the `X-KA-FKey` header against the `fkey`
 * cookie. Reads mostly pass without it; writes do not. Sending a real value is
 * what makes posting a comment or a reply work at all.
 */
export async function getFKey() {
  const cookie = await chrome.cookies.get({ url: 'https://www.khanacademy.org', name: 'fkey' });
  return cookie?.value ?? null;
}

async function post(name, variables, query) {
  const fkey = await getFKey();

  return fetch(`${GRAPHQL_URL}/${name}?/fastly/`, {
    method: 'POST',
    // Host permission plus `include` is what attaches the KAAS and fkey cookies.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-KA-FKey': fkey ?? '1',
    },
    body: JSON.stringify({ operationName: name, query, variables }),
  });
}

/**
 * Runs a safelisted operation. A 400 usually means Khan Academy rotated the
 * document out from under our cache, so we refetch it once and retry.
 */
async function callGraphQL(name, variables = {}) {
  let response = await post(name, variables, await loadDocument(name));

  if (response.status === 400) {
    response = await post(name, variables, await loadDocument(name, { refresh: true }));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`[KA Notify Me] ${name} HTTP ${response.status}`, body.slice(0, 400));
    throw new Error(`${name} failed (HTTP ${response.status}). ${describeStatus(response.status)}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    console.error(`[KA Notify Me] ${name} returned errors`, payload.errors);
    throw new Error(`${name} failed: ${payload.errors[0].message}`);
  }
  return payload.data;
}

function describeStatus(status) {
  if (status === 401 || status === 403) return 'Khan Academy refused the request — try reloading a khanacademy.org tab so the session refreshes.';
  if (status === 429) return 'Khan Academy is rate limiting; wait a minute.';
  if (status >= 500) return 'Khan Academy had a server error.';
  return '';
}

/* ---------------------------- notifications ---------------------------- */

/** One page of notifications, newest first. */
export async function fetchNotificationPage(after = '') {
  const data = await callGraphQL('getNotificationsForUser', { after });
  const feed = data?.user?.notifications;
  if (!feed) return null;
  return {
    notifications: feed.notifications ?? [],
    cursor: feed.pageInfo?.nextCursor ?? '',
  };
}

/** Clears the "brand new" flag on every notification, server side. */
export async function markAllRead() {
  await callGraphQL('clearBrandNewNotifications');
  return true;
}

/* -------------------------------- profile ------------------------------ */

/** Name, avatar and points for the popup header. */
export async function fetchProfile() {
  const data = await callGraphQL('getFullUserProfile');
  const user = data?.user;
  if (!user) return null;
  return {
    kaid: user.kaid ?? null,
    nickname: user.nickname ?? user.username ?? 'Learner',
    username: user.username ?? null,
    points: user.points ?? 0,
    avatarSrc: resolveAvatar(user.avatar?.imageSrc ?? null),
  };
}

/* --------------------------------- chat -------------------------------- */

/**
 * A chat room is an ordinary Tips & Thanks comment on a program; the messages
 * are its replies. Everything below is the normal discussion API -- anyone can
 * read the thread on khanacademy.org, the room code just saves you finding it.
 */

/**
 * Posts a comment or a reply.
 *
 * Khan Academy has a "this looks low quality" gate: when it trips, the mutation
 * comes back with `lowQualityResponse.showLowQualityNotice` and **nothing is
 * posted**. On the site you get a "post anyway?" prompt; the resubmit carries
 * `shownLowQualityNotice: true`. Without handling that, a post can silently
 * vanish, which is exactly what it looks like from our side.
 */
async function addFeedback(variables, what) {
  let result = await submit(variables);

  if (result?.lowQualityResponse?.showLowQualityNotice && !result.feedback) {
    console.warn(`[KA Notify Me] ${what} hit the low-quality gate; confirming.`);
    result = await submit({ ...variables, shownLowQualityNotice: true });
  }

  if (result?.error) {
    throw new Error(`Khan Academy rejected the ${what} (${result.error.code}).`);
  }

  if (!result?.feedback?.key) {
    console.error(`[KA Notify Me] ${what} returned no feedback`, result);
    throw new Error(
      `Khan Academy accepted the request but did not create the ${what}. ` +
        'Open the extension service worker console for the full response.',
    );
  }

  return result.feedback;
}

async function submit(variables) {
  const data = await callGraphQL('AddFeedbackToDiscussion', {
    fromVideoAuthor: false,
    shownLowQualityNotice: false,
    ...variables,
  });
  return data?.addFeedbackToDiscussion;
}

/** Creates the anchor comment for a new room and returns the created feedback. */
export async function createRoomComment(programId, text) {
  return addFeedback(
    {
      focusKind: 'scratchpad',
      focusId: programId,
      textContent: text,
      feedbackType: 'COMMENT',
    },
    'comment',
  );
}

/** Posts one message into a room. */
export async function postReply(roomKey, text) {
  return addFeedback({ parentKey: roomKey, textContent: text, feedbackType: 'REPLY' }, 'message');
}

async function readReplies(postKey) {
  const data = await callGraphQL('getFeedbackReplies', { postKey });
  const replies = data?.feedbackReplies ?? [];
  return replies.filter((r) => !r.deleted && !r.appearsAsDeleted).map(toMessage);
}

/**
 * Every message in a room, oldest first.
 *
 * Khan Academy gives each post two identifiers -- `key` and `expandKey` -- and
 * which one `feedbackReplies` wants is not something the posting side told us:
 * replies are posted with `parentKey: key`, but nothing proves the read side
 * uses the same one. So try each candidate and report which worked, letting the
 * caller remember it instead of paying for the retry every poll.
 *
 * @param candidates ordered keys to try
 * @returns {{ messages, keyUsed }} keyUsed is null when every candidate was empty
 */
export async function fetchReplies(candidates) {
  const tried = [...new Set([].concat(candidates).filter(Boolean))];

  for (const key of tried) {
    const messages = await readReplies(key);
    if (messages.length) return { messages, keyUsed: key };
  }

  // Genuinely empty and "we asked the wrong way" look identical from here.
  return { messages: [], keyUsed: null };
}

const COMMENT_PAGE_SIZE = 50;
const MAX_COMMENT_PAGES = 12;

/**
 * Finds the anchor comment for a room by scanning the program's Tips & Thanks
 * for our stamp. This is what a short code buys: the code carries only the
 * program and the room id, and the long Khan Academy key is looked up here.
 * Because the stamp is per-room, one program can host any number of rooms.
 */
export async function findRoomComment(programId, roomId) {
  let cursor;

  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const data = await callGraphQL('feedbackQuery', {
      topicId: programId,
      focusKind: 'scratchpad',
      feedbackType: 'COMMENT',
      currentSort: 1,
      limit: COMMENT_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });

    const feed = data?.feedback;
    const comments = feed?.feedback ?? [];

    const match = comments.find((comment) => findRoomId(comment.content) === roomId);
    if (match) return describeRoomComment(match);

    cursor = feed?.cursor;
    if (feed?.isComplete || !cursor || comments.length === 0) break;
  }

  return null;
}

function describeRoomComment(comment) {
  return {
    key: comment.key,
    expandKey: comment.expandKey ?? '',
    replyCount: comment.replyCount ?? 0,
    replyExpandKeys: comment.replyExpandKeys ?? [],
    title: comment.focus?.translatedTitle ?? 'Khan Academy program',
    url: comment.permalink ?? comment.focusUrl ?? null,
    owner: toAuthor(comment.author),
  };
}

function toMessage(reply) {
  return {
    key: reply.key,
    // Notifications reference a reply by its expandKey, which is how a
    // notification gets matched back to the room it belongs to.
    expandKey: reply.expandKey ?? null,
    content: reply.content ?? '',
    date: reply.date,
    author: toAuthor(reply.author),
  };
}

function toAuthor(author) {
  return {
    kaid: author?.kaid ?? null,
    nickname: author?.nickname ?? 'Someone',
    avatarSrc: resolveAvatar(author?.avatar?.imageSrc ?? null),
  };
}

function resolveAvatar(src) {
  if (!src) return null;
  if (src.startsWith('http')) return src;
  return `https://cdn.kastatic.org${src}`;
}
