import { today } from '../nutrition/core.js';
import { brief, format, money, expenseTypes } from './domain.js';
import { measurements, measurementText, newestMeasurements, providers } from './import-model.js';
import { prompts } from './coach.js';
import { icon } from './shell.js';
import { dateText, kinds, profileFields, templates } from './records.js';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const dayDate = day => new Date(day + 'T12:00:00');
export const tile = (name, tone = '') => `<span class="tile ${tone}">${icon(name, 18)}</span>`;
export const btn = (label, action, symbol = 'plus', theme = 'mint') =>
  `<button type="button" class="btn ${theme}" data-action="${action}">${icon(symbol, 17)}${label}</button>`;
const link = (label, url, theme = 'text-link', symbol = 'arrow') =>
  `<a class="${theme}" href="${url}">${label}${icon(symbol, 16)}</a>`;
const empty = message => `<p class="empty-state">${message}</p>`;
const percent = (part, total) => total ? Math.min(100, Math.max(0, Math.round(100 * part / total))) : 0;
const progress = (part, total) => total
  ? `<div class="progress" role="meter" aria-label="Goal progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${Math.min(part, total)}"><span style="--progress:${percent(part, total)}%"></span></div>` : '';

function pageHead(label, title, text, aside = '') {
  return `<div class="hero-head"><div><p class="eyeline">${label}</p><h1>${title}</h1><p class="lede">${text}</p></div>${aside}</div>`;
}

function metric({ label, value, unit, note, symbol, tone, url }) {
  return `<a href="${url}" class="metric"><div class="metric-head">${tile(symbol, tone)}${icon('next', 15)}</div>
    <span class="metric-label">${label}</span><span class="metric-value">${value} ${unit ? `<small>${unit}</small>` : ''}</span>
    <span class="metric-note">${note}</span></a>`;
}

function card(title, text, content, action = '') {
  return `<section class="card"><div class="card-head"><div><h2>${title}</h2>${text ? `<p>${text}</p>` : ''}</div>${action}</div>${content}</section>`;
}

function nextRow(title, detail, url, symbol, tone) {
  return `<a class="next-row" href="${url}">${tile(symbol, tone)}<span><strong>${title}</strong><small>${detail}</small></span>${icon('next', 16)}</a>`;
}

function calorieChart(data) {
  const highest = Math.max(2000, data.calorieTarget ?? 0, ...data.week.map(point => point.kcal ?? 0));
  const max = Math.ceil(highest / 500) * 500;
  const axis = value => value >= 1000 ? (value / 1000).toLocaleString('en-IN') + 'k' : value;
  const dateLabel = date => dayDate(date).toLocaleDateString('en-IN', { weekday: 'short' });
  const accessible = data.week.map(({ date, kcal, complete }) =>
    dateLabel(date) + ' ' + (kcal === null ? 'unlogged' : `${format(kcal)} kcal${complete ? '' : ' (partial day)'}`)).join(', ');
  return `<div class="chart" role="img" aria-label="Last seven days of logged calories. ${accessible}">
    <div class="chart-axis" aria-hidden="true"><span>${axis(max)}</span><span>${axis(max / 2)}</span><span>0</span></div>
    <div class="chart-plot" aria-hidden="true">
      ${data.calorieTarget ? `<span class="chart-target" style="--height:${percent(data.calorieTarget, max)}%"></span>` : ''}
      ${data.week.map(({ date, kcal, complete }) => `<div class="chart-col" title="${dateLabel(date)} · ${kcal === null ? 'No log' : format(kcal) + ' kcal'}">
        <span class="chart-bar ${kcal === null ? 'missing' : complete ? '' : 'partial'}" style="--height:${percent(kcal, max)}%"></span><span>${dateLabel(date)}</span></div>`).join('')}
    </div></div>
    <p class="chart-note">${data.week.some(day => day.kcal !== null)
      ? (data.calorieTarget ? 'Dashed line shows your daily target. Faded bars mark incomplete days.' : 'Faded bars mark incomplete days.')
      : 'Log a meal to start your trend. Empty days appear as dashes.'}</p>`;
}

