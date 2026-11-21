import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSubjects, buildProfile, scoreCandidates, pickRecords, recommend, subjectUrl } from '../extension/lib/recommend.mjs';

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
  const got = [{ catKey: '7', title: 'A game of thrones', author: 'Martin, George R. R., author.', format: 'Books' }];
  assert.equal(pickRecords({ title: 'A Game of Thrones', author: 'George R. R. Martin' }, got).length, 1, '"game" in a title is fine');
  const leGuin = [{ catKey: '8', title: 'A wizard of Earthsea', author: 'Le Guin, Ursula K., 1929-2018, author.', format: 'Books' }];
  assert.equal(pickRecords({ title: 'A Wizard of Earthsea', author: 'Ursula K. Le Guin' }, leGuin).length, 1, 'two-word surname');
});

test('recommend runs the whole pipeline with fake services', async () => {
  const ol = {
    seed: { docs: [{ key: '/works/1', title: 'The Haunting of Hill House', author_name: ['Shirley Jackson'], author_key: ['A1'], subject: ['Haunted houses', 'Horror tales'] }] },
    shining: { key: '/works/3', title: 'The Shining', author_name: ['Stephen King'], author_key: ['K'], subject: ['Haunted houses', 'Horror tales'] },
    misery: { key: '/works/9', title: 'Misery', author_name: ['Stephen King'], author_key: ['K'], subject: ['Horror tales'] },
    rebecca: { key: '/works/5', title: 'Rebecca', author_name: ['Daphne du Maurier'], author_key: ['D'], subject: ['Haunted houses', 'Horror tales'] },
  };
  const records = {
    Misery: { catKey: '9', title: 'Misery', author: 'King, Stephen', format: 'Books' },
    'The Shining': { catKey: '3', title: 'The shining', author: 'King, Stephen', format: 'Books' },
    Rebecca: { catKey: '5', title: 'Rebecca', author: 'Du Maurier, Daphne', format: 'Books' },
  };
  const status = { 9: 'On Shelf in library', 3: 'On Shelf in library', 5: 'Checked Out' };
  const deps = {
    cached: (key, ttl, fn) => fn(),
    fetchJson: async (url) => (url.includes('title=') ? ol.seed : { docs: [ol.misery, ol.rebecca, ol.shining] }),
    searchCatalogue: async (q) => Object.entries(records).filter(([t]) => q.startsWith(t)).map(([, r]) => r),
    getCopies: async (k) => [{ library: 'Inala Library', status: status[k], onShelf: status[k].startsWith('On Shelf') }],
  };
  const taste = [{ key: 'haunting of hill house|jackson', title: 'The Haunting of Hill House', author: 'Shirley Jackson', signal: 'liked', addedAt: '2024-01-01' }];
  const recs = await recommend({ taste, deps });
  // Best match first; Rebecca matches well but every copy is checked out, so it is left out.
  assert.deepEqual(recs.map((r) => [r.doc.title, r.catKeys]), [['The Shining', ['3']], ['Misery', ['9']]]);
  assert.match(subjectUrl('horror tales'), /q=subject%3A%22horror\+tales%22\+language%3Aeng/);
});

test('recommend fails loudly when availability lookups fail (e.g. expired catalogue session)', async () => {
  const deps = {
    cached: (key, ttl, fn) => fn(),
    fetchJson: async (url) => ({ docs: [{ key: url.includes('title=') ? '/works/1' : '/works/3', title: url.includes('title=') ? 'Dracula' : 'Carmilla', author_name: ['X Y'], author_key: ['A'], subject: ['Vampires'] }] }),
    searchCatalogue: async () => [{ catKey: '3', title: 'Carmilla', author: 'Y, X', format: 'Books' }],
    getCopies: async () => { throw new Error('Copy lookup for 3 failed: HTTP 403'); },
  };
  const taste = [{ key: 'dracula|y', title: 'Dracula', author: 'X Y', signal: 'liked', addedAt: '2024-01-01' }];
  await assert.rejects(recommend({ taste, deps }), /HTTP 403/);
});
