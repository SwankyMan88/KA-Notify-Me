/** Everything the extension persists, with the values it falls back to. */
export const DEFAULTS = {
  signedIn: false,
  loaded: false,

  // Notifications
  notifications: [],
  cursor: '',
  hasMore: true,
  unreadCount: 0,
  /** urlsafeKeys we have already chimed for, so a reload does not re-ring. */
  announcedKeys: [],

  // Chat
  /** Array of chat rooms; see lib/chat.js for the shape. */
  chats: [],
  activeChatId: null,

  profile: null,
  profileFetchedAt: 0,
  /** Remembered state of the "put the code in the comment" toggle. */
  shareCodeInComment: false,
  soundEnabled: true,
  volume: 0.6,
  lastSync: 0,
  lastError: null,
};

export async function read(...keys) {
  const wanted = keys.length ? keys : Object.keys(DEFAULTS);
  const stored = await chrome.storage.local.get(wanted);
  const out = {};
  for (const key of wanted) {
    out[key] = key in stored ? stored[key] : DEFAULTS[key];
  }
  return out;
}

export async function readOne(key) {
  return (await read(key))[key];
}

export function write(patch) {
  return chrome.storage.local.set(patch);
}

export function clear(keys) {
  return chrome.storage.local.remove(keys);
}
