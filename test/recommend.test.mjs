import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSubjects, buildProfile, scoreCandidates, pickRecords, tierOf, recommend, subjectUrl } from '../extension/lib/recommend.mjs';

const doc = (key, title, author, authorKey, subjects) => ({ key, title, author, authorKey, subjects, cover: null });
const hillHouse = doc('/works/1', 'The Haunting of Hill House', 'Shirley Jackson', 'A1', ['haunted houses', 'horror tales', 'psychological fiction']);
const dracula = doc('/works/2', 'Dracula', 'Bram Stoker', 'A2', ['vampires', 'horror tales', 'gothic fiction']);
const seeds = [
  { item: { title: 'The Haunting of Hill House' }, doc: hillHouse },
  { item: { title: 'Dracula' }, doc: dracula },
];

test('cleanSubjects drops generic and non-content subjects', () => {
  assert.deepEqual(cleanSubjects(['Fiction', 'Horror tales', 'horror tales', 'nyt:hardcover-fiction=2021', 'Accessible book', 'Vampires', 'Fiction, horror', 'Horror', 'Fiction, general']), ['horror tales', 'vampires', 'horror']);
});

test('buildProfile weights subjects shared by several liked books', () => {
  const p = buildProfile(seeds);
  assert.equal(p.subjects.get('horror tales'), 2);
  assert.equal(p.topSubjects[0], 'horror tales');
  assert.deepEqual(p.topAuthors.sort(), ['A1', 'A2']);
});

test('scoreCandidates ranks similar books, excludes read ones, caps books per author', () => {
  const docs = [
    hillHouse, // a seed: excluded
    doc('/works/3', 'The Shining', 'Stephen King', 'K', ['haunted houses', 'horror tales', 'hotels']),
    doc('/works/4', 'Carrie', 'Stephen King', 'K', ['horror tales', 'telekinesis']),
    doc('/works/5', 'It', 'Stephen King', 'K', ['horror tales', 'clowns']),
    doc('/works/6', 'Gardening Basics', 'Some One', 'G', ['gardening']),
    doc('/works/7', 'We Have Always Lived in the Castle', 'Shirley Jackson', 'A1', ['sisters']),
    doc('/works/8', 'Dune', 'Frank Herbert', 'H', ['horror tales']), // already read
  ];
  const taste = [{ key: 'dune|herbert', signal: 'read' }];
  const out = scoreCandidates(buildProfile(seeds), seeds, docs, taste);
  const titles = out.map((c) => c.doc.title);
  assert.equal(titles[0], 'The Shining');
  assert.ok(!titles.includes('Gardening Basics'), 'no shared subjects, no liked author');
  assert.ok(!titles.includes('Dune'), 'already read');
  assert.ok(!titles.includes('The Haunting of Hill House'), 'already liked');
  assert.equal(titles.filter((t) => ['The Shining', 'Carrie', 'It'].includes(t)).length, 2, 'max 2 per author');
  assert.match(out[0].reason, /^Because you liked The Haunting of Hill House: horror tales, haunted houses$/);
  assert.equal(out.find((c) => c.doc.authorKey === 'A1').reason, 'More by Shirley Jackson, who wrote The Haunting of Hill House');
});

test('pickRecords keeps physical editions of the same book only', () => {
  const records = [
    { catKey: '1', title: 'The shining', author: 'King, Stephen, 1947- author.', format: 'Books' },
    { catKey: '2', title: 'The shining [dvd]', author: 'Kubrick, Stanley', format: 'DVD' },
    { catKey: '3', title: 'The shining : a novel', author: 'King, Stephen, author.', format: 'Large print' },
    { catKey: null, title: 'The Shining', author: 'King, Stephen', format: 'eBook' },
    { catKey: '4', title: 'Shining girls', author: 'Beukes, Lauren', format: 'Books' },
  ];
  assert.deepEqual(pickRecords({ title: 'The Shining', author: 'Stephen King' }, records).map((r) => r.catKey), ['1', '3']);
});

test('tierOf ranks home shelf, second shelf, home on loan, elsewhere, none', () => {
  const home = { name: 'Ashgrove Library' }, second = { name: 'Kenmore Library' };
  const c = (LIBRARY, SD_ITEM_STATUS) => ({ LIBRARY, SD_ITEM_STATUS });
  assert.equal(tierOf([c('Ashgrove Library', 'On Shelf in library')], home, second), 0);
  assert.equal(tierOf([c('Kenmore Library', 'On Shelf in library')], home, second), 1);
  assert.equal(tierOf([c('Ashgrove Library', 'Checked Out'), c('Inala Library', 'On Shelf in library')], home, second), 2);
  assert.equal(tierOf([c('Inala Library', 'On Shelf in library')], home, second), 3);
  assert.equal(tierOf([c('Inala Library', 'Checked Out')], home, second), 4);
});

test('recommend runs the whole pipeline with fake services', async () => {
  const ol = {
    seed: { docs: [{ key: '/works/1', title: 'The Haunting of Hill House', author_name: ['Shirley Jackson'], author_key: ['A1'], subject: ['Haunted houses', 'Horror tales'] }] },
    shining: { key: '/works/3', title: 'The Shining', author_name: ['Stephen King'], author_key: ['K'], subject: ['Haunted houses', 'Horror tales'] },
    misery: { key: '/works/9', title: 'Misery', author_name: ['Stephen King'], author_key: ['K'], subject: ['Horror tales'] },
  };
  const deps = {
    cached: (key, ttl, fn) => fn(),
    fetchJson: async (url) => (url.includes('title=') ? ol.seed : { docs: [ol.misery, ol.shining] }),
    searchCatalogue: async (q) => (q.startsWith('Misery') ? [{ catKey: '9', title: 'Misery', author: 'King, Stephen', format: 'Books' }] : q.startsWith('The Shining') ? [{ catKey: '3', title: 'The shining', author: 'King, Stephen', format: 'Books' }] : []),
    getCopies: async (k) => [{ LIBRARY: k === '9' ? 'Ashgrove Library' : 'Inala Library', SD_ITEM_STATUS: 'On Shelf in library' }],
  };
  const taste = [{ key: 'haunting of hill house|jackson', title: 'The Haunting of Hill House', author: 'Shirley Jackson', signal: 'liked', addedAt: '2024-01-01' }];
  const recs = await recommend({ taste, home: { name: 'Ashgrove Library' }, deps });
  // The Shining is more similar, but Misery is on the shelf at the home library, so it comes first.
  assert.deepEqual(recs.map((r) => [r.doc.title, r.tier, r.catKeys]), [['Misery', 0, ['9']], ['The Shining', 3, ['3']]]);
  assert.match(subjectUrl('horror tales'), /q=subject%3A%22horror\+tales%22\+language%3Aeng/);
});
