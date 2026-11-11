import { today } from './nutrition/core.js';
import { loadDiary, openDiary, updateDiary } from './nutrition/storage.js';
import { calorieBackupState, calorieCounterUrl, createCalorieLink, latestDiaryDay } from './nutrition/calorie-link.js';
import { createImports, importsPage } from './lib/imports-ui.js';
import { ironLogPreference, ironLogStorageKey } from './lib/import-model.js';
import { localReply, modelContext, prompts } from './lib/coach.js';
import { groceryDraft, snapshot } from './lib/domain.js';
import { defaults, kinds, profileFields, readFields, templates, workspaceFromBackup } from './lib/records.js';
import { loadWorkspace, openWorkspace, saveWorkspace } from './lib/storage.js';
import { icon, registerOffline, renderShell, sections } from './lib/shell.js';
import { btn, coach, dashboard, escape, fields, planner, settings, spending, workouts } from './lib/views.js';

const $ = selector => document.querySelector(selector);
const dialog = $('.sheet');
const main = $('#main');
const toast = $('.toast');
const model = Boolean(document.querySelector('meta[name="fitness-agent-model"]'));
const broadcast = 'BroadcastChannel' in window ? new BroadcastChannel('fitness-agent-v1') : null;
const views = { planner, spending, settings };
const routes = new Set([...Object.keys(views), 'today', 'workout', 'coach', 'imports']);
let db, diaryDb, diary, state, activeView, lastDay, toastTimer, offlineReady, refreshing;
let coachBusy = false;
let workspaceRevision = 0;
let diaryRevision = 0;
let planDate = today();
const imports = createImports({ getState: () => state, edit, render, notify, modalForm });
const workspaceView = () => ({ ...state, workouts: imports.visibleWorkouts(state.workouts) });
const calorieLink = createCalorieLink(() => {
  if (['today', 'imports'].includes(route())) render();
});
const nutritionDiary = () => calorieLink.getInfo().diary ?? diary;

function route() {
  const hash = location.hash.slice(1);
  return routes.has(hash) ? hash : 'today';
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4300);
}

function offlineNote() {
  const note = $('#offline-note');
  if (note) note.textContent = offlineReady === true ? 'Ready for offline use.'
    : offlineReady === false ? 'Offline setup is unavailable. Reload while online to retry.'
      : 'Preparing offline files…';
}

function render() {
  if (!state || !diary) return;
  const page = route();
  const changed = page !== activeView;
  const hadChatFocus = page === 'coach' && document.activeElement?.matches('#coach-form input');
  if (lastDay && planDate === lastDay) planDate = today();
  lastDay = today();
  const workspace = workspaceView();
  const data = snapshot(workspace, nutritionDiary(), lastDay);
  if (changed) {
    renderShell(page);
    document.title = `Fitness Agent · ${sections[page]}`;
    activeView = page;
  }
  if (page === 'coach') main.innerHTML = coach(workspace, model, coachBusy);
  else if (page === 'imports') main.innerHTML = importsPage(state, imports.getInfo(), calorieLink.getInfo());
  else if (page === 'today') main.innerHTML = dashboard(workspace, data, calorieLink.getInfo().status);
  else if (page === 'workout') main.innerHTML = workouts(workspace, data, imports.isLinked);
  else main.innerHTML = views[page](workspace, data, planDate);
  if (page === 'coach') {
    const log = $('.chat-log');
    log.scrollTop = log.scrollHeight;
    if (hadChatFocus) $('#coach-form input')?.focus();
  }
  offlineNote();
}

async function edit(mutator) {
  state = await saveWorkspace(db, mutator);
  workspaceRevision += 1;
  broadcast?.postMessage('updated');
  render();
}

function showDialog(title, content) {
  if (dialog.open) dialog.close();
  $('#dialog-title').textContent = title;
  $('#dialog-content').innerHTML = content;
  dialog.showModal();
}

const footer = (label, tone = 'mint') => `<p class="form-error" role="alert" hidden></p>
  <div class="form-actions"><button class="btn" data-close type="button">Cancel</button><button class="btn ${tone}" type="submit">${label}</button></div>`;