export function dashboard(workspace, data, calorieStatus) {
  const { totals, foods, calorieTarget, proteinTarget, minutes, spent, meals, groceries, routines } = data;
  const name = workspace.profile.name;
  const dateLabel = dayDate(data.day).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const shortDate = dayDate(data.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const target = workspace.profile.workoutGoal;
  const budget = workspace.profile.budget;
  return `${pageHead(`YOUR DAY <span>·</span> ${shortDate}`, name ? `Welcome, ${escape(name)}.` : 'Make today count.',
    'Food, movement, and the plans in between.', `<span class="date-pill">${icon('planner', 15)}${dateLabel}</span>${btn('Add', 'quick', 'plus', 'mint mobile-add')}`)}
  <section class="hero" aria-labelledby="brief-title">
    <img class="hero-art" src="./assets/orbit.svg" alt="">
    <div class="hero-copy"><span class="hero-label">${icon('coach', 16)} AGENT BRIEF</span>
    <h2 id="brief-title">Your day, in focus.</h2><p>${escape(brief(data, workspace))}</p>
    ${link('Open coach', '#coach', 'btn')}</div>
  </section>
  <div class="section-bar"><h2>At a glance</h2><p>Updated from your workspace</p></div>
  <div class="metrics">
    ${metric({ label: 'Calories', value: foods ? format(totals.kcal.value) : '—', unit: 'kcal', note: calorieTarget ? `of ${format(calorieTarget)} daily` : 'Today’s diary', symbol: 'fire', tone: 'orange', url: './nutrition/#diary' })}
    ${metric({ label: 'Protein', value: totals.protein.known ? format(totals.protein.value) : '—', unit: 'g',
      note: totals.protein.known && totals.protein.known < foods ? 'Partial diary coverage' : proteinTarget ? `of ${format(proteinTarget)} daily` : 'Today’s diary', symbol: 'bolt', tone: '', url: './nutrition/#nutrition' })}
    ${metric({ label: 'Movement', value: format(minutes), unit: 'min', note: target ? `of ${target} in 7 days` : 'Last 7 days', symbol: 'workout', tone: 'violet', url: '#workout' })}
    ${metric({ label: 'Food spending', value: money(spent), note: budget ? `of ${money(budget)} this month` : 'This month', symbol: 'spending', tone: 'blue', url: '#spending' })}
  </div>
  <div class="dashboard-grid">
    ${card('Calorie trend', calorieStatus === 'linked' ? 'Daily energy from Calorie Counter'
      : 'Daily energy from your Fitness Agent diary', calorieChart(data), '<span class="period">Last 7 days</span>')}
    ${card('Up next', 'From your plan and daily routines', `<div class="next-list">
      ${nextRow('Meal plan', meals.length ? `${meals.length} planned for today` : 'Add a meal for today', '#planner', 'planner', 'violet')}
      ${nextRow('Grocery list', groceries.length ? `${groceries.length} items still to buy` : 'Build a list from your plan', '#planner', 'basket', '')}
      ${nextRow('Daily routines', routines.length ? `${routines.length} check-ins remaining` : 'See your daily check-ins', '#planner', 'clock', 'blue')}</div>`)}
  </div>`;
}

function editButtons(key, item) {
  return `<div class="record-actions">
    <button class="icon-btn" data-action="edit:${key}" data-id="${escape(item.id)}" aria-label="Edit ${kinds[key].name}" type="button">${icon('edit', 16)}</button>
    <button class="icon-btn" data-action="remove:${key}" data-id="${escape(item.id)}" aria-label="Remove ${kinds[key].name}" type="button">${icon('trash', 16)}</button>
    </div>`;
}

function record(key, item, title, subtitle, toggle = null, { detail = '', readonly = false } = {}) {
  const config = kinds[key];
  return `<div class="record${toggle ? ' done' : ''}">
    ${toggle === null ? tile(config.icon, config.tone)
      : `<button class="icon-btn toggle" data-action="toggle:${key}" data-id="${escape(item.id)}" aria-label="Mark ${escape(title)} complete" aria-pressed="${toggle}" type="button">${icon('check', 17)}</button>`}
    <div class="record-body"><strong>${escape(title)}</strong><small>${escape(subtitle)}</small>${detail}</div>${readonly ? '' : editButtons(key, item)}</div>`;
}

function exerciseDetail(item) {
  const exercises = item.imported?.exercises;
  if (!exercises?.length) return '';
  return `<details class="import-details"><summary>Working sets</summary><ul>${exercises.map(exercise =>
    `<li>${escape(exercise.name)} · ${exercise.sets.map(set => set.reps + ' reps' + (set.kg === null ? '' : ' × ' + set.kg + ' kg')).join(', ')}</li>`).join('')}</ul></details>`;
}

function healthMeasurements(health) {
  const recent = newestMeasurements(health);
  if (!recent.length) return empty('Import an Apple Health file or DrTrust PDF to see body measurements here.');
  const main = ['weight', 'bodyFat'];
  const groups = Object.keys(measurements).map(kind => recent.filter(item => item.kind === kind)).filter(group => group.length);
  const cards = data => `<div class="measurement-grid">${data.map(([item, ...past]) => `<div>
    <small>${measurements[item.kind].label}</small>
    <strong>${measurementText(item)}</strong><small>${escape(item.date)} · ${escape(item.source)}</small>
    ${past.length ? `<details class="import-details"><summary>History</summary><ul>${past.slice(0, 12).map(sample =>
      `<li>${escape(sample.date)} · ${measurementText(sample)} · ${escape(sample.source)}</li>`).join('')}</ul></details>` : ''}
    </div>`).join('')}</div>`;
  const other = groups.filter(([item]) => !main.includes(item.kind));
  return cards(groups.filter(([item]) => main.includes(item.kind))) +
    (other.length ? `<details class="import-details"><summary>More body composition readings</summary>
      ${cards(other)}</details>` : '');
}

export function workouts(workspace, data, isLinked = () => false) {
  const goal = workspace.profile.workoutGoal;
  const recent = [...workspace.workouts].sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created));
  return `${pageHead('MOVEMENT', 'Workouts', 'Build a record of how you move.', btn('Log workout', 'add:workouts'))}
    <div class="split">
      ${card('Workout log', 'Most recent sessions first', recent.length
        ? `<div class="records">${recent.map(item => {
          const duration = item.minutes ? item.minutes + ' min' : 'Duration unavailable';
          const source = item.imported && providers[item.imported.provider];
          const subtitle = [dateText(item.date), item.type, duration, source, item.notes].filter(Boolean).join(' · ');
          return record('workouts', item, item.name, subtitle, null, { detail: exerciseDetail(item), readonly: isLinked(item.id) });
        }).join('')}</div>`
        : empty('Log a walk, training session, or sport to begin.'), link('Import', '#imports'))}
      <div class="pane">
      ${card('Rolling 7-day progress', 'Includes today and the previous six days', `<p class="big-number">${format(data.minutes)} min</p>
        ${progress(data.minutes, goal)}<p class="muted">${data.workouts.length} workouts${goal ? ` · ${goal} min target` : ''}</p>
        ${link('Edit movement target', '#settings')}`)}
      ${card('Body measurements', 'From Apple Health, DrTrust and weight files', healthMeasurements(workspace.health ?? []))}
      </div>
    </div>`;
}

