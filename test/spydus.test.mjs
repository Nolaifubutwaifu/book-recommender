import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseResults, parseHoldings, isOnline, detailUrl } from '../extension/lib/spydus.mjs';
import { libraryById } from '../extension/lib/libraries.mjs';
import { describeCopies } from '../extension/lib/catalogue.mjs';

const fixture = (f) => readFile(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const melbourne = libraryById('melbourne');

test('parseResults reads Spydus result cards', async () => {
  const items = parseResults(await fixture('spydus-results-melbourne.html'));
  assert.deepEqual(items.map((i) => [i.title, i.format, i.catKey]), [
    ['11.22.63. [dvd]', 'Videos and DVDs', '643818'],
    ['11.22.63 : a novel', 'Book', '45505660'],
    ['1922', 'Book', '31915454'],
    ['After Buddhism : rethinking the Dharma for a secular age', 'Book', '431801'],
  ]);
});

test('parseHoldings reads the availability table with the network rule', async () => {
  const copies = parseHoldings(melbourne, await fixture('spydus-holdings-melbourne.html'));
  assert.deepEqual(copies, [
    { library: 'City Library', status: 'On loan - Due: 11 Dec 2026', onShelf: false },
    { library: 'North Melbourne Library', status: 'Available', onShelf: true },
  ]);
  const home = melbourne.branches.find((b) => b.name === 'City Library');
  assert.equal(describeCopies(copies, home).text, 'City copy on loan, on shelf at North Melbourne');
});

test('online formats and stable record links', () => {
  assert.ok(isOnline('eBook') && isOnline('eAudioBook') && isOnline('Streaming Video'));
  assert.ok(!isOnline('Book') && !isOnline('Videos and DVDs'));
  assert.equal(detailUrl(melbourne, '643818'), 'https://librarysearch.melbourne.vic.gov.au/cgi-bin/spydus.exe/ENQ/OPAC/BIBENQ?SETLVL=&IRN=643818');
});
