// Recommendations without AI: liked books -> Open Library subjects and authors -> similar popular books
// -> keep only those the Brisbane catalogue has -> rank by availability at the user's library, then similarity.
import { normTitle, surname, bookKey } from './taste.mjs';

const OL = 'https://openlibrary.org/search.json';
const FIELDS = 'key,title,author_name,author_key,subject,cover_i';
const DAY = 24 * 60 * 60 * 1000;

// Subjects that say nothing about what a book is like.
const STOP = new Set([
  'fiction', 'fiction, general', 'general', 'literature', 'novel', 'novels', 'roman', 'ficción', 'literatura',
  'accessible book', 'protected daisy', 'in library', 'large type books', 'lending library', 'popular print disabled books',
  'english literature', 'american literature', 'english fiction', 'american fiction', 'translations into english',
  'english language', 'juvenile fiction', 'open library staff picks', 'new york times bestseller', 'new york times reviewed',
  'long now manual for civilization', 'textbooks', 'readers', 'internet archive wishlist',
]);
const SKIP = /^(nyt:|award:|series:|reading level|overdrive)|=|history and criticism|criticism and interpretation/;

export const cleanSubjects = (subjects = []) =>
  [...new Set(subjects.map((s) => s.toLowerCase().trim().replace(/^fiction, /, '')))] // "Fiction, horror" -> "horror"
    .filter((s) => s.length > 2 && !STOP.has(s) && !SKIP.test(s));

// Keeps cached Open Library docs small.
export const slim = (d) => ({
  key: d.key,
  title: d.title,
  author: d.author_name?.[0] ?? '',
  authorKey: d.author_key?.[0] ?? null,
  subjects: cleanSubjects(d.subject).slice(0, 40),
  cover: d.cover_i ?? null,
});