export function planner(workspace, data, date) {
  const plan = workspace.meals.filter(meal => meal.date === date).sort((a, b) =>
    ['Breakfast', 'Lunch', 'Dinner', 'Snacks'].indexOf(a.slot) - ['Breakfast', 'Lunch', 'Dinner', 'Snacks'].indexOf(b.slot));
  const groceries = [...workspace.groceries].sort((a, b) => Number(a.done) - Number(b.done));
  const routines = [...workspace.routines].sort((a, b) => a.time.localeCompare(b.time));
  return `${pageHead('EVERYDAY PLANS', 'Planner', 'Plan meals, shop from one list, and check off routines.')}
    <div class="split"><div class="pane">
      ${card('Meal plan', dateText(date), `
        <div class="tab-date"><label class="field">Plan date<input type="date" id="plan-date" value="${escape(date)}"></label>
        ${btn('Today', 'plan-today', 'planner', '')}</div>
        <div class="records">${plan.length ? plan.map(item => record('meals', item, item.name,
          item.slot + (item.ingredients.length ? ' · ' + item.ingredients.join(', ') : ''))).join('') : empty('Nothing planned for this date yet.')}</div>
        <div class="action-row" style="margin-top:12px">${btn('Use plan for groceries', 'draft-groceries', 'basket', '')}</div>`, btn('Add meal', 'add:meals'))}
      ${card('Quick meal ideas', 'Pick a starting point and adjust it before saving.',
        `<div class="chip-row">${templates.map((item, index) => `<button type="button" data-action="template:${index}">${item.name}</button>`).join('')}</div>`)}
      </div><div class="pane">
      ${card('Grocery list', `${data.groceries.length} to buy`, groceries.length
        ? `<div class="records">${groceries.map(item => record('groceries', item, item.name, item.quantity || 'Grocery item', item.done)).join('')}</div>`
        : empty('Add an item or use ingredients from your meal plan.'), btn('Add item', 'add:groceries'))}
      ${card('Daily routines', 'Check off today’s tasks. They reopen each day.', routines.length
        ? `<div class="records">${routines.map(item => record('routines', item, item.name, item.time, item.doneOn === data.day)).join('')}</div>`
        : empty('Add a daily check-in at a time that suits you.'), btn('Add', 'add:routines'))}
    </div></div>`;
}

