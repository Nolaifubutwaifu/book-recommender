import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRss, rssUrl, onShelfAt } from '../src/catalogue.mjs';

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
