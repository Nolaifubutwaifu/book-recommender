// Client for SirsiDynix Enterprise catalogues (Brisbane, Gold Coast, Tasmania, ...).
// Every function takes `lib`, a network from libraries.mjs. Endpoint details: docs/catalogue-notes.md

const UA = 'Mozilla/5.0 (book-recommender prototype)';
const page = (lib) => `${lib.base}/client/en_AU/${lib.profile}`;
const docPath = (catKey) => `ent:$002f$002fSD_ILS$002f0$002fSD_ILS:${catKey}`;

export const detailUrl = (lib, catKey) => `${page(lib)}/search/detailnonmodal/${docPath(catKey)}/one`;

// Search feed URL. `branch` is { code, name } from the network's branch list; it limits
// results to titles that branch holds a copy of (on shelf or not).
export function rssUrl(lib, query, branch) {
  let url = `${lib.base}/client/rss/hitlist/${lib.profile}/qu=${encodeURIComponent(query).replace(/%20/g, '+')}`;
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

export async function search(lib, query, branch) {
  const res = await fetch(rssUrl(lib, query, branch), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`RSS search failed: HTTP ${res.status}`);
  return parseRss(await res.text());
}

// For matching a recommended book: keyword search on title words plus the author's surname.
export const findBook = (lib, title, author) => search(lib, `${title} ${author}`);

// Copy lookups are POSTs that need the page's anti-forgery token (sdcsrf). In the extension the
// content script reads it from the page; from Node this fetches a page to get one.
export async function getSession(lib) {
  const res = await fetch(`${page(lib)}/search/results?qu=a`, { headers: { 'User-Agent': UA } });
  const token = (await res.text()).match(/__sdcsrf = "([^"]+)"/)?.[1] ?? '';
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { token, cookie };
}

const post = (url, session, extra = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', sdcsrf: session.token, Cookie: session.cookie, ...extra.headers },
    body: extra.body,
  });

// One entry per physical copy: { library, status, onShelf }. `onShelf` uses the network's own rule,
// because networks word statuses differently ("On Shelf in library" vs a shelf location).
export async function getCopies(lib, catKey, session) {
  const d = encodeURIComponent(`ent://SD_ILS/0/SD_ILS:${catKey}~~0`);
  const res = await post(`${page(lib)}/search/detailnonmodal.detail.detailavailabilityaccordions:lookuptitleinfo/${docPath(catKey)}/ILS/0/true/true?d=${d}`, session);
  if (!res.ok) throw new Error(`Copy lookup for ${catKey} failed: HTTP ${res.status}`);
  return toCopies(lib, (await res.json()).childRecords ?? []);
}

export const toCopies = (lib, records) => records.map((c) => ({ library: c.LIBRARY, status: c.SD_ITEM_STATUS, onShelf: lib.onShelf(c.SD_ITEM_STATUS) }));

// The response wraps the numbers in a script string: updateWebServiceFields({"availableCount":"3",...}).
export function parseCounts(text) {
  const num = (k) => Number(text.match(new RegExp(`\\\\"${k}\\\\":\\\\"(\\d+)`))?.[1] ?? NaN);
  return { available: num('availableCount'), copies: num('copyCount'), holds: num('holdCount') };
}

// Returns { available, copies, holds } for a physical title.
export async function getCounts(lib, catKey, session) {
  const d = encodeURIComponent(`ent://SD_ILS/0/SD_ILS:${catKey}~ILS~0`);
  const url = `${page(lib)}/search/results.displaypanel.displaycell_0.detail.detailavailabilityaccordions.boundwithzone:lookupavailability/${docPath(catKey)}/ILS/0/true/LIBRARY$002cCALLNUMBER?&d=${d}&h=8`;
  const res = await post(url, session, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 't%3Azoneid=detailboundWithDiv0' });
  if (!res.ok) throw new Error(`Count lookup for ${catKey} failed: HTTP ${res.status}`);
  return parseCounts(await res.text());
}

export const onShelfAt = (copies, branchName) => copies.filter((c) => c.library === branchName && c.onShelf).length;

// --- badge text ---
export const shortBranch = (name) => name.replace(/ (Library|Branch)\b.*$/, ''); // "Garden City Library (Westfield)" -> "Garden City", "Woden Branch" -> "Woden"
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sentence = (parts) => {
  const s = parts.filter(Boolean).join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const friendlyStatus = (s) =>
  /checked out|^on loan|^due /i.test(s) ? 'on loan' : /transit/i.test(s) ? 'in transit' : /hold/i.test(s) ? 'on the holds shelf' : s.toLowerCase();
const listBranches = (names) => names.slice(0, 3).map(shortBranch).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');

// Badge for one book. copies: from getCopies. home / second: { name } or undefined.
// holds: hold count, only needed when nothing is on shelf. Returns { colour: 'green'|'amber'|'red'|'grey', text, homeOn }.
export function describeCopies(copies, home, second, holds) {
  if (!copies.length) return { colour: 'grey', text: 'No physical copies listed', homeOn: false };
  const onShelf = [...new Set(copies.filter((c) => c.onShelf).map((c) => c.library))];
  if (home && onShelf.includes(home.name)) return { colour: 'green', text: `On shelf at ${shortBranch(home.name)}`, homeOn: true };

  const homeCopy = home && copies.find((c) => c.library === home.name);
  const homeNote = !home ? '' : homeCopy ? `${shortBranch(home.name)} copy ${friendlyStatus(homeCopy.status)}` : `not at ${shortBranch(home.name)}`;
  if (second && onShelf.includes(second.name)) return { colour: 'amber', text: sentence([homeNote, `on shelf at ${shortBranch(second.name)}`]), homeOn: false };
  if (onShelf.length) return { colour: 'amber', text: sentence([homeNote, `on shelf at ${listBranches(onShelf)}`]), homeOn: false };
  const holdsNote = holds === undefined || Number.isNaN(holds) ? '' : plural(holds, 'hold');
  return { colour: 'red', text: sentence([homeNote, `none on shelf (${plural(copies.length, 'copy', 'copies')})`, holdsNote]), homeOn: false };
}
