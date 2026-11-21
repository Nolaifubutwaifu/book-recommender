// Client for Spydus catalogues (Civica): City of Melbourne, Libraries ACT.
// Same functions as catalogue.mjs, so the content script and recommendations can use either.
// Record id: the internal record number (IRN). It is stable; the numbers inside result-page links
// (".../BIBENQ/<set>/<irn>") contain a session set number and expire.

const UA = 'Mozilla/5.0 (book-recommender prototype)';
const exe = (lib) => `${lib.base}/cgi-bin/spydus.exe`;
const text = (html) =>
  html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();

// Formats from the result card icon ("Book", "Videos and DVDs", "eBook", "eAudioBook", "Streaming Video", ...).
export const isOnline = (format = '') => /^e[A-Z]|stream|online|digital/i.test(format);
const ONLINE_LOCATION = /^(eLibrary|Online Library)$/i;

export const detailUrl = (lib, irn) => `${exe(lib)}/ENQ/${lib.view}/BIBENQ?SETLVL=&IRN=${irn}`;
export const searchUrl = (lib, query) =>
  `${exe(lib)}/ENQ/${lib.view}/BIBENQ?${new URLSearchParams({ ENTRY: query, ENTRY_NAME: 'BS', ENTRY_TYPE: 'K', NRECS: '20' })}`;

// Result cards from a search results page. Cards show no author; the search query includes the surname instead.
// shortcut: regex over a known card layout; the content script reads the live page with querySelector instead.
export function parseResults(html) {
  return html.split('card-list-image"').slice(1).map((card) => {
    const format = card.match(/recfrmt-icon[^>]*title="([^"]+)"/)?.[1] ?? '';
    const irn = card.match(/\/XHLD\/[A-Z]+\/BIBENQ\/\d+\/(\d+)/)?.[1] ?? null;
    return {
      catKey: isOnline(format) ? null : irn,
      title: text(card.match(/class="card-title"[\s\S]*?<span>([\s\S]*?)<\/span>/)?.[1] ?? ''),
      author: null,
      format,
    };
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
