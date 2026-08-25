import { REPO_SLUG } from './constants.js';

/**
 * Update checking, not updating.
 *
 * An extension loaded with "Load unpacked" is run straight off a folder on
 * disk. Chrome only auto-updates extensions that came from the Web Store or a
 * signed self-hosted CRX, and no extension can write to its own directory or
 * run git. So the most this can do is notice that the repository has moved
 * ahead, say so, and reload itself once the files on disk have actually
 * changed -- the `git pull` in between is the user's to run.
 */

/** Compares dotted numeric versions. Returns -1, 0 or 1. */
export function compareVersions(a, b) {
  const parse = (v) =>
    String(v ?? '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function installedVersion() {
  return chrome.runtime.getManifest().version;
}

/* ------------------------------- sources ------------------------------- */

/**
 * Three independent ways to read the manifest at the head of the branch.
 *
 * One host is not enough: raw.githubusercontent.com is routinely blocked by
 * school and workplace network filters even when github.com itself is allowed,
 * and a blocked host is indistinguishable from being offline -- both surface as
 * a bare "Failed to fetch". Ordered fastest-to-freshest, so a working first
 * choice is normally the only request made.
 */
export const UPDATE_SOURCES = [
  {
    id: 'raw.githubusercontent.com',
    url: `https://raw.githubusercontent.com/${REPO_SLUG}/main/manifest.json`,
    parse: (text) => JSON.parse(text).version,
  },
  {
    id: 'api.github.com',
    url: `https://api.github.com/repos/${REPO_SLUG}/contents/manifest.json?ref=main`,
    // The contents API wraps the file as base64 with newlines in it.
    parse: (text) => {
      const payload = JSON.parse(text);
      if (payload.encoding !== 'base64' || !payload.content) {
        throw new Error('unexpected response shape');
      }
      return JSON.parse(atob(payload.content.replace(/\s/g, ''))).version;
    },
  },
  {
    // Already proven to work here: the GraphQL safelist is fetched from it.
    // Last because its cache for a branch ref can lag by several hours.
    id: 'cdn.jsdelivr.net',
    url: `https://cdn.jsdelivr.net/gh/${REPO_SLUG}@main/manifest.json`,
    parse: (text) => JSON.parse(text).version,
  },
];

async function readVersionFrom(source) {
  const response = await fetch(source.url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const version = source.parse(await response.text());
  if (!version) throw new Error('no version field');
  return version;
}

/** Tries each source, reporting what happened to every one it had to touch. */
export async function fetchLatestVersion() {
  const attempts = [];

  for (const source of UPDATE_SOURCES) {
    try {
      const version = await readVersionFrom(source);
      attempts.push({ id: source.id, ok: true });
      return { version, source: source.id, attempts };
    } catch (error) {
      attempts.push({ id: source.id, ok: false, reason: describe(error) });
    }
  }

  const error = new Error(
    `Could not reach GitHub. Tried ${attempts.length} sources: ` +
      attempts.map((a) => `${a.id} (${a.reason})`).join(', ') +
      '. A network that blocks these hosts is the usual cause.',
  );
  error.attempts = attempts;
  throw error;
}

/**
 * `fetch` rejects with a bare "Failed to fetch" for DNS failures, blocked
 * hosts, offline, and CORS alike, which tells the user nothing. Name the
 * category at least.
 */
function describe(error) {
  const message = String(error?.message ?? error);
  if (message === 'Failed to fetch' || error?.name === 'TypeError') {
    return navigator.onLine === false ? 'offline' : 'unreachable or blocked';
  }
  return message;
}

/**
 * Returns the newer version string, or null when already current, alongside
 * which source answered.
 */
export async function checkForUpdate() {
  const { version, source, attempts } = await fetchLatestVersion();
  return {
    latest: compareVersions(version, installedVersion()) > 0 ? version : null,
    remoteVersion: version,
    source,
    attempts,
  };
}
