// Taste profile: books the user liked, disliked or read. Stored in chrome.storage.local under "taste".
// Item: { key, title, author, signal: 'liked'|'disliked'|'read', source: 'button'|'goodreads'|'storygraph', addedAt }

const clean = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// "The Call of Cthulhu: and Other Stories (Penguin Classics)" -> "call of cthulhu"
export const normTitle = (t = '') => clean(t.split(/[:;([/]/)[0]).replace(/^(the|a|an) /, '');

// Works for "Lovecraft, H. P. (Howard Phillips), 1890-1937, author." (catalogue) and "H.P. Lovecraft" (Open Library).
// Returns the last word only, so "Le Guin, Ursula K." and "Ursula K. Le Guin" both give "guin".
export function surname(author = '') {
  const first = (author ?? '').split(';')[0];
  const raw = first.includes(',') ? first.split(',')[0] : first.trim().split(/\s+/).filter((w) => !/^(jr|sr|ii|iii)\.?$/i.test(w)).pop();
  return clean(raw ?? '').split(' ').pop();
}

export const bookKey = (title, author) => `${normTitle(title)}|${surname(author)}`;

// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, commas and newlines inside quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head = [], ...body] = rows;
  return body.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const isoDate = (d) => (d ? d.replace(/\//g, '-') : new Date().toISOString().slice(0, 10));
const byRating = (r) => (r >= 4 ? 'liked' : r >= 1 && r <= 2 ? 'disliked' : 'read');

// Turns a Goodreads or StoryGraph export into taste items. Unread shelves (to-read, currently-reading) are skipped.
export function importTaste(csvText) {
  const rows = parseCsv(csvText);
  const head = Object.keys(rows[0] ?? {});
  const make = (title, author, signal, source, addedAt) => ({ key: bookKey(title, author), title, author, signal, source, addedAt });

  if (head.includes('My Rating') && head.includes('Exclusive Shelf')) {
    const items = rows
      .filter((r) => r['Exclusive Shelf'] === 'read' && r.Title)
      .map((r) => make(r.Title, r.Author, byRating(Number(r['My Rating'])), 'goodreads', isoDate(r['Date Read'] || r['Date Added'])));
    return { source: 'goodreads', items, skipped: rows.length - items.length };
  }
  if (head.includes('Read Status') && head.includes('Star Rating')) {
    const items = rows
      .filter((r) => ['read', 'did-not-finish'].includes(r['Read Status']) && r.Title)
      .map((r) => {
        const signal = r['Read Status'] === 'did-not-finish' ? 'disliked' : byRating(parseFloat(r['Star Rating']) || 0);
        return make(r.Title, (r.Authors ?? '').split(',')[0].trim(), signal, 'storygraph', isoDate(r['Last Date Read'] || r['Date Added']));
      });
    return { source: 'storygraph', items, skipped: rows.length - items.length };
  }
  throw new Error('This does not look like a Goodreads or StoryGraph export (CSV).');
}

// Imports never overwrite what the user set with the like / not-for-me buttons.
export function mergeTaste(existing, incoming) {
  const byKey = new Map(existing.map((i) => [i.key, i]));
  for (const item of incoming) if (byKey.get(item.key)?.source !== 'button') byKey.set(item.key, item);
  return [...byKey.values()];
}

// --- storage (extension only) ---
// Keys are recomputed on load so books saved before a matching change still line up (button choices win on duplicates).
export const loadTaste = async () =>
  mergeTaste([], (await chrome.storage.local.get({ taste: [] })).taste.map((i) => ({ ...i, key: bookKey(i.title, i.author) })));
export const saveTaste = (taste) => chrome.storage.local.set({ taste });

// signal: 'liked' | 'disliked' | null (remove)
export async function setSignal({ title, author }, signal) {
  const key = bookKey(title, author);
  const taste = (await loadTaste()).filter((i) => i.key !== key);
  if (signal) taste.push({ key, title, author, signal, source: 'button', addedAt: new Date().toISOString().slice(0, 10) });
  await saveTaste(taste);
}
