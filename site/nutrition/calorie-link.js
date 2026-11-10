import { backupVersion, emptyState, validateBackup } from './core.js';
import { readCalorieCounterDiary } from './storage.js';

export const calorieCounterUrl = 'https://planwithdata.github.io/Calorie-counter/';
const preference = 'fitness-agent:calorie-counter-linked';
const supportedHosts = new Set(['planwithdata.github.io', 'localhost', '127.0.0.1']);

export function linkedDiaryState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) throw new Error('Unrecognized Calorie Counter diary.');
  const defaults = emptyState();
  const state = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
    key, Object.hasOwn(raw, key) ? raw[key] : value,
  ]));
  if (state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings)) {
    state.settings = { ...defaults.settings, ...state.settings };
  }
  return validateBackup({ version: backupVersion, data: state });
}

export function calorieLinkStatus(info) {
  if (info.status === 'linked') {
    const { entries, foods } = info.diary;
    const entryLabel = entries.length === 1 ? 'diary entry' : 'diary entries';
    const foodLabel = foods.length === 1 ? 'personal food' : 'personal foods';
    return `Linked · ${entries.length} ${entryLabel} · ${foods.length} ${foodLabel}`;
  }
  if (info.status === 'waiting') return 'Waiting for Calorie Counter in this browser. Showing the Fitness Agent diary.';
  if (info.status === 'error') return 'Calorie Counter could not be read. Showing the Fitness Agent diary.';
  if (info.status === 'checking') return 'Checking this browser for the Calorie Counter diary…';
  return info.available ? 'Off · Link once to refresh automatically' : 'Available on the shared GitHub Pages site';
}

export function createCalorieLink(onChange) {
  const available = supportedHosts.has(location.hostname);
  const isEnabled = () => {
    try { return available && localStorage.getItem(preference) === 'yes'; }
    catch { return false; }
  };
  const enabled = isEnabled();
  let info = { available, enabled, status: enabled ? 'checking' : 'off', diary: null };
  let signature = '';
  let pending;

  function publish(status, diary = null, key = '') {
    if (info.status === status && signature === key) return;
    signature = key;
    info = { available, enabled: status !== 'off', status, diary };
    onChange(info);
  }

  function refresh() {
    if (!isEnabled()) {
      publish('off');
      return Promise.resolve();
    }
    if (pending) return pending;
    if (info.status === 'off') publish('checking');
    pending = readCalorieCounterDiary().then(raw => {
      if (!isEnabled()) return;
      if (raw === null) {
        publish('waiting');
        return;
      }
      const key = JSON.stringify(raw);
      if (info.status !== 'linked' || key !== signature) publish('linked', linkedDiaryState(raw), key);
    }).catch(() => {
      if (isEnabled()) publish('error');
    }).finally(() => { pending = null; });
    return pending;
  }

  function watch() {
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', ({ key }) => {
      if (key === preference || key === null) refresh();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(() => { if (!document.hidden && isEnabled()) refresh(); }, 4000);
    return refresh();
  }

  function setEnabled(value) {
    if (!available) throw new Error('Open Fitness Agent on the shared GitHub Pages site to link Calorie Counter.');
    if (value) localStorage.setItem(preference, 'yes');
    else localStorage.removeItem(preference);
    return refresh();
  }

  return { getInfo: () => info, isEnabled, setEnabled, watch };
}
