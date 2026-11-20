import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normTitle, surname, bookKey, parseCsv, importTaste, mergeTaste } from '../extension/lib/taste.mjs';

test('normTitle drops articles, subtitles, series and punctuation', () => {
  assert.equal(normTitle('The Call of Cthulhu: and Other Weird Stories'), 'call of cthulhu');
  assert.equal(normTitle('The Colour of Magic (Discworld, #1)'), 'colour of magic');
  assert.equal(normTitle('Color out of space [dvd].'), 'color out of space');
  assert.equal(normTitle('Café & Crêpes'), 'cafe and crepes');
});

test('surname handles catalogue, Open Library and suffix formats', () => {
  assert.equal(surname('Lovecraft, H. P. (Howard Phillips), 1890-1937, author.'), 'lovecraft');
  assert.equal(surname('H.P. Lovecraft'), 'lovecraft');
  assert.equal(surname('Kurt Vonnegut Jr.'), 'vonnegut');
  assert.equal(surname(null), '');
  assert.equal(bookKey('The Shining', 'Stephen King'), bookKey('Shining', 'King, Stephen, 1947- author.'));
});

test('parseCsv handles quotes, commas and newlines in fields', () => {
  const rows = parseCsv('﻿Title,Notes\r\n"A, B","say ""hi""\nthere"\r\nC,\r\n');
  assert.deepEqual(rows, [{ Title: 'A, B', Notes: 'say "hi"\nthere' }, { Title: 'C', Notes: '' }]);
});

const GOODREADS =
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies\n' +
  '1,"The Haunting of Hill House","Shirley Jackson","Jackson, Shirley",,"=""0143039989""","=""9780143039983""",5,4.0,Penguin,Paperback,182,2006,1959,2024/03/01,2024/02/01,,,read,,,,1,0\n' +
  '2,"Twilight (Twilight, #1)","Stephenie Meyer","Meyer, Stephenie",,"","",1,3.6,,,,,,,2023/01/01,,,read,,,,1,0\n' +
  '3,"Dune","Frank Herbert","Herbert, Frank",,"","",0,4.2,,,,,,,2023/01/01,,,read,,,,1,0\n' +
  '4,"Piranesi","Susanna Clarke","Clarke, Susanna",,"","",0,4.2,,,,,,,2023/01/01,to-read,,to-read,,,,0,0\n';

test('importTaste maps a Goodreads export', () => {
  const { source, items, skipped } = importTaste(GOODREADS);
  assert.equal(source, 'goodreads');
  assert.equal(skipped, 1); // to-read
  assert.deepEqual(items.map((i) => [i.title, i.signal]), [
    ['The Haunting of Hill House', 'liked'],
    ['Twilight (Twilight, #1)', 'disliked'],
    ['Dune', 'read'],
  ]);
  assert.equal(items[0].isbn, '9780143039983');
  assert.equal(items[0].addedAt, '2024-03-01');
  assert.equal(items[0].key, 'haunting of hill house|jackson');
});

const STORYGRAPH =
  'Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?\n' +
  'Mexican Gothic,"Silvia Moreno-Garcia, Someone Else",,9780525620785,hardcover,read,2024/01/02,2024/01/20,,1,,,,,,,,4.25,,,,,No\n' +
  'Some Slog,An Author,,,paperback,did-not-finish,2024/01/02,,,,,,,,,,,,,,,,No\n' +
  'Later,An Author,,,paperback,to-read,2024/01/02,,,,,,,,,,,,,,,,No\n';

test('importTaste maps a StoryGraph export', () => {
  const { source, items, skipped } = importTaste(STORYGRAPH);
  assert.equal(source, 'storygraph');
  assert.equal(skipped, 1);
  assert.deepEqual(items.map((i) => [i.title, i.author, i.signal]), [
    ['Mexican Gothic', 'Silvia Moreno-Garcia', 'liked'],
    ['Some Slog', 'An Author', 'disliked'],
  ]);
});

test('importTaste rejects other CSVs', () => {
  assert.throws(() => importTaste('a,b\n1,2\n'), /Goodreads or StoryGraph/);
});

test('mergeTaste keeps button choices over imports', () => {
  const existing = [{ key: 'dune|herbert', signal: 'disliked', source: 'button' }, { key: 'it|king', signal: 'read', source: 'goodreads' }];
  const incoming = [{ key: 'dune|herbert', signal: 'liked', source: 'goodreads' }, { key: 'it|king', signal: 'liked', source: 'goodreads' }];
  assert.deepEqual(mergeTaste(existing, incoming).map((i) => i.signal), ['disliked', 'liked']);
});
