# Book Recommender for Brisbane City Council Libraries: Roadmap

A browser extension that sits on top of the Brisbane library catalogue and answers one question fast:
**"What would I enjoy that is on the shelf at my library right now?"**

Catalogue: `https://library-brisbane.ent.sirsidynix.net.au/client/en_AU/eLibCat/`

---

## 1. The problem

The catalogue (SirsiDynix Enterprise) is built for finding a book you already know. It is weak at:

- Discovery: you can search by title, author, subject, but not by "books like X" or "slow-burn cosmic horror, short".
- Branch awareness: availability is hidden behind a click per result. You cannot easily see "available at Ashgrove now".
- Memory: it does not know what you have read or liked.

The tool fixes those three things and nothing else.

## 2. What the catalogue gives us (checked 19 Nov 2026, details in docs/catalogue-notes.md)

| Data | How | Notes |
|---|---|---|
| Search results as a feed | `GET /client/rss/hitlist/eLibCat/qu=<query>` (Atom XML) | Returns title, author, format, ISBN, cover URL, detail link. Up to 500 hits (`ps=500`). Best data source: structured, no HTML scraping. |
| ISBNs on results page | In the HTML of each result (`detailN_ISBN`) | Lets the overlay identify each book on the page. |
| Copies per branch | `lookuptitleinfo` POST per title, the same call the detail page makes | Returns branch name and status (On Shelf, Checked Out) per copy. Needs the page's `sdcsrf` token. |
| Copy and hold counts | `lookupavailability` POST per title | Available count, copy count, hold count. |
| Branch list | "Library" facet on results page | 35 public branches (incl. Mobile and Pop-up), each with a code, e.g. `ASH` = Ashgrove Library. Filter search by branch with `qf=`. |
| Covers | Syndetics and OverDrive image URLs already in results | Reuse, do not re-host. |
| Read-alikes | NoveList Select (EBSCO) is already embedded in the catalogue | The council already pays for "similar books". Our angle is different: personal taste plus branch plus on-shelf. Do not reuse NoveList credentials found in the page source: they are licensed to the council, not to us. |
| Formats | Physical books, eBooks and eAudiobooks (Libby) mixed in one result set | Filter by format in the overlay. |

There is no public API. Everything goes through the public pages and the RSS feed, so the tool must be polite (see section 8).

## 3. Product shape

**Main product: Chrome extension (Manifest V3), also loadable in Edge and Brave.**

Why an extension and not a separate website:
- It is the "overlay" you asked for: it improves the page people already use.
- It runs in the user's browser, so catalogue requests come from the user, not from a server hammering the catalogue.
- No accounts needed. Your taste profile lives in the browser.

**Small backend (only from Phase 3):** one serverless endpoint that holds the LLM API key and calls the recommendation sources. An API key can never ship inside an extension.

```
┌──────────────────────────── Browser ────────────────────────────┐
│  Catalogue page                                                  │
│   └─ content script: badges, filters, "for you" panel            │
│  Side panel: natural-language search, taste profile              │
│  chrome.storage.local: branch, liked/disliked books, cache       │
└──────────────┬──────────────────────────────┬───────────────────┘
               │ RSS + availability            │ /api/recommend
               ▼                               ▼
   library-brisbane.ent.sirsidynix     Backend (Vercel function)
                                        ├─ Claude (query parsing, ranking)
                                        ├─ Open Library API
                                        └─ Google Books API
```

## 4. Phases

### Phase 0: Data spike (done 19 Nov 2026)

Goal: prove we can get every piece of data before building UI.

- [x] Open DevTools on a results page, capture the `lookupavailability` request and response. Document: URL pattern, which IDs it needs, whether it returns per-branch copies and status (On shelf, On loan, In transit, Due date).
- [x] Confirm the URL parameter for the branch facet, so we can link to "this search, filtered to Ashgrove".
- [x] Confirm RSS feed limits: max results, response time, whether it accepts `qu=` with author and title fields.
- [x] Extract the full branch list (code, name) into `extension/lib/libraries.mjs`.
- [x] Write findings to `docs/catalogue-notes.md`.

**Done when:** a 30-line script takes a search term and a branch code and prints titles that are on shelf at that branch.
Result: `node scripts/onshelf.mjs "H.P. Lovecraft" ASH` does this.

### Phase 1: Branch-aware overlay, no AI (done 20 Nov 2026)

The useful core. Works with zero setup beyond picking a branch.