function modalForm(title, body, label, submit, tone) {
  showDialog(title, `<form class="stack">${body}${footer(label, tone)}</form>`);
  const form = $('#dialog-content form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const after = await submit(form);
      if (form.isConnected && dialog.open) {
        dialog.close();
        if (typeof after === 'function') after();
      }
    } catch (error) {
      const note = form.querySelector('.form-error');
      note.textContent = error.message;
      note.hidden = false;
      submitButton.disabled = false;
    }
  });
}

function createRecord(values) {
  return { id: crypto.randomUUID(), created: new Date().toISOString(), ...values };
}

function editRecord(key, item, preset = {}) {
  const config = kinds[key];
  const values = item ?? { ...defaults[key]?.(planDate), ...preset };
  modalForm(`${item ? 'Edit' : 'Add'} ${config.name}`, fields(config.fields, values), item ? 'Save changes' : 'Save', async form => {
    const record = readFields(form, config.fields);
    await edit(draft => {
      if (item) {
        const index = draft[key].findIndex(entry => entry.id === item.id);
        if (index === -1) throw new Error('This item was already removed.');
        draft[key][index] = { ...draft[key][index], ...record };
      } else {
        if (key === 'groceries') record.done = false;
        if (key === 'routines') record.doneOn = null;
        draft[key].push(createRecord(record));
      }
    });
    notify(item ? 'Changes saved.' : 'Added to your workspace.');
  });
}

function draftGroceries() {
  const fromPlan = workspace => groceryDraft(workspace.meals.filter(meal => meal.date === planDate), workspace.groceries);
  const names = fromPlan(state);
  if (!names.length) {
    notify('There are no new ingredients for this date.');
    return;
  }
  modalForm('Add ingredients to groceries', `<p class="muted">Choose the items you need.</p>
    ${names.map((name, index) => `<label class="option-check"><input type="checkbox" name="item" value="${index}" checked>${escape(name)}</label>`).join('')}`,
  'Add selected', async form => {
    const picked = new Set(new FormData(form).getAll('item').map(index => names[Number(index)]));
    if (!picked.size) throw new Error('Select at least one item.');
    let added = 0;
    await edit(draft => {
      const fresh = fromPlan(draft).filter(name => picked.has(name));
      draft.groceries.push(...fresh.map(name => createRecord({ name, quantity: '', done: false })));
      added = fresh.length;
    });
    notify(added ? `Added ${added} grocery items.` : 'Your grocery list already has these items.');
  });
}

