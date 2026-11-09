import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { emptyState } from '../site/nutrition/core.js';
import { emptyWorkspace, groceryDraft, snapshot } from '../site/lib/domain.js';
import { localReply, modelContext } from '../site/lib/coach.js';
import { workspaceFromBackup } from '../site/lib/records.js';

test('dashboard joins diary coverage with the rolling workout window and monthly food spending', () => {
  const workspace = emptyWorkspace();
  workspace.workouts = [
    { date: '2026-11-04', minutes: 40 }, { date: '2026-11-03', minutes: 20 },
    { date: '2026-11-11', minutes: 10 },
  ];
  workspace.expenses = [
    { date: '2026-11-09', created: '2026-11-09', amount: 50050 },
    { date: '2026-10-31', created: '2026-10-31', amount: 7500 },
  ];
  workspace.routines = [{ doneOn: '2026-11-09' }, { doneOn: '2026-11-10' }];
  workspace.meals = [{ date: '2026-11-10' }, { date: '2026-11-12' }];
  const diary = emptyState();
  diary.settings.kcal = 2100;
  diary.entries = [
    { day: '2026-11-09', nutrients: { kcal: 980, protein: 12 } },
    { day: '2026-11-10', nutrients: { kcal: 220, protein: 4 } },
    { day: '2026-11-10', nutrients: { kcal: 350 } },
  ];
  diary.completed['2026-11-09'] = true;
  const data = snapshot(workspace, diary, '2026-11-10');
  assert.equal(data.minutes, 40);
  assert.equal(data.spent, 50050);
  assert.equal(data.calorieTarget, 2100);
  assert.equal(data.meals.length, 1);
  assert.equal(data.routines.length, 1);
  assert.deepEqual(data.totals.protein, { value: 4, known: 1, total: 2 });
  assert.equal(data.week[0].kcal, null);
  assert.deepEqual(data.week.slice(-2), [
    { date: '2026-11-09', kcal: 980, complete: true },
    { date: '2026-11-10', kcal: 570, complete: false },
  ]);
  assert.match(localReply('Review my nutrition', data, workspace), /570 kcal.*Some entries lack protein data/);
});

test('grocery drafts deduplicate against the list and across meals', () => {
  const meals = [{ ingredients: ['Rice', 'Moong dal', 'Carrots'] }, { ingredients: ['rice', 'Cucumber'] }];
  const list = [{ name: 'moong dal', done: false }, { name: 'carrots', done: true }];
  assert.deepEqual(groceryDraft(meals, list), ['Rice', 'Cucumber']);
  assert.equal(list.length, 2);
});

test('local coaching uses saved preferences and spending, and model context omits raw diary and chat', () => {
  const workspace = emptyWorkspace();
  workspace.profile.budget = 100000;
  workspace.profile.name = 'Private name';
  workspace.memory.push({ kind: 'Food', text: 'I cook for two.' });
  workspace.messages.push({ role: 'user', text: 'Private conversation' });
  workspace.expenses.push({ date: '2026-11-01', amount: 110000, name: 'Private expense' });
  const diary = emptyState();
  diary.settings.diet = 'vegan';
  const data = snapshot(workspace, diary, '2026-11-10');
  assert.match(localReply('What should I cook?', data, workspace), /vegan.*I cook for two/);
  assert.match(localReply('Check my food budget', data, workspace), /₹100 over your ₹1,000 budget/);
  const serialized = JSON.stringify(modelContext(data, workspace));
  assert.match(serialized, /I cook for two/);
  assert.doesNotMatch(serialized, /Private name|Private conversation|Private expense/);
});

test('workspace backup validates record fields and supports zero-valued goals', () => {
  const data = emptyWorkspace();
  data.profile.workoutGoal = 0;
  const backup = { format: 'fitness-agent-workspace', data };
  assert.deepEqual(workspaceFromBackup(backup), data);
  data.expenses = [{ id: 'one', name: 'Dinner', type: 'Dining out', created: '2026-11-09', date: '2026-11-09', amount: -300 }];
  assert.throws(() => workspaceFromBackup(backup), /invalid expenses/);
  data.expenses[0].amount = 300;
  assert.deepEqual(workspaceFromBackup(backup), data);
  data.expenses.push(data.expenses[0]);
  assert.throws(() => workspaceFromBackup(backup), /invalid expenses/);
});

test('PWA asset references resolve at the required GitHub Pages base', () => {
  const base = 'https://planwithdata.github.io/Fitness-Agent/';
  const root = new URL('../site/', import.meta.url);
  const read = path => readFileSync(new URL(path, root), 'utf8');
  const manifest = JSON.parse(read('manifest.webmanifest').trim());
  const worker = read('sw.js');
  const listed = [...worker.split('const assets = [')[1].split('];')[0].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.equal(new URL(manifest.start_url, base).href, base);
  assert.equal(new URL(manifest.scope, base).href, base);
  for (const path of [...listed, ...manifest.icons.map(icon => icon.src)]) {
    assert.ok(new URL(path, base).href.startsWith(base), path);
    assert.ok(read(path.endsWith('/') ? path + 'index.html' : path).length, path);
  }
  for (const page of ['index.html', 'nutrition/index.html']) {
    const links = read(page).matchAll(/(?:href|src)="([^"#][^"]*)"/g);
    for (const [, path] of links) {
      if (path.startsWith('https://')) continue;
      const url = new URL(path, new URL(page, base)).href;
      assert.ok(url.startsWith(base), path);
      const local = url.slice(base.length);
      assert.ok(read(local.endsWith('/') || local === '' ? local + 'index.html' : local).length, path);
    }
  }
});