- [x] Extension skeleton: content script matching `https://library-brisbane.ent.sirsidynix.net.au/client/*`.
- [x] Settings popup: pick home branch, optional second branch.
- [x] Badge on every search result: `On shelf at Ashgrove`, `On loan, 2 holds`, `Not at your branch, on shelf at Kenmore`, `eBook on Libby`.
- [x] Toggle above results: "Only show books on shelf at my branch".
- [x] Toggle: hide eBooks/eAudiobooks, or show only them.
- [x] Cache availability for 10 minutes per item.
- [x] Rate limit: max 2 catalogue requests per second (one request starts every 500 ms).
- [x] Extra: "Search only books held at Ashgrove" link, because the on-shelf filter only sees the 12 results on the current page.
- [x] End-to-end test against the live catalogue: `npm run e2e`.

**Done when:** searching "Lovecraft" shows, without clicking, which results you can walk in and grab today.
Result: done. Not yet built: badges on the single-book detail page, Firefox.

### Phase 2: Taste profile and recommendations (built 20 Nov 2026, needs your verdict)

- [x] "Like" and "Not for me" buttons on every search result and book detail page.
- [x] Import from Goodreads (Library export CSV) and StoryGraph (CSV export), on the extension's options page. 4 to 5 stars = liked, 1 to 2 stars or did-not-finish = not for me, 3 or unrated = read (never recommended). To-read is skipped.
- [x] "For you at Ashgrove" panel: open on the catalogue home page, collapsed on search pages (only builds when opened), 10 books with cover, availability badge and reason.
- [x] Recommendation pipeline (no LLM), `extension/lib/recommend.mjs`:
  1. For each liked book (latest 30), look up subjects and author on Open Library.
  2. Profile: subjects weighted by how many liked books share them, plus liked authors.
  3. Candidates: popular English books for the top 6 subjects (exact `subject:"..."` search) and top 3 authors.
  4. Score (top 80 candidates): weighted shared subjects (damped for books with very long subject lists) plus a liked-author bonus. Max 2 books per author.
  5. Remove books already liked, disliked or read.
  6. Match each candidate in the catalogue (title + author, physical editions only, no DVDs or audio CDs).
  7. Keep only books with a copy on shelf somewhere right now (green or amber badge), in best-match order. Books with every copy out are dropped (changed 20 Nov 2026 after first real use: red recommendations were not useful).
- [x] One-line reason per book: "Because you liked Dracula: horror, horror tales" or "More by Shirley Jackson, who wrote The Haunting of Hill House".
- [x] Caches: Open Library lookups 7 to 30 days, catalogue matches 7 days, availability 10 minutes.
- [x] Tests: unit tests for import, matching and scoring; end-to-end test covers import, like button, panel, detail and home pages.

First build takes about 45 to 60 seconds (Open Library at 1 request per second, catalogue at 2 per second). Repeat visits use the cache.

Known limits:
- Disliked books are only excluded. They don't push similar books down yet.
- Open Library subjects are crowd-sourced and noisy. Some picks are loose (e.g. *World War Z* for a Dracula fan).
- Goodreads and StoryGraph column names were written from documentation and tested on sample files, not on a real export yet.

**Done when:** after importing 20+ books, at least 7 of 10 recommendations are books you would actually consider. **Not verified yet: needs a real import from you.**
On a 5-book horror sample: Shirley Jackson, Frankenstein, Dr Jekyll, Dorian Gray, The Historian, Interview with the Vampire, which reads as plausible.

### Phase 2b: Other Australian library networks (research 20 Nov 2026)

Research: checked which catalogue software each major city's public library runs, and tried Brisbane's data requests against it.

| City / network | Catalogue software | Brisbane's requests work? | Effort |
|---|---|---|---|
| Brisbane (BCC) | SirsiDynix Enterprise | Yes | Done |
| Gold Coast | SirsiDynix Enterprise (`librarycatalogue.goldcoast.qld.gov.au`, profile `default`) | Search feed and branch filter yes; copy lookup blocked from scripts by the site's bot protection, needs a browser test | Settings only |
| Tasmania, statewide (Libraries Tasmania) | SirsiDynix Enterprise (`librariestas.ent.sirsidynix.net.au`, profile `library`) | Yes. Statuses differ: "Due 4/08/25" = on loan, a shelf location = available | Settings plus own "on shelf" rule |
| SA, statewide (One Card, 130+ libraries, incl. Adelaide) | SirsiDynix Enterprise (`onecard.network/client/en_AU/<council>`) | Not tested: bot check in front of the site | Settings, needs a manual test |
| Melbourne, Canberra (Libraries ACT), 90+ AU/NZ libraries | Spydus (Civica) | Different software, same pattern: RSS search feed, per-record holdings table, no token needed | New adapter |
| Sydney (City of Sydney) | Softlink Aurora Montage | Not checked | New adapter |
| Darwin | OCLC WorldCat Discovery | Not checked | New adapter |
| Perth | Not identified | | |

