/**
 * Runs in the page's own world on khanacademy.org and filters chat-room replies
 * out of Khan Academy's notification feed before its UI ever sees them.
 *
 * A chat message is a real comment reply, so Khan Academy raises a real
 * notification for it, and its API has no way to unsubscribe from a thread.
 * The only place left to intervene is the response itself: wrap `fetch`, and
 * when the site asks for its notifications, drop the ones belonging to rooms
 * before handing the body back.
 *
 * Rules this follows, because it is patching someone else's site:
 *   - one operation only; everything else is passed through untouched
 *   - any failure returns the original response rather than a broken one
 *   - it filters, never rewrites: no notification is altered, only omitted
 */

(() => {
  const OPERATION = 'getNotificationsForUser';

  /** expandKeys belonging to rooms, fed in by the extension's content script. */
  let roomKeys = new Set();
  let enabled = false;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.source !== 'kanm-filter') return;

    enabled = Boolean(data.enabled);
    roomKeys = new Set(data.keys ?? []);
  });

  function expandKeyOf(url) {
    const query = String(url ?? '').split('?')[1];
    if (!query) return null;
    try {
      return new URLSearchParams(query).get('qa_expand_key');
    } catch {
      return null;
    }
  }

  function belongsToRoom(notification) {
    const key = expandKeyOf(notification?.url);
    return Boolean(key) && roomKeys.has(key);
  }

  /** Returns a filtered copy, or null when there is nothing to change. */
  function filterPayload(payload) {
    const feed = payload?.data?.user?.notifications;
    const list = feed?.notifications;
    if (!Array.isArray(list) || !list.length) return null;

    const kept = list.filter((n) => !belongsToRoom(n));
    if (kept.length === list.length) return null;

    return {
      ...payload,
      data: {
        ...payload.data,
        user: {
          ...payload.data.user,
          notifications: { ...feed, notifications: kept },
        },
      },
    };
  }

  const nativeFetch = window.fetch;

  window.fetch = async function kanmFetch(...args) {
    const response = await nativeFetch.apply(this, args);

    try {
      if (!enabled || !roomKeys.size) return response;

      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (!url.includes(OPERATION)) return response;

      // Read from a clone so the caller's response body stays unconsumed if
      // anything below goes wrong.
      const text = await response.clone().text();
      const payload = JSON.parse(text);

      const filtered = filterPayload(payload);
      if (!filtered) return response;

      return new Response(JSON.stringify(filtered), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      // Never let this break the site: hand back exactly what Khan Academy sent.
      return response;
    }
  };
})();
