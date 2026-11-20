// Shelf Check content script. On the catalogue it adds:
// - search results: availability badges, filters, like / not-for-me buttons, a "For you" panel
// - book detail pages: like / not-for-me buttons
// - home page: the "For you" panel
// Runs on the catalogue origin, so catalogue requests are same-origin and use the page's own token.
(async () => {
  const url = (path) => chrome.runtime.getURL(path);
  const [cat, taste, rec, cache, libs] = await Promise.all(
    ['catalogue', 'taste', 'recommend', 'cache', 'libraries'].map((m) => import(url(`lib/${m}.mjs`))),
  );
  const lib = libs.libraryForUrl(location.href);
  if (!lib) return;
  const resultsWrapper = document.getElementById('results_wrapper');
  const detail = document.getElementById('detail_biblio0');
  const isHome = new RegExp(`/client/[^/]+/${lib.profile}/?$`).test(location.pathname);
  if (!resultsWrapper && !detail && !isHome) return;

  const settings = await chrome.storage.sync.get({ onlyOnShelf: false, format: 'all' });
  const { home, second } = await libs.branchSettings(lib);
  const token = [...document.scripts].map((s) => s.textContent).join('\n').match(/__sdcsrf = "([^"]+)"/)?.[1];
  const session = { token, cookie: '' }; // same-origin fetch sends the page's cookies itself
  const tasteByKey = new Map((await taste.loadTaste()).map((i) => [i.key, i.signal]));

  // --- helpers ---------------------------------------------------------------
  const el = (tag, className, text) => Object.assign(document.createElement(tag), className ? { className } : {}, text ? { textContent: text } : {});
  const { shortBranch: short, plural } = cat;
  const detailUrl = (catKey) => cat.detailUrl(lib, catKey);

  // Cache keys carry the network id: catalogue keys are only unique within one network.
  const getCopies = (catKey) => cache.cached(`${lib.id}:copies:${catKey}`, 10 * cache.MINUTE, () => cache.catalogueGate(() => cat.getCopies(lib, catKey, session)));
  const getCounts = (catKey) => cache.cached(`${lib.id}:counts:${catKey}`, 10 * cache.MINUTE, () => cache.catalogueGate(() => cat.getCounts(lib, catKey, session)));

  function setBadge(badge, colour, text) {
    badge.className = `bsf-badge bsf-${colour}`;
    badge.textContent = text;
  }

  // Fills `badge` with availability for one book (one or more catalogue records). Returns true if on shelf at home.
  async function check(catKeys, badge) {
    const copies = (await Promise.all(catKeys.map(getCopies))).flat();
    let d = cat.describeCopies(copies, home, second);
    if (d.colour === 'red') d = cat.describeCopies(copies, home, second, (await getCounts(catKeys[0])).holds); // hold count only when needed
    setBadge(badge, d.colour, d.text);
    return d.homeOn;
  }

  // Like / not-for-me toggle buttons for one book.
  function tasteButtons(book) {
    const key = taste.bookKey(book.title, book.author);
    const wrap = el('span', 'bsf-taste');
    const buttons = [['liked', '♥ Like'], ['disliked', 'Not for me']].map(([signal, label]) => {
      const b = el('button', `bsf-taste-btn bsf-${signal}`, label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(tasteByKey.get(key) === signal));
      b.addEventListener('click', async () => {
        const next = tasteByKey.get(key) === signal ? null : signal;
        await taste.setSignal(book, next);
        next ? tasteByKey.set(key, next) : tasteByKey.delete(key);
        buttons.forEach((x, i) => x.setAttribute('aria-pressed', String(tasteByKey.get(key) === ['liked', 'disliked'][i])));
      });
      wrap.append(b);
      return b;
    });
    return wrap;
  }

  // Field names differ between networks (e.g. AUTHOR in Brisbane, INITIAL_AUTHOR_SRCH on the Gold Coast).
  const AUTHOR = '.displayElementText.AUTHOR, .displayElementText.INITIAL_AUTHOR_SRCH, .displayElementText.AUTHOR_OTHER_TALIS_FULL';
  const DETAIL_TITLE = '.displayElementText.TITLE, .displayElementText.INITIAL_TITLE_SRCH, .displayElementText.T245_DISPLAY';
  const bookFrom = (root, titleSel) => ({
    title: root.querySelector(titleSel)?.textContent.trim() ?? '',
    author: root.querySelector(AUTHOR)?.textContent.trim() ?? '',
  });

  // --- "For you" panel ---------------------------------------------------------
  function forYouPanel(open) {
    const panel = el('details', 'bsf-recs');
    panel.open = open;
    panel.innerHTML = `<summary>For you${home ? ` at ${short(home.name)}` : ''}</summary>
      <p class="bsf-recs-status" aria-live="polite"></p><ol class="bsf-recs-list"></ol>`;
    const status = panel.querySelector('.bsf-recs-status');
    const list = panel.querySelector('.bsf-recs-list');
    let started = false;

    const render = (recs) => {
      list.replaceChildren(...recs.map((r) => {
        const li = el('li', 'bsf-rec');
        if (r.doc.cover) li.append(Object.assign(el('img', 'bsf-rec-cover'), { src: `https://covers.openlibrary.org/b/id/${r.doc.cover}-S.jpg`, alt: '', loading: 'lazy' }));
        const body = el('div', 'bsf-rec-body');
        const link = Object.assign(el('a', 'bsf-rec-title', r.doc.title), { href: detailUrl(r.catKeys[0]) });
        const badge = el('div', 'bsf-badge bsf-grey', 'Checking shelves...');
        body.append(link, el('span', 'bsf-rec-author', ` by ${r.doc.author}`), badge, el('p', 'bsf-rec-reason', r.reason));
        li.append(body);
        check(r.catKeys, badge).catch(() => setBadge(badge, 'grey', 'Could not check availability'));
        return li;
      }));
    };

    async function run() {
      if (started) return;
      const likes = [...tasteByKey.values()].filter((s) => s === 'liked').length;
      if (!likes) {
        status.innerHTML = `Like books with <strong>♥ Like</strong> on any search result, or
          <a href="${url('options.html')}" target="_blank">import your Goodreads or StoryGraph export</a>, to get recommendations.`;
        return; // not started: reopening the panel after liking a book tries again
      }
      started = true;
      const deps = {
        cached: (key, ttl, fn) => cache.cached(`${lib.id}:${key}`, ttl, fn),
        fetchJson: (u) => cache.openLibraryGate(async () => {
          const res = await fetch(u);
          if (!res.ok) throw new Error(`Open Library: HTTP ${res.status}`);
          return res.json();
        }),
        searchCatalogue: (q) => cache.catalogueGate(() => cat.search(lib, q)),
        getCopies,
      };
      let shown = 0;
      try {
        const recs = await rec.recommend({
          taste: await taste.loadTaste(), deps,
          onProgress: (message, soFar) => {
            status.textContent = `${message} First run takes about a minute, later visits are quick.`;
            if (soFar.length !== shown) render(soFar), (shown = soFar.length);
          },
        });
        render(recs);
        status.textContent = recs.length
          ? `Your best matches that are on a shelf right now, based on ${plural(likes, 'book')} you liked. Use Like and Not for me on any book to improve these.`
          : 'None of your best matches are on a shelf right now. Like a few more books or try again later.';
      } catch (err) {
        console.warn('[Shelf Check]', err);
        status.textContent = 'Could not check the catalogue right now. Reload the page and try again.';
      }
    }
    panel.addEventListener('toggle', () => panel.open && run());
    if (open) run();
    return panel;
  }

  // --- home page -----------------------------------------------------------------
  if (isHome && !resultsWrapper) {
    document.getElementById('content')?.prepend(forYouPanel(true));
    return;
  }

  // --- detail page -----------------------------------------------------------------
  if (detail && !resultsWrapper) {
    const row = el('div', 'bsf-row');
    row.append(tasteButtons(bookFrom(detail, DETAIL_TITLE)));
    detail.prepend(row);
    return;
  }

  // --- search results --------------------------------------------------------------
  const cells = [...document.querySelectorAll('.results_cell')];
  if (!cells.length) return;

  const bar = el('div', 'bsf-bar');
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
  bar.after(forYouPanel(false)); // closed on results pages; builds only when opened

  const onlyBox = bar.querySelector('.bsf-only input');
  const formatSel = bar.querySelector('select');
  const status = bar.querySelector('.bsf-status');
  formatSel.value = settings.format;
  onlyBox.checked = settings.onlyOnShelf;

  if (home) {
    bar.querySelector('.bsf-only span').textContent = short(home.name);
    // The on-shelf filter only sees this page; this link narrows the whole search to the home branch.
    if (lib.branchFilter !== false && !decodeURIComponent(location.search.replace(/\+/g, ' ')).includes(`1:${home.code}\t`)) {
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

  const items = cells.map((cell) => {
    const catKey = cell.querySelector('input[id^="da"]')?.value.match(/SD_ILS:(\d+)$/)?.[1] ?? null;
    const badge = el('div', 'bsf-badge bsf-grey', 'Checking shelves...');
    const row = el('div', 'bsf-row');
    row.append(badge, tasteButtons(bookFrom(cell, '.displayDetailLink a')));
    cell.querySelector('.results_bio')?.prepend(row);
    if (!catKey) {
      const format = cell.querySelector('.displayElementText.FORMAT')?.textContent.trim() || 'Online';
      setBadge(badge, 'grey', `${format}: online, no branch visit needed`);
    }
    return { wrap: cell.closest('.cell_wrapper') ?? cell, catKey, badge, homeOn: false, done: !catKey };
  });

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
    status.textContent = [
      pending && `Checking ${pending} more...`,
      hidden && `${hidden} of ${items.length} hidden on this page.`,
      hidden === items.length && 'Try the next page or the branch search link.',
    ].filter(Boolean).join(' ');
  }

  apply(); // some networks (e.g. Tasmania) need no token; if lookups fail, each badge says so
  for (const item of items.filter((i) => i.catKey)) {
    check([item.catKey], item.badge)
      .then((homeOn) => (item.homeOn = homeOn))
      .catch((err) => {
        console.warn('[Shelf Check]', err);
        setBadge(item.badge, 'grey', 'Could not check availability');
      })
      .finally(() => {
        item.done = true;
        apply();
      });
  }
})();
