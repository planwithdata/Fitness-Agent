import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  backupVersion, calculateRecipe, diaryCsv, emptyState, findFoods, makeEntry, parseQuantity,
  scaleMealEntries, summarize, validateBackup, validateCatalog, weeklyReview,
} from '../../site/nutrition/core.js';

const foods = validateCatalog(JSON.parse(readFileSync(new URL('../../site/nutrition/catalog.json', import.meta.url), 'utf8')));
const catalog = new Map(foods.map(food => [food.id, food]));
const day = '2026-11-09';
const approximate = (actual, expected, difference = 0.01) => assert.ok(
  Math.abs(actual - expected) <= difference, `Expected ${expected}, received ${actual}`,
);
const entry = (id, quantity, unit, factor, date = day, meal = 'Lunch') =>
  makeEntry(catalog.get(id), quantity, unit, factor, meal, date);

test('finds everyday Indian foods, supplements, and clearly sourced delivery proxies', () => {
  for (const [query, id] of [
    ['chapati', 'roti'], ['dahi', 'curd'], ['chola', 'chole'], ['rajma', 'rajma'],
    ['paneer', 'paneer'], ['miild protein roti', 'milld-roti'], ['whey protein', 'on-whey-drc'],
    ['on serious mass', 'on-serious-mass-choc'], ['on creatine', 'on-creatine'],
    ['kela', 'banana'], ['zomato chicken biryani', 'biryani-chicken'],
  ]) assert.ok(findFoods(foods, query).some(food => food.id === id), query);
  assert.match(catalog.get('biryani-chicken').source.label, /survey estimate/i);
  assert.ok(catalog.get('biryani-chicken').source.note.includes('can differ'));
  assert.equal(findFoods(foods, 'BCAA').length, 0);
  for (const food of foods) for (const item of food.recipe || []) assert.ok(catalog.has(item.id), item.id);
});

test('finds North Indian preparations by common names and spellings', () => {
  for (const query of ['shahi paneer', 'palak paneer', 'aloo sabzi', 'chola bhatura',
    'bhatura', 'tinda', 'tori', 'karela', 'methi aloo', 'kaddu', 'bhindi', 'lauki', 'gajar matar']) {
    assert.ok(findFoods(foods, query).some(food => food.portions?.length && food.source.url), query);
  }
  const dish = catalog.get('chole-bhatura');
  assert.equal(dish.portions[0].amount, 225);
  const combined = entry(dish.id, 1, 'plate', dish.portions[0].amount);
  approximate(combined.nutrients.kcal, 480.6, 0.1);
});

test('accepts familiar portions and rejects invalid quantities', () => {
  for (const [quantity, expected] of [['1 1/2', 1.5], ['½', 0.5], ['2¾', 2.75], ['0.25', 0.25], ['.5', 0.5]]) {
    assert.equal(parseQuantity(quantity), expected);
  }
  for (const quantity of ['', '-1', '0', 'Infinity', '1/0', '1.5.2', '2 rotis', '1e5']) {
    assert.equal(parseQuantity(quantity), null, quantity);
  }
});

test('repeating a saved meal scales mixed portions and known nutrients using the same ratio', () => {
  const originals = [entry('roti', 2, 'piece', 40), entry('amul-gold-pouch', 1, 'glass', 200)];
  const snapshot = structuredClone(originals);
  const half = scaleMealEntries(originals, 0.5);
  assert.deepEqual(half.map(food => [food.quantity, food.unit, food.factor]), [[1, 'piece', 40], [0.5, 'glass', 200]]);
  assert.equal(summarize(half).kcal.value, 189);
  assert.equal(half[1].nutrients.fiber, undefined);
  assert.equal(summarize(scaleMealEntries(originals, 2)).kcal.value, 756);
  assert.equal(summarize(scaleMealEntries(originals, parseQuantity('3/4'))).kcal.value, 283.5);
  assert.deepEqual(originals, snapshot);
  assert.throws(() => scaleMealEntries(originals, 0), /positive meal amount/);
  assert.throws(() => scaleMealEntries(originals, 1e7), /outside the supported range/);
});

test('scales the discussed meals using saved portion weights', () => {
  const log = [
    entry('roti', 2, 'piece', 40), entry('dal', 1, 'katori', 150), entry('curd', 1, 'small katori', 100),
    entry('sabzi', 1, 'katori', 125), entry('chai', 1, 'cup', 150, day, 'Snacks'),
  ];
  const lunch = summarize(log.slice(0, 4));
  approximate(lunch.kcal.value, 514.559375);
  approximate(lunch.protein.value, 21.453475);
  approximate(log[4].nutrients.kcal, 54.2);
  for (const [id, amount, kcal] of [
    ['chole', 150, 199.10], ['rajma', 150, 163.91], ['paneer', 50, 149.5],
    ['egg-boiled', 50, 77.5], ['banana', 118, 105.02], ['chicken-breast', 100, 165],
    ['amul-taaza-uht', 200, 116.4], ['amul-sagar', 200, 72], ['apple', 100, 52],
  ]) approximate(entry(id, amount, catalog.get(id).basis, 1).nutrients.kcal, kcal);
});

