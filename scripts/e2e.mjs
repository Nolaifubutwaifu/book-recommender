// End-to-end check of the real extension against the live catalogue.
// Usage: npm run e2e   (first time: npx playwright install chromium)
// Loads extension/ into Playwright's Chromium, picks Ashgrove + Kenmore in the popup,
// then checks badges, the on-shelf filter and the branch search link on a real search.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ext = fileURLToPath(new URL('../extension', import.meta.url));
// Unpacked extension IDs are derived from the folder path.
const id = [...createHash('sha256').update(ext).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join('');
const SEARCH = 'https://library-brisbane.ent.sirsidynix.net.au/client/en_AU/eLibCat/search/results?qu=H.P.+Lovecraft&te=';

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'shelf-check-')), {
  channel: 'chromium',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  failed ||= !ok;
};

try {
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.selectOption('#home', 'ASH');
  await popup.selectOption('#second', 'KEN');
  await popup.waitForSelector('text=Saved.');
  check((await popup.$$eval('#home option', (o) => o.length)) === 36, 'popup lists 35 branches');

  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.setInputFiles('#file', fileURLToPath(new URL('../test/fixtures/goodreads-sample.csv', import.meta.url)));
  await options.waitForSelector('#msg:not(:empty)');
  check((await options.innerText('#msg')).startsWith('Imported 5 books from Goodreads: 4 liked, 1 not for you'), 'Goodreads import');

  const page = await ctx.newPage();
  const settle = async () => {
    await page.waitForSelector('.bsf-bar', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.bsf-status')?.textContent.includes('Checking'), null, { timeout: 90000 });
    const badges = await page.$$eval('.bsf-badge', (els) => els.map((e) => [e.className.split(' ')[1].slice(4), e.textContent]));
    for (const [colour, text] of badges) console.log(`      ${colour.padEnd(5)} ${text}`);
    return badges;
  };

  await page.goto(SEARCH);
  let badges = await settle();
  check(badges.length === 12, 'every result on the page has a badge');
  check(badges.some(([c]) => c !== 'grey'), 'physical books get an availability badge');
  check(!badges.some(([, t]) => t.includes('Could not')), 'no failed lookups');

  const like = page.locator('.results_cell .bsf-liked').nth(1);
  await like.click();
  check((await like.getAttribute('aria-pressed')) === 'true', 'like button toggles on');
  await options.reload();
  check((await options.innerText('#liked-n')) === '5', 'liked book appears in the taste profile');

  await page.click('.bsf-recs summary');
  const t0 = Date.now();
  await page.waitForFunction(() => /^Based on/.test(document.querySelector('.bsf-recs-status')?.textContent ?? ''), null, { timeout: 240000 });
  await page.waitForFunction(() => ![...document.querySelectorAll('.bsf-rec .bsf-badge')].some((b) => b.textContent.startsWith('Checking')), null, { timeout: 60000 });
  const recs = await page.$$eval('.bsf-rec', (els) => els.map((e) => `${e.querySelector('.bsf-rec-title').textContent} | ${e.querySelector('.bsf-badge').textContent} | ${e.querySelector('.bsf-rec-reason').textContent}`));
  recs.forEach((r) => console.log(`      ${r}`));
  check(recs.length >= 5, `"For you" panel shows ${recs.length} recommendations (${Math.round((Date.now() - t0) / 1000)} s)`);
  await page.screenshot({ path: join(tmpdir(), 'shelf-check-recs.png'), fullPage: false });

  await page.check('.bsf-only input');
  const visible = await page.$$eval('.cell_wrapper', (w) => w.filter((x) => x.querySelector('.results_cell') && x.style.display !== 'none').length);
  const greens = badges.filter(([c]) => c === 'green').length;
  check(visible === greens, `"only on shelf" leaves ${greens} green result(s) visible`);
  await page.uncheck('.bsf-only input');

  await page.click('.bsf-branch-search');
  await page.waitForLoadState('load');
  badges = await settle();
  check(page.url().includes('1%3AASH'), 'branch search link adds the Ashgrove filter');
  check(badges.length > 0 && badges.every(([c]) => c !== 'grey'), 'branch search shows only physical books');

  await page.goto('https://library-brisbane.ent.sirsidynix.net.au/client/en_AU/eLibCat/search/detailnonmodal/ent:$002f$002fSD_ILS$002f0$002fSD_ILS:824506/one');
  await page.waitForSelector('#detail_biblio0 .bsf-liked', { timeout: 20000 });
  check(true, 'detail page has like buttons');

  await page.goto('https://library-brisbane.ent.sirsidynix.net.au/client/en_AU/eLibCat/');
  await page.waitForSelector('.bsf-recs[open] .bsf-rec', { timeout: 30000 });
  check(true, 'home page shows the open "For you" panel (from cache)');
} finally {
  await ctx.close();
}
process.exit(failed ? 1 : 0);
