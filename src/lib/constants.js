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

/** How often the background looks for new notifications and chat messages. */
export const POLL_INTERVAL_MS = 5_000;

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

