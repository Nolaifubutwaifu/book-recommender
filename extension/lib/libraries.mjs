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
  {
    id: 'goldcoast',
    name: 'Gold Coast Libraries',
    system: 'sirsi',
    base: 'https://librarycatalogue.goldcoast.qld.gov.au',
    profile: 'default',
    // shortcut: wording not confirmed (copy lookups are bot-protected, so only a real browser sees them);
    // assumed to match Brisbane until someone checks the Status column on a Gold Coast book page.
    onShelf: (status) => /^(on shelf|available)/i.test(status),
    branches: [
      { code: 'BROADBEACH', name: 'Broadbeach Library' },
      { code: 'BURL_HEADS', name: 'Burleigh Heads Library' },
      { code: 'BURL_WATER', name: 'Burleigh Waters Library' },
      { code: 'COOLANGATA', name: 'Coolangatta Library' },
      { code: 'ELANORA', name: 'Elanora Library' },
      { code: 'HELENSVALE', name: 'Helensvale Library' },
      { code: 'NERANG', name: 'Nerang Library' },
      { code: 'ORMEAU', name: 'Ormeau Community Lounge and Library' },
      { code: 'ROBINA', name: 'Robina Library' },
      { code: 'RUNAWAYBAY', name: 'Runaway Bay Library' },
      { code: 'SOUTHPORT', name: 'Southport Library' },
      { code: 'UP_COOMERA', name: 'Upper Coomera Library' },
      { code: 'MOBILE1', name: 'Mobile Library' },
    ],
  },
  {
    id: 'tas',
    name: 'Libraries Tasmania',
    system: 'sirsi',
    base: 'https://librariestas.ent.sirsidynix.net.au',
    profile: 'library',
    // Tasmania shows a shelf location ("Adult fiction") when a copy is in; anything else means it is not.
    onShelf: (status) => !/^(due|in transit|hold|missing|lost|on order|in process|withdrawn|damaged|repair|claim|checked out|on loan)/i.test(status),
    branchFilter: false, // no "Library" filter on its search page, so no branch search link
    branches: [
      { code: 'BEACONSFIELD', name: 'Beaconsfield Library' },
      { code: 'BICHENO', name: 'Bicheno Library' },
      { code: 'BOTHWELL', name: 'Bothwell Library' },
      { code: 'BRIDGEWATER', name: 'Bridgewater Library' },
      { code: 'BRIDPORT', name: 'Bridport Library' },
      { code: 'BURNIE', name: 'Burnie Library' },
      { code: 'CAMPBELL_TOWN', name: 'Campbell Town Library' },
      { code: 'CURRIE', name: 'Currie Library' },
      { code: 'CYGNET', name: 'Cygnet Library' },
      { code: 'DELORAINE', name: 'Deloraine Library' },
      { code: 'DEVONPORT', name: 'Devonport Library' },
      { code: 'EXETER', name: 'Exeter Library' },
      { code: 'GEEVESTON', name: 'Geeveston Library' },
      { code: 'GLENORCHY', name: 'Glenorchy Library' },
      { code: 'HOBART', name: 'Hobart Library' },
      { code: 'HUONVILLE', name: 'Huonville Library' },
      { code: 'KINGSTON', name: 'Kingston Library' },
      { code: 'GEORGE_TOWN', name: 'Kinimathatakinta/George Town Library' },
      { code: 'LATROBE', name: 'Latrobe Library' },
      { code: 'LAUNCESTON', name: 'Launceston Library' },
      { code: 'LILYDALE', name: 'Lilydale Library' },
      { code: 'LONGFORD', name: 'Longford Library' },
      { code: 'NEW_NORFOLK', name: 'New Norfolk Library' },
      { code: 'OATLANDS', name: 'Oatlands Library' },
      { code: 'ORFORD', name: 'Orford Library' },
      { code: 'PENGUIN', name: 'Penguin Library' },
      { code: 'QUEENSTOWN', name: 'Queenstown Library' },
      { code: 'RAVENSWOOD', name: 'Ravenswood Library' },
      { code: 'RINGAROOMA', name: 'Ringarooma Library' },
      { code: 'ROSEBERY', name: 'Rosebery Library' },
      { code: 'ROSNY', name: 'Rosny Library' },
      { code: 'SCOTTSDALE', name: 'Scottsdale Library' },
      { code: 'SHEFFIELD', name: 'Sheffield Library' },
      { code: 'SMITHTON', name: 'Smithton Library' },
      { code: 'SORELL', name: 'Sorell Library' },
      { code: 'ST_HELENS', name: 'St Helens Library' },
      { code: 'ST_MARYS', name: 'St Marys Library' },
      { code: 'STRAHAN', name: 'Strahan Library' },
      { code: 'SWANSEA', name: 'Swansea Library' },
      { code: 'TASMAN', name: 'Tasman Library' },
      { code: 'ULVERSTONE', name: 'Ulverstone Library' },
      { code: 'WESTBURY', name: 'Westbury Library' },
      { code: 'WHITEMARK', name: 'Whitemark Library' },
      { code: 'WYNYARD', name: 'Wynyard Library' },
      { code: 'ZEEHAN', name: 'Zeehan Library' },
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
