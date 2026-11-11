import { prettyDay, shiftDay, summarize } from '../nutrition/core.js';
import { targetFor } from '../nutrition/insights.js';
import { calendarDate, newestMeasurements } from './import-model.js';

export const reviewPeriods = { daily: 1, weekly: 7, monthly: 30 };
export const reviewQuestions = [
  'Which lifts improved?',
  'How consistent were my workouts and food logs?',
  'Which foods helped me reach my protein target?',
  'How did my weight and muscle mass change?',
  'What worked, and what could explain it?',
];

const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const decimal = value => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value);
const dateRange = (start, end) => start === end ? prettyDay(end) : prettyDay(start) + ' – ' + prettyDay(end);
const textKey = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const delta = value => (value > 0 ? '+' : '') + decimal(value);
const setLabel = set => (set.kg === null ? '' : decimal(set.kg) + ' kg × ') + set.reps + ' reps';

function coverage(days, proteinTarget) {
  const logged = days.filter(day => day.entries.length);
  const complete = logged.filter(day => day.complete);
  const calories = complete.filter(day => day.totals.kcal.known === day.entries.length);
  const protein = complete.filter(day => day.totals.protein.known === day.entries.length);
  return { logged: logged.length, complete: complete.length, calories: average(calories.map(day => day.totals.kcal.value)),
    protein: average(protein.map(day => day.totals.protein.value)), calorieDays: calories.length, proteinDays: protein.length,
    targetDays: proteinTarget ? protein.filter(day => day.totals.protein.value >= proteinTarget) : [] };
}

function liftsFor(workouts, start, end, baselineStart) {
  const lifts = new Map();
  for (const workout of workouts) {
    if (workout.imported?.provider !== 'ironlog' || workout.date > end) continue;
    for (const exercise of (workout.imported.exercises ?? [])) {
      const key = textKey(exercise.name);
      if (!lifts.has(key)) lifts.set(key, { name: exercise.name, sessions: new Map() });
      const sessions = lifts.get(key).sessions;
      if (!sessions.has(workout.id)) sessions.set(workout.id, { date: workout.date, created: workout.created, sets: [] });
      sessions.get(workout.id).sets.push(...exercise.sets);
    }
  }
  return [...lifts.values()].map(({ name, sessions }) => {
    const ordered = [...sessions.values()].sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created));
    const active = ordered.filter(session => session.date >= start);
    const current = active[0];
    if (!current) return null;
    const before = ordered.filter(session => session.date < current.date);
    const comparableDays = [
      ...before.filter(session => session.date < start && session.date >= baselineStart),
      ...before.filter(session => session.date >= start),
      ...before.filter(session => session.date < baselineStart),
    ];
    const sorted = [...current.sets].sort((a, b) => (b.kg ?? -1) - (a.kg ?? -1) || b.reps - a.reps);
    let currentSet = sorted[0], priorSet, change, comparison;
    for (const session of comparableDays) {
      for (const set of sorted) {
        if (set.kg === null) continue;
        const sameLoad = session.sets.filter(old => old.kg === set.kg).sort((a, b) => b.reps - a.reps)[0];
        const sameReps = session.sets.filter(old => old.kg !== null && old.reps === set.reps).sort((a, b) => b.kg - a.kg)[0];
        priorSet = sameLoad ?? sameReps;
        if (!priorSet) continue;
        currentSet = set;
        comparison = session;
        change = sameLoad ? { value: set.reps - priorSet.reps, unit: 'reps', basis: 'at the same load' }
          : { value: set.kg - priorSet.kg, unit: 'kg', basis: 'at the same reps' };
        break;
      }
      if (comparison) break;
    }
    return { name, count: active.length, sets: active.reduce((sum, session) => sum + session.sets.length, 0),
      current: currentSet, date: current.date, previous: priorSet, previousDate: comparison?.date, change };
  }).filter(Boolean).sort((a, b) => Number(b.change?.value > 0) - Number(a.change?.value > 0) || b.count - a.count || a.name.localeCompare(b.name));
}

