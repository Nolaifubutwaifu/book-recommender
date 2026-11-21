# Shelf Check for Australian Libraries (unofficial)

A Chrome extension for public library catalogues. It shows, on every search result, whether the book is on the shelf at **your** library right now.

| Network | Catalogue | Status |
|---|---|---|
| [Brisbane City Council Libraries](https://library-brisbane.ent.sirsidynix.net.au/client/en_AU/eLibCat/) | SirsiDynix | Tested |
| [Libraries Tasmania](https://librariestas.ent.sirsidynix.net.au/client/en_AU/library/) | SirsiDynix | Tested |
| [City of Melbourne Libraries](https://librarysearch.melbourne.vic.gov.au/) | Spydus | Tested |
| [Libraries ACT (Canberra)](https://librariesact.spydus.com/) | Spydus | Tested |
| [Gold Coast Libraries](https://librarycatalogue.goldcoast.qld.gov.au/client/en_AU/default/) | SirsiDynix | Added, not yet checked in a browser |

- Green: on shelf at your library.
- Amber: not on shelf at your library, but on shelf at another branch (your second library first).
- Red: no copy on shelf anywhere, with copy and hold counts.
- Grey: eBook or eAudiobook, no branch visit needed.

Above the results: "Only on shelf at my library" filter, a format filter, and a link that limits the whole search to books your library holds.

**Recommendations:** mark books with **Like** or **Not for me** (on search results and book pages), or import your Goodreads or StoryGraph export from the extension's options page. A "For you" panel (open on the catalogue home page, collapsed above search results) then lists your 10 best matches that are on a shelf at some Brisbane library right now (green or amber), best match first, each with a short reason. Books with every copy out are left out. Book data comes from [Open Library](https://openlibrary.org). Your taste profile is stored only in your browser; the titles and authors of books you liked are sent to Open Library to find similar books.

Not affiliated with Brisbane City Council. Uses the catalogue's public search feed and the same availability lookups its own pages make, at most 2 requests per second per open catalogue tab.

## Install (developer mode)

1. Download this repo (Code > Download ZIP) and unzip it, or `git clone` it.
2. In Chrome, open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension` folder.
4. Click the puzzle icon in the toolbar, pin **Shelf Check**, click it, choose your library network and your library.
   For recommendations, click "Taste profile and Goodreads / StoryGraph import" in the same menu.
5. Search the catalogue as usual.

Works in Chrome, Edge and Brave.

## Development

```bash
npm test                                    # parser tests against saved catalogue responses
npx playwright install chromium             # once, for the end-to-end test
npm run e2e                                 # loads the extension and checks a live search
node scripts/onshelf.mjs "H.P. Lovecraft" ASH   # what's on shelf at a branch (tas:HOBART, melbourne:CITY, ...)
```

- `extension/`: the extension (Manifest V3, plain JavaScript, no build step).
- `extension/lib/libraries.mjs`: supported networks (address, branches, "on shelf" rule).
- `extension/lib/catalogue.mjs`: SirsiDynix catalogue client and badge text, shared by the extension and the scripts.
- `extension/lib/spydus.mjs`: Spydus catalogue client.
- `extension/lib/taste.mjs`: taste profile, Goodreads and StoryGraph import.
- `extension/lib/recommend.mjs`: recommendation pipeline (Open Library + catalogue).
- `docs/catalogue-notes.md`: how the catalogue's data sources work.
- `ROADMAP.md`: what's next (natural-language search).
