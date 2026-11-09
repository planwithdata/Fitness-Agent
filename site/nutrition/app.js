import {
  backupVersion, calculateRecipe, diaryCsv, findFoods, makeEntry, meals, nutrients, nutrientKeys,
  parseQuantity, prettyDay, scaleMealEntries, shiftDay, summarize, targetKeys, today, upperTargets, validateBackup, validateCatalog, weeklyReview,
} from './core.js';
import {
  adultReferences, compareMeal, dayReferenceStatus, foodContributions, mealGroups, mealSuggestions,
  nutritionReport, portionLimitShare, reportReference, summaryText, targetFor, trendReferenceStatus,
} from './insights.js';
import { loadDiary, openDiary, updateDiary } from './storage.js';
import { registerOffline } from '../lib/shell.js';

const broadcast = 'BroadcastChannel' in window ? new BroadcastChannel('fitness-agent-v1') : null;

const $ = id => document.getElementById(id);
const dialog = $('modal');
const modal = $('modal-body');
const tabs = ['diary', 'nutrition', 'foods', 'review', 'settings'];
const numberFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const format = number => numberFormat.format(number);
const size = (number, unit) => `${format(number)} ${unit}`;
const nutrient = (key, amount) => amount == null ? 'Unknown' : size(amount, nutrients[key][1]);
const primary = nutrientKeys.slice(0, 5);
const sourceTypes = ['Package label', 'Restaurant nutrition label', 'Restaurant estimate', 'Personal estimate'];
const presets = ['Whey protein', 'ON Serious Mass', 'ON Creatine', 'BCAA', 'MIILD Protein Roti', 'Zomato order'];
const guidanceUrl = 'https://www.nin.res.in/dietaryguidelines/pdfjs/locale/DGI24thJune2024fin.pdf';
let db, state, catalog, day = today(), foodLimit = 24, alertTimer;

function element(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, options);
  node.append(...children);
  return node;
}

function button(label, action, className = 'quiet') {
  return element('button', { type: 'button', textContent: label, className, onclick: action });
}

function message(text, error = false) {
  clearTimeout(alertTimer);
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
  $('status').hidden = false;
  if (!error) alertTimer = setTimeout(() => { $('status').hidden = true; }, 4000);
}

async function save(update, success, after) {
  try {
    state = await updateDiary(db, update);
    broadcast?.postMessage('updated');
    render();
    if (success) message(success);
    after?.();
    return true;
  } catch (error) {
    const target = modal.querySelector('.form-error');
    if (dialog.open && target) target.textContent = error.message;
    else message(error.message || 'Could not save your changes.', true);
    return false;
  }
}

function showDialog(title, content) {
  $('modal-title').textContent = title;
  modal.replaceChildren(content);
  if (!dialog.open) dialog.showModal();
  modal.querySelector('input:not([type=hidden]), select')?.focus();
}

function formError(form, text) {
  form.querySelector('.form-error').textContent = text;
}

function allFoods() {
  const personalIds = new Set(state.foods.map(food => food.id));
  return [...state.foods, ...catalog.filter(food => !personalIds.has(food.id))];
}

function search(query) {
  const recents = [...new Set(state.entries.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(entry => entry.foodId))].slice(0, 40);
  return findFoods(allFoods(), query, state.favorites, recents);
}

function sourceInfo(source) {
  const label = source.url
    ? element('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', textContent: source.label })
    : source.label;
  return element('p', { className: 'muted' }, label, source.note ? ` · ${source.note}` : '');
}

function nutrientGrid(keys, valueFor) {
  return element('div', { className: 'details-grid' }, ...keys.map(key =>
    element('div', {}, nutrients[key][0], element('strong', { textContent: valueFor(key) }))));
}

function foodRow(food, action, label) {
  const context = [nutrient('kcal', food.nutrients.kcal) + ` / 100 ${food.basis}`, food.source.label];
  if (state.favorites.includes(food.id)) context.unshift('Favorite');
  return element('div', { className: 'food-row' },
    element('div', { className: 'row-main' }, element('strong', { textContent: food.name }),
      element('small', { textContent: context.join(' · ') })),
    button(label, () => action(food)));
}

function renderDiary() {
  $('day').value = day;
  const complete = state.completed[day] === true;
  $('complete').checked = complete;
  const entries = state.entries.filter(entry => entry.day === day);
  const total = summarize(entries);
  const display = key => entries.length ? nutrient(key, total[key].value) : '—';
  const coverage = key => total[key].known > 0 && total[key].known < total[key].total
    ? `Partial · ${total[key].known}/${total[key].total} items` : '';
  const references = new Map(targetKeys.map(key => [key, reportReference(state.settings, key)]));
  $('summary').replaceChildren(...primary.map(key => {
    const reference = references.get(key);
    const status = entries.length ? dayReferenceStatus(total[key], complete, reference) : null;
    return element('div', { className: 'stat' }, element('span', { textContent: nutrients[key][0] }),
      referenceValue(display(key), status, 'strong'),
      element('small', { textContent: coverage(key) || (reference ? referenceText(key, reference) : '') }),
      ...(status ? [statusBadge(status)] : []));
  }));
  const cards = targetKeys.filter(key => entries.length && !primary.includes(key) && references.get(key));
  $('day-targets').replaceChildren(...cards.map(key => {
    const reference = references.get(key);
    const status = dayReferenceStatus(total[key], complete, reference);
    return element('div', { className: 'panel target-card' }, element('span', { className: 'muted', textContent: nutrients[key][0] }),
      referenceValue(shownTotal(key, total[key]), status, 'strong'),
      element('small', { className: 'muted', textContent: `${referenceText(key, reference)} · ${reference.label}` }),
      statusBadge(status));
  }));
  $('day-targets').hidden = cards.length === 0;
  $('day-target-legend').hidden = !entries.length || ![...references.values()].some(Boolean);
  $('day-target-legend').textContent = 'Green meets the target. Amber is below it. Red flags an upper limit or an above-target total. Gray means the day or nutrient data is incomplete.';
  const portionLegend = $('portion-share-legend');
  portionLegend.hidden = !entries.some(entry => upperTargets.some(key => portionLimitShare(state.settings, key, entry.nutrients[key])));
  portionLegend.textContent = 'Each food shows its share of a daily limit: low ≤5%, moderate between 5% and 20%, high ≥20%.';
  $('extra-nutrients').replaceChildren(nutrientGrid(nutrientKeys.slice(5), key => [display(key), coverage(key)].filter(Boolean).join(' · ')));
  $('meals').replaceChildren(...meals.map(meal => {
    const list = entries.filter(entry => entry.meal === meal);
    const header = element('div', { className: 'meal-head' }, element('div', {},
      element('h3', { textContent: meal }), element('small', { className: 'muted', textContent: list.length
        ? nutrient('kcal', summarize(list).kcal.value) : 'Ready when you are' })),
      button('+ Add food', () => addFood(meal), ''));
    const rows = list.map(entry => element('div', { className: 'entry' },
      element('div', { className: 'row-main' }, element('strong', { textContent: entry.name }),
        element('small', { textContent: `${size(entry.quantity, entry.unit)} · ${nutrient('kcal', entry.nutrients.kcal)}` }),
        portionLimitBadges(entry.nutrients)),
      button('Edit', () => editEntry(entry))));
    const footer = element('div', { className: 'actions' });
    if (list.length) footer.append(button('Save this meal', () => saveMeal(meal, list)),
      button('Preview a change', () => showMealPreview(meal)));
    if (state.savedMeals.length) footer.append(button('Repeat saved meal', () => repeatMeal(meal)));
    return element('article', { className: 'panel meal' }, header,
      ...(rows.length ? rows : [element('p', { className: 'empty', textContent: 'Nothing logged here yet.' })]), footer);
  }));
}