function bodyTrend(health, start, end, baselineStart) {
  const ordered = newestMeasurements(health.filter(item => item.date <= end));
  return ['weight', 'muscleMass', 'bodyFat'].flatMap(kind => {
    const sample = ordered.find(item => item.kind === kind && item.date >= start);
    if (!sample) return [];
    const matching = ordered.filter(item => item.kind === kind && item.source === sample.source && item.provider === sample.provider);
    const unique = [...new Map([...matching].reverse().map(item => [item.date, item])).values()];
    const current = unique.filter(item => item.date >= start);
    const previous = unique.filter(item => item.date >= baselineStart && item.date < start);
    return [{ kind, source: sample.source, latest: sample.value, date: sample.date, count: current.length,
      lastEarlier: start === end ? matching.find(item => item.date < start) : null,
      average: average(current.map(item => item.value)), previousCount: previous.length, previousAverage: average(previous.map(item => item.value)) }];
  });
}

function foodsOnTarget(days) {
  const foods = new Map();
  for (const day of days) {
    for (const entry of day.entries) {
      if (!(entry.nutrients.protein > 0)) continue;
      const food = foods.get(entry.foodId) ?? { name: entry.name, protein: 0, days: new Set() };
      food.protein += entry.nutrients.protein;
      food.days.add(day.date);
      foods.set(entry.foodId, food);
    }
  }
  return [...foods.values()].map(food => ({ name: food.name, count: food.days.size, average: food.protein / food.days.size }))
    .sort((a, b) => b.count - a.count || b.average - a.average).slice(0, 5);
}

export function progressReview(workspace, diary, period, end) {
  const length = reviewPeriods[period];
  const start = shiftDay(end, 1 - length);
  const baselineStart = shiftDay(start, -length);
  const baselineEnd = shiftDay(start, -1);
  const days = new Map(Array.from({ length: length * 2 }, (_, index) => {
    const date = shiftDay(baselineStart, index);
    return [date, { date, entries: [], workouts: [], complete: diary.completed[date] === true }];
  }));
  for (const entry of diary.entries) days.get(entry.day)?.entries.push(entry);
  for (const workout of workspace.workouts) days.get(workout.date)?.workouts.push(workout);
  for (const day of days.values()) day.totals = summarize(day.entries);
  const all = [...days.values()];
  const active = all.slice(length), baseline = all.slice(0, length);
  const workouts = active.filter(day => day.workouts.length);
  const priorWorkouts = baseline.filter(day => day.workouts.length);
  const proteinTarget = targetFor(diary.settings, 'protein');
  const food = coverage(active, proteinTarget);
  const priorFood = coverage(baseline, proteinTarget);
  const trainingFood = coverage(workouts, proteinTarget);
  const otherFood = coverage(active.filter(day => !day.workouts.length), proteinTarget);
  return { end, length, range: dateRange(start, end), baseline: dateRange(baselineStart, baselineEnd),
    workoutDays: workouts.length, priorWorkoutDays: priorWorkouts.length, sessions: workouts.flatMap(day => day.workouts).length,
    food, priorFood, trainingFood, otherFood, proteinTarget, foods: foodsOnTarget(food.targetDays),
    lifts: liftsFor(workspace.workouts, start, end, baselineStart), body: bodyTrend(workspace.health ?? [], start, end, baselineStart),
    dayTotals: length === 1 ? active[0].totals : null };
}

export function liftEvidence(lift) {
  const current = setLabel(lift.current) + ' on ' + prettyDay(lift.date);
  if (!lift.change) return current + ' · ' + lift.sets + ' working sets in range. A comparable set on another day is needed to measure change.';
  const previous = setLabel(lift.previous) + ' on ' + prettyDay(lift.previousDate);
  return current + ' vs ' + previous + ' · ' + delta(lift.change.value) + ' ' + lift.change.unit + ' ' + lift.change.basis + '.';
}

export function consistencyEvidence(review) {
  const { food, priorFood, workoutDays, priorWorkoutDays, length, sessions } = review;
  return `${workoutDays}/${length} days with workouts (${sessions} sessions), versus ${priorWorkoutDays}/${length} in the previous period. Food logged on ${food.logged}/${length} days, with ${food.complete} marked complete, versus ${priorFood.logged}/${length} logged and ${priorFood.complete} complete.`;
}

