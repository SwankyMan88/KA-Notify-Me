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

  /**
   * A game message is recognisable from its own text, with no key matching at
   * all -- which is the only thing that works when a reply arrives before the
   * extension has learned its key. Khan Academy stores comments as markdown, so
   * the brackets can come back escaped.
   */
  function looksLikeGameMessage(content) {
    const text = String(content || "")
      .replace(/[\u200B\u200C\u200D\uFEFF\u00A0]/g, " ")
      .replace(/&#(\d+);/g, function (_, c) { return String.fromCharCode(Number(c)); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, c) { return String.fromCharCode(parseInt(c, 16)); })
      .replace(/&lbrack;/gi, "[")
      .replace(/&rbrack;/gi, "]")
      .split("\\").join("")
      .trim();

    return /^(?:KANMCHESS|\[chess\]|chess:{1,2})/i.test(text);
  }
  function shouldHide(notification) {
    return looksLikeGameMessage(notification && notification.content) || belongsToRoom(notification);
  }
  /** Returns a filtered copy, or null when there is nothing to change. */
  function filterPayload(payload) {
    const feed = payload?.data?.user?.notifications;
    const list = feed?.notifications;
    if (!Array.isArray(list) || !list.length) return null;

    const kept = list.filter((n) => !shouldHide(n));
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

  // Bound to the window: a site calling a detached `fetch(url)` gives us an
  // undefined `this`, and forwarding that to the real fetch throws "Illegal
  // invocation" -- which would break every request we wrap rather than just
  // failing to filter it.
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async function kanmFetch(...args) {
    const response = await nativeFetch(...args);

    try {
      if (!enabled) return response;

      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (!url.includes(OPERATION)) return response;

      // Read from a clone so the caller's response body stays unconsumed if
      // anything below goes wrong.
      const text = await response.clone().text();
      const payload = JSON.parse(text);

      const filtered = filterPayload(payload);
      if (!filtered) return response;

      // content-encoding and content-length describe the body we just
      // replaced, so copying them over would misdescribe the new one.
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');

      return new Response(JSON.stringify(filtered), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      // Never let this break the site: hand back exactly what Khan Academy sent.
      return response;
    }
  };
})();
