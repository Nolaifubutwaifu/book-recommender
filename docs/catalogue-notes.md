# Catalogue notes (Phase 0 findings, 19 Nov 2026)

How the Brisbane City Council library catalogue exposes its data, and what the tool uses.
Code: [extension/lib/catalogue.mjs](../extension/lib/catalogue.mjs). Proof script: [scripts/onshelf.mjs](../scripts/onshelf.mjs).

Base URL: `https://library-brisbane.ent.sirsidynix.net.au`
Software: SirsiDynix Enterprise 5.x on Apache Tapestry 5.3.8, backed by SirsiDynix Symphony.

## Summary

| Need | Endpoint | Auth | Status |
|---|---|---|---|
| Search results as data | RSS (Atom) feed | None | Works |
| Filter by branch | `qf=` parameter on search and RSS | None | Works |
| Copies per branch + status | `lookuptitleinfo` POST | `sdcsrf` token header | Works |
| Copy, available and hold counts | `lookupavailability` POST | `sdcsrf` token header | Works |
| Branch list | Library facet on results page | None | Saved to `extension/lib/libraries.mjs` |

## 1. Search feed (RSS / Atom)

```
GET /client/rss/hitlist/eLibCat/qu=<query>[&qf=<facet>]
```

- `<query>` is URL encoded, spaces as `+`.
- Returns up to **500 entries**, no paging. "horror" (271k+ hits) returned exactly 500 in 2.2 s, 475 KB.
- "H.P. Lovecraft" returned 67 entries, matching the HTML page's "67 Results Found".
- Each `<entry>`:
  - `<id>`: `ent://SD_ILS/0/SD_ILS:<catKey>` for physical items. eBooks and eAudiobooks use other sources, e.g. `ent://ERC_884_1963/0/ERC_884_1963:OVERDRIVE:<uuid>` (Libby) and Borrowbox.
  - `<title>`: prefixed with `Title `.
  - `<content>`: HTML, escaped twice. Lines split by `<br/>`, each `Label` + non-breaking space + `Value`.
    Physical labels: `Author`, `Format` (Books, Regular print, Large print, DVD...), `Publication Date`, `Call Number`, `ISBN`, `Publisher`.
    E-resource labels: `Format:` (with colon), `Electronic Format:`, `Vendor`, `Cover Image URL`.
- Author field can be long (editors, illustrators, adapted works). Needs cleaning before matching.

## 2. Branch filter

Facet value format: `LIBRARY<TAB>Library<TAB>1:<CODE><TAB><Name>`, URL encoded:

```
qf=LIBRARY%09Library%091%3AASH%09Ashgrove+Library
```

- Works on both the HTML results page and the RSS feed. "H.P. Lovecraft" + Ashgrove: 3 results.
- Means "this branch **holds** a copy", not "on shelf now". Need copy lookups for that.
- Filtering by branch drops eBooks (they belong to no branch).
- `%20` instead of `+` for spaces in the name also works.
- Other facets follow the same pattern, e.g. `ITYPE%09Item+Type%091%3AAD-FICTION%09Adult+Fiction`.

## 3. Copies per branch (`lookuptitleinfo`)

What the detail page itself calls to fill its "Library | Item Type | Barcode | Call Number | Status" table.

```
POST /client/en_AU/eLibCat/search/detailnonmodal.detail.detailavailabilityaccordions:lookuptitleinfo/ent:$002f$002fSD_ILS$002f0$002fSD_ILS:<catKey>/ILS/0/true/true?d=ent%3A%2F%2FSD_ILS%2F0%2FSD_ILS%3A<catKey>%7E%7E0
Headers: X-Requested-With: XMLHttpRequest
         sdcsrf: <token>
```

Response:

```json
{"childRecords":[
  {"LIBRARY":"Kenmore Library","barcode":"34000096377072","SD_ITEM_STATUS":"On Shelf in library"},
  {"LIBRARY":"Holland Park Library","barcode":"34000096377668","SD_ITEM_STATUS":"Checked Out"}
], "fields":["LIBRARY","SD_ITEM_STATUS"]}
```

- `LIBRARY` is the branch **name**, not the code. Map via the branch list in `libraries.mjs`.
- Statuses seen so far: `On Shelf in library`, `Checked Out`, `In Transit from one library to another`. Others (on hold shelf, being processed) are likely but not yet seen. Treat only `On Shelf...` as available.
- One request per title. At 2 requests/second, 12 results (one page) take about 6 s. The overlay should check only the results on screen, not all 500.

## 4. Counts and holds (`lookupavailability`)

```
POST /client/en_AU/eLibCat/search/results.displaypanel.displaycell_0.detail.detailavailabilityaccordions.boundwithzone:lookupavailability/ent:$002f$002fSD_ILS$002f0$002fSD_ILS:<catKey>/ILS/0/true/LIBRARY$002cCALLNUMBER?&d=ent%3A%2F%2FSD_ILS%2F0%2FSD_ILS%3A<catKey>%7EILS%7E0&h=8
Body:    t:zoneid=detailboundWithDiv0
Headers: same as above
```

Response is a Tapestry script wrapper; the useful part is inside a string:
`updateWebServiceFields({"availableCount":"3","copyCount":"4","holdCount":"0","holdable":true, ...})`.
Used for the hold count on red badges. Parsed by `parseCounts()` in `extension/lib/catalogue.mjs`.

## 5. The `sdcsrf` token

- Every catalogue HTML page has `var __sdcsrf = "<uuid>";` in an inline script.
- The page adds it as an `sdcsrf` header to every non-GET request. Without it: `403 Invalid CSRF client token`.
- From a script: GET any results page, read the token, reuse it. No login and no cookies were needed in testing (the script still forwards any cookies it gets).
- In the extension: the content script runs on the catalogue page, so it can read the token from the page and make same-origin requests. No session handling needed.

## 6. Things deliberately not used

- **Symphony Web Services** (`https://bccl.sirsidynix.net.au/bccl_ilsws/rest/...`, client ID visible in page source). The catalogue page calls it from the browser for reshelving info. We don't call it directly: it is a separate backend service, and the catalogue's own endpoints above give everything we need.
- **NoveList Select** and **Syndetics**: licensed to the council. Credentials visible in page source are not ours to use.

## 7. Branches

35 public branches in `extension/lib/libraries.mjs` (33 libraries plus Mobile Library `VAN` and Pop-up Library `POP`).
Excluded: `LHQ` (Library HQ, not a public branch). Facet lists only show branches with hits, so the list came from a broad search ("the").

## 8. Open questions for Phase 1

- [ ] Full list of `SD_ITEM_STATUS` values (look at many titles).
- [ ] Whether the RSS feed supports sorting (`&rt=` or similar) for "newest first" recommendations.
- [ ] Catalogue terms of use: check before publishing anything.

## 9. Results page layout (used by the extension)

- 12 results per page. Paging links reload the whole page (no AJAX), so the content script runs again on every page.
- Each result: `.results_cell` inside `.cell_wrapper`. Hide the wrapper to hide a result.
- Record ID: hidden `input[id^="da"]` in each cell, value `ent://SD_ILS/0/SD_ILS:<catKey>` (physical) or an OverDrive/Borrowbox ID (online).
- Format text: `.displayElementText.FORMAT`.
- Text column: `.results_bio`. Results list container: `#results_wrapper`.
- The page itself shows "Available / Holds / Copies" totals for physical items but no branch detail, which is the gap the extension fills.
- No Content-Security-Policy `script-src` on the catalogue (only `frame-ancestors`).
