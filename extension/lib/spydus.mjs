// Client for Spydus catalogues (Civica): City of Melbourne, Libraries ACT.
// Same functions as catalogue.mjs, so the content script and recommendations can use either.
// Record id: the internal record number (IRN). It is stable; the numbers inside result-page links
// (".../BIBENQ/<set>/<irn>") contain a session set number and expire.

const UA = 'Mozilla/5.0 (book-recommender prototype)';
const exe = (lib) => `${lib.base}/cgi-bin/spydus.exe`;
const text = (html) =>
  html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();

// Format from the result card icon ("Book", "Videos and DVDs", "eBook", "eAudioBook", "Streaming Video", ...).
// Some online items carry it only in the title: "[eComic]", "[electronic resource]".
export const isOnline = (format = '', title = '') =>
  /^e[A-Z]|stream|online|digital/i.test(format) || /\[(e[A-Z][a-z]+|electronic resource)\]/i.test(title);
const ONLINE_LOCATION = /^(eLibrary|Online Library)$/i;

// Ids are IRNs ("643818", from result pages) or BRNs with a "b" prefix ("b637578", from the RSS feed).
export const detailUrl = (lib, id) =>
  `${exe(lib)}/ENQ/${lib.view}/BIBENQ?SETLVL=&${id.startsWith('b') ? `BRN=${id.slice(1)}` : `IRN=${id}`}`;
// Title + author search, for matching a recommended book. Plain keyword search is too loose here: results
// come sorted by title, so "cell king" lists dozens of unrelated books before Stephen King's "Cell".
export const findUrl = (lib, title, author) =>
  `${exe(lib)}/ENQ/${lib.view}/BIBENQ?${new URLSearchParams({
    ENTRY1: title, ENTRY1_NAME: 'TI', ENTRY1_TYPE: 'K', ENTRY2: author, ENTRY2_NAME: 'AU', ENTRY2_TYPE: 'K', NRECS: '20',
    ...(lib.rss ? { FMT: 'RSS', XSLT: 'rss.xsl' } : {}),
  })}`;
export const searchUrl = (lib, query) =>
  `${exe(lib)}/ENQ/${lib.view}/BIBENQ?${new URLSearchParams({ ENTRY: query, ENTRY_NAME: 'BS', ENTRY_TYPE: 'K', NRECS: '20' })}`;

// Result cards from a search results page. Cards show no author; the search query includes the surname instead.
// shortcut: regex over a known card layout; the content script reads the live page with querySelector instead.
export function parseResults(html) {
  return html.split('card-list-image"').slice(1).map((card) => {
    const format = card.match(/recfrmt-icon[^>]*title="([^"]+)"/)?.[1] ?? '';
    const irn = card.match(/\/XHLD\/[A-Z]+\/BIBENQ\/\d+\/(\d+)/)?.[1] ?? null;
    // The whole link text: search terms inside it are wrapped in highlight spans.
    const title = text(card.match(/class="card-title"[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '');
    return {
      catKey: isOnline(format, title) ? null : irn,
      title,
      author: null,
      format,
    };
  });
}

// RSS feed items (Melbourne has one, Canberra not). Titles carry the author: "At the mountains of madness / H.P. Lovecraft."
export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const full = text(text(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '')); // escaped HTML: decode, then strip tags
    const [title, author] = full.split(' / ');
    const brn = item.match(/BRN=(\d+)/)?.[1];
    return { catKey: brn && !isOnline('', full) ? `b${brn}` : null, title: title.trim(), author: author?.trim() ?? null, format: '' };
  });
}

// Holdings table: Location | Collection | Call number | Status/Desc. Online rows (eLibrary) are dropped.
export function parseHoldings(lib, html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(([, row]) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => text(cell)))
    .filter((cells) => cells.length >= 4 && !ONLINE_LOCATION.test(cells[0]))
    .map(([library, , , status]) => ({ library, status, onShelf: lib.onShelf(status) }));
}

const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Spydus request failed: HTTP ${res.status}`);
  return res.text();
};

export const search = async (lib, query) => parseResults(await get(searchUrl(lib, query)));

// Where there is a feed (Melbourne) it is used: smaller than a results page and it includes the author.
export const findBook = async (lib, title, author) => {
  const page = await get(findUrl(lib, title, author));
  return lib.rss ? parseRss(page) : parseResults(page);
};
export const getSession = async () => ({}); // Spydus needs no token

// holdingsPath: the "View availability" link from a result card in the current session, saves one request.
export async function getCopies(lib, irn, session, holdingsPath) {
  let path = holdingsPath;
  if (!path) {
    path = (await get(detailUrl(lib, irn))).match(/\/cgi-bin\/spydus\.exe\/XHLD\/[A-Z]+\/BIBENQ\/\d+\/\d+/)?.[0];
    if (!path) return [];
  }
  return parseHoldings(lib, await get(`${lib.base}${path}`));
}

// Spydus pages don't expose a hold count cheaply, so red badges show copies only.
export const getCounts = async () => ({ available: NaN, copies: NaN, holds: NaN });
