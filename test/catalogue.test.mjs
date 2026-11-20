import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRss, rssUrl, onShelfAt, parseCounts, describeCopies } from '../extension/lib/catalogue.mjs';

const fixture = (f) => readFile(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('parseRss reads physical books from a saved feed', async () => {
  const items = parseRss(await fixture('rss-lovecraft-ashgrove.xml'));
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    id: 'ent://SD_ILS/0/SD_ILS:903726',
    catKey: '903726',
    title: 'Children of Lovecraft',
    author: 'Datlow, Ellen, editor.',
    format: 'Books',
    isbn: '9781506700045',
    callNumber: 'AD-PBK CHI',
  });
});

test('rssUrl encodes the branch filter the way the catalogue expects', () => {
  assert.equal(
    rssUrl('H.P. Lovecraft', { code: 'ASH', name: 'Ashgrove Library' }),
    'https://library-brisbane.ent.sirsidynix.net.au/client/rss/hitlist/eLibCat/qu=H.P.+Lovecraft&qf=LIBRARY%09Library%091%3AASH%09Ashgrove%20Library',
  );
});

test('onShelfAt counts only on-shelf copies at the given branch', async () => {
  const copies = JSON.parse(await fixture('titleinfo-824506.json')).childRecords;
  assert.equal(onShelfAt(copies, 'Kenmore Library'), 1);
  assert.equal(onShelfAt(copies, 'Holland Park Library'), 0); // checked out
  assert.equal(onShelfAt(copies, 'Ashgrove Library'), 0); // no copy
});

test('parseCounts reads available, copy and hold counts', async () => {
  assert.deepEqual(parseCounts(await fixture('availability-824506.json')), { available: 3, copies: 4, holds: 0 });
});

test('describeCopies picks the badge colour and text', () => {
  const home = { name: 'Ashgrove Library' }, second = { name: 'Kenmore Library' };
  const c = (LIBRARY, SD_ITEM_STATUS) => ({ LIBRARY, SD_ITEM_STATUS });
  const shelf = 'On Shelf in library';
  const d = (copies, holds) => { const r = describeCopies(copies, home, second, holds); return `${r.colour}: ${r.text}`; };
  assert.equal(d([c('Ashgrove Library', shelf)]), 'green: On shelf at Ashgrove');
  assert.equal(describeCopies([c('Ashgrove Library', shelf)], home).homeOn, true);
  assert.equal(d([c('Inala Library', shelf), c('Kenmore Library', shelf)]), 'amber: Not at Ashgrove, on shelf at Kenmore');
  assert.equal(d([c('Ashgrove Library', 'Checked Out'), c('Inala Library', shelf)]), 'amber: Ashgrove copy on loan, on shelf at Inala');
  assert.equal(d(['A', 'B', 'C', 'D'].map((x) => c(`${x} Library`, shelf))), 'amber: Not at Ashgrove, on shelf at A, B, C +1 more');
  assert.equal(d([c('Ashgrove Library', 'In Transit from one library to another')], 2), 'red: Ashgrove copy in transit, none on shelf (1 copy), 2 holds');
  assert.equal(d([c('Inala Library', 'Checked Out'), c('Inala Library', 'Checked Out')]), 'red: Not at Ashgrove, none on shelf (2 copies)');
  assert.equal(d([]), 'grey: No physical copies listed');
  assert.equal(describeCopies([c('Inala Library', shelf)]).text, 'On shelf at Inala', 'no home branch set');
});
