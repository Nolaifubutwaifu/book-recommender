// Usage: node scripts/onshelf.mjs "<search>" <BRANCH_CODE> [limit]
// Example: node scripts/onshelf.mjs "H.P. Lovecraft" ASH
// Prints titles from the search that are on the shelf at that branch right now.
import { readFile } from 'node:fs/promises';
import { search, getSession, getCopies, onShelfAt } from '../extension/lib/catalogue.mjs';

const [query, code, limit = '50'] = process.argv.slice(2);
const branches = JSON.parse(await readFile(new URL('../extension/lib/branches.json', import.meta.url), 'utf8'));
const branch = branches.find((b) => b.code === code?.toUpperCase());

if (!query || !branch) {
  console.error('Usage: node scripts/onshelf.mjs "<search>" <BRANCH_CODE> [limit]');
  console.error('Branch codes: ' + branches.map((b) => `${b.code} (${b.name})`).join(', '));
  process.exit(1);
}

const items = (await search(query, branch)).filter((i) => i.catKey).slice(0, Number(limit));
console.log(`${items.length} physical titles held at ${branch.name}. Checking shelves...\n`);

const session = await getSession();
let found = 0;
for (const item of items) {
  const n = onShelfAt(await getCopies(item.catKey, session), branch.name);
  if (n) {
    found++;
    console.log(`ON SHELF (${n})  ${item.title}  [${item.callNumber ?? 'no call number'}]`);
  }
  await new Promise((r) => setTimeout(r, 500)); // stay at or under 2 requests per second
}
console.log(`\n${found} of ${items.length} on shelf at ${branch.name} right now.`);
