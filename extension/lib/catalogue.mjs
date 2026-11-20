// Client for the Brisbane City Council library catalogue (SirsiDynix Enterprise).
// Endpoint details and how they were found: docs/catalogue-notes.md

export const BASE = 'https://library-brisbane.ent.sirsidynix.net.au';
const UA = 'Mozilla/5.0 (book-recommender prototype)';

// Search feed URL. `branch` is { code, name } from branches.json; it limits
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

// The response wraps the numbers in a script string: updateWebServiceFields({"availableCount":"3",...}).
export function parseCounts(text) {
  const num = (k) => Number(text.match(new RegExp(`\\\\"${k}\\\\":\\\\"(\\d+)`))?.[1] ?? NaN);
  return { available: num('availableCount'), copies: num('copyCount'), holds: num('holdCount') };
}

// Returns { available, copies, holds } for a physical title.
export async function getCounts(catKey, session) {
  const doc = `ent:$002f$002fSD_ILS$002f0$002fSD_ILS:${catKey}`;
  const d = encodeURIComponent(`ent://SD_ILS/0/SD_ILS:${catKey}~ILS~0`);
  const url = `${BASE}/client/en_AU/eLibCat/search/results.displaypanel.displaycell_0.detail.detailavailabilityaccordions.boundwithzone:lookupavailability/${doc}/ILS/0/true/LIBRARY$002cCALLNUMBER?&d=${d}&h=8`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', sdcsrf: session.token, Cookie: session.cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 't%3Azoneid=detailboundWithDiv0',
  });
  if (!res.ok) throw new Error(`Count lookup for ${catKey} failed: HTTP ${res.status}`);
  return parseCounts(await res.text());
}

// The one place that decides "available": statuses seen are "On Shelf in library", "Checked Out", "In Transit...".
export const isOnShelf = (copy) => copy.SD_ITEM_STATUS.startsWith('On Shelf');

export const onShelfAt = (copies, branchName) => copies.filter((c) => c.LIBRARY === branchName && isOnShelf(c)).length;

// --- badge text ---
export const shortBranch = (name) => name.replace(/ Library.*$/, ''); // "Garden City Library (Westfield)" -> "Garden City"
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sentence = (parts) => {
  const s = parts.filter(Boolean).join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const friendlyStatus = (s) =>
  /checked out/i.test(s) ? 'on loan' : /transit/i.test(s) ? 'in transit' : /hold/i.test(s) ? 'on the holds shelf' : s.toLowerCase();
const listBranches = (names) => names.slice(0, 3).map(shortBranch).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');

// Badge for one book. home / second: { name } or undefined. holds: hold count, only needed when nothing is on shelf.
// Returns { colour: 'green'|'amber'|'red'|'grey', text, homeOn }.
export function describeCopies(copies, home, second, holds) {
  if (!copies.length) return { colour: 'grey', text: 'No physical copies listed', homeOn: false };
  const onShelf = [...new Set(copies.filter(isOnShelf).map((c) => c.LIBRARY))];
  if (home && onShelf.includes(home.name)) return { colour: 'green', text: `On shelf at ${shortBranch(home.name)}`, homeOn: true };

  const homeCopy = home && copies.find((c) => c.LIBRARY === home.name);
  const homeNote = !home ? '' : homeCopy ? `${shortBranch(home.name)} copy ${friendlyStatus(homeCopy.SD_ITEM_STATUS)}` : `not at ${shortBranch(home.name)}`;
  if (second && onShelf.includes(second.name)) return { colour: 'amber', text: sentence([homeNote, `on shelf at ${shortBranch(second.name)}`]), homeOn: false };
  if (onShelf.length) return { colour: 'amber', text: sentence([homeNote, `on shelf at ${listBranches(onShelf)}`]), homeOn: false };
  const holdsNote = holds === undefined || Number.isNaN(holds) ? '' : plural(holds, 'hold');
  return { colour: 'red', text: sentence([homeNote, `none on shelf (${plural(copies.length, 'copy', 'copies')})`, holdsNote]), homeOn: false };
}
