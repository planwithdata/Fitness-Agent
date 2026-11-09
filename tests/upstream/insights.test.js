import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { backupVersion, emptyState, makeEntry, validateBackup } from '../../site/nutrition/core.js';
import {
  compareMeal, dayReferenceStatus, foodContributions, mealSuggestions, nutritionReport,
  portionLimitShare, reportReference, summaryText, targetPatterns, trendReferenceStatus,
} from '../../site/nutrition/insights.js';

const foods = JSON.parse(readFileSync(new URL('../../site/nutrition/catalog.json', import.meta.url), 'utf8'));
const byId = new Map(foods.map(food => [food.id, food]));
const day = '2026-11-09';
const meal = 'Lunch';
const food = (id, amount = 100, date = day) => makeEntry(byId.get(id), amount, byId.get(id).basis, 1, meal, date);

test('daily and trend views preserve partial totals and use only fully covered complete days for averages', () => {
  const state = emptyState();
  state.entries = [food('rice-cooked'), food('rajma'), food('rajma', 150, '2026-11-08'),
    food('rajma', 25, '2026-11-07'), food('rajma', 30, '2026-10-25')];
  delete state.entries[0].nutrients.fiber;
  state.completed[day] = state.completed['2026-11-08'] = state.completed['2026-10-25'] = true;
  const daily = nutritionReport(state, day, 1);
  assert.equal(daily.days[0].totals.fiber.known, 1);
  assert.equal(daily.days[0].totals.fiber.total, 2);
  assert.equal(daily.metrics.fiber.average, null);
  const week = nutritionReport(state, day, 7);
  assert.equal(week.logged, 3);
  assert.equal(week.metrics.kcal.covered.length, 2);
  assert.equal(week.metrics.fiber.covered.length, 1);
  assert.equal(nutritionReport(state, day, 30).metrics.fiber.covered.length, 2);
  const ranked = foodContributions(week.complete.flatMap(item => item.entries), 'fiber');
  assert.equal(ranked.known, 2);
  assert.equal(ranked.count, 3);
  assert.equal(ranked.foods[0].count, 2);
});

test('preview supports add, reduce and swap without changing a log or inventing unknown values', () => {
  const rice = food('rice-cooked');
  const legacy = food('curd');
  delete legacy.nutrients.fiber;
  const original = [rice, legacy];
  const before = structuredClone(original);
  const rajma = byId.get('rajma');
  const swapped = compareMeal(original, { action: 'swap', entryId: rice.id, food: rajma, amount: 100 });
  assert.ok(Math.abs(swapped.difference.kcal + 20.7293) < 1e-6);
  assert.ok(Math.abs(swapped.difference.fiber - 4.7734) < 1e-6);
  assert.equal(swapped.after.fiber.known, 1);
  assert.equal(swapped.after.fiber.total, 2);
  assert.equal(compareMeal(original, { action: 'reduce', entryId: rice.id, amount: 50 }).difference.kcal, -65);
  assert.equal(compareMeal(original, { action: 'reduce', entryId: rice.id, amount: 100 }), null);
  assert.equal(compareMeal(original, { action: 'reduce', entryId: rice.id, amount: 0 }).difference.kcal, -130);
  assert.equal(compareMeal(original, { action: 'add', food: rajma, amount: 100 }).difference.kcal, rajma.nutrients.kcal);
  assert.equal(compareMeal(original, { action: 'reduce', entryId: legacy.id, amount: 50 }).difference.fiber, null);
  assert.deepEqual(original, before);
});

test('meal suggestions need repeated covered days, honor vegan choices and improve the selected target', () => {
  const state = emptyState();
  state.settings.diet = 'vegan';
  state.settings.nutrientTargets = { fiber: 20 };
  const dates = [day, '2026-11-08', '2026-11-07'];
  state.entries = dates.map(date => food('rice-cooked', 100, date));
  state.completed = Object.fromEntries(dates.slice(0, 2).map(date => [date, true]));
  const mealEntries = state.entries.slice(0, 1);
  assert.deepEqual(mealSuggestions(nutritionReport(state, day, 7), mealEntries, foods, state.settings, ['rajma']), []);
  state.completed[dates[2]] = true;
  const report = nutritionReport(state, day, 7);
  assert.equal(targetPatterns(report, state.settings)[0].count, 3);
  const [suggestion] = mealSuggestions(report, mealEntries, foods, state.settings, ['rajma']);
  assert.equal(suggestion.pattern.key, 'fiber');
  assert.ok(suggestion.comparison.difference.fiber > 0);
  assert.ok(!['curd', 'paneer', 'egg-boiled', 'chicken-breast'].includes(suggestion.food?.id));
});