function receiptDetail(item) {
  const receipt = item.imported;
  if (!receipt?.items?.length) return '';
  return `<details class="import-details"><summary>${receipt.items.length} receipt items</summary><ul>
    ${receipt.items.map(line => `<li>${escape(line.name)}${line.quantity ? ' × ' + line.quantity : ''}
      ${receipt.provider === 'zomato' ? `<a class="diary-match" data-diary-query="${escape(line.name)}"
        href="./nutrition/#foods" aria-label="Find ${escape(line.name)} in the food diary">Find in diary</a>` : ''}
    </li>`).join('')}</ul></details>`;
}

export function spending(workspace, data) {
  const budget = workspace.profile.budget;
  const monthExpenses = workspace.expenses.filter(item => item.date.startsWith(data.month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created));
  const history = workspace.expenses.filter(item => !item.date.startsWith(data.month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created));
  const render = list => list.map(item => record('expenses', item, item.name,
    [dateText(item.date), item.type, money(item.amount), item.imported && providers[item.imported.provider]].filter(Boolean).join(' · '),
    null, { detail: receiptDetail(item) })).join('');
  const month = dayDate(data.day).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return `${pageHead('FOOD BUDGET', 'Spending', 'See what you spend on groceries, delivery, and dining out.', btn('Add expense', 'add:expenses'))}
    <div class="split">
      <div class="pane">${card('This month', month, monthExpenses.length ? render(monthExpenses) : empty('Add an expense to start tracking your food spending.'), link('Read receipts', '#imports'))}
      ${history.length ? card('Past expenses', 'All records outside the current month', render(history)) : ''}</div>
      <div class="pane">${card('Monthly budget', month, `<p class="big-number">${money(data.spent)}</p>
      ${progress(data.spent, budget)}
      <p class="muted">${budget ? `${money(Math.abs(budget - data.spent))} ${data.spent > budget ? 'over' : 'left in'} your ${money(budget)} budget.` : 'Set a monthly target to see how much remains.'}</p>${link('Edit budget', '#settings')}`)}
      ${card('By category', 'Recorded this month', expenseTypes.map(type => {
        const subtotal = monthExpenses.filter(item => item.type === type).reduce((sum, item) => sum + item.amount, 0);
        return `<div class="next-row"><span class="record-body"><strong>${type}</strong></span><span>${money(subtotal)}</span></div>`;
      }).join(''))}</div>
    </div>`;
}