test('matches manufacturer serving values and keeps missing fields unknown', () => {
  for (const [id, grams, kcal, protein] of [
    ['on-whey-drc', 30.4, 117, 24], ['on-serious-mass-choc', 334, 1243, 50],
    ['on-serious-mass-choc', 167, 621.5, 25], ['on-creatine', 3, 0, 0], ['milld-roti', 33.3, 129.02, 15.37],
  ]) {
    const { nutrients } = entry(id, 1, 'label serving', grams);
    approximate(nutrients.kcal, kcal);
    approximate(nutrients.protein, protein);
  }
  const bcaa = { id: 'test-bcaa', name: 'BCAA test label', category: 'Supplements', basis: 'g',
    nutrients: { kcal: 0 }, source: { label: 'Package label' } };
  const logged = makeEntry(bcaa, 1, 'scoop', 5, 'Snacks', day);
  const totals = summarize([logged, entry('dal', 1, 'katori', 150)]);
  assert.equal(logged.nutrients.protein, undefined);
  assert.deepEqual(totals.protein, { value: 7.1901, known: 1, total: 2 });
});

test('finds distinct Amul Gold formulations and scales their manufacturer values by volume', () => {
  const gold = findFoods(foods, 'amul gold').filter(food => food.id.startsWith('amul-gold-'));
  assert.equal(gold.length, 2);
  assert.ok(gold.every(food => food.basis === 'ml'));
  const pouch = entry('amul-gold-pouch', 1, 'glass', 200);
  const carton = entry('amul-gold-uht', 1, 'glass', 200);
  approximate(pouch.nutrients.kcal, 174);
  approximate(pouch.nutrients.protein, 6.4);
  approximate(carton.nutrients.kcal, 142);
  approximate(carton.nutrients.protein, 6);
  assert.equal(pouch.nutrients.addedSugar, 0);
});

test('recalculates homemade recipes by cooked yield and retains unmeasured nutrients as unknown', () => {
  const rice = catalog.get('rice-cooked');
  const oil = { nutrients: { kcal: 900, fat: 100 } };
  const result = calculateRecipe([{ food: rice, amount: 200 }, { food: oil, amount: 10 }], 240);
  approximate(result.kcal, (rice.nutrients.kcal * 2 + 90) / 2.4);
  assert.equal(result.protein, undefined);
});

test('weekly observations skip incomplete days and partial protein totals', () => {
  const state = emptyState();
  state.settings.protein = 100;
  state.entries = [
    entry('dal', 1, 'katori', 150, day),
    entry('rajma', 1, 'katori', 150, '2026-11-08'),
    entry('roti', 2, 'piece', 40, '2026-11-07'),
    entry('curd', 1, 'katori', 100, '2026-11-06'),
    entry('chicken-breast', 2, 'portion', 100, '2026-11-02'),
  ];
  delete state.entries[2].nutrients.protein;
  state.completed = { [day]: true, '2026-11-08': true, '2026-11-07': true, '2026-11-02': true };
  const review = weeklyReview(state, day);
  assert.equal(review.logged, 4);
  assert.equal(review.complete, 3);
  assert.equal(review.protein.count, 2);
  assert.equal(review.belowProtein, 2);
  assert.equal(review.meal.meal, 'Lunch');
  assert.equal(review.meal.count, 2);
});

test('backs up snapshots, rejects malformed restores, and escapes CSV formulas', () => {
  const state = emptyState();
  state.entries = [entry('roti', 2, 'piece', 40)];
  state.entries[0].name = '=1+2';
  state.completed[day] = true;
  const serialized = JSON.stringify({ version: backupVersion, data: state });
  assert.deepEqual(validateBackup(JSON.parse(serialized)), state);
  assert.throws(() => validateBackup({ version: 999, data: state }), /supported/);
  assert.throws(() => validateBackup({ version: backupVersion, data: { ...state, completed: { '2026-02-31': true } } }), /invalid/);
  assert.throws(() => validateCatalog([foods[0], foods[0]]), /duplicate/);
  assert.match(diaryCsv(state.entries), /"Food".*"Calories kcal"[\s\S]*"'=1\+2"/);
});
