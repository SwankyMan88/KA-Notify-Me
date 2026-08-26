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

  /** Version string when GitHub is ahead of what is installed, else null. */
  updateAvailable: null,
  updateCheckedAt: 0,
  updateError: null,
  /** Which host answered the last successful check, for the Settings row. */
  updateSource: null,
  updateRemoteVersion: null,
  /** Remembered state of the "put the code in the comment" toggle. */
  shareCodeInComment: false,
  /* Settings */
  theme: 'system',
  accent: 'violet',
  soundEnabled: true,
  soundName: 'chime',
  volume: 0.6,
  soundOnNotifications: true,
  soundOnChat: true,
  pollSeconds: 5,
  autoMessages: true,
  /** Keep chat replies out of the Notifications list; they belong in Chat. */
  hideChatNotifications: true,
  /** Also filter room replies out of khanacademy.org's own notification menu. */
  hideChatOnSite: false,
  /** Clear the "new" flag when you open the popup, so nothing piles up. */
  autoMarkRead: true,
  /** Version the user pressed "Not now" on; cleared when a newer one lands. */
  updateDismissedVersion: null,
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
