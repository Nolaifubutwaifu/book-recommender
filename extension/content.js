// Adds branch availability badges and filters to catalogue search results.
// Runs as a content script on the catalogue, so requests are same-origin and use the page's own token.
(async () => {
  const cells = [...document.querySelectorAll('.results_cell')];
  const resultsWrapper = document.getElementById('results_wrapper');
  if (!cells.length || !resultsWrapper) return; // not a results page

  const url = (path) => chrome.runtime.getURL(path);
  const cat = await import(url('lib/catalogue.mjs'));
  const branches = await (await fetch(url('lib/branches.json'))).json();
  const settings = await chrome.storage.sync.get({ homeBranch: '', secondBranch: '', onlyOnShelf: false, format: 'all' });
  const home = branches.find((b) => b.code === settings.homeBranch);
  const second = branches.find((b) => b.code === settings.secondBranch);
  const token = [...document.scripts].map((s) => s.textContent).join('\n').match(/__sdcsrf = "([^"]+)"/)?.[1];
  const session = { token, cookie: '' }; // same-origin fetch sends the page's cookies itself

  // --- helpers ---------------------------------------------------------------
  const short = (name) => name.replace(/ Library.*$/, ''); // "Garden City Library (Westfield)" -> "Garden City"
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const sentence = (parts) => {
    const s = parts.filter(Boolean).join(', ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const friendlyStatus = (s) =>
    /checked out/i.test(s) ? 'on loan' : /transit/i.test(s) ? 'in transit' : /hold/i.test(s) ? 'on the holds shelf' : s.toLowerCase();
  const listBranches = (names) =>
    names.slice(0, 3).map(short).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');

  // At most 2 catalogue requests per second: each call waits 500 ms after the previous one started.
  let gate = Promise.resolve();
  const throttled = (fn) => {
    const run = gate.then(fn);
    gate = gate.then(() => new Promise((r) => setTimeout(r, 500)));
    return run;
  };

  // shortcut: cache entries are never pruned (a few hundred bytes each), add cleanup if storage use grows.
  const TTL = 10 * 60 * 1000;
  async function cached(key, fn) {
    const hit = (await chrome.storage.local.get(key))[key];
    if (hit && Date.now() - hit.t < TTL) return hit.v;
    const v = await throttled(fn);
    await chrome.storage.local.set({ [key]: { t: Date.now(), v } });
    return v;
  }

  // --- toolbar ---------------------------------------------------------------
  const bar = document.createElement('div');
  bar.className = 'bsf-bar';
  bar.innerHTML = `
    <strong class="bsf-title">Shelf Check</strong>
    <label class="bsf-only"><input type="checkbox"> Only on shelf at<span></span></label>
    <select aria-label="Format filter">
      <option value="all">All formats</option>
      <option value="print">Print and physical only</option>
      <option value="ebook">eBooks and eAudiobooks only</option>
    </select>
    <a class="bsf-branch-search" hidden></a>
    <span class="bsf-status" aria-live="polite"></span>`;
  resultsWrapper.before(bar);

  const onlyBox = bar.querySelector('.bsf-only input');
  const formatSel = bar.querySelector('select');
  const status = bar.querySelector('.bsf-status');
  formatSel.value = settings.format;
  onlyBox.checked = settings.onlyOnShelf;

  if (home) {
    bar.querySelector('.bsf-only span').textContent = short(home.name);
    // The on-shelf filter only sees this page; this link narrows the whole search to the home branch.
    if (!decodeURIComponent(location.search.replace(/\+/g, ' ')).includes(`1:${home.code}\t`)) {
      const link = bar.querySelector('.bsf-branch-search');
      const u = new URL(location.href);
      u.searchParams.append('qf', `LIBRARY\tLibrary\t1:${home.code}\t${home.name}`);
      link.href = u.href;
      link.textContent = `Search only books held at ${short(home.name)}`;
      link.hidden = false;
    }
  } else {
    bar.querySelector('.bsf-only').remove();
    status.textContent = 'Pick your library: click the Shelf Check icon in the browser toolbar.';
  }

  onlyBox.addEventListener('change', () => {
    settings.onlyOnShelf = onlyBox.checked;
    chrome.storage.sync.set({ onlyOnShelf: onlyBox.checked });
    apply();
  });
  formatSel.addEventListener('change', () => {
    settings.format = formatSel.value;
    chrome.storage.sync.set({ format: formatSel.value });
    apply();
  });

  // --- results ---------------------------------------------------------------
  const items = cells.map((cell) => {
    const catKey = cell.querySelector('input[id^="da"]')?.value.match(/SD_ILS:(\d+)$/)?.[1] ?? null;
    const badge = document.createElement('div');
    badge.className = 'bsf-badge bsf-grey';
    cell.querySelector('.results_bio')?.prepend(badge);
    const item = { wrap: cell.closest('.cell_wrapper') ?? cell, catKey, badge, homeOn: false, done: !catKey };
    if (!catKey) {
      const format = cell.querySelector('.displayElementText.FORMAT')?.textContent.trim() || 'Online';
      setBadge(item, 'grey', `${format}: online, no branch visit needed`);
    } else {
      setBadge(item, 'grey', 'Checking shelves...');
    }
    return item;
  });

  function setBadge(item, colour, text) {
    item.badge.className = `bsf-badge bsf-${colour}`;
    item.badge.textContent = text;
  }

  async function check(item) {
    const copies = await cached(`copies:${item.catKey}`, () => cat.getCopies(item.catKey, session));
    if (!copies.length) return setBadge(item, 'grey', 'No physical copies listed');

    const onShelf = [...new Set(copies.filter((c) => c.SD_ITEM_STATUS.startsWith('On Shelf')).map((c) => c.LIBRARY))];
    item.homeOn = Boolean(home && onShelf.includes(home.name));
    if (item.homeOn) return setBadge(item, 'green', `On shelf at ${short(home.name)}`);

    const homeCopy = home && copies.find((c) => c.LIBRARY === home.name);
    const homeNote = !home ? '' : homeCopy ? `${short(home.name)} copy ${friendlyStatus(homeCopy.SD_ITEM_STATUS)}` : `not at ${short(home.name)}`;

    if (second && onShelf.includes(second.name)) return setBadge(item, 'amber', sentence([homeNote, `on shelf at ${short(second.name)}`]));
    if (onShelf.length) return setBadge(item, 'amber', sentence([homeNote, `on shelf at ${listBranches(onShelf)}`]));

    const n = await cached(`counts:${item.catKey}`, () => cat.getCounts(item.catKey, session));
    const holds = Number.isNaN(n.holds) ? '' : plural(n.holds, 'hold');
    setBadge(item, 'red', sentence([homeNote, `none on shelf (${plural(copies.length, 'copy', 'copies')})`, holds]));
  }

  function apply() {
    let hidden = 0;
    for (const i of items) {
      const isOnline = !i.catKey;
      const hide =
        (settings.format === 'print' && isOnline) ||
        (settings.format === 'ebook' && !isOnline) ||
        (settings.onlyOnShelf && home && i.done && !i.homeOn);
      i.wrap.style.display = hide ? 'none' : '';
      hidden += hide;
    }
    if (!home) return;
    const pending = items.filter((i) => !i.done).length;
    status.textContent = [pending && `Checking ${pending} more...`, hidden && `${hidden} of ${items.length} hidden on this page.`, hidden === items.length && 'Try the next page or the branch search link.']
      .filter(Boolean)
      .join(' ');
  }

  apply();
  if (!token) {
    status.textContent = 'Could not read the catalogue session. Reload the page.';
    return;
  }
  for (const item of items.filter((i) => i.catKey)) {
    check(item)
      .catch((err) => {
        console.warn('[Shelf Check]', err);
        setBadge(item, 'grey', 'Could not check availability');
      })
      .finally(() => {
        item.done = true;
        apply();
      });
  }
})();