export function nutritionEvidence(review) {
  const { food, priorFood, proteinTarget, dayTotals } = review;
  const averageLine = food.calories === null && food.protein === null ? 'Mark food days complete to compare daily averages.'
    : [food.calories !== null && `${decimal(food.calories)} kcal average over ${food.calorieDays} fully recorded days`,
      food.protein !== null && `${decimal(food.protein)} g protein average over ${food.proteinDays} fully recorded days`].filter(Boolean).join(' · ') + '.';
  const targetLine = proteinTarget && food.proteinDays
    ? ` Your current ${decimal(proteinTarget)} g protein target was reached on ${food.targetDays.length}/${food.proteinDays} eligible days.` : '';
  const previous = [priorFood.calories !== null && `${decimal(priorFood.calories)} kcal over ${priorFood.calorieDays} days`,
    priorFood.protein !== null && `${decimal(priorFood.protein)} g protein over ${priorFood.proteinDays} days`].filter(Boolean);
  const comparison = previous.length ? ' Previous averages were ' + previous.join(' and ') + '.' : '';
  if (!dayTotals?.kcal.known) return averageLine + targetLine + comparison;
  const protein = dayTotals.protein;
  return `Logged for this date · ${decimal(dayTotals.kcal.value)} kcal${protein.known ? ', ' + decimal(protein.value) + ' g protein' : ''}.`
    + (protein.known < protein.total ? ' Some entries lack protein values.' : '') + ' ' + averageLine + targetLine + comparison;
}

export function bodyEvidence(item) {
  const label = { weight: 'Weight', muscleMass: 'Estimated muscle mass', bodyFat: 'Estimated body fat' }[item.kind];
  const unit = item.kind === 'bodyFat' ? '%' : ' kg';
  const changeUnit = item.kind === 'bodyFat' ? ' percentage points' : ' kg';
  const sample = `${label} · ${decimal(item.latest)}${unit} on ${prettyDay(item.date)} from ${item.source}.`;
  if (item.lastEarlier) return sample + ` Previous reading from this source was ${decimal(item.lastEarlier.value)}${unit} on ${prettyDay(item.lastEarlier.date)}.`;
  if (item.count < 2 || item.previousCount < 2) return sample + ` ${item.count} reading days in range and ${item.previousCount} in the previous period. A trend needs at least two in each.`;
  return sample + ` Average ${decimal(item.average)}${unit} vs ${decimal(item.previousAverage)}${unit} across ${item.count} and ${item.previousCount} reading days (${delta(item.average - item.previousAverage)}${changeUnit}).`;
}

export function reviewFindings(review, { includeFallback = true } = {}) {
  const findings = [];
  const improved = review.lifts.find(lift => lift.change?.value > 0);
  if (improved) {
    findings.push({ title: 'A lift improved', evidence: improved.name + ' · ' + liftEvidence(improved),
      next: 'Repeat the same exercise setup and check whether the improvement holds in your next session.' });
  }
  const comparison = improved ?? review.lifts.find(lift => lift.change);
  if (comparison && !improved) {
    findings.push({ title: 'A lift to revisit', evidence: comparison.name + ' · ' + liftEvidence(comparison),
      next: 'Record the next session with the same setup to see whether this result repeats.' });
  }
  const { food, priorFood } = review;
  if (comparison && food.proteinDays >= 3 && priorFood.proteinDays >= 3) {
    const proteinChange = food.protein - priorFood.protein;
    const workoutChange = review.workoutDays - review.priorWorkoutDays;
    if (Math.abs(proteinChange) >= 5 || workoutChange) {
      findings.push({ type: 'lift-context', title: 'What changed alongside the lift',
        evidence: `Workout days moved from ${review.priorWorkoutDays} to ${review.workoutDays}. Average protein moved from ${decimal(priorFood.protein)} to ${decimal(food.protein)} g, based on ${priorFood.proteinDays} and ${food.proteinDays} complete days. These changes give you two things to check against future sessions.`,
        next: 'Keep your exercise setup steady and compare the next few sessions under a similar routine.' });
    }
  }
  const training = review.trainingFood, other = review.otherFood;
  if (review.proteinTarget && training.proteinDays >= 3 && other.proteinDays >= 3) {
    const fraction = group => group.targetDays.length / group.proteinDays;
    const gap = fraction(training) - fraction(other);
    if (Math.abs(gap) >= 0.2) {
      findings.push({ title: gap > 0 ? 'You reached your protein target more often on workout days' : 'You reached your protein target more often on days without a logged workout',
        evidence: `You reached it on ${training.targetDays.length}/${training.proteinDays} eligible workout days and ${other.targetDays.length}/${other.proteinDays} eligible days without a logged workout. Meal choices and logging habits could both contribute.`,
        next: 'Try repeating a familiar meal on the days with fewer hits and compare the next period.' });
    }
  }
  const repeated = review.foods.find(food => food.count >= 2);
  if (repeated) {
    findings.push({ title: 'A repeatable protein source', evidence: foodEvidence(repeated),
      next: 'If it fits your routine, repeat the logged portion and see whether it remains a useful way to meet your target.' });
  }
  if (!findings.length && includeFallback) findings.push({ title: 'Build a comparison', evidence: 'A repeat lift, complete food days, and repeated weigh-ins give Coach more evidence to work with.',
    next: 'Choose one lift to repeat and mark food days complete when you have finished logging.' });
  return findings;
}