Plan (built on branch `multi-library`, one commit per network, so any step can be dropped):
- [x] Per-library settings: web address, profile, branch list, "on shelf" rule, home and second branch per network (`extension/lib/libraries.mjs`).
- [ ] Gold Coast.
- [ ] Libraries Tasmania.
- [ ] SA One Card: only if it can be checked without getting past the bot check automatically.
- [ ] Spydus adapter: City of Melbourne, then Libraries ACT.
- [ ] Later: Sydney (Montage), Darwin (WorldCat), Perth.

The recommendation pipeline needs no changes: it only receives "search" and "get copies" functions, so each network plugs in its own.

### Phase 3: Natural-language search with an LLM (1 to 2 weeks)

- [ ] Side panel with one input: "short, creepy, set in the sea, nothing too gory".
- [ ] Backend endpoint `POST /api/recommend` (Vercel function).
- [ ] Pipeline:
  1. Claude turns the query plus your taste profile into 30 candidate titles with authors, and structured filters (format, length, fiction/non-fiction, audience).
  2. The extension checks every candidate against the catalogue.
  3. Only books that exist in the catalogue are shown. This blocks hallucinated titles, because the catalogue is the source of truth.
  4. Claude re-ranks the survivors and writes a one-line reason per book.
- [ ] Model: Claude Haiku 5.5 for both steps (fast, cheap). Confirm current pricing before launch.
- [ ] Limits: 20 searches per user per day, enforced by an anonymous install ID.
- [ ] Follow-ups in the same panel: "more like the second one", "only on shelf at Kenmore".

**Done when:** a vague natural-language query returns 5+ real, available books in under 10 seconds.

### Phase 4: Portfolio polish (1 week)

- [ ] Landing page with a 30-second demo video (before vs after on the same search).
- [ ] README: problem, screenshots, architecture diagram, how the anti-hallucination step works.
- [ ] Privacy policy (needed for the Chrome Web Store): what is stored, where, that nothing personal leaves the browser except the query text sent to the LLM.
- [ ] Chrome Web Store listing (one-off USD 5 developer fee).
- [ ] Basic usage numbers: installs, searches per day. No personal data.

### Phase 5: Council pitch (optional)

- [ ] Run it yourself for a month, collect 5 to 10 users (friends, volleyball club, uni clubs).
- [ ] One-page pitch: problem, demo, usage numbers, cost to run, privacy story.
- [ ] Contact: Brisbane City Council Libraries digital services team. Frame it as "branch-aware discovery on top of your existing SirsiDynix and NoveList setup", not as a replacement.
- [ ] Be ready for: accessibility (WCAG 2.2 AA), data hosting in Australia, and SirsiDynix integration questions. A council would most likely build it as a catalogue customisation or ask SirsiDynix, not install your extension.

## 5. Feature list

Priority: **P0** = MVP, **P1** = makes it good, **P2** = nice to have.

