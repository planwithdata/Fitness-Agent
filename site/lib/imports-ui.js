import { money } from './domain.js';
import { btn, escape } from './views.js';
import { calendarDate, fileKey, ironLogBackup, ironLogPreference, ironLogSessions, ironLogStorageKey,
  ironLogUrl, mergeUnique, providers, visibleWorkouts } from './import-model.js';
import { parseReceipt } from './receipt.js';

const help = 'https://github.com/planwithdata/Fitness-Agent#read-only-imports';
const field = (label, control) => `<label class="field">${label}${control}</label>`;
const input = (name, value, extra = '') => `<input name="${name}" value="${escape(value)}" ${extra}>`;
const countText = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const receiptLimit = 20;
const supportedHosts = new Set(['planwithdata.github.io', 'localhost', '127.0.0.1']);

function importCard(title, detail, body) {
  return `<section class="card stack"><div><h2>${title}</h2><p class="muted">${detail}</p></div>${body}</section>`;
}

export function importsPage(workspace, info) {
  const { enabled, available, count, issue } = info;
  const status = issue || (count ? countText(count, 'completed workout') + ' linked in this browser.'
    : enabled ? 'Waiting for IronLog workouts in this browser. Open IronLog here or use a JSON backup.'
      : 'Off. Enable to show completed IronLog workouts from the same browser profile.');
  return `<div class="hero-head"><div><p class="eyeline">DATA SOURCES</p><h1>Imports</h1>
    <p class="lede">Bring your workouts, measurements and purchases into one workspace.</p></div></div>
    <div class="split"><div class="pane">
    ${importCard('Project IronLog', 'Bring over completed sessions and their working sets.', `
      <p class="import-status" role="status">${escape(status)}</p>
      <div class="action-row">
        ${available ? btn(enabled ? 'Disconnect IronLog' : 'Link IronLog', 'iron-link', enabled ? 'close' : 'check', enabled ? '' : 'mint') : ''}
        ${btn('Import JSON backup', 'pick-import:ironlog', 'download', '')}
        <a class="text-link" href="${ironLogUrl}" target="_blank" rel="noopener noreferrer">Open IronLog ↗</a>
      </div><p class="field-help">Linked workouts update while Fitness Agent is open. If your iPhone Home Screen apps use separate storage, use an IronLog JSON backup.</p>
      <input id="import-ironlog" data-import="ironlog" type="file" accept=".json,application/json" hidden>`)}
    ${importCard('Apple Health and DrTrust', 'Import workouts, body weight and body fat. If DrTrust writes these readings to Apple Health, the export includes them.', `
      <p class="field-help">In Health, tap your profile and choose Export All Health Data. You can also pick a weight CSV saved by an iPhone Shortcut.</p>
      <div class="action-row">${btn('Import Health file', 'pick-import:health', 'download', '')}
        ${workspace.health?.length ? btn('Clear measurements', 'clear-health', 'trash', '') : ''}</div>
      <input id="import-health" data-import="health" type="file" accept=".zip,.xml,.csv,application/zip,application/xml,text/xml,text/csv" hidden>`)}
    </div><div class="pane">
    ${importCard('Blinkit and Zomato receipts', 'Read totals, dates and recognizable line items from order receipts.', `
      <div class="action-row">${btn('Read receipts', 'pick-import:receipt', 'download')}
      ${btn('Paste receipt text', 'paste-receipt', 'list', '')}</div>
      <p class="field-help">Pick up to ${receiptLimit} PDF or text files at once. For a screenshot or scanned receipt, copy its text with iPhone Live Text and paste it here. Use the complete order summary for the amount paid.</p>
      <input id="import-receipt" data-import="receipt" type="file" accept=".pdf,.txt,application/pdf,text/plain" multiple hidden>`)}
    ${importCard('Automation and privacy', 'Files are read in this browser. Only confirmed records are saved.', `
      <p class="muted">IronLog can refresh automatically in the same browser. Apple Health and store receipts use files you select. The setup guide covers iPhone Shortcuts and provider access.</p>
      <a class="text-link" href="${help}" target="_blank" rel="noopener noreferrer">Read the setup guide ↗</a>`)}
    </div></div>`;
}

function workoutPreview(records) {
  if (!records.length) return '';
  const sample = [...records].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  return `<ul class="import-list">${sample.map(record => `<li>${escape(record.date)} · ${escape(record.name)} · ${record.minutes ? record.minutes + ' min' : 'Duration unavailable'}</li>`).join('')}</ul>`;
}

