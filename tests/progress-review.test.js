import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, shiftDay } from '../site/nutrition/core.js';
import { emptyWorkspace } from '../site/lib/domain.js';
import { bodyEvidence, liftEvidence, progressReply, progressReview, reviewFindings } from '../site/lib/progress-review.js';

const end = '2026-11-11';
const day = offset => shiftDay(end, offset);
const workout = (offset, kg, reps, name = 'Bench Press') => ({
  id: String(offset), date: day(offset), created: day(offset), imported: { provider: 'ironlog', exercises: [{ name, sets: [{ kg, reps }] }] },
});
function food(diary, offset, protein, complete = true) {
  diary.entries.push({ day: day(offset), foodId: 'dal', name: 'Dal bowl', nutrients: { kcal: 600, ...(protein === null ? {} : { protein }) } });
  diary.completed[day(offset)] = complete;
}

test('rolling periods compare completed nutrition days and comparable IronLog sets', () => {
  const workspace = emptyWorkspace(), diary = emptyState();
  workspace.workouts = [workout(-12, 60, 6), workout(-8, 55, 10), workout(-2, 60, 8),
    workout(-1, 50, 6, 'Machine Bench Press'), workout(1, 90, 3)];
  diary.settings.protein = 70;
  [-13, -11, -9].forEach(offset => food(diary, offset, 60));
  [-6, -5, -3].forEach(offset => food(diary, offset, 80));
  food(diary, -2, 95, false);
  food(diary, -1, null);
  const review = progressReview(workspace, diary, 'weekly', end);
  assert.equal(review.workoutDays, 2);
  assert.equal(review.priorWorkoutDays, 2);
  assert.equal(review.food.logged, 5);
  assert.equal(review.food.complete, 4);
  assert.equal(review.food.proteinDays, 3);
  assert.equal(review.food.protein, 80);
  assert.equal(review.foods[0].count, 3);
  const lift = review.lifts.find(lift => lift.name === 'Bench Press');
  assert.deepEqual(lift.change, { value: 2, unit: 'reps', basis: 'at the same load' });
  assert.match(liftEvidence(lift), /60 kg × 8 reps.*60 kg × 6 reps/);
  assert.ok(reviewFindings(review).some(item => item.title === 'What changed alongside the lift'));
  assert.equal(progressReview(workspace, diary, 'monthly', end).length, 30);
  assert.match(progressReply('Which lifts improved this month?', workspace, diary, { period: 'weekly', end }, end), /Bench Press/);
});

test('body trends use one reading per day from the same source and daily uses previous reading', () => {
  const workspace = emptyWorkspace(), diary = emptyState();
  const sample = (offset, value, source = 'DrTrust', time = 1) =>
    ({ date: day(offset), value, kind: 'weight', provider: 'drtrust', source, time });
  workspace.health = [sample(-8, 81), sample(-7, 79), sample(-2, 79), sample(0, 78), sample(0, 90, 'DrTrust', 0), sample(-1, 95, 'Other')];
  const [body] = progressReview(workspace, diary, 'weekly', end).body;
  assert.equal(body.count, 2);
  assert.equal(body.average, 78.5);
  assert.equal(body.previousAverage, 80);
  assert.match(bodyEvidence(body), /-1.5 kg/);
  const [daily] = progressReview(workspace, diary, 'daily', end).body;
  assert.equal(daily.lastEarlier.value, 79);
  assert.match(progressReply('How did my weight change today?', workspace, diary, { period: 'weekly', end }, end), /Previous reading from this source/);
  assert.match(progressReply('How many workouts last week?', workspace, diary, { period: 'daily', end }, end), /29 Oct 2026.*4 Nov 2026/);
  assert.equal(progressReply('What is my food budget this month?', workspace, diary, { period: 'weekly', end }, end), null);
  assert.equal(progressReply('What should I cook?', workspace, diary, { period: 'weekly', end }, end), null);
});
