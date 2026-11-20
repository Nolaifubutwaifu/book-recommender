const branches = await (await fetch('lib/branches.json')).json();
const settings = await chrome.storage.sync.get({ homeBranch: '', secondBranch: '' });

for (const [id, key, empty] of [['home', 'homeBranch', 'Choose your library'], ['second', 'secondBranch', 'None']]) {
  const select = document.getElementById(id);
  select.add(new Option(empty, ''));
  for (const b of branches) select.add(new Option(b.name, b.code));
  select.value = settings[key];
  select.addEventListener('change', async () => {
    await chrome.storage.sync.set({ [key]: select.value });
    document.getElementById('saved').textContent = 'Saved.';
  });
}

document.getElementById('taste').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