function renderFoods() {
  const group = $('catalog-category');
  const selection = group.value;
  const groups = [...new Set(allFoods().map(food => food.category))].sort();
  group.replaceChildren(option('', 'All food groups'), ...groups.map(name => option(name)));
  group.value = groups.includes(selection) ? selection : '';
  const results = search($('catalog-query').value).filter(food => !group.value || food.category === group.value);
  $('catalog-count').textContent = `${results.length} matching foods · ${allFoods().length} in your catalog`;
  $('catalog-list').replaceChildren(...results.slice(0, foodLimit).map(food => foodRow(food, inspectFood, 'View')));
  $('more-foods').hidden = results.length <= foodLimit;
  $('saved-meals').replaceChildren(...state.savedMeals.map(item => element('div', { className: 'food-row' },
    element('div', { className: 'row-main' }, element('strong', { textContent: item.name }),
      element('small', { textContent: item.entries.map(entry => entry.name).join(', ') })),
    button('Remove', () => confirmAction('Remove saved meal', `Remove “${item.name}” from saved meals?`, 'Remove',
      () => save(draft => { draft.savedMeals = draft.savedMeals.filter(meal => meal.id !== item.id); }, 'Saved meal removed.'))))));
  if (!state.savedMeals.length) $('saved-meals').append(element('p', { className: 'empty', textContent: 'Your saved meals will appear here.' }));
}

function option(value, text = value) {
  return element('option', { value, textContent: text });
}

function table(headers, rows) {
  return element('div', { className: 'table-scroll' }, element('table', { className: 'nutrition-table' },
    element('thead', {}, element('tr', {}, ...headers.map(heading => element('th', { scope: 'col', textContent: heading })))),
    element('tbody', {}, ...rows.map(([label, ...values]) => element('tr', {},
      element('th', { scope: 'row' }, label), ...values.map(value => element('td', {}, value)))))));
}

function shownTotal(key, total, empty = '—') {
  if (!total.total) return empty;
  const missing = total.total - total.known;
  if (missing && total.known) return `${nutrient(key, total.value)} (partial)`;
  return nutrient(key, total.value);
}

function nutritionPanel(heading, ...content) {
  return element('section', { className: 'panel' }, element('h2', { textContent: heading }), ...content);
}

function statusBadge(status) {
  const container = element('span', { className: 'report-detail' });
  if (status) {
    container.append(element('span', { className: `report-status ${status.tone}`, textContent: status.text }));
    if (status.detail) container.append(element('small', { className: 'muted report-detail', textContent: status.detail }));
  }
  return container;
}

function portionLimitBadges(values) {
  const badges = upperTargets.flatMap(key => {
    const share = portionLimitShare(state.settings, key, values[key]);
    if (!share) return [];
    const percent = share.percent;
    const rounded = Math.round(percent * 10) / 10;
    const display = percent > 5 && rounded === 5 ? '>5%' : percent < 20 && rounded === 20 ? '<20%'
      : percent > 0 && rounded === 0 ? '<0.1%' : `${format(rounded)}%`;
    return [element('span', { className: `report-status ${share.tone}`,
      textContent: `${nutrients[key][0]} ${display} · ${share.text}`,
      title: `${nutrient(key, values[key])} of ${nutrient(key, share.reference.value)} · ${share.reference.label}` })];
  });
  return element('div', { className: 'portion-badges', hidden: !badges.length }, ...badges);
}

function referenceText(key, reference) {
  const prefix = { minimum: '≥ ', maximum: '≤ ', under: '< ', target: '' };
  return `${prefix[reference.type]}${nutrient(key, reference.value)}`;
}

function referenceValue(value, status, tag = 'span') {
  return element(tag, { className: status ? `reference-value ${status.tone}` : '', textContent: value });
}

function referenceCell(key, reference, status) {
  if (!reference) return '—';
  return element('div', {}, referenceText(key, reference),
    element('small', { className: 'muted report-detail', textContent: reference.label }), statusBadge(status));
}