const shortTitle = (t) => t.split(/[:;([/]/)[0].trim();
const olUrl = (params) => `${OL}?${new URLSearchParams({ fields: FIELDS, ...params })}`;
export const seedUrl = (item) => olUrl({ title: shortTitle(item.title), author: surname(item.author), limit: '1' });
// Quoted subject search is exact; the plain `subject=` parameter is fuzzy (returns Harry Potter for "vampires").
export const subjectUrl = (s) => olUrl({ q: `subject:"${s}" language:eng`, sort: 'readinglog', limit: '40' });
export const authorUrl = (k) => olUrl({ q: `author_key:${k} language:eng`, sort: 'readinglog', limit: '20' });

// seeds: [{ item, doc }] where doc is a slim Open Library doc for a liked book.
export function buildProfile(seeds) {
  const subjects = new Map();
  const authors = new Map();
  for (const { doc } of seeds) {
    for (const s of doc.subjects) subjects.set(s, (subjects.get(s) ?? 0) + 1);
    if (doc.authorKey) authors.set(doc.authorKey, (authors.get(doc.authorKey) ?? 0) + 1);
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  return { subjects, authors, topSubjects: top(subjects, 6), topAuthors: top(authors, 3) };
}

// Similarity: weighted shared subjects, damped for books with very long subject lists, plus a bonus for liked authors.
// shortcut: disliked books are only excluded, not used to push similar books down; add if recommendations feel off.
export function scoreCandidates(profile, seeds, docs, taste, limit = 40) {
  const exclude = new Set([...taste.map((i) => i.key), ...seeds.map((s) => bookKey(s.doc.title, s.doc.author))]);
  const seen = new Set(seeds.map((s) => s.doc.key));
  const maxW = Math.max(1, ...profile.subjects.values());
  const scored = [];

  for (const doc of docs) {
    if (seen.has(doc.key) || exclude.has(bookKey(doc.title, doc.author))) continue;
    seen.add(doc.key);
    const w = (s) => profile.subjects.get(s) ?? 0;
    const shared = doc.subjects.filter(w).sort((a, b) => w(b) - w(a));
    const likedAuthor = profile.authors.has(doc.authorKey);
    const score = shared.reduce((n, s) => n + w(s) / maxW, 0) / Math.sqrt(doc.subjects.length + 1) + (likedAuthor ? 0.5 : 0);
    if (score > 0) scored.push({ doc, score, reason: reasonFor(doc, shared, likedAuthor, seeds) });
  }

  scored.sort((a, b) => b.score - a.score);
  const perAuthor = new Map();
  return scored
    .filter(({ doc }) => {
      const n = (perAuthor.get(doc.author) ?? 0) + 1;
      perAuthor.set(doc.author, n);
      return n <= 2; // keep the list varied
    })
    .slice(0, limit);
}

function reasonFor(doc, shared, likedAuthor, seeds) {
  if (likedAuthor) {
    const seed = seeds.find((s) => s.doc.authorKey === doc.authorKey);
    return `More by ${doc.author}, who wrote ${seed.doc.title}`;
  }
  const best = seeds
    .map((s) => ({ s, common: shared.filter((x) => s.doc.subjects.includes(x)) }))
    .sort((a, b) => b.common.length - a.common.length)[0];
  return `Because you liked ${best.s.doc.title}: ${best.common.slice(0, 2).join(', ')}`;
}

const NOT_A_BOOK = /\b(dvd|blu-ray|videorecording|sound recording|cd|kit|game)\b/i;

// Catalogue records (from catalogue.search) that are the same book: same title and author, physical, not a film or audio CD.
export const pickRecords = (doc, records) =>
  records
    .filter((r) => r.catKey && normTitle(r.title) === normTitle(doc.title) && (!r.author || surname(r.author) === surname(doc.author)))
    .filter((r) => !NOT_A_BOOK.test(`${r.format} ${r.title}`))
    .slice(0, 3);

// 0 on shelf at home, 1 on shelf at second library, 2 home has a copy (on loan), 3 on shelf elsewhere, 4 none on shelf.
export function tierOf(copies, home, second) {
  const onShelfAt = (b) => b && copies.some((c) => c.LIBRARY === b.name && c.SD_ITEM_STATUS.startsWith('On Shelf'));
  if (onShelfAt(home)) return 0;
  if (onShelfAt(second)) return 1;
  if (home && copies.some((c) => c.LIBRARY === home.name)) return 2;
  if (copies.some((c) => c.SD_ITEM_STATUS.startsWith('On Shelf'))) return 3;
  return 4;
}

const quietly = async (fn, fallback) => {
  try {
    return await fn();
  } catch (err) {
    console.warn('[Shelf Check]', err);
    return fallback;
  }
};

// deps: { fetchJson(url), searchCatalogue(query), getCopies(catKey), cached(key, ttl, fn) }, rate limits applied by the caller.
// onProgress(message, recommendationsSoFar) is called as work happens, so the panel can fill in gradually.
export async function recommend({ taste, home, second, deps, onProgress = () => {}, want = 10 }) {
  const likes = taste.filter((i) => i.signal === 'liked').sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 30);
  const seeds = [];
  for (const [n, item] of likes.entries()) {
    onProgress(`Reading your taste (${n + 1} of ${likes.length})...`, []);
    const doc = await quietly(() => deps.cached(`ol:seed:${item.key}`, 30 * DAY, async () => {
      const d = (await deps.fetchJson(seedUrl(item))).docs?.[0];
      return d ? slim(d) : null;
    }), null);
    if (doc) seeds.push({ item, doc });
  }
  if (!seeds.length) return [];

  const profile = buildProfile(seeds);
  const urls = [...profile.topSubjects.map(subjectUrl), ...profile.topAuthors.map(authorUrl)];
  const docs = [];
  for (const [n, url] of urls.entries()) {
    onProgress(`Finding similar books (${n + 1} of ${urls.length})...`, []);
    docs.push(...(await quietly(() => deps.cached(`ol:q:${url}`, 7 * DAY, async () => ((await deps.fetchJson(url)).docs ?? []).map(slim)), [])));
  }

  const candidates = scoreCandidates(profile, seeds, docs, taste);
  const found = [];
  const ranked = () => [...found].sort((a, b) => a.tier - b.tier || b.score - a.score).slice(0, want);
  for (const [n, c] of candidates.entries()) {
    onProgress(`Checking the catalogue (${n + 1} of ${candidates.length})...`, ranked());
    const catKeys = await quietly(() => deps.cached(`cat:match:${c.doc.key}`, 7 * DAY, async () =>
      pickRecords(c.doc, await deps.searchCatalogue(`${shortTitle(c.doc.title)} ${surname(c.doc.author)}`)).map((r) => r.catKey)), []);
    if (!catKeys.length) continue;
    const copies = (await quietly(() => Promise.all(catKeys.map(deps.getCopies)), [])).flat();
    found.push({ ...c, catKeys, tier: tierOf(copies, home, second) });
    if (found.filter((f) => f.tier === 0).length >= want || found.length >= 2 * want) break;
  }
  return ranked();
}