function downloadWorkspace() {
  const blob = new Blob([JSON.stringify({ format: 'fitness-agent-workspace', data: state }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `fitness-agent-${today()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function restoreWorkspace(file) {
  if (!file) return;
  if (file.size > 25_000_000) throw new Error('Choose a workspace backup smaller than 25 MB.');
  const restored = workspaceFromBackup(JSON.parse(await file.text()));
  const count = Object.keys(kinds).reduce((total, key) => total + restored[key].length, 0);
  modalForm('Replace workspace data?', `<p class="muted">Restore ${count} records, settings and coach history from this backup. Your current workspace records will be replaced. The food diary has its own restore screen.</p>`,
    'Restore workspace', async () => {
      await edit(draft => Object.assign(draft, restored));
      notify('Workspace restored.');
    }, 'danger');
}

async function ask(question) {
  const text = question.trim();
  if (!text || text.length > 500 || coachBusy) return;
  const workspace = workspaceView();
  const data = snapshot(workspace, nutritionDiary());
  const useModel = model && $('#use-model')?.checked;
  coachBusy = true;
  render();
  try {
    let role = 'local';
    let answer = localReply(text, data, workspace);
    if (useModel) {
      try {
        const response = await fetch('./api/coach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Fitness-Agent': 'coach' },
          body: JSON.stringify({ question: text, context: modelContext(data, workspace) }),
          signal: AbortSignal.timeout(35000),
        });
        if (!response.ok) throw new Error('Model request failed.');
        const reply = await response.json();
        if (typeof reply.text !== 'string' || !reply.text.trim()) throw new Error('Empty model reply.');
        answer = reply.text.slice(0, 6000);
        role = 'model';
      } catch {
        notify('Model unavailable. The local coach answered instead.', true);
      }
    }
    await edit(draft => {
      draft.messages.push({ role: 'user', text }, { role, text: answer });
      draft.messages = draft.messages.slice(-60);
    });
  } finally {
    coachBusy = false;
    render();
  }
}

async function importCalorieBackup(file) {
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) throw new Error('Choose a Calorie Counter backup smaller than 30 MB.');
  let payload;
  try { payload = JSON.parse(await file.text()); }
  catch { throw new Error('This file is not valid JSON. Download a fresh backup from Calorie Counter.'); }
  const restored = calorieBackupState(payload);
  modalForm('Import Calorie Counter backup?', `<p class="muted">This file contains ${restored.entries.length} diary entries,
    ${restored.foods.length} personal foods and ${restored.savedMeals.length} saved meals. Importing replaces the Fitness Agent
    nutrition diary and selects it as the active source. You can link Calorie Counter again from Imports.</p>`, 'Import backup', async () => {
    diary = await updateDiary(diaryDb, () => restored);
    diaryRevision += 1;
    if (calorieLink.isEnabled()) await calorieLink.setEnabled(false);
    broadcast?.postMessage('nutrition-updated');
    render();
    notify('Calorie Counter backup imported.');
    const latest = latestDiaryDay(restored.entries);
    return () => { location.href = latest ? `./nutrition/?day=${latest}#diary` : './nutrition/#foods'; };
  });
}

const actions = {
  ...imports.actions,
  'pick-calorie-backup': () => $('#calorie-backup-file').click(),
  'calorie-refresh': () => calorieLink.refresh(),
  'calorie-link': async () => {
    await calorieLink.setEnabled(!calorieLink.isEnabled());
    const { status } = calorieLink.getInfo();
    if (status === 'linked') notify('Calorie Counter linked.');
    else if (status === 'off') notify('Using your Fitness Agent diary.');
  },
  quick: () => showDialog('Quick add', `<div class="stack">
    <a class="btn mint" href="${calorieLink.isEnabled() ? calorieCounterUrl : './nutrition/#diary'}">${icon('nutrition', 17)}
      ${calorieLink.isEnabled() ? 'Log in Calorie Counter' : 'Log food'}</a>
    ${btn('Log workout', 'add:workouts', 'workout', '')}
    ${btn('Plan a meal', 'add:meals', 'planner', '')}
    ${btn('Add expense', 'add:expenses', 'spending', '')}
    ${btn('Add grocery item', 'add:groceries', 'basket', '')}
  </div>`),
  add: key => editRecord(key),
  edit: (key, item) => { if (item) editRecord(key, item); },
  remove: (key, item) => {
    if (!item) return;
    modalForm(`Remove ${kinds[key].name}?`, `<p class="muted">Remove “${escape(item.name ?? item.text)}” from your workspace?</p>`, 'Remove', async () => {
      await edit(draft => { draft[key] = draft[key].filter(record => record.id !== item.id); });
      notify('Removed.');
    }, 'danger');
  },
  toggle: async (key, item) => {
    if (!item) return;
    const day = today();
    await edit(draft => {
      const record = draft[key].find(entry => entry.id === item.id);
      if (!record) return;
      if (key === 'groceries') record.done = !record.done;
      if (key === 'routines') record.doneOn = record.doneOn === day ? null : day;
    });
  },
  template: index => editRecord('meals', null, templates[Number(index)]),
  'plan-today': () => { planDate = today(); render(); },
  'draft-groceries': draftGroceries,
  'clear-chat': () => modalForm('Clear conversation?', '<p class="muted">Remove all saved messages from this workspace.</p>', 'Clear history',
    async () => { await edit(draft => { draft.messages = []; }); notify('Conversation cleared.'); }, 'danger'),
  prompt: index => ask(prompts[Number(index)]),
  backup: downloadWorkspace,
  restore: () => $('#restore-file').click(),
};

document.addEventListener('click', async event => {
  if (event.target.closest('.skip')) {
    event.preventDefault();
    main.focus();
    return;
  }
  const diaryLink = event.target.closest('[data-diary-query]');
  if (diaryLink) {
    try { sessionStorage.setItem('fitness-agent:diary-query', diaryLink.dataset.diaryQuery); } catch { /* Catalog link remains usable. */ }
    return;
  }
  const target = event.target.closest('button[data-action], button[data-close]');
  if (!target || !state) return;
  if (target.hasAttribute('data-close')) {
    dialog.close();
    return;
  }
  const [action, key] = target.dataset.action.split(':');
  try {
    await actions[action]?.(key, kinds[key] && state[key].find(item => item.id === target.dataset.id));
  } catch (error) { notify(error.message, true); }
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (form.id !== 'profile-form' && form.id !== 'coach-form') return;
  event.preventDefault();
  try {
    if (form.id === 'coach-form') await ask(String(new FormData(form).get('question')));
    else {
      const profile = readFields(form, profileFields);
      await edit(draft => { draft.profile = profile; });
      notify('Settings saved.');
    }
  } catch (error) { notify(error.message, true); }
});

document.addEventListener('change', async ({ target }) => {
  try {
    if (target.id === 'calorie-backup-file') {
      const [file] = target.files;
      target.value = '';
      await importCalorieBackup(file);
      return;
    }
    if (target.dataset.import && target.files) {
      const files = [...target.files];
      target.value = '';
      await imports.onFiles(target.dataset.import, files);
      return;
    }
    if (target.id === 'plan-date' && target.value) {
      planDate = target.value;
      render();
    }
    if (target.id === 'restore-file') {
      const [file] = target.files;
      target.value = '';
      await restoreWorkspace(file);
    }
  } catch (error) { notify(error.message, true); }
});

async function refresh() {
  if (!db || !diaryDb || refreshing) return;
  refreshing = true;
  const revision = workspaceRevision;
  const nutritionRevision = diaryRevision;
  try {
    const [nextState, nextDiary] = await Promise.all([loadWorkspace(db), loadDiary(diaryDb)]);
    if (JSON.stringify(state) !== JSON.stringify(nextState) || JSON.stringify(diary) !== JSON.stringify(nextDiary) || lastDay !== today()) {
      if (revision === workspaceRevision) state = nextState;
      if (nutritionRevision === diaryRevision) diary = nextDiary;
      render();
    }
  } catch (error) {
    notify(error.message, true);
  } finally { refreshing = false; }
}

$('.sheet [data-close]').innerHTML = icon('close', 18);
window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
});
function refreshSources() {
  if (imports.refreshIronLog()) render();
  refresh();
}

window.addEventListener('pageshow', refreshSources);
window.addEventListener('focus', refreshSources);
window.addEventListener('storage', event => {
  if ([ironLogPreference, ironLogStorageKey, null].includes(event.key) && imports.refreshIronLog()) render();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSources(); });
broadcast?.addEventListener('message', refresh);

async function start() {
  renderShell(route());
  try {
    [db, diaryDb] = await Promise.all([openWorkspace(), openDiary()]);
    [state, diary] = await Promise.all([loadWorkspace(db), loadDiary(diaryDb)]);
    imports.refreshIronLog();
    await calorieLink.watch();
    render();
  } catch {
    state = null;
    main.innerHTML = '<p class="empty-state">Your browser couldn’t open local storage. Reload Fitness Agent with browser storage enabled.</p>';
    return;
  }
  try {
    const offline = registerOffline();
    if (offline) {
      const timer = setTimeout(() => { offlineReady = false; offlineNote(); }, 15000);
      try {
        await offline;
        offlineReady = true;
      } finally { clearTimeout(timer); }
    } else offlineReady = false;
  } catch { offlineReady = false; }
  offlineNote();
}

start();
