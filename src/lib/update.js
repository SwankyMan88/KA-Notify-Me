import { UPDATE_MANIFEST_URL } from './constants.js';

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

/**
 * Reads the manifest at the head of the default branch and compares versions.
 * Returns the newer version string, or null when already current.
 */
export async function checkForUpdate() {
  const response = await fetch(UPDATE_MANIFEST_URL, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Could not reach GitHub (HTTP ${response.status}).`);
  }

  const remote = await response.json();
  const latest = remote?.version;
  if (!latest) throw new Error('The manifest on GitHub has no version field.');

  return compareVersions(latest, installedVersion()) > 0 ? latest : null;
}
