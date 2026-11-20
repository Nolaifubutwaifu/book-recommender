import { LIBRARIES, libraryById, branchSettings } from './lib/libraries.mjs';

const $ = (id) => document.getElementById(id);
const { popupLibrary } = await chrome.storage.sync.get({ popupLibrary: 'bcc' });

for (const l of LIBRARIES) $('library').add(new Option(l.name, l.id));
$('library').value = libraryById(popupLibrary) ? popupLibrary : 'bcc';

// Fills the branch lists for the chosen network with its saved choices.
async function showBranches() {
  const lib = libraryById($('library').value);
  const { codes } = await branchSettings(lib);
  for (const [id, empty] of [['home', 'Choose your library'], ['second', 'None']]) {
    $(id).replaceChildren(new Option(empty, ''), ...lib.branches.map((b) => new Option(b.name, b.code)));
    $(id).value = codes[id];
  }
}

const saved = () => ($('saved').textContent = 'Saved.');
$('library').addEventListener('change', async () => {
  await chrome.storage.sync.set({ popupLibrary: $('library').value });
  await showBranches();
});
for (const id of ['home', 'second']) {
  $(id).addEventListener('change', async () => {
    await chrome.storage.sync.set({ [`branches:${$('library').value}`]: { home: $('home').value, second: $('second').value } });
    saved();
  });
}
$('taste').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
await showBranches();