function renderReceipt({ label, parsed, error }, index) {
  if (error) return `<section class="receipt-preview"><h3>${escape(label)}</h3><p class="form-error">${escape(error)}</p></section>`;
  const { provider, merchant, amount, date, weakTotal, orderId, items } = parsed;
  const recognized = Boolean(provider && date && amount && !weakTotal);
  const merchantName = merchant || providers[provider] || '';
  const option = name => `<option value="${name}" ${name === provider ? 'selected' : ''}>${providers[name]}</option>`;
  return `<section class="receipt-preview stack">
    <label class="option-check"><input type="checkbox" name="selected-${index}" ${recognized ? 'checked' : ''}> Include ${escape(label)}</label>
    ${orderId ? `<p class="field-help">Order ${escape(orderId)}</p>` : '<p class="field-help">Order ID unavailable. Matching files are still skipped on repeat import.</p>'}
    <div class="fields">
      ${field('Provider', `<select name="provider-${index}"><option value="">Choose provider</option>${option('blinkit')}${option('zomato')}</select>`)}
      ${field('Description', input('name-' + index, merchantName, 'maxlength="100" placeholder="Store or restaurant"'))}
      ${field('Order date', input('date-' + index, date, 'type="date"'))}
      ${field('Amount paid (₹)', input('amount-' + index, amount ? (amount / 100).toFixed(2) : '', 'type="number" inputmode="decimal" min=".01" max="10000000" step=".01"'))}
    </div>
    ${!recognized ? '<p class="field-help">Check the date and complete order total, choose the provider, then select this receipt.</p>' : ''}
    ${items.length ? `<details class="import-details"><summary>${countText(items.length, 'detected item')}</summary>
      <ul>${items.map(item => `<li>${escape(item.name)}${item.quantity ? ' × ' + item.quantity : ''}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function receiptRecords(previews, fields) {
  return previews.flatMap(({ parsed, hash }, index) => {
    if (!parsed || !fields.get('selected-' + index)) return [];
    const provider = fields.get('provider-' + index);
    const date = fields.get('date-' + index);
    const amount = Math.round(Number(fields.get('amount-' + index)) * 100);
    if (!['blinkit', 'zomato'].includes(provider) || !calendarDate(date)
      || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1e9) {
      throw new Error('For each selected receipt, check the provider, date and amount paid.');
    }
    const name = String(fields.get('name-' + index) ?? '').trim().slice(0, 100) || providers[provider];
    const orderId = parsed.orderId ? parsed.orderId.toUpperCase() : '';
    return [{ id: provider + ':' + (orderId ? 'order:' + orderId : 'file:' + hash), name, date, amount,
      created: new Date().toISOString(), type: provider === 'blinkit' ? 'Groceries' : 'Food delivery',
      imported: { provider, orderId, items: parsed.items } }];
  });
}

async function readReceipt(file) {
  const label = file.name.slice(0, 130);
  try {
    if (file.size > 15 * 1024 * 1024) throw new Error('Choose a receipt smaller than 15 MB.');
    let text, hash;
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      hash = await fileKey(bytes);
      const { receiptPdfText } = await import('./pdf-receipt.js');
      text = await receiptPdfText(bytes);
    } else if (/\.txt$/i.test(file.name) || file.type === 'text/plain') {
      text = (await file.text()).trim();
      hash = await fileKey(text);
    } else throw new Error('Choose a PDF or text file.');
    if (!text.trim()) throw new Error('No selectable text was found. Copy the receipt with Live Text and paste it.');
    return { label, parsed: parseReceipt(text), hash };
  } catch (problem) {
    const error = problem.message?.startsWith('Choose') || problem.message?.startsWith('No selectable')
      ? problem.message : 'Could not read this receipt. Try copying and pasting the order summary.';
    return { label, error };
  }
}

export function createImports({ getState, edit, render, notify, modalForm }) {
  const available = supportedHosts.has(location.hostname);
  let enabled = false;
  let linked = [];
  let raw;
  let issue = '';
  let busy = false;

  function refreshIronLog() {
    let preference = false;
    let sessions = null;
    try {
      preference = available && localStorage.getItem(ironLogPreference) === 'yes';
      if (preference) sessions = localStorage.getItem(ironLogStorageKey);
    } catch { /* Local JSON imports remain available when browser storage is restricted. */ }
    if (enabled === preference && raw === sessions) return false;
    enabled = preference;
    raw = sessions;
    linked = [];
    issue = '';
    if (raw) {
      try { linked = ironLogSessions(JSON.parse(raw)).records; }
      catch { issue = 'The browser’s IronLog data could not be read. Import a JSON backup instead.'; }
    }
    return true;
  }

  function toggleLink() {
    const save = () => {
      localStorage.setItem(ironLogPreference, enabled ? 'no' : 'yes');
      refreshIronLog();
      render();
      notify(enabled ? 'IronLog linked in this browser.' : 'IronLog disconnected.');
    };
    if (!available) return;
    if (enabled) save();
    else modalForm('Link IronLog in this browser?',
      '<p class="muted">Fitness Agent will read completed workouts and working sets from IronLog’s local browser storage and use them in Workouts, Today and Coach. You can disconnect here any time.</p>',
      'Enable automatic link', save);
  }

  function workoutImport(records, health, skipped, source) {
    const current = getState();
    const nextWorkouts = mergeUnique(current.workouts, records);
    const nextHealth = mergeUnique(current.health ?? [], health);
    const summary = [countText(nextWorkouts.length, 'new workout'), countText(nextHealth.length, 'new measurement')].join(' and ');
    if (!nextWorkouts.length && !nextHealth.length) {
      notify(records.length || health.length ? 'These records are already imported.' : 'No supported completed workouts or measurements were found.');
      return;
    }
    modalForm(`Review ${source} import`, `<p class="muted">Found ${summary}.
        ${skipped ? ` ${countText(skipped, 'incomplete or invalid record')} skipped.` : ''}</p>
        ${nextWorkouts.length ? `<label class="option-check"><input type="checkbox" name="workouts" checked> Import workouts</label>${workoutPreview(nextWorkouts)}` : ''}
        ${nextHealth.length ? `<label class="option-check"><input type="checkbox" name="health" checked> Import measurements</label>` : ''}
        ${source === 'Health' && nextWorkouts.length ? '<p class="field-help">If IronLog already has these sessions, uncheck workouts to avoid counting the same movement twice.</p>' : ''}`,
    'Import selected', async form => {
      const selection = new FormData(form);
      if (!selection.has('workouts') && !selection.has('health')) throw new Error('Select workouts or measurements.');
      let addedWorkouts, addedHealth;
      await edit(draft => {
        draft.health ??= [];
        addedWorkouts = selection.has('workouts') ? mergeUnique(draft.workouts, records) : [];
        addedHealth = selection.has('health') ? mergeUnique(draft.health, health) : [];
        if (draft.workouts.length + addedWorkouts.length > 50000 || draft.health.length + addedHealth.length > 50000) {
          throw new Error('This import would exceed the workspace limit of 50,000 workouts or measurements.');
        }
        for (const item of addedWorkouts) draft.workouts.push(item);
        for (const item of addedHealth) draft.health.push(item);
      });
      notify(`Added ${countText(addedWorkouts.length, 'workout')} and ${countText(addedHealth.length, 'measurement')}.`);
    });
  }

  function receiptImport(previews) {
    if (!previews.length) return;
    modalForm('Review receipts', `<p class="muted">Confirm what you paid. Only selected receipts become expenses. Repeat orders with the same order ID are skipped.</p>
      ${previews.map(renderReceipt).join('')}`, 'Save expenses', async form => {
      const records = receiptRecords(previews, new FormData(form));
      if (!records.length) throw new Error('Select at least one receipt with complete details.');
      let saved;
      await edit(draft => {
        saved = mergeUnique(draft.expenses, records);
        draft.expenses.push(...saved);
      });
      const skipped = records.length - saved.length;
      notify(`Saved ${countText(saved.length, 'expense')}${saved.length ? ' · ' + money(saved.reduce((sum, item) => sum + item.amount, 0)) : ''}.${skipped ? ' Skipped ' + countText(skipped, 'duplicate') + '.' : ''}`);
    });
  }

  async function onFiles(kind, files) {
    if (!files.length || busy) return;
    busy = true;
    notify(kind === 'receipt' ? 'Reading receipts…' : 'Reading import file…');
    try {
      if (kind === 'ironlog') {
        if (files[0].size > 30 * 1024 * 1024) throw new Error('Choose an IronLog JSON backup smaller than 30 MB.');
        const data = ironLogBackup(JSON.parse(await files[0].text()));
        workoutImport(data.records, [], data.skipped, 'IronLog');
      } else if (kind === 'health') {
        const { readHealthFile } = await import('./health-import.js');
        const data = await readHealthFile(files[0]);
        workoutImport(data.workouts, data.health, data.skipped, 'Health');
      } else {
        if (files.length > receiptLimit) throw new Error(`Choose up to ${receiptLimit} receipt files at a time.`);
        const previews = [];
        for (const file of files) previews.push(await readReceipt(file));
        if (previews.every(item => item.error)) throw new Error(previews[0].error);
        receiptImport(previews);
      }
    } finally { busy = false; }
  }

  const actions = {
    'iron-link': toggleLink,
    'pick-import': kind => document.querySelector('#import-' + kind)?.click(),
    'paste-receipt': () => modalForm('Paste receipt text',
      field('Receipt or order summary', '<textarea name="receipt" rows="8" maxlength="350000" required></textarea>'),
      'Read receipt', async form => {
        const text = String(new FormData(form).get('receipt')).trim();
        if (!text) throw new Error('Paste the text of an order summary.');
        const hash = await fileKey(text);
        return () => receiptImport([{ label: 'Pasted receipt', parsed: parseReceipt(text), hash }]);
      }),
    'clear-health': () => modalForm('Clear imported measurements?',
      '<p class="muted">Remove imported weight and body-fat readings from Fitness Agent.</p>', 'Clear measurements',
      async () => { await edit(draft => { draft.health = []; }); notify('Measurements cleared.'); }, 'danger'),
  };

  return { actions, onFiles, refreshIronLog, getInfo: () => ({ enabled, available, count: linked.length, issue }),
    visibleWorkouts: saved => visibleWorkouts(saved, linked), isLinked: id => linked.some(item => item.id === id) };
}
