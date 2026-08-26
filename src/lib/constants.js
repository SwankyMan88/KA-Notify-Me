/** Khan Academy's internal GraphQL endpoint. */
export const GRAPHQL_URL = 'https://www.khanacademy.org/api/internal/graphql';

/**
 * Khan Academy only accepts GraphQL documents it has safelisted, and it rotates
 * them without notice. This community mirror keeps the current text of each
 * operation, so we look the document up by name instead of hardcoding it.
 */
export const SAFELIST_URL = 'https://cdn.jsdelivr.net/gh/bhavjitChauhan/khan-api@safelist';

/** The session cookie Khan Academy sets when you sign in. */
export const SESSION_COOKIE = 'KAAS';

/** Default seconds between polls; the user can change this in Settings. */
export const DEFAULT_POLL_SECONDS = 5;

/** Poll intervals offered in Settings. Faster costs more requests to Khan. */
export const POLL_CHOICES = [
  { value: 5, label: 'Every 5 seconds' },
  { value: 15, label: 'Every 15 seconds' },
  { value: 30, label: 'Every 30 seconds' },
  { value: 60, label: 'Every minute' },
];

/**
 * Your name, avatar and points do not change every few seconds, so the profile
 * is refetched once a minute rather than on every tick. At a 5s cadence that is
 * the difference between 12 requests a minute and 24.
 */
export const PROFILE_REFRESH_MS = 60_000;

/**
 * chrome.alarms cannot fire faster than once a minute, so the poll cadence comes
 * from an offscreen document. The alarm is a safety net that revives the poller
 * if that document ever goes away.
 */
export const KEEPALIVE_ALARM = 'kanm-keepalive';

/** How many notifications to request per page, and how many to keep in total. */
export const NOTIFICATION_PAGE_SIZE = 20;
export const MAX_NOTIFICATIONS = 400;

export const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

export const BADGE_COLOR = '#6d4aff';

/** Marks a share code as ours and lets us reject pasted junk early. */
export const CHAT_CODE_PREFIX = 'KANM1-';


/* -------------------------------- updates ------------------------------- */

export const REPO_SLUG = 'SwankyMan88/KA-Notify-Me';

export const REPO_URL = `https://github.com/${REPO_SLUG}`;

export const UPDATE_ALARM = 'kanm-update-check';

/** Minutes between update checks. chrome.alarms will not fire faster than 1. */
export const UPDATE_CHECK_MINUTES = 5;

/** The command that actually performs the update, shown in the popup. */
export const UPDATE_COMMAND = 'git pull';

/* ------------------------------- settings ------------------------------- */

export const THEMES = [
  { value: 'system', label: 'Match my system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Accent colours. Each is [light mode, dark mode] so contrast holds in both. */
export const ACCENTS = [
  { value: 'violet', label: 'Violet', swatch: '#6d4aff' },
  { value: 'blue', label: 'Blue', swatch: '#0b72d9' },
  { value: 'teal', label: 'Teal', swatch: '#0d8f86' },
  { value: 'rose', label: 'Rose', swatch: '#d63b6a' },
  { value: 'amber', label: 'Amber', swatch: '#b7791f' },
];

/** Keep these ids in sync with the SOUNDS table in tools/make-assets.mjs. */
export const SOUNDS = [
  { value: 'chime', label: 'Chime' },
  { value: 'ping', label: 'Ping' },
  { value: 'knock', label: 'Knock' },
  { value: 'marimba', label: 'Marimba' },
  { value: 'droplet', label: 'Droplet (soft)' },
  { value: 'hush', label: 'Hush (soft)' },
  { value: 'drift', label: 'Drift (softest)' },
  { value: 'felt', label: 'Felt (softest)' },
];

/* --------------------------- posting restraint -------------------------- */

/**
 * Khan Academy rate-limits comment posting, and a burst looks like spam. A
 * minute between your own moves keeps a game comfortably under that.
 */
export const MOVE_COOLDOWN_MS = 60_000;

/** How many of your own messages a room keeps when tidying is switched on. */
export const KEEP_RECENT_MESSAGES = 20;
