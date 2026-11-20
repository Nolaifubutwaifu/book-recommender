// Usage: node scripts/onshelf.mjs "<search>" [<network>:]<BRANCH_CODE> [limit]
// Example: node scripts/onshelf.mjs "H.P. Lovecraft" ASH          (Brisbane is the default network)
//          node scripts/onshelf.mjs "H.P. Lovecraft" goldcoast:BRO
// Prints titles from the search that are on the shelf at that branch right now.
import { search, getSession, getCopies, onShelfAt } from '../extension/lib/catalogue.mjs';
import { LIBRARIES, libraryById } from '../extension/lib/libraries.mjs';

const [query, where = '', limit = '50'] = process.argv.slice(2);
const [libId, code] = where.includes(':') ? where.split(':') : ['bcc', where];
const lib = libraryById(libId);
const branch = lib?.branches.find((b) => b.code === code.toUpperCase());

if (!query || !branch) {
  console.error('Usage: node scripts/onshelf.mjs "<search>" [<network>:]<BRANCH_CODE> [limit]');
  for (const l of LIBRARIES) console.error(`${l.id}: ${l.branches.map((b) => `${b.code} (${b.name})`).join(', ')}`);
  process.exit(1);
}

const items = (await search(lib, query, branch)).filter((i) => i.catKey).slice(0, Number(limit));
console.log(`${items.length} physical titles held at ${branch.name}. Checking shelves...\n`);

const session = await getSession(lib);
let found = 0;
for (const item of items) {
  const n = onShelfAt(await getCopies(lib, item.catKey, session), branch.name);
  if (n) {
    found++;
    console.log(`ON SHELF (${n})  ${item.title}  [${item.callNumber ?? 'no call number'}]`);
  }
  await new Promise((r) => setTimeout(r, 500)); // stay at or under 2 requests per second
}
console.log(`\n${found} of ${items.length} on shelf at ${branch.name} right now.`);