test('summary exposes aggregate coverage and new targets remain compatible with existing backups', () => {
  const original = emptyState();
  assert.deepEqual(validateBackup({ version: backupVersion, data: original }), original);
  const state = structuredClone(original);
  Object.assign(state.settings, { goal: 'maintain', diet: 'vegetarian', nutrientTargets: { iron: 10, sodium: 1700 } });
  const entry = food('rice-cooked');
  state.entries.push(entry);
  state.completed[day] = true;
  const text = summaryText(nutritionReport(state, day, 7), state.settings, (_key, amount) => String(amount));
  assert.match(text, /1 complete days? of 1 logged days?/);
  assert.match(text, /Maintain weight/);
  assert.match(text, /Food preference: vegetarian/);
  assert.match(text, /my limit 1700/);
  assert.ok(!text.includes(entry.name));
  assert.deepEqual(validateBackup({ version: backupVersion, data: state }), state);
  state.settings.nutrientTargets.sodium = '1700';
  assert.throws(() => validateBackup({ version: backupVersion, data: state }), /invalid diary data/);
});

test('report colors use adult or personal references and avoid judging an incomplete low total', () => {
  const settings = emptyState().settings;
  const potassium = reportReference(settings, 'potassium');
  const sodium = reportReference(settings, 'sodium');
  const example = { value: 2399, known: 2, total: 2 };
  assert.equal(dayReferenceStatus(example, true, potassium).tone, 'below');
  assert.equal(dayReferenceStatus(example, false, potassium).tone, 'neutral');
  assert.equal(dayReferenceStatus({ ...example, known: 1 }, true, potassium).text, 'Partial data');
  assert.equal(dayReferenceStatus({ ...example, value: 5000 }, true, potassium).tone, 'met');
  assert.equal(dayReferenceStatus({ ...example, value: 2000, known: 1 }, false, sodium).tone, 'over');
  const covered = [1400, 1600, 2200].map(value => ({ totals: { sodium: { value } } }));
  assert.equal(trendReferenceStatus({ average: 1600, covered: covered.slice(0, 2) }, 'sodium', sodium).tone, 'neutral');
  const trend = trendReferenceStatus({ average: 5200 / 3, covered }, 'sodium', sodium);
  assert.equal(trend.tone, 'met');
  assert.match(trend.detail, /2\/3/);
  settings.showReferences = false;
  assert.equal(reportReference(settings, 'potassium'), null);
  settings.nutrientTargets = { potassium: 3000 };
  assert.equal(reportReference(settings, 'potassium').label, 'Your target');
});

test('portion colors use the actual portion, the selected limit and inclusive 5% and 20% bands', () => {
  const settings = emptyState().settings;
  assert.equal(portionLimitShare(settings, 'fat', 0).tone, 'met');
  assert.equal(portionLimitShare(settings, 'saturatedFat', 1).tone, 'met');
  assert.equal(portionLimitShare(settings, 'saturatedFat', 1.01).tone, 'moderate');
  assert.equal(portionLimitShare(settings, 'saturatedFat', 4).tone, 'over');
  assert.equal(portionLimitShare(settings, 'fat', 16).reference.value, 78);
  assert.equal(portionLimitShare(settings, 'fat', undefined), null);
  assert.equal(portionLimitShare(settings, 'potassium', 5000), null);
  settings.showReferences = false;
  assert.equal(portionLimitShare(settings, 'fat', 16), null);
  settings.nutrientTargets = { fat: 50 };
  assert.equal(portionLimitShare(settings, 'fat', 10).percent, 20);
  assert.equal(portionLimitShare(settings, 'fat', 10).tone, 'over');
  settings.kcal = 2000;
  const calorieReference = reportReference(settings, 'kcal');
  assert.equal(dayReferenceStatus({ value: 2101, known: 1, total: 1 }, false, calorieReference).tone, 'over');
  assert.equal(dayReferenceStatus({ value: 1900, known: 1, total: 1 }, true, calorieReference).tone, 'met');
});
