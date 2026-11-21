// Recommendations without AI: liked books -> Open Library subjects and authors -> similar popular books
// -> keep only those on a shelf at some Brisbane library right now -> best matches first.
import { normTitle, surname, bookKey } from './taste.mjs';
import { DAY } from './cache.mjs';

const OL = 'https://openlibrary.org/search.json';
const FIELDS = 'key,title,author_name,author_key,subject,cover_i';

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
// avoid: profile of disliked books. Subjects only disliked books have push a candidate down; a subject that liked
// books share too ("horror") is left alone. Books by an author you only dislike are skipped.
export function scoreCandidates(profile, seeds, docs, taste, limit = 80, avoid = null) {
  const exclude = new Set([...taste.map((i) => i.key), ...seeds.map((s) => bookKey(s.doc.title, s.doc.author))]);
  const seen = new Set(seeds.map((s) => s.doc.key));
  const maxW = Math.max(1, ...profile.subjects.values());
  const dw = (s) => (profile.subjects.has(s) ? 0 : avoid?.subjects.get(s) ?? 0);
  const maxDW = Math.max(1, ...(avoid?.subjects.values() ?? []));
  const scored = [];

  for (const doc of docs) {
    if (seen.has(doc.key) || exclude.has(bookKey(doc.title, doc.author))) continue;
    seen.add(doc.key);
    const w = (s) => profile.subjects.get(s) ?? 0;
    const shared = doc.subjects.filter(w).sort((a, b) => w(b) - w(a));
    const likedAuthor = profile.authors.has(doc.authorKey);
    if (!likedAuthor && avoid?.authors.has(doc.authorKey)) continue;
    const damp = Math.sqrt(doc.subjects.length + 1);
    const penalty = (0.5 * doc.subjects.reduce((n, s) => n + dw(s) / maxDW, 0)) / damp; // half weight: lowers, rarely removes
    const score = shared.reduce((n, s) => n + w(s) / maxW, 0) / damp + (likedAuthor ? 0.5 : 0) - penalty;
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

// Media words are checked in the format only: titles like "A Game of Thrones" are books.
const NOT_A_BOOK_FORMAT = /dvd|blu-ray|video|sound|music|\bcd\b|kit|game/i;
const MEDIA_TAG = /\[(dvd|blu-ray|videorecording|sound recording)/i; // catalogue titles like "The shining [dvd]"

// Catalogue records (from catalogue.search) that are the same book: same title and author, physical, not a film or audio CD.
export const pickRecords = (doc, records) =>
  records
    .filter((r) => r.catKey && normTitle(r.title) === normTitle(doc.title) && (!r.author || surname(r.author) === surname(doc.author)))
    .filter((r) => !NOT_A_BOOK_FORMAT.test(r.format ?? '') && !MEDIA_TAG.test(r.title))
    .slice(0, 3);


const quietly = async (fn, fallback) => {
  try {
    return await fn();
  } catch (err) {
    console.warn('[Shelf Check]', err);
    return fallback;
  }
};

// deps: { fetchJson(url), searchCatalogue(title, surname), getCopies(catKey), cached(key, ttl, fn) }, rate limits applied by the caller.
// onProgress(message, recommendationsSoFar) is called as work happens, so the panel can fill in gradually.
// Only books with a copy on shelf somewhere (green or amber badge) are returned; a book nobody can borrow today is no use.
export async function recommend({ taste, deps, onProgress = () => {}, want = 10 }) {
  const recent = (signal, n) => taste.filter((i) => i.signal === signal).sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, n);
  // Open Library details for each book, looked up once and kept for 30 days.
  const lookUp = async (items, label) => {
    const out = [];
    for (const [n, item] of items.entries()) {
      onProgress(`${label} (${n + 1} of ${items.length})...`, []);
      const doc = await quietly(() => deps.cached(`ol:seed:${item.key}`, 30 * DAY, async () => {
        const d = (await deps.fetchJson(seedUrl(item))).docs?.[0];
        return d ? slim(d) : null;
      }), null);
      if (doc) out.push({ item, doc });
    }
    return out;
  };
  const seeds = await lookUp(recent('liked', 30), 'Reading your taste');
  if (!seeds.length) return [];
  const avoid = buildProfile(await lookUp(recent('disliked', 10), 'Reading what you did not like'));

  const profile = buildProfile(seeds);
  const urls = [...profile.topSubjects.map(subjectUrl), ...profile.topAuthors.map(authorUrl)];
  const docs = [];
  for (const [n, url] of urls.entries()) {
    onProgress(`Finding similar books (${n + 1} of ${urls.length})...`, []);
    docs.push(...(await quietly(() => deps.cached(`ol:q:${url}`, 7 * DAY, async () => ((await deps.fetchJson(url)).docs ?? []).map(slim)), [])));
  }

  const candidates = scoreCandidates(profile, seeds, docs, taste, 80, avoid);
  // Returns the candidate with its catalogue records if a copy is on a shelf somewhere, else null.
  const check = async (c) => {
    // "match2": matches cached before the surname and title-filter fixes could be wrongly empty.
    const catKeys = await quietly(() => deps.cached(`cat:match2:${c.doc.key}`, 7 * DAY, async () =>
      pickRecords(c.doc, await deps.searchCatalogue(shortTitle(c.doc.title), surname(c.doc.author))).map((r) => r.catKey)), []);
    if (!catKeys.length) return null;
    // Not swallowed: if the catalogue session expired, every lookup fails and the panel should say so.
    const copies = (await Promise.all(catKeys.map(deps.getCopies))).flat();
    return copies.some((x) => x.onShelf) ? { ...c, catKeys } : null;
  };

  // 3 at a time: the rate limits still hold, but one slow search no longer blocks the rest.
  // Results are kept in candidate order, so `found` stays ranked best match first.
  const found = [];
  for (let i = 0; i < candidates.length && found.length < want; i += 3) {
    onProgress(`Checking the catalogue (${Math.min(i + 3, candidates.length)} of ${candidates.length})...`, [...found]);
    for (const r of await Promise.all(candidates.slice(i, i + 3).map(check))) if (r && found.length < want) found.push(r);
  }
  return found;
}
