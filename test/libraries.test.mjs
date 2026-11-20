import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LIBRARIES, libraryForUrl } from '../extension/lib/libraries.mjs';

test('every network is complete and covered by manifest.json', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const scriptHosts = manifest.content_scripts[0].matches;
  const resourceHosts = manifest.web_accessible_resources[0].matches;
  for (const lib of LIBRARIES) {
    assert.ok(lib.id && lib.name && lib.profile && typeof lib.onShelf === 'function', `${lib.id}: missing fields`);
    assert.ok(lib.branches.length > 0 && lib.branches.every((b) => b.code && b.name), `${lib.id}: branches`);
    assert.equal(new Set(lib.branches.map((b) => b.code)).size, lib.branches.length, `${lib.id}: duplicate branch codes`);
    assert.ok(scriptHosts.includes(`${lib.base}/client/*`), `${lib.id}: add ${lib.base}/client/* to content_scripts.matches`);
    assert.ok(resourceHosts.includes(`${lib.base}/*`), `${lib.id}: add ${lib.base}/* to web_accessible_resources.matches`);
  }
  assert.equal(new Set(LIBRARIES.map((l) => l.id)).size, LIBRARIES.length, 'duplicate network ids');
});

test('libraryForUrl finds the network from a catalogue address', () => {
  assert.equal(libraryForUrl('https://library-brisbane.ent.sirsidynix.net.au/client/en_AU/eLibCat/search/results?qu=x')?.id, 'bcc');
  assert.equal(libraryForUrl('https://example.com/client/'), undefined);
});