export function foodEvidence(food) {
  return `${food.name} contributed about ${decimal(food.average)} g protein per day it appeared, across ${food.count} days that reached your target.`;
}

function dailyAdvice(data, diary, weekly) {
  const lift = weekly.lifts.find(item => item.date === data.day && item.change?.value > 0);
  if (lift) return { title: `Repeat your ${lift.name} setup`, evidence: liftEvidence(lift),
    next: 'Use the same setup next time to check whether the improvement holds.' };
  if (!data.foods && data.workouts.some(workout => workout.date === data.day)) {
    return { title: 'Pair today’s workout with a food log', evidence: 'You have a workout logged for today.',
      next: 'Add the meals you ate so Coach can compare nutrition on similar training days.' };
  }
  if (!data.foods) return null;
  const protein = data.totals.protein;
  if (protein.known < data.foods) {
    return { title: 'Check the protein values in today’s log',
      evidence: `${protein.known} of ${data.foods} food entries have a protein value.`,
      next: 'Add values from the label or recipe where you have them.' };
  }
  if (data.proteinTarget && protein.value >= data.proteinTarget) {
    return { title: 'Save a meal that helped you reach your protein target',
      evidence: `You’ve logged ${decimal(protein.value)} g protein against your ${decimal(data.proteinTarget)} g target.`,
      next: 'Save a meal you’d happily eat again so it’s easy to repeat.' };
  }
  if (diary.completed[data.day] && data.proteinTarget) {
    return { title: 'Plan a familiar protein source for tomorrow',
      evidence: `Your complete food log shows ${decimal(protein.value)} g protein against your ${decimal(data.proteinTarget)} g target.`,
      next: weekly.foods.length ? 'Use a meal from a day you reached your target as a starting point.'
        : 'Review the protein values for your usual meals when you plan tomorrow.' };
  }
  if (!diary.completed[data.day]) {
    return { title: 'Finish today’s food log', evidence: `You’ve logged ${data.foods} food entries today.`,
      next: 'Mark the day complete once you’ve recorded what you ate so it can count toward your averages.' };
  }
  return null;
}

function weeklyAdvice(review) {
  const findings = reviewFindings(review, { includeFallback: false });
  if (findings.length) return findings.find(item => item.type === 'lift-context') ?? findings[0];
  if (review.food.logged) return { title: 'Build a repeatable food logging routine', evidence: consistencyEvidence(review),
    next: 'Choose a meal you already eat regularly and use it as the cue to finish logging that day.' };
  if (review.workoutDays) return { title: 'Repeat one logged workout', evidence: consistencyEvidence(review),
    next: review.lifts.length ? 'Use the same setup and record weight and reps so Coach has comparable sets next week.'
      : 'Choose a session you can repeat and log it when complete.' };
  return null;
}

function monthlyAdvice(review) {
  const body = review.body.find(item => item.kind === 'weight' && item.count >= 2 && item.previousCount >= 2);
  if (body) return { title: 'Review your weight trend alongside training', evidence: bodyEvidence(body)
    + ` You logged workouts on ${review.workoutDays} days, compared with ${review.priorWorkoutDays} in the previous period.`,
    next: 'Keep your weigh-in conditions consistent and review the next 30 days alongside your lift progress.' };
  if (review.food.logged || review.workoutDays) return { title: 'Pick one habit to carry into the next month',
    evidence: consistencyEvidence(review),
    next: 'Choose a repeatable workout day or a regular time to finish your food log. Check how often it happens next month.' };
  return null;
}

