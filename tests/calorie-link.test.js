import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, makeEntry, today } from '../site/nutrition/core.js';
import { calorieLinkStatus, linkedDiaryState } from '../site/nutrition/calorie-link.js';
import { emptyWorkspace, snapshot } from '../site/lib/domain.js';

test('linked Calorie Counter data keeps personal foods, portions, meals and targets together', () => {
  const original = emptyState();
  const day = today();
  const food = { id: 'recipe-sample', name: 'Linked recipe', category: 'Homemade', basis: 'g',
    nutrients: { kcal: 180, protein: 12 }, source: { label: 'Personal recipe' },
    recipe: [{ id: 'sample-rice', amount: 100 }] };
  const entry = makeEntry(food, 2, 'bowl', 100, 'Lunch', day);
  original.entries = [entry];
  original.foods = [food];
  original.portions = [{ id: 'portion1', foodId: food.id, label: 'bowl', amount: 100 }];
  original.favorites = [food.id];
  original.savedMeals = [{ id: 'meal1', name: 'Saved lunch', entries: [entry] }];
  original.completed[day] = true;
  original.settings = { ...original.settings, kcal: 2100, protein: 90, diet: 'vegetarian', nutrientTargets: { fiber: 27 } };

  const linked = linkedDiaryState({ ...original, unrelated: 'discard' });
  assert.deepEqual(linked, original);
  assert.match(calorieLinkStatus({ status: 'linked', diary: linked }), /1 diary entry · 1 personal food/);
  const view = snapshot(emptyWorkspace(), linked, day);
  assert.equal(view.totals.kcal.value, 360);
  assert.equal(view.totals.protein.value, 24);
  assert.equal(view.calorieTarget, 2100);
  assert.equal(view.week.at(-1).complete, true);
});

test('linked diary accepts older snapshots with absent collections and rejects malformed state', () => {
  assert.deepEqual(linkedDiaryState({ entries: [], settings: { kcal: 1900 } }), {
    ...emptyState(), settings: { ...emptyState().settings, kcal: 1900 },
  });
  assert.throws(() => linkedDiaryState({ entries: [], foods: {} }), /invalid diary data/);
  assert.throws(() => linkedDiaryState({ foo: 1 }), /Unrecognized Calorie Counter/);
});
