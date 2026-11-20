// Rate limits and a storage-backed cache, shared by everything the extension runs on one page.

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

// Each call starts at least `ms` after the previous one started.
export function throttle(ms) {
  let gate = Promise.resolve();
  return (fn) => {
    const run = gate.then(fn);
    gate = gate.then(() => new Promise((r) => setTimeout(r, ms)));
    return run;
  };
}

export const catalogueGate = throttle(500); // at most 2 requests per second to the catalogue
export const openLibraryGate = throttle(1000); // be gentle with Open Library's free API

// shortcut: entries are never pruned (most are under 1 KB), add cleanup if storage use grows.
export async function cached(key, ttl, fn) {
  const hit = (await chrome.storage.local.get(key))[key];
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  await chrome.storage.local.set({ [key]: { t: Date.now(), v } });
  return v;
}