export function adviceForReview(workspace, diary, data, period, review) {
  if (review.end !== data.day) return null;
  if (period === 'weekly') return weeklyAdvice(review);
  if (period === 'monthly') return monthlyAdvice(review);
  return dailyAdvice(data, diary, progressReview(workspace, diary, 'weekly', data.day));
}

export function dashboardAdvice(workspace, diary, data) {
  const weekly = progressReview(workspace, diary, 'weekly', data.day);
  const monthly = progressReview(workspace, diary, 'monthly', data.day);
  const advice = { daily: dailyAdvice(data, diary, weekly), weekly: weeklyAdvice(weekly), monthly: monthlyAdvice(monthly) };
  return Object.entries(advice).flatMap(([period, item]) => item ? [{ period, ...item }] : []);
}

export function progressReply(question, workspace, diary, selection, today) {
  const query = textKey(question);
  if (/\b(budget|spending|expenses?|cost)\b/.test(query)) return null;
  const explicitPeriod = Object.keys(reviewPeriods).find(period => query.includes(period));
  const period = explicitPeriod ?? (/\b(today|yesterday)\b/.test(query) ? 'daily' : /\b(month|30 days)\b/.test(query)
    ? 'monthly' : /\b(week|7 days)\b/.test(query) ? 'weekly' : selection.period);
  const workout = /\b(strength|stronger|lifts?|lifting|working sets|personal best|plateau)\b/.test(query);
  const hasPeriod = explicitPeriod || /\b(today|yesterday|week|month|7 days|30 days)\b/.test(query) || /\d{4}-\d{2}-\d{2}/.test(question);
  const activitySummary = hasPeriod && /\b(workouts?|training|exercise)\b/.test(query);
  const dietSummary = hasPeriod && /\b(nutrition|food|calories|protein)\b/.test(query);
  const consistency = activitySummary || /\b(consisten\w*|adherence|frequency|training days|workout days|food days|food logs)\b/.test(query);
  const nutrition = dietSummary || /\b(protein target|protein goal|nutrition trend|calorie trend|foods helped|food coverage)\b/.test(query);
  const body = /\b(weight|muscle mass|body fat)\b/.test(query);
  const combined = /what (?:has )?(?:worked|helped|changed)|why.*(improv|stall|progress|stronger|plateau)|progress review|combine|how.*(food|nutrition).*training/.test(query);
  const mentionsLift = name => {
    const key = textKey(name);
    return key.length >= 3 && (' ' + query + ' ').includes(' ' + key + ' ');
  };
  const namedLift = workspace.workouts.some(workout => workout.imported?.exercises?.some(exercise => mentionsLift(exercise.name)));
  if (!workout && !consistency && !nutrition && !combined && !namedLift && !(body && (hasPeriod || /change|compare|trend/.test(query)))) return null;
  const requestedDate = question.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  let selectedDate = selection.end;
  if (/\b(today|this (?:week|month)|last (?:7|30) days)\b/.test(query)) selectedDate = today;
  if (/\byesterday\b/.test(query)) selectedDate = shiftDay(today, -1);
  if (/\b(?:last|previous) (?:week|month)\b/.test(query)) selectedDate = shiftDay(today, -reviewPeriods[period]);
  const end = calendarDate(requestedDate) && requestedDate <= today ? requestedDate : selectedDate;
  const review = progressReview(workspace, diary, period, end);
  const named = review.lifts.filter(lift => mentionsLift(lift.name));
  let lines;
  if (combined) lines = [consistencyEvidence(review), nutritionEvidence(review),
    ...reviewFindings(review).map(item => item.evidence + ' ' + item.next), ...review.body.map(bodyEvidence)];
  else if (workout || namedLift) lines = (namedLift ? named : review.lifts.slice(0, 5)).map(lift => lift.name + ' · ' + liftEvidence(lift));
  else if (body && !consistency) lines = review.body.map(bodyEvidence);
  else if (nutrition && !consistency) lines = [nutritionEvidence(review), ...review.foods.map(foodEvidence)];
  else lines = [consistencyEvidence(review), nutritionEvidence(review)];
  return review.range + '\n\n' + (lines.length ? lines.join('\n\n') : 'There are no matching records in this period. Try another date range or check Imports.');
}
