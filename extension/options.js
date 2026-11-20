import { importTaste, mergeTaste, loadTaste, saveTaste } from './lib/taste.mjs';

const $ = (id) => document.getElementById(id);
const msg = (text, error = false) => Object.assign($('msg'), { textContent: text, className: error ? 'error' : '' });

async function render() {
  const taste = await loadTaste();
  for (const signal of ['liked', 'disliked', 'read']) {
    const items = taste.filter((i) => i.signal === signal).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    $(`${signal}-n`).textContent = items.length;
    if (signal === 'read') continue;
    $(signal).replaceChildren(...items.map((item) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${item.title}${item.author ? `, ${item.author}` : ''}`;
      const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Remove' });
      remove.setAttribute('aria-label', `Remove ${item.title}`);
      remove.addEventListener('click', async () => {
        await saveTaste((await loadTaste()).filter((i) => i.key !== item.key));
        render();
      });
      li.append(label, remove);
      return li;
    }));
  }
}

$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { source, items, skipped } = importTaste(await file.text());
    await saveTaste(mergeTaste(await loadTaste(), items));
    const count = (s) => items.filter((i) => i.signal === s).length;
    const name = source === 'goodreads' ? 'Goodreads' : 'StoryGraph';
    msg(`Imported ${items.length} books from ${name}: ${count('liked')} liked, ${count('disliked')} not for you, ${count('read')} read. Skipped ${skipped} unread.`);
    render();
  } catch (err) {
    msg(err.message, true);
  }
  e.target.value = '';
});

$('clear').addEventListener('click', async () => {
  if (!confirm('Delete all liked, disliked and read books from Shelf Check? This cannot be undone.')) return;
  await saveTaste([]);
  msg('Taste profile deleted.');
  render();
});

render();