| Feature | Priority | Phase |
|---|---|---|
| Home branch setting | P0 | 1 |
| Availability badge per result | P0 | 1 |
| "On shelf at my branch only" filter | P0 | 1 |
| Format filter (print / eBook / audio) | P0 | 1 |
| Like / dislike buttons | P1 | 2 |
| Goodreads and StoryGraph CSV import | P1 | 2 |
| "For you at my branch" panel | P1 | 2 |
| Reason shown per recommendation | P1 | 2 |
| Natural-language search | P1 | 3 |
| Conversational follow-ups | P2 | 3 |
| Want-to-read list with alert when a book is on shelf at your branch | P2 | later |
| "Next in series" detection, shows if the next book is available | P2 | later |
| Multi-branch trip planner: "these 4 books are all at Indooroopilly" | P2 | later |
| One-click "Place hold" for recommendations (uses the catalogue's own hold button, user is logged in) | P2 | later |
| Mood / length / pace filters (from Open Library and LLM tags) | P2 | later |
| Firefox version | P2 | later |
| Shareable lists ("my 10 cosmic horror picks at Brisbane libraries") | P2 | later |

## 6. Tech stack

| Part | Choice | Why |
|---|---|---|
| Extension | Plain JavaScript, Manifest V3, no build step | Phase 1 is small enough to load straight from the folder. Revisit TypeScript or [WXT](https://wxt.dev) if Phase 2 grows or Firefox support is needed. |
| Overlay UI | Plain DOM + small CSS file in Phase 1, Preact if it grows | The overlay is a few badges and toggles. No need for a big framework. |
| Storage | `chrome.storage.local` (taste, caches), `chrome.storage.sync` (branch settings) | No accounts, no database, private by default. |
| Backend | One Vercel function (Node.js) | Only needed for the LLM key and rate limiting. |
| LLM | Claude Haiku 5.5 via AI SDK | Fast and cheap enough for per-search calls. |
| Book data | Open Library API (free, no key), Google Books API (free tier, key) | Subjects, authors, descriptions, edition ISBNs. |
| Tests | Node's built-in test runner, Playwright for end-to-end | Parser tests against saved catalogue samples (`npm test`), real extension against the live catalogue (`npm run e2e`). |

Book sources that are **not** available, so do not plan around them:
- Goodreads API: closed to new developers since December 2020. CSV export still works.
- StoryGraph: no public API. CSV export works.
- Hardcover has a public GraphQL API (beta): worth a look in Phase 2 as a third source.

## 7. Data model (browser storage)

```ts
type Settings = {
  homeBranch: string;        // branch code, e.g. "ASH"
  secondBranch?: string;
  formats: ("print" | "ebook" | "eaudio")[];
};

type TasteItem = {
  title: string;
  author: string;
  isbn?: string;
  openLibraryWorkId?: string; // e.g. "OL45883W", links all editions
  signal: "liked" | "disliked" | "read";
  source: "button" | "goodreads" | "storygraph";
  addedAt: string;            // ISO date
};

type CatalogueMatch = {
  key: string;                // normalised "title|author"
  catalogueIds: string[];     // ent:// IDs, one per edition/format
  detailUrl: string;
  checkedAt: string;          // re-check after 7 days
};

type Availability = {
  catalogueId: string;
  branches: { code: string; onShelf: number; total: number }[];
  holds: number;
  checkedAt: string;          // re-check after 10 minutes
};
```

Matching rule: match on normalised title + author, not ISBN alone. The library often holds a different edition from the one on Goodreads, so ISBN-only matching misses many books. Use Open Library work IDs to collect all edition ISBNs as a second check.

## 8. Rules and risks

| Risk | Mitigation |
|---|---|
| Overloading the catalogue | Rate limit (2 req/s), caching, requests only triggered by the user's own browsing. No bulk crawling of the full collection. |
| Catalogue markup changes | Prefer the RSS feed over HTML scraping. Keep saved HTML samples and parser tests, so breakage is caught in one test run. |
| Terms of use | Read the BCC library website and catalogue terms before publishing the extension. If unclear, email the library before the Web Store launch. |
| LLM invents books | Never show a title that was not found in the catalogue. |
| LLM cost abuse | Backend rate limit per install ID, daily global spending cap. |
| Privacy | Taste data stays in the browser. Only the query text and a short taste summary go to the backend. No library card number or login data is ever touched. |
| Using the council's licensed services | Do not call NoveList or Syndetics with the council's credentials. Displaying what the catalogue page itself already shows is fine. |
| Trademark | Do not use the council logo or imply it is official. Name it something neutral. |

## 9. Open decisions

1. **Name.** Needs to be neutral (not "BCC Library Plus"). Shortlist later.
2. **Phase 3 hosting.** Vercel function is the default. Supabase Edge Function also works if you want to reuse your Klubbies setup.
3. **eBooks.** Include Libby titles in recommendations, or physical books only? Recommendation: include, but filter by default to print since the branch angle only matters for physical books.
4. **Build order.** Phase 1 alone is already a useful, shippable tool. Ship it to the Web Store before starting the AI work, so the portfolio has something live early.

## 10. Timeline summary

| Phase | Effort | Output |
|---|---|---|
| 0. Data spike | 1 to 2 days | `catalogue-notes.md`, proof script |
| 1. Branch overlay | 1 to 2 weeks | Installable extension, useful on its own |
| 2. Taste + recs | 2 weeks | "For you at my branch" panel |
| 3. Natural language | 1 to 2 weeks | Side panel AI search |
| 4. Polish | 1 week | Web Store listing, landing page, demo video |
| 5. Pitch | ongoing | One-pager for the council |

Total: roughly 6 to 8 weeks of part-time work to a polished portfolio piece.
