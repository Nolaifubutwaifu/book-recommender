// Every supported library network. `system` picks the catalogue client (catalogue.mjs for SirsiDynix Enterprise).
// To add a SirsiDynix network: its web address, its profile (the part after /client/en_AU/ in its URLs),
// its branches (codes from the "Library" filter on its search page) and its "on shelf" rule.
// Also add the web address to manifest.json (a test checks this).

export const LIBRARIES = [
  {
    id: 'bcc',
    name: 'Brisbane City Council Libraries',
    system: 'sirsi',
    base: 'https://library-brisbane.ent.sirsidynix.net.au',
    profile: 'eLibCat',
    onShelf: (status) => status.startsWith('On Shelf'), // "On Shelf in library", "Checked Out", "In Transit..."
    branches: [
      { code: 'ANN', name: 'Annerley Library' },
      { code: 'ASH', name: 'Ashgrove Library' },
      { code: 'BNO', name: 'Banyo Library' },
      { code: 'BRR', name: 'Bracken Ridge Library' },
      { code: 'BSQ', name: 'Brisbane Square Library' },
      { code: 'BUL', name: 'Bulimba Library' },
      { code: 'CRA', name: 'Carina Library' },
      { code: 'CNL', name: 'Carindale Library' },
      { code: 'CDE', name: 'Chermside Library' },
      { code: 'CPL', name: 'Coopers Plains Library' },
      { code: 'CDA', name: 'Corinda Library' },
      { code: 'EPK', name: 'Everton Park Library' },
      { code: 'FAI', name: 'Fairfield Library' },
      { code: 'GCY', name: 'Garden City Library (Westfield)' },
      { code: 'GNG', name: 'Grange Library' },
      { code: 'HAM', name: 'Hamilton Library' },
      { code: 'HPK', name: 'Holland Park Library' },
      { code: 'INA', name: 'Inala Library' },
      { code: 'IPY', name: 'Indooroopilly Library' },
      { code: 'KEN', name: 'Kenmore Library' },
      { code: 'MIT', name: 'Mitchelton Library' },
      { code: 'VAN', name: 'Mobile Library' },
      { code: 'MBG', name: 'Mt Coot-tha Botanic Gardens Library' },
      { code: 'MTG', name: 'Mt Gravatt Library' },
      { code: 'MTO', name: 'Mt Ommaney Library' },
      { code: 'NFM', name: 'New Farm Library' },
      { code: 'NDH', name: 'Nundah Library' },
      { code: 'POP', name: 'Pop-up Library' },
      { code: 'SGT', name: 'Sandgate Library' },
      { code: 'SCR', name: 'Stones Corner Library' },
      { code: 'SBK', name: 'Sunnybank Hills Library' },
      { code: 'TWG', name: 'Toowong Library' },
      { code: 'WND', name: 'West End Library' },
      { code: 'WYN', name: 'Wynnum Library' },
      { code: 'ZIL', name: 'Zillmere Library' },
    ],
  },
];

export const libraryById = (id) => LIBRARIES.find((l) => l.id === id);
export const libraryForUrl = (url) => LIBRARIES.find((l) => new URL(url).origin === new URL(l.base).origin);

// Home and second branch for one network, as { code, name } or undefined.
export async function branchSettings(lib) {
  const key = `branches:${lib.id}`;
  const s = await chrome.storage.sync.get({ [key]: null, homeBranch: '', secondBranch: '' });
  // homeBranch / secondBranch: settings saved before multi-library support, Brisbane only.
  const v = s[key] ?? (lib.id === 'bcc' ? { home: s.homeBranch, second: s.secondBranch } : { home: '', second: '' });
  const find = (code) => lib.branches.find((b) => b.code === code);
  return { home: find(v.home), second: find(v.second), codes: v };
}
