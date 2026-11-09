import { meals, nutrientKeys, nutrients, prettyDay, scaleNutrition, shiftDay, summarize, targetKeys, upperTargets, weightGoals } from './core.js';

export function targetFor(settings, key) {
  return key === 'kcal' || key === 'protein' ? settings[key] : settings.nutrientTargets?.[key];
}

export const adultReferences = {
  fiber: { value: 25, type: 'minimum' },
  sodium: { value: 2000, type: 'under' },
  potassium: { value: 3510, type: 'minimum' },
  fat: { value: 78, type: 'maximum', label: 'FDA label reference' },
  saturatedFat: { value: 20, type: 'maximum', label: 'FDA label reference' },
  addedSugar: { value: 50, type: 'maximum', label: 'FDA label reference' },
};

export function reportReference(settings, key) {
  const personal = targetFor(settings, key);
  if (personal) return { value: personal, type: key === 'kcal' ? 'target'
    : upperTargets.includes(key) ? 'maximum' : 'minimum', label: 'Your target' };
  if (settings.showReferences === false || !Object.hasOwn(adultReferences, key)) return null;
  return { label: 'WHO adult reference', ...adultReferences[key] };
}

export function portionLimitShare(settings, key, value) {
  if (!upperTargets.includes(key) || !Number.isFinite(value)) return null;
  const reference = reportReference(settings, key);
  if (!reference) return null;
  const percent = (value / reference.value) * 100;
  const status = percent <= 5 ? { tone: 'met', text: 'Low' }
    : percent < 20 ? { tone: 'moderate', text: 'Moderate' } : { tone: 'over', text: 'High' };
  return { percent, reference, ...status };
}

function compareReference(value, { value: target, type }) {
  if ((type === 'under' && value >= target) || (type === 'maximum' && value > target)) {
    return { tone: 'over', text: 'At or over limit' };
  }
  if (type === 'target' && Math.abs(value - target) > target * 0.05) {
    return value < target ? { tone: 'below', text: 'Below target' } : { tone: 'over', text: 'Above target' };
  }
  if (type === 'minimum' && value < target) return { tone: 'below', text: 'Below target' };
  if (type === 'target') return { tone: 'met', text: 'Near target' };
  return { tone: 'met', text: type === 'minimum' ? 'Meets target' : 'Within limit' };
}

export function dayReferenceStatus(total, complete, reference) {
  if (!reference) return null;
  if (total.value == null) return { tone: 'neutral', text: 'No data' };
  if (!complete || total.known !== total.total) {
    if (compareReference(total.value, reference).tone === 'over') {
      return { tone: 'over', text: reference.type === 'target' ? 'Recorded amount above target' : 'Recorded amount reaches limit' };
    }
    return { tone: 'neutral', text: total.known !== total.total ? 'Partial data' : 'Day open' };
  }
  return compareReference(total.value, reference);
}

export function trendReferenceStatus(metric, key, reference) {
  if (!reference) return null;
  if (metric.covered.length < 3) return { tone: 'neutral', text: 'Needs 3 covered days' };
  const status = compareReference(metric.average, reference);
  const met = metric.covered.filter(day => compareReference(day.totals[key].value, reference).tone === 'met').length;
  return { ...status, detail: `${met}/${metric.covered.length} days met reference` };
}

export function nutritionReport(state, end, length) {
  const dates = Array.from({ length }, (_, index) => shiftDay(end, index - length + 1));
  const entriesByDay = new Map(dates.map(day => [day, []]));
  for (const entry of state.entries) entriesByDay.get(entry.day)?.push(entry);
  const days = dates.map(date => {
    const entries = entriesByDay.get(date);
    return { date, entries, totals: summarize(entries), complete: entries.length > 0 && state.completed[date] === true };
  });
  const complete = days.filter(day => day.complete);
  const logged = days.filter(day => day.entries.length).length;
  const metrics = Object.fromEntries(nutrientKeys.map(key => {
    const covered = complete.filter(day => day.totals[key].known === day.totals[key].total);
    const average = covered.length ? covered.reduce((sum, day) => sum + day.totals[key].value, 0) / covered.length : null;
    return [key, { average, covered }];
  }));
  return { days, complete, logged, metrics, start: dates[0], end };
}