function referenceNote() {
  return element('p', { className: 'muted footnote' }, 'Colors compare logged intake with a daily target. Green meets the reference, amber is below target, and red is above a target or limit. Calorie totals within 5% of your target are marked near target. ',
    element('a', { href: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet', target: '_blank', rel: 'noopener noreferrer', textContent: 'WHO adult references' }),
    ' cover fiber, sodium and potassium. ',
    element('a', { href: 'https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels', target: '_blank', rel: 'noopener noreferrer', textContent: 'FDA label references' }),
    ' cover fat, saturated fat and added sugar and provide the portion share bands. Potassium from meals is an intake estimate. People with kidney disease or medicines that affect potassium may need a different target. ',
    element('a', { href: 'https://ods.od.nih.gov/factsheets/potassium-Consumer/', target: '_blank', rel: 'noopener noreferrer', textContent: 'NIH potassium guidance' }));
}

function renderNutrition() {
  $('nutrition-date').value = day;
  const period = Number($('nutrition-period').value);
  const focus = $('focus-nutrient').value;
  const report = nutritionReport(state, day, period);
  const selected = report.days.at(-1);
  const dates = period === 1 ? prettyDay(day) : `${prettyDay(report.start)} – ${prettyDay(day)}`;
  $('nutrition-coverage').textContent = period === 1
    ? `${dates} · ${selected.entries.length} logged foods · ${selected.complete ? 'Day complete' : 'Day open'}`
    : `${dates} · ${report.complete.length} complete days of ${report.logged} logged. Each average uses complete days with data for that nutrient.`;

  const highlighted = new Set([...primary, ...Object.keys(adultReferences), focus,
    ...targetKeys.filter(key => targetFor(state.settings, key))]);
  const row = key => {
    const metric = report.metrics[key];
    const { average, covered } = metric;
    const total = selected.totals[key];
    const coverage = period === 1 ? `${total.known}/${total.total} foods` : `${covered.length}/${report.complete.length} days`;
    const reference = reportReference(state.settings, key);
    const status = period === 1 ? dayReferenceStatus(total, selected.complete, reference) : trendReferenceStatus(metric, key, reference);
    const label = button(nutrients[key][0], () => {
      $('focus-nutrient').value = key;
      renderNutrition();
      $('focus-nutrient').focus();
    }, 'metric-select');
    label.setAttribute('aria-pressed', String(focus === key));
    const value = period === 1 ? shownTotal(key, total) : (average == null ? '—' : nutrient(key, average));
    return [label, referenceValue(value, status),
      referenceCell(key, reference, status), coverage];
  };
  const headers = ['Nutrient', period === 1 ? 'Logged' : 'Average', 'Daily reference', 'Coverage'];
  const extras = nutrientKeys.filter(key => !highlighted.has(key));
  const totals = nutritionPanel(period === 1 ? 'Nutrient totals' : 'Daily averages',
    table(headers, nutrientKeys.filter(key => highlighted.has(key)).map(row)));
  if (extras.length) {
    totals.append(element('details', { className: 'target-fields' }, element('summary', { textContent: 'More nutrients' }),
      table(headers, extras.map(row))));
  }
  const contribution = foodContributions(period === 1 ? selected.entries : report.complete.flatMap(item => item.entries), focus);
  const sources = nutritionPanel(`Top ${nutrients[focus][0].toLowerCase()} contributors`,
    element('p', { className: 'muted', textContent: `${contribution.known} of ${contribution.count} entries have values${period === 1 ? '' : ' on complete days'}. Ranked by recorded amounts.` }));
  if (contribution.foods.length) {
    const max = contribution.foods[0].amount;
    sources.append(table(['Food', 'Logged amount'], contribution.foods.slice(0, 8).map(item => {
      const bar = element('span', { className: 'nutrition-bar' });
      bar.style.width = `${item.amount / max * 100}%`;
      return [item.name, element('span', {}, nutrient(focus, item.amount), bar)];
    })));
  } else sources.append(element('p', { className: 'empty', textContent: 'No positive amounts recorded for this nutrient.' }));

  const mealPanel = nutritionPanel(`Meals on ${prettyDay(day)}`,
    table(['Meal', ...primary.map(key => nutrients[key][0])], mealGroups(selected.entries)
      .map(({ meal, totals }) => [meal, ...primary.map(key => shownTotal(key, totals[key]))])));
  mealPanel.classList.add('wide');
  const panels = element('div', { className: 'nutrition-panels' }, mealPanel, totals, sources);
  if (period > 1) {
    const reference = reportReference(state.settings, focus);
    const trend = nutritionPanel(`${nutrients[focus][0]} by day`,
      element('p', { className: 'muted', textContent: 'Open days and partial values are shown for context. Daily averages use fully covered, complete days.' }),
      table(['Day', 'Recorded', 'Status'], report.days.map(item => [prettyDay(item.date), shownTotal(focus, item.totals[focus]),
        element('div', {}, item.entries.length ? (item.complete ? 'Complete' : 'Open') : 'No entries',
          statusBadge(dayReferenceStatus(item.totals[focus], item.complete, reference)))])));
    trend.classList.add('wide');
    panels.append(trend);
  }
  $('nutrition-overview').replaceChildren(panels, referenceNote());
  renderSuggestions(selected.entries);
}

function renderSuggestions(dayEntries) {
  const meal = $('preview-meal').value;
  const entries = dayEntries.filter(entry => entry.meal === meal);
  const week = nutritionReport(state, day, 7);
  const items = mealSuggestions(week, entries, allFoods(), state.settings, week.days.flatMap(item => item.entries.map(entry => entry.foodId)));
  const container = $('nutrition-suggestions');
  container.replaceChildren();
  if (!items.length) {
    const text = !entries.length ? 'Choose a logged meal for tailored suggestions, or preview adding a food to this meal.'
      : 'Suggestions appear when a saved target shows a repeated pattern across at least three fully covered, complete days. You can compare a change any time.';
    container.append(element('p', { className: 'muted', textContent: text }));
    return;
  }
  for (const item of items) {
    const { action, entry, food, amount, pattern } = item;
    const headline = action === 'add' ? `Add ${size(amount, food.basis)} of ${food.name}`
      : action === 'reduce' ? `Reduce ${entry.name} to ${size(amount, entry.basis)}`
      : `Swap ${entry.name} for ${size(amount, food.basis)} of ${food.name}`;
    const observation = `${nutrients[pattern.key][0]} was ${pattern.direction} your ${nutrient(pattern.key, pattern.target)} target on ${pattern.count} of ${pattern.covered} fully covered days this week.`;
    container.append(element('article', { className: 'suggestion' }, element('h3', { textContent: headline }),
      element('p', { className: 'muted', textContent: observation }),
      element('p', { className: 'muted', textContent: `Estimated ${nutrients[pattern.key][0].toLowerCase()} change: ${differenceText(pattern.key, item.comparison.difference[pattern.key])}.` }),
      button('Preview suggestion', () => showMealPreview(meal, item), 'secondary')));
  }
  container.append(element('p', { className: 'muted footnote' },
    'Suggestions compare your saved targets and logged foods. Food variety guidance: ',
    element('a', { href: guidanceUrl, target: '_blank', rel: 'noopener noreferrer', textContent: 'ICMR–NIN Dietary Guidelines for Indians' })));
}

function differenceText(key, change) {
  if (change == null) return 'Unknown';
  return `${change > 0 ? '+' : ''}${nutrient(key, change)}`;
}

function showMealPreview(meal, suggested) {
  const dayEntries = state.entries.filter(entry => entry.day === day);
  const entries = dayEntries.filter(entry => entry.meal === meal);
  const action = element('select', {}, option('add', 'Add a food'));
  if (entries.length) action.append(option('reduce', 'Reduce a portion'), option('swap', 'Swap a food'));
  action.value = suggested?.action || 'add';
  const entry = element('select', {}, ...entries.map(item => option(item.id, `${item.name} · ${size(item.quantity, item.unit)}`)));
  if (suggested?.entry) entry.value = suggested.entry.id;
  const entryLabel = element('label', {}, 'Logged food', entry);
  const query = element('input', { type: 'search', placeholder: 'Try rajma or Amul Gold' });
  const matches = element('select', {});
  const foodLabel = element('div', { className: 'stack' }, element('label', {}, 'Find a food', query),
    element('label', {}, 'Choose a result', matches));
  const quantity = element('input', { value: String(suggested?.amount ?? 100) });
  const amountLabel = element('span');
  const results = element('div');
  let food = suggested?.food || null;
  let matching = [];
  const form = element('div', { className: 'stack' }, element('p', { className: 'muted',
    textContent: `Preview for ${prettyDay(day)}. Your diary will keep the amounts you actually logged.` }),
  element('label', {}, 'Change', action), entryLabel, foodLabel, element('label', {}, amountLabel, quantity), results);

  function showMatches() {
    matching = search(query.value).slice(0, 18);
    if (food && !matching.some(item => item.id === food.id)) matching.unshift(food);
    matches.replaceChildren(option('', 'Choose a food'), ...matching.map(item => option(item.id, item.name)));
    matches.value = food?.id || '';
  }

  function update() {
    const selected = entries.find(item => item.id === entry.value);
    const reducing = action.value === 'reduce';
    const basis = reducing ? selected?.basis : food?.basis;
    entryLabel.hidden = action.value === 'add';
    foodLabel.hidden = reducing;
    amountLabel.textContent = `${reducing ? 'New portion amount' : 'Amount to add'}${basis ? ` (${basis})` : ''}`;
    const raw = quantity.value.trim();
    const amount = reducing && /^0+(?:\.0*)?$/.test(raw) ? 0 : parseQuantity(raw);
    const change = { action: action.value, entryId: entry.value, food, amount };
    const comparison = compareMeal(entries, change);
    if (!comparison) {
      results.replaceChildren(element('p', { className: 'muted', textContent: reducing
        ? 'Enter an amount smaller than the logged portion. Use 0 to preview removing it.'
        : 'Choose a food and enter a positive amount to preview the change.' }));
      return;
    }
    const rows = keys => keys.map(key => [nutrients[key][0], shownTotal(key, comparison.before[key], nutrient(key, 0)),
      shownTotal(key, comparison.after[key], nutrient(key, 0)), differenceText(key, comparison.difference[key])]);
    results.replaceChildren(table(['Nutrient', 'Before', 'After', 'Change'], rows(primary)),
      element('details', {}, element('summary', { textContent: 'Compare more nutrients' }),
        table(['Nutrient', 'Before', 'After', 'Change'], rows(nutrientKeys.slice(5)))),
      element('p', { className: 'muted footnote', textContent: 'A change can be calculated when the foods being changed have values for that nutrient.' }));
    const targets = targetKeys.filter(key => targetFor(state.settings, key));
    if (targets.length) {
      const daily = compareMeal(dayEntries, change);
      const targetRows = targets.map(key => [nutrients[key][0], shownTotal(key, daily.before[key], nutrient(key, 0)),
        shownTotal(key, daily.after[key], nutrient(key, 0)),
        `${upperTargets.includes(key) ? '≤ ' : ''}${nutrient(key, targetFor(state.settings, key))}`]);
      results.append(element('h3', { textContent: 'Day totals against your targets' }),
        table(['Nutrient', 'Before', 'After', 'Target'], targetRows));
    }
    if (!reducing) results.append(sourceInfo(food.source));
  }
  action.onchange = () => {
    const current = entries.find(item => item.id === entry.value);
    quantity.value = String(action.value === 'reduce' && current ? current.quantity * current.factor / 2 : 100);
    update();
  };
  entry.onchange = () => {
    const current = entries.find(item => item.id === entry.value);
    if (action.value === 'reduce' && current) quantity.value = String(current.quantity * current.factor / 2);
    update();
  };
  query.oninput = () => { food = null; showMatches(); update(); };
  matches.onchange = () => {
    food = matching.find(item => item.id === matches.value);
    if (food) quantity.value = String(food.portions?.[0]?.amount || 100);
    update();
  };
  quantity.oninput = update;
  showMatches();
  showDialog(`Preview ${meal.toLowerCase()}`, form);
  update();
}

function showWeeklySummary() {
  const text = summaryText(nutritionReport(state, day, 7), state.settings, nutrient);
  const preview = element('textarea', { className: 'summary-text', readOnly: true, value: text });
  const status = element('p', { className: 'muted', role: 'status' });
  const copy = button('Copy summary', async () => {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Weekly summary copied.';
    } catch {
      preview.focus();
      preview.select();
      status.textContent = 'Summary selected. Use your device’s copy command.';
    }
  }, '');
  showDialog('Weekly summary', element('div', { className: 'stack' },
    element('p', { className: 'muted', textContent: 'Review these totals before sharing them. The summary is generated on this device.' }),
    element('label', {}, 'Summary to copy', preview), copy, status));
}

function renderReview() {
  const review = weeklyReview(state, day);
  const nutrientReport = nutritionReport(state, day, 7);
  $('review-range').textContent = `${prettyDay(review.start)} – ${prettyDay(review.end)} · ${review.complete} complete days of ${review.logged} logged`;
  const cards = [];
  const card = (heading, text) => element('article', { className: 'panel' },
    element('h2', { textContent: heading }), element('p', { className: 'muted', textContent: text }));
  if (review.complete < 2) {
    cards.push(card('Build your weekly picture', 'Mark at least two logged days complete in the diary to see patterns. The review uses the seven days ending on the date selected in the diary.'));
  } else {
    const metrics = ['kcal', 'protein', 'fiber'].map(key => {
      const metric = review[key];
      return metric.count >= 2
        ? `${nutrients[key][0]} averaged ${nutrient(key, metric.value)} across ${metric.count} fully covered days.`
        : `${nutrients[key][0]} needs more complete nutrient data.`;
    });
    cards.push(card('Daily averages', metrics.join(' ')));
    if (state.settings.kcal && review.kcal.count >= 2) {
      const target = nutrient('kcal', state.settings.kcal);
      const exact = review.kcal.count - review.aboveCalories - review.belowCalories;
      cards.push(card('Calorie target', `Against your ${target} target, ${review.aboveCalories} days were above, ${review.belowCalories} below and ${exact} matched. ${review.kcal.count} complete days had calorie data. If the difference surprises you, review the saved portions and recipe estimates in those entries.`));
    }
    if (state.settings.protein && review.protein.count >= 2) {
      const comparison = `Protein was below your ${nutrient('protein', state.settings.protein)} target on ${review.belowProtein} of ${review.protein.count} fully covered days.`;
      if (review.belowProtein >= 2) {
        const foods = state.settings.diet === 'vegan' ? 'cooked chana, rajma or tofu'
          : state.settings.diet === 'vegetarian' ? 'dal, plain curd or paneer' : 'dal, eggs or chicken';
        const observed = review.meal ? ` ${review.meal.meal} averaged ${nutrient('protein', review.meal.average)} on ${review.meal.count} of those days when it was logged.` : '';
        const action = ` Try previewing a portion of ${foods} ${review.meal ? `at ${review.meal.meal.toLowerCase()}` : 'with a usual meal'}.`;
        cards.push(card('Protein pattern', comparison + observed + action));
      } else cards.push(card('Protein pattern', comparison));
    } else if (!state.settings.protein) {
      cards.push(card('Protein target', 'You can add your own daily protein target in Settings to see how it compares with complete diary days.'));
    }
    if (!review.categories.includes('Fruit') || !review.categories.includes('Vegetables')) {
      const group = !review.categories.includes('Fruit') && !review.categories.includes('Vegetables')
        ? 'fruit or vegetable' : review.categories.includes('Fruit') ? 'vegetable' : 'fruit';
      cards.push(card('Food variety', `No separate ${group} entries appeared on the ${review.complete} complete days. If you ate some in a mixed dish, it may already be part of that entry. Otherwise try adding a ${group} you enjoy to a usual meal.`));
    }
  }
  const highlights = Object.keys(adultReferences).flatMap(key => {
    const reference = reportReference(state.settings, key);
    if (!reference) return [];
    const metric = nutrientReport.metrics[key];
    const status = trendReferenceStatus(metric, key, reference);
    return [[nutrients[key][0], referenceValue(metric.average == null ? '—' : nutrient(key, metric.average), status),
      referenceCell(key, reference, status)]];
  });
  if (highlights.length) {
    const sodium = trendReferenceStatus(nutrientReport.metrics.sodium, 'sodium', reportReference(state.settings, 'sodium'));
    const fiber = trendReferenceStatus(nutrientReport.metrics.fiber, 'fiber', reportReference(state.settings, 'fiber'));
    cards.push(nutritionPanel('Nutrient highlights',
      table(['Nutrient', 'Daily average', 'Daily reference'], highlights),
      ...(sodium?.tone === 'over' ? [element('p', { className: 'muted footnote', textContent: 'Review your biggest sodium contributors and preview a smaller portion or a lower-sodium swap.' })] : []),
      ...(fiber?.tone === 'below' ? [element('p', { className: 'muted footnote', textContent: 'Try previewing a portion of pulses, whole grains, fruit or vegetables you already eat.' })] : []),
      element('p', { className: 'muted footnote' }, 'See ',
        element('a', { href: '#nutrition', textContent: 'Nutrition' }), ' for daily values, coverage, and reference sources.')));
  }
  $('review-content').replaceChildren(...cards);
}

function renderSettings() {
  const fields = $('settings-form').elements;
  for (const key of ['kcal', 'protein', 'diet', 'goal']) fields[key].value = state.settings[key] ?? '';
  for (const key of targetKeys.slice(2)) fields[key].value = targetFor(state.settings, key) ?? '';
  fields.showReferences.checked = state.settings.showReferences !== false;
  $('last-backup').textContent = state.settings.lastBackup
    ? `Last backup export requested ${new Date(state.settings.lastBackup).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
    : 'No backup exported yet.';
}

function render() {
  const current = tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'diary';
  for (const tab of tabs) {
    $(tab).hidden = tab !== current;
    const link = document.querySelector(`nav a[href="#${tab}"]`);
    if (tab === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (current === 'diary') renderDiary();
  if (current === 'nutrition') renderNutrition();
  if (current === 'foods') renderFoods();
  if (current === 'review') renderReview();
  if (current === 'settings') renderSettings();
}

function addFood(meal) {
  const query = element('input', { id: 'add-query', type: 'search', placeholder: 'Try rajma, dahi or chicken' });
  const results = element('div', { className: 'results' });
  const hint = element('p', { className: 'muted' });
  const update = () => {
    const list = search(query.value);
    hint.textContent = list.length ? `Showing ${Math.min(35, list.length)} of ${list.length} matches`
      : 'No match. Add a custom food from your label or recipe.';
    results.replaceChildren(...list.slice(0, 35).map(food => foodRow(food, selected => choosePortion(selected, meal), 'Select')));
  };
  query.oninput = update;
  const actions = element('div', { className: 'actions' },
    button('+ Custom food', () => customFood(meal), 'secondary'),
    button('Supplement or restaurant label', () => quickLabel(meal), 'secondary'));
  if (state.savedMeals.length) actions.append(button('Repeat saved meal', () => repeatMeal(meal)));
  showDialog(`Add to ${meal.toLowerCase()}`, element('div', { className: 'stack' },
    element('label', { htmlFor: query.id, textContent: 'Search food' }), query, hint, results, actions));
  update();
}

function inspectFood(food) {
  const favorite = state.favorites.includes(food.id);
  const panel = element('div', { className: 'stack' },
    sourceInfo(food.source), element('p', { className: 'tag', textContent: `Nutrition per 100 ${food.basis}` }),
    nutrientGrid(nutrientKeys, key => nutrient(key, food.nutrients[key])));
  if (food.recipe?.length) {
    const parts = food.recipe.map(item => {
      const ingredient = allFoods().find(candidate => candidate.id === item.id);
      return `${ingredient?.name || item.id} · ${size(item.amount, ingredient?.basis || 'g')}`;
    });
    panel.append(element('p', { className: 'muted', textContent: `Batch ingredients: ${parts.join(', ')}` }));
  }
  const meal = element('select', {}, ...meals.map(value => element('option', { value, textContent: value })));
  const actions = element('div', { className: 'actions' }, button('Log food', () => choosePortion(food, meal.value), ''),
    button(favorite ? 'Unfavorite' : 'Favorite', async () => {
      if (await save(draft => {
        draft.favorites = favorite ? draft.favorites.filter(id => id !== food.id) : [...new Set([...draft.favorites, food.id])];
      })) inspectFood(food);
    }));
  panel.append(element('label', {}, `Log on ${prettyDay(day)}`, meal), actions);
  if (food.recipe?.length) actions.append(button('Adapt recipe', () => recipeForm(food), 'secondary'));
  if (food.id.startsWith('custom-') && !food.recipe?.length) actions.append(button('Edit food', () => customFood(null, food), 'secondary'));
  showDialog(food.name, panel);
}

function portionForm({ food, meal, oldEntry }) {
  const custom = state.portions.filter(item => item.foodId === food.id);
  const options = [{ label: food.basis, amount: 1 }, ...(food.portions || []), ...custom];
  if (oldEntry && !options.some(item => item.label === oldEntry.unit && item.amount === oldEntry.factor)) {
    options.push({ label: oldEntry.unit, amount: oldEntry.factor });
  }
  const initial = oldEntry ? options.findIndex(item => item.label === oldEntry.unit && item.amount === oldEntry.factor)
    : custom.length ? options.length - 1 : options.length > 1 ? 1 : 0;
  const amount = element('input', { id: 'portion-amount', value: String(oldEntry?.quantity ?? (initial ? 1 : 100)), required: true });
  const unit = element('select', { id: 'portion-unit' }, ...options.map((option, index) => element('option', {
    value: String(index), textContent: index && !/\d\s*(?:mL|g)\b/i.test(option.label)
      ? `${option.label} (${size(option.amount, food.basis)})` : option.label,
  })));
  unit.value = String(initial);
  const mealSelect = element('select', {}, ...meals.map(value => element('option', { value, textContent: value })));
  mealSelect.value = meal;
  const preview = element('div', { className: 'portion-preview', ariaLive: 'polite' });
  const shares = element('div');
  const form = element('form', { className: 'stack' });
  const error = element('p', { className: 'form-error', role: 'alert' });
  const details = element('details', {}, element('summary', { textContent: 'All nutrients for this portion' }));
  const calculate = () => {
    const quantity = parseQuantity(amount.value);
    if (!quantity) return null;
    const selected = options[Number(unit.value)];
    if (quantity * selected.amount > 1e7) return null;
    return makeEntry(food, quantity, selected.label, selected.amount, mealSelect.value, oldEntry?.day || day);
  };
  const update = () => {
    const result = calculate();
    preview.textContent = result ? `${size(result.quantity * result.factor, result.basis)} · ${nutrient('kcal', result.nutrients.kcal)} · ${nutrient('protein', result.nutrients.protein)} protein` : 'Enter a positive amount, such as 1.5 or 1/2.';
    shares.replaceChildren(...(result ? [portionLimitBadges(result.nutrients)] : []));
    shares.hidden = !shares.querySelector('.report-status');
    details.querySelector('.details-grid')?.remove();
    if (result) details.append(nutrientGrid(nutrientKeys, key => nutrient(key, result.nutrients[key])));
  };
  amount.oninput = update;
  unit.onchange = update;
  const actions = element('div', { className: 'actions' }, element('button', {
    type: 'submit', textContent: oldEntry ? 'Save entry' : 'Log food',
  }), button('+ Personal portion', () => personalPortion(food, meal, oldEntry), 'secondary'));
  if (oldEntry) actions.append(button('Delete entry', () => confirmAction('Delete diary entry',
    `Remove “${oldEntry.name}” from ${oldEntry.meal.toLowerCase()}?`, 'Delete', () => save(draft => {
      draft.entries = draft.entries.filter(item => item.id !== oldEntry.id);
      delete draft.completed[oldEntry.day];
    }, 'Entry deleted. Mark the day complete again when ready.')), 'danger'));
  else actions.append(button('Back to search', () => addFood(meal)));
  form.append(sourceInfo(food.source), element('div', { className: 'fields' },
    element('label', {}, 'Quantity', amount), element('label', {}, 'Unit', unit)),
  element('label', {}, 'Meal', mealSelect), preview, shares, details, error, actions);
  form.onsubmit = async event => {
    event.preventDefault();
    const result = calculate();
    if (!result) return formError(form, 'Enter a valid portion.');
    await save(draft => {
      if (oldEntry) {
        if (!draft.entries.some(item => item.id === oldEntry.id)) throw new Error('This entry was removed in another tab.');
        draft.entries = draft.entries.map(item => item.id === oldEntry.id
          ? { ...result, id: item.id, createdAt: item.createdAt } : item);
      } else draft.entries.push(result);
      delete draft.completed[result.day];
    }, oldEntry ? 'Entry updated.' : `Added ${result.name} to ${result.meal.toLowerCase()}.`, () => dialog.close());
  };
  showDialog(food.name, form);
  update();
}

function choosePortion(food, meal) {
  portionForm({ food, meal });
}

function editEntry(entry) {
  const factor = 100 / (entry.quantity * entry.factor);
  const currentFood = allFoods().find(item => item.id === entry.foodId);
  const food = { ...currentFood, id: entry.foodId, name: entry.name, basis: entry.basis,
    category: entry.category, source: entry.source, nutrients: Object.fromEntries(Object.entries(entry.nutrients)
      .map(([key, amount]) => [key, amount * factor])) };
  portionForm({ food, meal: entry.meal, oldEntry: entry });
}

function personalPortion(food, meal, oldEntry) {
  const form = element('form', { className: 'stack' });
  const label = element('input', { required: true, maxLength: 50, placeholder: 'My katori' });
  const amount = element('input', { type: 'number', min: '0.01', max: '100000', step: 'any', required: true });
  form.append(element('label', {}, 'Portion name', label), element('label', {}, `Amount in ${food.basis}`, amount),
    element('p', { className: 'form-error', role: 'alert' }), element('button', { type: 'submit', textContent: 'Save portion' }));
  form.onsubmit = async event => {
    event.preventDefault();
    if (!label.value.trim()) return formError(form, 'Enter a portion name.');
    await save(draft => {
      draft.portions = draft.portions.filter(item => !(item.foodId === food.id && item.label.toLowerCase() === label.value.trim().toLowerCase()));
      draft.portions.push({ id: crypto.randomUUID(), foodId: food.id, label: label.value.trim(), amount: amount.valueAsNumber });
    }, 'Personal portion saved.', () => portionForm({ food, meal, oldEntry }));
  };
  showDialog(`Personal portion for ${food.name}`, form);
}

function quickLabel(meal) {
  showDialog('Add a label or restaurant order', element('div', { className: 'stack' },
    element('p', { className: 'muted', textContent: 'Enter the figures from your exact product or menu. Save it once to reuse it later. For a restaurant meal with no label, choose a similar catalog dish or save a clearly marked estimate.' }),
    element('div', { className: 'actions' }, ...presets.map(name =>
      button(name, () => customFood(meal, null, name), 'secondary')))));
}

function customFood(meal, existing, preset = '') {
  const form = element('form', { className: 'stack' });
  const input = (properties = {}) => element('input', properties);
  const name = input({ required: true, maxLength: 100, value: existing?.name || (preset === 'Zomato order' ? '' : preset),
    placeholder: preset === 'Zomato order' ? 'Restaurant and dish name' : 'Brand, food and variant' });
  const kind = element('select', {}, ...sourceTypes.map(value => element('option', { value, textContent: value })));
  kind.value = existing?.source.label || (preset === 'Zomato order' ? sourceTypes[1] : sourceTypes[0]);
  const category = element('select', {}, ...[...new Set(['Custom food', 'Supplements', 'Restaurant meal', 'Fruit', 'Vegetables',
    ...catalog.map(food => food.category)])].map(value => element('option', { value, textContent: value })));
  category.value = existing?.category || (preset === 'Zomato order' ? 'Restaurant meal' : preset && preset !== 'MIILD Protein Roti' ? 'Supplements' : 'Custom food');
  const basis = element('select', {}, ...['g', 'ml'].map(value => element('option', { value, textContent: value })));
  basis.value = existing?.basis || 'g';
  if (existing) basis.disabled = true;
  const firstPortion = existing?.portions?.[0];
  const reference = input({ type: 'number', min: '0.001', max: '100000', step: 'any', required: true, value: String(firstPortion?.amount || 100) });
  const portionName = input({ maxLength: 50, placeholder: 'e.g. scoop or piece', value: firstPortion?.label || (preset === 'Zomato order' ? 'order' : '') });
  const note = input({ maxLength: 250, value: existing?.source.note || '', placeholder: 'Flavour, label date or estimate details' });
  const url = input({ type: 'url', maxLength: 500, value: existing?.source.url || '', placeholder: 'https://…' });
  const fields = Object.fromEntries(nutrientKeys.map(key => [key, input({
    type: 'number', min: '0', max: '100000', step: 'any', required: key === 'kcal',
    value: Number.isFinite(existing?.nutrients[key]) ? String(Math.round(existing.nutrients[key] * (firstPortion?.amount || 100) * 1000000 / 100) / 1000000) : '',
  })]));
  const grid = keys => element('div', { className: 'fields three' }, ...keys.map(key =>
    element('label', {}, `${nutrients[key][0]} (${nutrients[key][1]})`, fields[key])));
  form.append(element('label', {}, 'Food name', name),
    element('div', { className: 'fields' }, element('label', {}, 'Source type', kind), element('label', {}, 'Food group', category)),
    element('div', { className: 'fields three' }, element('label', {}, 'Label amount', reference),
      element('label', {}, 'Unit', basis), element('label', {}, 'Portion name', portionName)),
    element('p', { className: 'muted', textContent: 'Enter nutrients for the label amount above. For a scoop or package serving, use its stated weight or volume. Leave unlisted nutrients blank.' }),
    grid(primary), element('details', {}, element('summary', { textContent: 'More nutrient fields' }), grid(nutrientKeys.slice(5))),
    element('label', {}, 'Source notes (optional)', note), element('label', {}, 'Source link (optional)', url),
    element('p', { className: 'form-error', role: 'alert' }), element('button', { type: 'submit', textContent: 'Save food' }));
  form.onsubmit = async event => {
    event.preventDefault();
    if (!name.value.trim()) return formError(form, 'Enter a food name.');
    if (url.value && !/^https?:\/\//i.test(url.value)) return formError(form, 'Enter an https or http source link.');
    const factor = 100 / reference.valueAsNumber;
    const food = { id: existing?.id || `custom-${crypto.randomUUID()}`, name: name.value.trim(),
      category: category.value, basis: basis.value,
      nutrients: Object.fromEntries(nutrientKeys.filter(key => fields[key].value !== '')
        .map(key => [key, fields[key].valueAsNumber * factor])),
      portions: portionName.value.trim() ? [{ label: portionName.value.trim(), amount: reference.valueAsNumber }] : [],
      source: { label: kind.value, ...(note.value.trim() ? { note: note.value.trim() } : {}), ...(url.value ? { url: url.value } : {}) } };
    try { validateCatalog([food]); } catch (error) { return formError(form, error.message); }
    await save(draft => {
      draft.foods = [...draft.foods.filter(item => item.id !== food.id), food];
    }, 'Food saved.', () => meal ? choosePortion(food, meal) : inspectFood(food));
  };
  showDialog(existing ? 'Edit custom food' : 'Save a custom food', form);
}

function recipeForm(template) {
  const form = element('form', { className: 'stack' });
  const rows = element('div');
  const available = allFoods().slice().sort((a, b) => a.name.localeCompare(b.name));
  const ingredients = new Map(available.map(food => [food.id, food]));
  const recipeName = element('input', { required: true, maxLength: 100, value: template ? `My ${template.name}` : '' });
  const cooked = element('input', { type: 'number', min: '0.01', max: '100000', step: 'any', placeholder: 'Best for accuracy' });
  const servings = element('input', { type: 'number', min: '0.01', max: '10000', step: 'any', placeholder: 'Optional with weight' });
  const group = element('select', {}, ...['Indian dishes', 'Vegetables', 'Fruit', 'Custom food'].map(value => element('option', { value, textContent: value })));
  const addRow = (ingredient = {}) => {
    const select = element('select', { required: true },
      element('option', { value: '', textContent: 'Select food' }),
      ...available.map(food => element('option', { value: food.id, textContent: food.name })));
    select.value = ingredients.has(ingredient.id) ? ingredient.id : '';
    const quantity = element('input', { required: true, value: ingredient.amount ? String(ingredient.amount) : '' });
    const unit = element('span');
    const update = () => { unit.textContent = `Amount (${ingredients.get(select.value)?.basis || 'g or ml'})`; };
    select.onchange = update;
    update();
    const row = element('div', { className: 'recipe-row' }, element('label', {}, 'Ingredient', select),
      element('label', {}, unit, quantity), button('Remove', () => row.remove()));
    rows.append(row);
  };
  for (const ingredient of template?.recipe || [{}]) addRow(ingredient);
  form.append(element('label', {}, 'Recipe name', recipeName), element('label', {}, 'Food group', group), rows,
    button('+ Add ingredient', () => addRow(), 'secondary'),
    element('div', { className: 'fields' }, element('label', {}, 'Cooked batch weight (g)', cooked), element('label', {}, 'Servings in batch', servings)),
    element('p', { className: 'muted', textContent: 'Include the oil, ghee and sugar you use. For a serving-only batch with ingredients weighed in grams, the app estimates weight from their sum. Enter cooked weight for recipes with ingredients measured in millilitres.' }),
    element('p', { className: 'form-error', role: 'alert' }), element('button', { type: 'submit', textContent: 'Save recipe' }));
  form.onsubmit = async event => {
    event.preventDefault();
    const items = [...rows.children].map(row => ({
      food: ingredients.get(row.querySelector('select').value), amount: parseQuantity(row.querySelector('input').value),
    }));
    const name = recipeName.value.trim();
    const weight = cooked.valueAsNumber;
    const count = servings.valueAsNumber;
    if (!name || !items.length || items.some(item => !item.food || !item.amount)) return formError(form, 'Enter a name and a valid amount for every ingredient.');
    if (!weight && (!count || items.some(item => item.food.basis !== 'g'))) {
      return formError(form, 'Enter the cooked weight, or servings for a recipe with ingredients weighed in grams.');
    }
    const yieldWeight = weight || items.reduce((sum, item) => sum + item.amount, 0);
    const food = { id: `recipe-${crypto.randomUUID()}`, name, category: group.value, basis: 'g',
      nutrients: calculateRecipe(items, yieldWeight),
      portions: count ? [{ label: 'serving', amount: yieldWeight / count }] : [],
      source: { label: 'Homemade recipe estimate',
        note: weight ? `Calculated from your ingredients and ${size(weight, 'g')} cooked yield.`
          : `Calculated per serving. Weight uses the ${size(yieldWeight, 'g')} sum of ingredients as an estimate.` },
      recipe: items.map(item => ({ id: item.food.id, amount: item.amount })) };
    try { validateCatalog([food]); } catch (error) { return formError(form, error.message); }
    await save(draft => { draft.foods.push(food); }, 'Recipe saved.', () => inspectFood(food));
  };
  showDialog(template ? 'Adapt this recipe' : 'Build a recipe', form);
}

function saveMeal(meal, entries) {
  const form = element('form', { className: 'stack' });
  const name = element('input', { maxLength: 80, required: true, placeholder: 'e.g. Usual lunch' });
  form.append(element('label', {}, 'Saved meal name', name),
    element('p', { className: 'muted', textContent: entries.map(entry => entry.name).join(' · ') }),
    element('p', { className: 'form-error', role: 'alert' }),
    element('button', { type: 'submit', textContent: 'Save meal' }));
  form.onsubmit = async event => {
    event.preventDefault();
    if (!name.value.trim()) return formError(form, 'Enter a meal name.');
    await save(draft => {
      draft.savedMeals.push({ id: crypto.randomUUID(), name: name.value.trim(), entries });
    }, `${meal} saved to your library.`, () => dialog.close());
  };
  showDialog('Save this meal', form);
}

function repeatMeal(meal) {
  const selectedDay = day;
  const savedMeals = state.savedMeals;
  const selection = element('select', {}, ...savedMeals.map(item => option(item.id, item.name)));
  const amount = element('select', {}, option('0.5', '½× · Half'), option('1', '1× · As saved'),
    option('1.5', '1½×'), option('2', '2× · Double'), option('custom', 'Custom'));
  amount.value = '1';
  const custom = element('input', { placeholder: 'e.g. 3/4 or 1.25', autoComplete: 'off' });
  const customLabel = element('label', { hidden: true }, 'Custom multiplier', custom);
  const preview = element('div', { className: 'portion-preview stack' });
  const error = element('p', { className: 'form-error', role: 'alert' });
  const submit = element('button', { type: 'submit', textContent: 'Add meal' });
  const form = element('form', { className: 'stack' },
    element('p', { className: 'muted', textContent: `Add to ${meal.toLowerCase()} on ${prettyDay(selectedDay)}. The same multiplier applies to every food.` }),
    element('label', {}, 'Saved meal', selection), element('label', {}, 'Meal amount', amount), customLabel, preview, error, submit);
  const multiplier = () => parseQuantity(amount.value === 'custom' ? custom.value : amount.value);

  function update() {
    error.textContent = '';
    customLabel.hidden = amount.value !== 'custom';
    try {
      const item = savedMeals.find(candidate => candidate.id === selection.value);
      const entries = scaleMealEntries(item.entries, multiplier());
      const total = summarize(entries);
      preview.replaceChildren(
        element('strong', { ariaLive: 'polite', textContent: `${shownTotal('kcal', total.kcal)} · Protein ${shownTotal('protein', total.protein)}` }),
        element('ul', { className: 'meal-portion-list' }, ...entries.map(entry => element('li', {},
          `${entry.name} · ${size(entry.quantity * entry.factor, entry.basis)}`))));
      submit.disabled = false;
    } catch (failure) {
      preview.replaceChildren(element('p', { className: 'muted', textContent: failure.message }));
      submit.disabled = true;
    }
  }

  selection.onchange = update;
  amount.onchange = () => {
    update();
    if (amount.value === 'custom') custom.focus();
  };
  custom.oninput = update;
  form.onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const selectedId = selection.value;
    const ratio = multiplier();
    submit.disabled = selection.disabled = amount.disabled = custom.disabled = true;
    const success = await save(draft => {
      const current = draft.savedMeals.find(candidate => candidate.id === selectedId);
      if (!current) throw new Error('This saved meal was removed in another tab.');
      const createdAt = new Date().toISOString();
      for (const entry of scaleMealEntries(current.entries, ratio)) {
        draft.entries.push({ ...entry, id: crypto.randomUUID(), day: selectedDay, meal, createdAt });
      }
      delete draft.completed[selectedDay];
    }, `Added ${format(ratio)}× the saved meal to ${meal.toLowerCase()}.`, () => dialog.close());
    if (!success) submit.disabled = selection.disabled = amount.disabled = custom.disabled = false;
  };
  showDialog('Repeat a saved meal', form);
  update();
}

function confirmAction(title, description, label, action) {
  const confirm = button(label, async () => {
    confirm.disabled = true;
    if (await action()) dialog.close();
    else confirm.disabled = false;
  }, 'danger');
  showDialog(title, element('div', { className: 'stack' }, element('p', { textContent: description }),
    element('p', { className: 'form-error', role: 'alert' }),
    element('div', { className: 'actions' }, confirm, button('Cancel', () => dialog.close()))));
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = element('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function readJson(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return undefined;
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a JSON file smaller than 25 MB.');
  try { return JSON.parse(await file.text()); } catch { throw new Error('The file is not readable JSON.'); }
}

function goToDay(value) {
  day = value;
  renderDiary();
}

function bind() {
  $('focus-nutrient').replaceChildren(...nutrientKeys.map(key => option(key, nutrients[key][0])));
  $('preview-meal').replaceChildren(...meals.map(meal => option(meal)));
  $('preview-meal').value = 'Lunch';
  const targetField = key => {
    const [name, unit] = nutrients[key];
    const qualifier = upperTargets.includes(key) ? ' limit' : ' target';
    return element('label', {}, `${name}${qualifier} (${unit})`, element('input', {
      name: key, type: 'number', min: '0.001', max: '100000', step: 'any', placeholder: 'Optional',
    }));
  };
  const commonTargets = ['fiber', 'sodium', 'fat', 'saturatedFat'];
  $('primary-nutrient-targets').append(...commonTargets.map(targetField));
  $('extra-nutrient-targets').append(...targetKeys.slice(2).filter(key => !commonTargets.includes(key)).map(targetField));
  $('nutrition-period').onchange = renderNutrition;
  $('focus-nutrient').onchange = renderNutrition;
  $('nutrition-date').onchange = event => {
    if (event.target.validity.valid && event.target.value) {
      day = event.target.value;
      renderNutrition();
    }
  };
  $('preview-meal').onchange = () => renderSuggestions(state.entries.filter(entry => entry.day === day));
  $('jump-preview').onclick = () => $('preview-heading').focus();
  $('preview-change').onclick = () => showMealPreview($('preview-meal').value);
  $('weekly-summary').onclick = showWeeklySummary;
  $('close-modal').onclick = () => dialog.close();
  $('previous').onclick = () => goToDay(shiftDay(day, -1));
  $('next').onclick = () => goToDay(shiftDay(day, 1));
  $('today').onclick = () => goToDay(today());
  $('day').onchange = event => { if (event.target.validity.valid && event.target.value) goToDay(event.target.value); };
  $('complete').onchange = async event => {
    const checked = event.target.checked;
    const target = day;
    if (!await save(draft => {
      if (checked && !draft.entries.some(entry => entry.day === target)) throw new Error('Log a meal before marking this day complete.');
      if (checked) draft.completed[target] = true;
      else delete draft.completed[target];
    })) renderDiary();
  };
  $('catalog-query').oninput = () => { foodLimit = 24; renderFoods(); };
  $('catalog-category').onchange = () => { foodLimit = 24; renderFoods(); };
  $('more-foods').onclick = () => { foodLimit += 24; renderFoods(); };
  $('new-food').onclick = () => customFood(null);
  $('new-recipe').onclick = () => recipeForm();
  $('settings-form').onsubmit = async event => {
    event.preventDefault();
    const fields = event.target.elements;
    const kcal = fields.kcal.valueAsNumber || null;
    const protein = fields.protein.valueAsNumber || null;
    const diet = fields.diet.value;
    const goal = fields.goal.value;
    const showReferences = fields.showReferences.checked;
    const nutrientTargets = Object.fromEntries(targetKeys.slice(2)
      .filter(key => Number.isFinite(fields[key].valueAsNumber))
      .map(key => [key, fields[key].valueAsNumber]));
    await save(draft => {
      Object.assign(draft.settings, { kcal, protein, diet, nutrientTargets, showReferences });
      if (goal) draft.settings.goal = goal;
      else delete draft.settings.goal;
    }, 'Targets saved.');
  };
  $('backup').onclick = async () => {
    const exportedAt = new Date().toISOString();
    await save(draft => { draft.settings.lastBackup = exportedAt; }, 'Backup export requested.', () =>
      download(`fitness-agent-nutrition-${today()}.json`, JSON.stringify({ version: backupVersion, exportedAt, data: state }, null, 2), 'application/json'));
  };
  $('csv').onclick = async () => {
    try {
      const latest = await loadDiary(db);
      download(`fitness-agent-nutrition-${today()}.csv`, '\uFEFF' + diaryCsv(latest.entries), 'text/csv;charset=utf-8');
    } catch { message('Could not export the diary.', true); }
  };
  $('restore').onclick = () => $('backup-file').click();
  $('backup-file').onchange = async event => {
    try {
      const json = await readJson(event.target);
      if (json === undefined) return;
      const restored = validateBackup(json);
      confirmAction('Restore this backup?', `This file contains ${restored.entries.length} entries, ${restored.foods.length} custom foods and ${restored.savedMeals.length} saved meals. Restoring replaces the current diary and settings on this device.`, 'Replace local diary',
        () => save(() => restored, 'Backup restored.'));
    } catch (error) { message(error.message, true); }
  };
  $('import-catalog').onclick = () => $('catalog-file').click();
  $('catalog-file').onchange = async event => {
    try {
      const json = await readJson(event.target);
      if (json === undefined) return;
      const imported = validateCatalog(json);
      const reserved = new Set(catalog.map(food => food.id));
      const conflicting = imported.find(food => reserved.has(food.id) || /^(?:custom|recipe)-/.test(food.id));
      if (conflicting) throw new Error(`“${conflicting.name}” uses a reserved food ID. Give it a unique personal ID.`);
      const ids = new Set(imported.map(food => food.id));
      confirmAction('Import these foods?', `${imported.length} foods will be added to your personal catalog. Matching personal food IDs will be updated. Past diary entries keep their saved values.`, 'Import foods',
        () => save(draft => { draft.foods = [...draft.foods.filter(food => !ids.has(food.id)), ...imported]; }, 'Personal foods imported.'));
    } catch (error) { message(error.message, true); }
  };
  $('sample-catalog').onclick = () => download('fitness-agent-nutrition-food-example.json', JSON.stringify([{
    id: 'personal-example', name: 'Example food (replace with your label)', category: 'Custom food', basis: 'g',
    aliases: ['example'], nutrients: { kcal: 100, protein: 4 }, portions: [{ label: 'serving', amount: 75 }],
    source: { label: 'Package label', note: 'Nutrients in this file are per 100 g.' },
  }], null, 2), 'application/json');
  window.addEventListener('hashchange', render);
  window.addEventListener('pageshow', async event => {
    if (event.persisted) {
      try { state = await loadDiary(db); render(); } catch { message('Could not refresh the local diary.', true); }
    }
  });
}

async function init() {
  try {
    const [database, response] = await Promise.all([openDiary(), fetch('./catalog.json')]);
    if (!response.ok) throw new Error('The food catalog could not load.');
    db = database;
    catalog = validateCatalog(await response.json());
    state = await loadDiary(db);
    bind();
    render();
  } catch (error) {
    message(`Could not open your food diary. ${error.message} Reload and check that browser storage is available.`, true);
    return;
  }
  if ('serviceWorker' in navigator) {
    try {
      const ready = registerOffline('../sw.js');
      const timeout = setTimeout(() => {
        $('offline-status').textContent = 'Offline setup is taking longer than expected. Reload while online to retry.';
      }, 15000);
      await ready;
      clearTimeout(timeout);
      $('offline-status').textContent = 'Ready offline on this browser.';
    } catch {
      $('offline-status').textContent = 'Offline setup could not finish. Reload while online to try again.';
    }
  } else $('offline-status').textContent = 'Offline installation needs a browser with service worker support.';
}

init();
