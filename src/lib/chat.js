/**
 * A chat room, as stored:
 *   { id, programId, roomId, roomKey, expandKey, title, url, members, messages,
 *     lastSeenKey, unread }
 *
 * `roomId` is ours: a short id we stamp into the text of the Tips & Thanks
 * comment that anchors the room. That stamp is what lets a program hold several
 * rooms at once and lets someone joining find the right comment to reply to.
 * `roomKey` is Khan Academy's key for that comment -- it is long, so it is
 * resolved by looking the stamp up rather than carried around in the code.
 */

/**
 * Crockford-style base32 for room ids: no I, L, O or U, so a room id survives
 * being read aloud or retyped. The program half of a code is base36 and does
 * use those letters, so the repair below is only ever applied to the room id.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ROOM_ID_LENGTH = 6;

/** Characters people reliably mistype, mapped to what they meant. */
const CONFUSABLES = { I: '1', L: '1', O: '0', U: 'V' };

/* ------------------------------- room ids ------------------------------ */

export function makeRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_ID_LENGTH));
  return [...bytes].map((b) => ALPHABET[b % 32]).join('');
}

/**
 * The text we post as the room's anchor comment. Kept short and plain: long
 * promotional-sounding comments are more likely to trip Khan Academy's
 * low-quality gate, which silently refuses the post.
 *
 * Passing `code` prints the join code underneath, so anyone reading the thread
 * can add the room to their own extension. Note this gives away nothing that
 * the comment did not already give away — the code is just the program and the
 * room id, both of which are visible to anyone looking at the comment.
 */
export function roomMarker(roomId, { name = '', code = null } = {}) {
  const titled = name ? ` · ${cleanName(name)}` : '';
  const line = `KA Notify Me chat room ${roomId}${titled} — reply below to join the conversation.`;
  return code ? `${line}\nJoin code: ${code}` : line;
}

/**
 * A room name has to survive living inside a comment, so it cannot carry
 * newlines, and it cannot contain the two characters that delimit it.
 */