export function foodContributions(entries, key) {
  const foods = new Map();
  let known = 0;
  for (const entry of entries) {
    const amount = entry.nutrients[key];
    if (!Number.isFinite(amount)) continue;
    known++;
    const food = foods.get(entry.foodId) ?? { name: entry.name, amount: 0, count: 0 };
    food.amount += amount;
    food.count++;
    foods.set(entry.foodId, food);
  }
  return { known, count: entries.length, foods: [...foods.values()].filter(food => food.amount > 0)
    .sort((a, b) => b.amount - a.amount) };
}

export function compareMeal(entries, { action, entryId, food, amount }) {
  const changed = entries.find(entry => entry.id === entryId);
  if (!['add', 'reduce', 'swap'].includes(action) || (action !== 'add' && !changed)
    || !Number.isFinite(amount) || amount < 0 || amount > 1e7
    || (action === 'reduce' ? amount >= changed.quantity * changed.factor : !food || amount === 0)) return null;

  const replaced = action === 'add' ? [] : [changed];
  const added = action === 'reduce'
    ? (amount ? [{ nutrients: scaleNutrition(changed.nutrients, amount / (changed.quantity * changed.factor)) }] : [])
    : [{ nutrients: scaleNutrition(food.nutrients, amount / 100) }];
  const before = summarize(entries);
  const after = summarize(entries.filter(entry => !replaced.includes(entry)).concat(added));
  // The unchanged foods cancel out, even if their nutrient values are unknown.
  const removedTotals = summarize(replaced);
  const addedTotals = summarize(added);
  const difference = Object.fromEntries(nutrientKeys.map(key => {
    const from = removedTotals[key];
    const to = addedTotals[key];
    return [key, from.known === from.total && to.known === to.total
      ? (to.value ?? 0) - (from.value ?? 0) : null];
  }));
  return { before, after, difference };
}

function gap(value, target, key) {
  if (key === 'kcal') return Math.abs(value - target);
  return upperTargets.includes(key) ? Math.max(0, value - target) : Math.max(0, target - value);
}

export function targetPatterns(report, settings) {
  return targetKeys.flatMap(key => {
    const target = targetFor(settings, key);
    const { average, covered } = report.metrics[key];
    if (!target || covered.length < 3) return [];
    const direction = (upperTargets.includes(key) || (key === 'kcal' && average > target)) ? 'above' : 'below';
    const count = covered.filter(day => direction === 'above' ? day.totals[key].value > target : day.totals[key].value < target).length;
    if (count < Math.max(2, Math.ceil(covered.length / 2)) || (direction === 'above' ? average <= target : average >= target)) return [];
    return [{ key, direction, count, covered: covered.length, target, average }];
  }).sort((a, b) => Math.abs(b.average / b.target - 1) - Math.abs(a.average / a.target - 1));
}

// Everyday foods with a known diet fit and practical default portion sizes.
const choices = [
  ['rajma', 100, 'vegan'], ['chole', 100, 'vegan'], ['tofu', 100, 'vegan'],
  ['dal', 150, 'vegan'], ['banana', 118, 'vegan'], ['apple', 100, 'vegan'],
  ['spinach-cooked', 100, 'vegan'], ['rice-cooked', 100, 'vegan'],
  ['curd', 100, 'vegetarian'], ['paneer', 50, 'vegetarian'],
  ['egg-boiled', 50, 'any'], ['chicken-breast', 100, 'any'],
];

const stapleGroups = ['Grains & breads', 'Pulses & beans', 'Indian dishes'];
function compatibleSwap(entry, food) {
  if (entry.basis !== food.basis || entry.foodId === food.id) return false;
  if (entry.category === food.category) return true;
  return stapleGroups.includes(entry.category) && stapleGroups.includes(food.category);
}