export function coach(workspace, model, busy) {
  const log = workspace.messages.length ? workspace.messages.map(item => `<div class="bubble ${item.role}"><small>${{ user: 'You', local: 'Local coach', model: 'Model reply' }[item.role]}</small>${escape(item.text)}</div>`).join('')
    : '<div class="bubble"><small>Local coach</small>I can review your diary, movement, plans, routines, or food spending. Pick a question to start.</div>';
  return `${pageHead('PERSONAL COACH', 'Coach', 'Get a read on your day using what you’ve recorded.')}
    <div class="split"><div class="pane">
      ${card('Conversation', 'History stays in this browser.', `<div class="stack">
      <div class="chat-log" role="log" aria-label="Coach conversation">${log}${busy ? '<p class="muted">Getting your reply…</p>' : ''}</div>
      <div class="chip-row">${prompts.map((prompt, index) => `<button type="button" data-action="prompt:${index}" ${busy ? 'disabled' : ''}>${prompt}</button>`).join('')}</div>
      <form class="chat-compose" id="coach-form"><label class="field">Ask the coach<input name="question" maxlength="500" placeholder="How is my day going?" required ${busy ? 'disabled' : ''}></label>
      <button type="submit" class="icon-btn" aria-label="Send question" ${busy ? 'disabled' : ''}>${icon('send')}</button></form>
      ${model ? '<label class="option-check"><input type="checkbox" id="use-model"> Send this question and a workspace summary to OpenAI</label>' : '<p class="field-help">Local mode uses rules and your saved workspace data.</p>'}
      </div>`, workspace.messages.length ? btn('Clear', 'clear-chat', 'trash', '') : '<span class="pill">On device</span>')}
      </div><div class="pane">
      ${card('Memory', 'Save habits and preferences you want the coach to use.', workspace.memory.length
        ? workspace.memory.map(item => record('memory', item, item.text, item.kind)).join('')
        : empty('Add a food preference, a training habit, or a routine note.'), btn('Add', 'add:memory'))}
      ${card('What the coach can see', '', '<p class="muted">Daily nutrition totals, recent movement, meal plans, unchecked groceries and routines, monthly food spending, and notes you save in Memory.</p>')}
    </div></div>`;
}

export function fields(config, values) {
  return config.map(([key, label, type, settings = {}]) => {
    const options = { ...settings };
    const required = options.optional ? '' : 'required';
    const value = values[key] ?? '';
    let control;
    if (type === 'select') {
      control = `<select name="${key}">${options.options.map(item => `<option ${value === item ? 'selected' : ''}>${escape(item)}</option>`).join('')}</select>`;
    } else if (type === 'textarea' || type === 'ingredients') {
      control = `<textarea name="${key}" maxlength="${options.max}" placeholder="${escape(options.placeholder)}" ${required}>${escape(type === 'ingredients' && Array.isArray(value) ? value.join(', ') : value)}</textarea>`;
    } else {
      const numeric = type === 'money' || type === 'number';
      const attributes = numeric ? `min="${options.min}" max="${options.max}" step="${options.step}" inputmode="${type === 'money' ? 'decimal' : 'numeric'}"`
        : options.max ? `maxlength="${options.max}"` : '';
      control = `<input type="${numeric ? 'number' : type}" name="${key}" value="${escape(type === 'money' && value !== '' ? value / 100 : value)}"
        placeholder="${escape(options.placeholder)}" ${attributes} ${required}>`;
    }
    return `<label class="field">${label}${control}</label>`;
  }).join('');
}

export function settings(workspace) {
  return `${pageHead('WORKSPACE SETTINGS', 'Settings', 'Set targets, manage your data, and install on your iPhone.')}
    <div class="split"><div class="pane">
      ${card('Profile and goals', 'Enter 0 to turn off a movement target or budget.', `<form id="profile-form" class="stack">${fields(profileFields, workspace.profile)}
        <div class="action-row"><button class="btn mint" type="submit">Save settings</button></div></form>`)}
      ${card('Nutrition settings', 'Set calorie and protein targets, dietary preferences, and nutrition references.',
        link('Open nutrition settings', './nutrition/#settings'))}
      ${card('Food spending', 'Review groceries, restaurant, and delivery spending.', link('Open spending', '#spending'))}
    </div><div class="pane">
      ${card('Install on iPhone', 'Open Fitness Agent in Safari, tap Share, then choose Add to Home Screen.',
        '<p id="offline-note" class="muted">Checking offline availability…</p>')}
      ${card('Data and backups', 'Your workspace and food diary have separate backup files.', `<div class="action-row">
        ${btn('Export workspace', 'backup', 'download', '')}${btn('Restore workspace', 'restore', 'download', '')}
        <input type="file" id="restore-file" accept=".json,application/json" hidden></div>
        ${link('Import or export your food diary', './nutrition/#settings')}`)}
      ${card('Imports and linked apps', 'Link Calorie Counter or bring in IronLog workouts, health files, and store receipts.', link('Open Imports', '#imports'))}
      ${card('Connected services', 'Review the available data sources.', `<div class="integrations">
        <div><span>Food diary</span><span class="pill">Built in</span></div>
        <div><span>Zomato</span><span class="pill">Receipt import</span></div>
        <div><span>Blinkit</span><span class="pill">Receipt import</span></div>
        <div><span>Apple Health</span><span class="pill">File import</span></div>
      </div>`)}
    </div></div>`;
}
