import { today, shiftDay, summarize } from '../nutrition/core.js';
import { targetFor } from '../nutrition/insights.js';

export const workoutTypes = ['Strength', 'Cardio', 'Mobility', 'Sport', 'Other'];
export const expenseTypes = ['Groceries', 'Food delivery', 'Dining out'];
export const money = paise => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 ? 2 : 0,
}).format(paise / 100);
export const format = value => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);

export function emptyWorkspace() {
  return { version: 1, profile: { name: '', workoutGoal: 150, budget: 0 }, workouts: [],
    expenses: [], meals: [], groceries: [], routines: [], memory: [], messages: [] };
}

export function snapshot(workspace, diary, day = today()) {
  const month = day.slice(0, 7);
  const days = Array.from({ length: 7 }, (_, index) => shiftDay(day, index - 6));
  const byDay = new Map(days.map(date => [date, []]));
  for (const entry of diary.entries) byDay.get(entry.day)?.push(entry);
  const week = days.map(date => {
    const entries = byDay.get(date);
    const total = summarize(entries).kcal;
    return { date, kcal: total.known ? total.value : null, complete: Boolean(diary.completed[date]) };
  });
  const meals = workspace.meals.filter(meal => meal.date === day);
  const workouts = workspace.workouts.filter(workout => workout.date >= days[0] && workout.date <= day);
  const spent = workspace.expenses.filter(expense => expense.date.startsWith(month))
    .reduce((sum, expense) => sum + expense.amount, 0);
  return { day, month, week, meals, workouts, spent, diet: diary.settings.diet,
    calorieTarget: targetFor(diary.settings, 'kcal'), proteinTarget: targetFor(diary.settings, 'protein'),
    totals: summarize(byDay.get(day)), foods: byDay.get(day).length,
    minutes: workouts.reduce((sum, workout) => sum + workout.minutes, 0),
    groceries: workspace.groceries.filter(item => !item.done),
    routines: workspace.routines.filter(item => item.doneOn !== day) };
}

export function groceryDraft(meals, groceries) {
  const known = new Set(groceries.map(item => item.name.toLocaleLowerCase('en-IN')));
  const names = [];
  for (const meal of meals) {
    for (const ingredient of meal.ingredients) {
      const key = ingredient.toLocaleLowerCase('en-IN');
      if (known.has(key)) continue;
      known.add(key);
      names.push(ingredient);
    }
  }
  return names;
}

export function brief(data, workspace) {
  const { foods, groceries, meals, routines, totals } = data;
  if (foods && data.calorieTarget && totals.kcal.known) {
    return `You've logged ${format(totals.kcal.value)} kcal today against your ${format(data.calorieTarget)} kcal target. Review the diary before planning your next meal.`;
  }
  if (meals.length && groceries.length) {
    return `You have ${meals.length} meal${meals.length === 1 ? '' : 's'} planned for today and ${groceries.length} unchecked grocery items. Review the list before you shop.`;
  }
  if (workspace.profile.budget && data.spent > workspace.profile.budget) {
    return `Your recorded food spending is ${money(data.spent - workspace.profile.budget)} over your monthly budget. Review your expenses as you plan the next shop.`;
  }
  if (routines.length) return `You have ${routines.length} routines left today. Start with “${[...routines].sort((a, b) => a.time.localeCompare(b.time))[0].name}”.`;
  return 'Start with a meal, workout, or expense. I’ll use what you log to connect the dots across your day.';
}