export function mealSuggestions(report, entries, foods, settings, recentIds) {
  if (!entries.length) return [];
  const catalog = new Map(foods.map(food => [food.id, food]));
  const familiar = new Set(recentIds);
  const possible = choices.filter(([id, , diet]) => catalog.has(id)
    && (settings.diet === 'any' || diet === 'vegan' || settings.diet === diet));
  const patterns = targetPatterns(report, settings);
  const suggestions = [];
  for (const pattern of patterns) {
    const { key, target, average, direction } = pattern;
    const candidates = [];
    function consider(action, entry, food, amount) {
      const before = entry?.nutrients[key] ?? 0;
      if (entry && !Number.isFinite(entry.nutrients[key])) return;
      const after = action === 'reduce' ? before * amount / (entry.quantity * entry.factor) : food.nutrients[key] * amount / 100;
      const change = after - before;
      const improvement = gap(average, target, key) - gap(average + change, target, key);
      if (!(improvement > 0.00001)) return;
      const comparison = compareMeal(entries, { action, entryId: entry?.id, food, amount });
      let penalty = 0;
      for (const other of ['kcal', 'protein', 'fiber', 'sodium']) {
        if (other === key || comparison.difference[other] == null) continue;
        const otherTarget = targetFor(settings, other);
        const value = report.metrics[other].average;
        if (otherTarget && value != null) {
          penalty += Math.max(0, gap(value + comparison.difference[other], otherTarget, other) - gap(value, otherTarget, other)) / otherTarget;
        }
      }
      const score = improvement / target - penalty + (familiar.has(food?.id) ? 0.015 : 0);
      if (score > 0) candidates.push({ action, entry, food, amount, score, pattern, comparison });
    }
    const eligible = entries.filter(entry => entry.category !== 'Supplements' && Number.isFinite(entry.nutrients[key]));
    for (const [id, amount] of possible) {
      const food = catalog.get(id);
      if (!Number.isFinite(food.nutrients[key])) continue;
      if (direction === 'below') consider('add', null, food, amount);
      for (const entry of eligible) {
        if (compatibleSwap(entry, food)) consider('swap', entry, food, Math.min(entry.quantity * entry.factor, amount * 2));
      }
    }
    if (direction === 'above') {
      for (const entry of eligible) consider('reduce', entry, null, entry.quantity * entry.factor / 2);
    }
    candidates.sort((a, b) => b.score - a.score);
    const next = candidates.find(item => !suggestions.some(chosen => chosen.action === item.action
      && chosen.entry?.id === item.entry?.id && chosen.food?.id === item.food?.id));
    if (next) suggestions.push(next);
    if (suggestions.length === 2) break;
  }
  return suggestions;
}

export function mealGroups(entries) {
  return meals.map(meal => ({ meal, totals: summarize(entries.filter(entry => entry.meal === meal)) }));
}

export function summaryText(report, settings, display) {
  const lines = [
    'BabyNeKhanaKhaya? weekly nutrition summary',
    `${prettyDay(report.start)} to ${prettyDay(report.end)}`,
    `${report.complete.length} complete days of ${report.logged} logged days`,
  ];
  if (settings.goal) lines.push(`Goal: ${weightGoals[settings.goal]}`);
  if (settings.diet !== 'any') lines.push(`Food preference: ${settings.diet}`);
  for (const key of nutrientKeys) {
    const { average, covered } = report.metrics[key];
    const target = targetFor(settings, key);
    if (average == null && !target) continue;
    const coverage = average == null ? 'no fully covered days' : `${display(key, average)} average, ${covered.length}/${report.complete.length} complete days covered`;
    lines.push(`${nutrients[key][0]}: ${coverage}${target ? `; my ${upperTargets.includes(key) ? 'limit' : 'target'} ${display(key, target)}` : ''}`);
  }
  lines.push('', 'Suggest small, practical meal changes for my goals. Treat missing nutrient data as unknown. Ask about my usual foods if needed.');
  return lines.join('\n');
}
