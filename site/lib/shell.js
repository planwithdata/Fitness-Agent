const paths = {
  today: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  nutrition: '<path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18m11-18c-2 2-3 5-3 9h4m0-9v18"/>',
  workout: '<path d="m6 7 11 11M4 11l7-7m2 16 7-7M2 9l7-7m6 20 7-7"/>',
  planner: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-12 5 2 2 4-4"/>',
  spending: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18m0 3h-5a2 2 0 1 0 0 4h5"/>',
  coach: '<path d="M12 2 14.8 9.2 22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Zm7 1v4m-2-2h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m10 2-.7 2.5-2 .9L5 4.3 2.8 6.5l1.1 2.3-.9 2-2.5.7v3l2.5.7.9 2-1.1 2.3L5 21.7l2.3-1.1 2 .9.7 2.5h3l.7-2.5 2-.9 2.3 1.1 2.2-2.2-1.1-2.3.9-2 2.5-.7v-3l-2.5-.7-.9-2 1.1-2.3L18 4.3l-2.3 1.1-2-.9L13 2z" transform="translate(1 0) scale(.93)"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4m-4 4v2"/>',
  fire: '<path d="M12 22a7 7 0 0 0 7-7c0-3-1-5-3-7 0 3-2 4-2 4 0-4-2-8-5-10 1 4-1 6-2 8a8 8 0 0 0-2 5 7 7 0 0 0 7 7Z"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-8z"/>',
  basket: '<path d="M3 9h18l-2 11H5L3 9zm4 0 5-6 5 6m-8 4 1 3m5-3-1 3"/>',
  edit: '<path d="m14 5 5 5m-14 4L16 3l5 5L10 19l-6 1z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3m4 0-1 15H6L5 6m5 4v7m4-7v7"/>',
  send: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
};
export const icon = (name, size = 20) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ''}</svg>`;

export const sections = {
  today: 'Today', nutrition: 'Nutrition', workout: 'Workouts', planner: 'Planner',
  spending: 'Spending', coach: 'Coach', settings: 'Settings',
};

export function renderShell(page, root = './') {
  const url = key => key === 'nutrition' ? root + 'nutrition/#diary' : root + (key === 'today' ? '' : '#' + key);
  const link = (key, label = sections[key]) => `<a href="${url(key)}" data-section="${key}" ${key === page ? 'aria-current="page"' : ''}>${icon(key)}<span>${label}</span></a>`;
  const brand = `<a class="agent-brand" href="${url('today')}"><img width="38" height="38" src="${root}assets/icon.svg" alt=""><span>Fitness Agent<small>PERSONAL WORKSPACE</small></span></a>`;
  document.querySelector('#workspace-rail').innerHTML = `
    ${brand}
    <nav class="desktop-nav" aria-label="Workspace">
      <span class="nav-label">WORKSPACE</span>
      ${['today', 'nutrition', 'workout', 'planner', 'spending'].map(key => link(key)).join('')}
      <span class="nav-label nav-break">PREFERENCES</span>
      ${link('coach')}${link('settings')}
    </nav>
    <div class="rail-foot"><span class="rail-lock">${icon('lock', 16)}</span><span>On this device<small>Private workspace</small></span></div>
    <nav class="mobile-nav" aria-label="Workspace">
      ${link('today')}${link('nutrition')}${link('workout', 'Train')}${link('planner')}${link('coach')}
    </nav>`;
  document.querySelector('#workspace-header').innerHTML = `
    <div class="crumb"><span>Workspace</span>${icon('next', 14)}<strong>${sections[page]}</strong></div>
    <div class="compact-brand">${brand}</div>
    <div class="top-actions"><span class="private-chip"><i></i> Private workspace</span>
    <a class="icon-btn" href="${url('settings')}" aria-label="Settings">${icon('settings', 18)}</a>
    ${page === 'nutrition' ? '' : `<button class="btn mint desktop-add" data-action="quick">${icon('plus', 17)} Quick add</button>`}</div>`;
}

export function registerOffline(url = './sw.js') {
  return navigator.serviceWorker?.register(url).then(() => navigator.serviceWorker.ready);
}