export function cleanName(name) {
  return String(name ?? '')
    .replace(/[\r\n·—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

const MARKER_RE = new RegExp(`KA Notify Me chat room ([${ALPHABET}]{${ROOM_ID_LENGTH}})`, 'i');

/** The optional name sits between the id and the em-dash on the same line. */
const NAME_RE = new RegExp(
  'KA Notify Me chat room [' +
    ALPHABET +
    ']{' +
    ROOM_ID_LENGTH +
    '}\\s*\\u00b7\\s*([^\\n\\u2014]+?)\\s*\\u2014',
  'i',
);

/** The name the room was created with, as written into its anchor comment. */
export function findRoomName(content) {
  const match = String(content ?? '').match(NAME_RE);
  return match ? cleanName(match[1]) : null;
}

/** Pulls the room id back out of a comment, or null if it is not one of ours. */
export function findRoomId(content) {
  const match = String(content ?? '').match(MARKER_RE);
  return match ? match[1].toUpperCase() : null;
}

/* ------------------------------ room codes ----------------------------- */

/** Program ids are long decimal numbers; base36 makes them about a third shorter. */
function encodeProgramId(programId) {
  return BigInt(programId).toString(36).toUpperCase();
}

function decodeProgramId(text) {
  let value = 0n;
  for (const char of text.toLowerCase()) {
    const digit = parseInt(char, 36);
    if (Number.isNaN(digit)) throw new Error('bad digit');
    value = value * 36n + BigInt(digit);
  }
  return value.toString();
}

/** One character so an obviously mistyped code fails before we hit the network. */
function checksum(payload) {
  let sum = 0;
  for (const char of payload) sum = (sum + char.charCodeAt(0)) % 32;
  return ALPHABET[sum];
}

/**
 * The string you share to invite someone, e.g. `KA-3PJ7BQ9F2-7HQ2MBX`.
 * Short enough to survive being pasted into a comment or a chat message.
 */
export function encodeRoomCode({ programId, roomId }) {
  const program = encodeProgramId(programId);
  return `KA-${program}-${roomId}${checksum(program + roomId)}`;
}

/** Accepts sloppy input: lower case, missing prefix, stray spaces, O for 0. */
export function decodeRoomCode(input) {
  const cleaned = String(input ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^KA-/, '')
    .replace(/[^0-9A-Z-]/g, '');

  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length !== 2) {
    throw new Error('That does not look like a room code. They look like KA-3PJ7BQ9F2-7HQ2MBX.');
  }

  const [program, tail] = parts;
  if (tail.length !== ROOM_ID_LENGTH + 1) {
    throw new Error('That room code is the wrong length — check for a missing character.');
  }

  const roomId = [...tail.slice(0, ROOM_ID_LENGTH)]
    .map((char) => CONFUSABLES[char] ?? char)
    .join('');

  if (checksum(program + roomId) !== tail.at(-1)) {
    throw new Error('That room code has a typo in it.');
  }

  let programId;
  try {
    programId = decodeProgramId(program);
  } catch {
    throw new Error('That room code is incomplete. Ask for it to be sent again.');
  }

  return { programId, roomId };
}

/* -------------------------------- helpers ------------------------------ */

export function displayTitle(chat) {
  return chat.customTitle || chat.name || chat.title || 'Khan Academy program';
}

export function programUrl(programId) {
  return `https://www.khanacademy.org/computer-programming/x/${programId}`;
}

export function roomUrl(chat) {
  const base = programUrl(chat.programId);
  return chat.expandKey ? `${base}?qa_expand_key=${encodeURIComponent(chat.expandKey)}` : base;
}

/** Identity within the extension. Two rooms on one program differ by roomId. */
export function chatId({ programId, roomId }) {
  return `${programId}:${roomId}`;
}

/* ----------------------------- program URLs ---------------------------- */

/**
 * Accepts a full program URL or a bare program id. Khan Academy program ids are
 * the long numeric tail of the URL.
 */
export function parseProgramId(input) {
  const text = String(input ?? '').trim();
  if (/^\d{6,}$/.test(text)) return text;

  const match = text.match(/khanacademy\.org\/(?:computer-programming|cs)\/[^/]+\/(\d{6,})/);
  if (match) return match[1];

  throw new Error('Enter a link to one of your Khan Academy programs.');
}

/* -------------------------- notification links ------------------------- */

/** Khan Academy points at a specific post with a `qa_expand_key` query param. */
export function expandKeyFromUrl(url) {
  const query = String(url ?? '').split('?')[1];
  if (!query) return null;
  return new URLSearchParams(query).get('qa_expand_key');
}

/**
 * Works out whether a notification is about one of your rooms, by matching the
 * post it points at against the room's anchor comment or any of its messages.
 * Returns the chat, so the popup can open it instead of sending you to the site.
 */
export function findChatForNotification(notification, chats) {
  const key = expandKeyFromUrl(notification?.url);
  if (!key) return null;

  return (
    chats.find(
      (chat) =>
        chat.expandKey === key || (chat.messages ?? []).some((m) => m.expandKey === key),
    ) ?? null
  );
}

/* ------------------------------- messages ------------------------------ */

/** Everyone who has spoken in the room, most recent first, excluding you. */
export function membersFrom(messages, selfKaid) {
  const seen = new Map();
  for (const message of messages) {
    const { kaid } = message.author;
    if (!kaid || kaid === selfKaid) continue;
    seen.set(kaid, message.author);
  }
  return [...seen.values()];
}

/** Messages newer than the last one you looked at. */
export function countUnread(messages, lastSeenKey, selfKaid) {
  if (!messages.length) return 0;

  const index = lastSeenKey ? messages.findIndex((m) => m.key === lastSeenKey) : -1;
  const fresh = index === -1 ? messages : messages.slice(index + 1);
  return fresh.filter((m) => m.author.kaid !== selfKaid).length;
}
