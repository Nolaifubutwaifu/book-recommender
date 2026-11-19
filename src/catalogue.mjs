// Client for the Brisbane City Council library catalogue (SirsiDynix Enterprise).
// Endpoint details and how they were found: docs/catalogue-notes.md

export const BASE = 'https://library-brisbane.ent.sirsidynix.net.au';
const UA = 'Mozilla/5.0 (book-recommender prototype)';

// Search feed URL. `branch` is { code, name } from src/data/branches.json; it limits
// results to titles that branch holds a copy of (on shelf or not).
export function rssUrl(query, branch) {
  let url = `${BASE}/client/rss/hitlist/eLibCat/qu=${encodeURIComponent(query).replace(/%20/g, '+')}`;
  if (branch) url += `&qf=${encodeURIComponent(`LIBRARY\tLibrary\t1:${branch.code}\t${branch.name}`)}`;
  return url;
}

// The feed's <content> is HTML escaped inside XML, sometimes twice (&amp;#160;).
function decode(s) {
  for (let i = 0; i < 2; i++) {
    s = s
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, '&');
  }
  return s;
}

// shortcut: regex parse of a known, flat Atom feed; switch to DOMParser inside the extension.
export function parseRss(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const id = e.match(/<id>([^<]*)<\/id>/)?.[1] ?? '';
    const fields = {};
    for (const line of decode(e.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? '').split('<br/>')) {
      const m = line.match(/^([^ ]+) (.+)$/); // label and value are split by a non-breaking space
      if (m) fields[m[1].trim()] = m[2].trim();
    }
    return {
      id,
      // Only physical items (SD_ILS) have a catalogue key with copy-level availability.
      catKey: id.match(/SD_ILS:(\d+)$/)?.[1] ?? null,
      title: decode(e.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? '').replace(/^Title\s+/, ''),
      author: fields.Author ?? null,
      format: fields.Format ?? fields['Format:'] ?? null, // eBooks label it "Format:"
      isbn: fields.ISBN ?? null,
      callNumber: fields['Call Number'] ?? null,
    };
  });
}

export async function search(query, branch) {
  const res = await fetch(rssUrl(query, branch), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`RSS search failed: HTTP ${res.status}`);
  return parseRss(await res.text());
}

// Copy lookups are POSTs that need the page's anti-forgery token (sdcsrf).
export async function getSession() {
  const res = await fetch(`${BASE}/client/en_AU/eLibCat/search/results?qu=a`, { headers: { 'User-Agent': UA } });
  const token = (await res.text()).match(/__sdcsrf = "([^"]+)"/)?.[1];
  if (!token) throw new Error('Could not find sdcsrf token on the catalogue page');
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { token, cookie };
}

// Returns [{ LIBRARY, barcode, SD_ITEM_STATUS }], one per physical copy.
export async function getCopies(catKey, session) {
  const doc = `ent:$002f$002fSD_ILS$002f0$002fSD_ILS:${catKey}`;
  const d = encodeURIComponent(`ent://SD_ILS/0/SD_ILS:${catKey}~~0`);
  const url = `${BASE}/client/en_AU/eLibCat/search/detailnonmodal.detail.detailavailabilityaccordions:lookuptitleinfo/${doc}/ILS/0/true/true?d=${d}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', sdcsrf: session.token, Cookie: session.cookie },
  });
  if (!res.ok) throw new Error(`Copy lookup for ${catKey} failed: HTTP ${res.status}`);
  return (await res.json()).childRecords ?? [];
}

export const onShelfAt = (copies, branchName) =>
  copies.filter((c) => c.LIBRARY === branchName && c.SD_ITEM_STATUS.startsWith('On Shelf')).length;
