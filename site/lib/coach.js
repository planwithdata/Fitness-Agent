import { brief, format, money } from './domain.js';
import { measurements, measurementText, newestMeasurements } from './import-model.js';

const measurementQueries = [
  ['subcutaneousFat', /subcutaneous fat/], ['visceralFat', /visceral fat/],
  ['fatFreeMass', /fat.free mass|weight without fat/], ['bodyFat', /body fat/],
  ['weight', /body weight|my weight|latest weight|weigh[- ]?in|weight trend|weight history/],
  ['muscleMass', /muscle mass/], ['muscleRate', /muscle rate/], ['bodyWater', /body water/],
  ['boneMass', /bone mass/], ['bmr', /\bbmr\b/], ['protein', /protein mass/],
];

export const prompts = ['How is my day going?', 'Review my nutrition', 'What should I cook?', 'Check my food budget'];

export function localReply(question, data, workspace) {
  const query = question.toLowerCase();
  const { totals, foods, week, meals, groceries, routines } = data;
  if (/remember|memory|preference/.test(query)) {
    return workspace.memory.length
      ? 'Your saved preferences:\n' + workspace.memory.map(item => '• ' + item.text).join('\n')
      : 'Your memory is empty. Add a preference or habit in the Memory panel and you can edit or remove it there.';
  }
  if (/purchase|bought|buy often|go-to|go to items/.test(query)) {
    const list = new Map();
    for (const expense of workspace.expenses) {
      if (expense.imported?.provider !== 'blinkit') continue;
      for (const item of expense.imported.items) {
        const key = item.name.toLocaleLowerCase('en-IN');
        const current = list.get(key);
        if (current) current.orders++;
        else list.set(key, { name: item.name, orders: 1 });
      }
    }
    const frequent = [...list.values()].sort((a, b) => b.orders - a.orders).slice(0, 5);
    return frequent.length ? 'Your most frequent items from imported Blinkit receipts:\n' + frequent.map(item =>
      `• ${item.name} · ${item.orders} ${item.orders === 1 ? 'order' : 'orders'}`).join('\n')
      : 'I don’t have any Blinkit line items yet. Open Imports to read your receipts.';
  }
  if (/budget|spend|cost|expense|delivery/.test(query)) {
    const budget = workspace.profile.budget;
    const remaining = budget - data.spent;
    const target = !budget ? 'Set a monthly budget in Settings to track what remains.'
      : remaining < 0 ? `You are ${money(-remaining)} over your ${money(budget)} budget.`
        : `You have ${money(remaining)} of your ${money(budget)} budget left.`;
    return `You’ve recorded ${money(data.spent)} in food expenses this month. ${target}`;
  }
  if (/cook|plan|grocery|groceries|shop/.test(query)) {
    const plan = meals.length ? 'Today’s meal plan: ' + meals.map(meal => `${meal.slot} · ${meal.name}`).join(', ') + '.'
      : 'Your meal plan is empty today. In Planner, you can choose a starter idea or add your own meal.';
    const staples = groceries.length ? ' Still to buy: ' + groceries.slice(0, 7).map(item => item.name).join(', ') + '.' : '';
    const preference = data.diet === 'any' ? '' : ` Your food diary is set to ${data.diet}.`;
    const memory = workspace.memory.filter(item => item.kind === 'Food').slice(0, 2);
    return plan + staples + preference + (memory.length ? ' Food notes you saved: ' + memory.map(item => item.text).join(' • ') : '');
  }
  const kind = measurementQueries.find(([, pattern]) => pattern.test(query))?.[0];
  if (kind) {
    const recent = newestMeasurements((workspace.health ?? []).filter(item => item.kind === kind));
    const [sample] = recent;
    if (!sample) return 'There are no readings for that measurement. Open Imports to add an Apple Health file or DrTrust report.';
    const previous = recent.find(item => item.date < sample.date && item.source === sample.source && item.provider === sample.provider);
    const latest = `Your latest imported ${measurements[kind].label.toLowerCase()} was ${measurementText(sample)} on ${sample.date}, from ${sample.source}.`;
    return previous && /trend|change|history|compare/.test(query)
      ? latest + ` The previous reading from that source was ${measurementText(previous)} on ${previous.date}.` : latest;
  }
  if (/workout|exercise|train|movement|fitness/.test(query)) {
    const target = workspace.profile.workoutGoal;
    const progress = target ? ` Your rolling 7-day goal is ${target} minutes.` : '';
    const memory = workspace.memory.find(item => item.kind === 'Training');
    return `You logged ${data.minutes} minutes across ${data.workouts.length} workouts in the last 7 days.` + progress
      + (memory ? ` Your saved training note is “${memory.text}”.` : '');
  }
  if (/nutri|calor|protein|eating|food log|macro/.test(query)) {
    if (!foods) return 'Your diary has no meals logged today. Add a meal in Nutrition and I can summarize your calories and known protein.';
    const protein = totals.protein.known ? `${format(totals.protein.value)} g of logged protein` : 'no recorded protein values';
    const target = data.calorieTarget ? ` Your calorie target is ${format(data.calorieTarget)} kcal.` : '';
    const logged = week.filter(point => point.kcal !== null).length;
    return `Today’s diary contains ${foods} ${foods === 1 ? 'entry' : 'entries'}, ${format(totals.kcal.value)} kcal and ${protein}.${target} You logged food on ${logged} of the last 7 days.`
      + (totals.protein.known < foods ? ' Some entries lack protein data, so the total may be incomplete.' : '');
  }
  if (/routine|schedule|remind|task/.test(query)) {
    return routines.length ? 'Still open today: ' + [...routines].sort((a, b) => a.time.localeCompare(b.time))
      .map(item => `${item.time} · ${item.name}`).join(', ') + '.' : 'You have no open routines today. Add a daily check-in from Planner.';
  }
  if (/today|day|summary|going|overview/.test(query)) return brief(data, workspace);
  return 'The local coach can review your day, nutrition, workouts, meal plan, grocery list, routines, budget, purchases, body measurements, or saved memory. Try “How is my day going?”';
}

export function modelContext(data, workspace) {
  return {
    date: data.day, diet: data.diet, calories: data.foods ? data.totals.kcal.value : null,
    calorieTarget: data.calorieTarget, proteinTarget: data.proteinTarget,
    knownProtein: data.totals.protein.known ? data.totals.protein.value : null,
    proteinEntriesCovered: data.totals.protein.known, foodEntries: data.foods,
    sevenDayCalories: data.week, workoutMinutes: data.minutes, workoutGoal: workspace.profile.workoutGoal,
    foodSpendPaise: data.spent, budgetPaise: workspace.profile.budget,
    plannedMeals: data.meals.slice(0, 12).map(({ name, slot }) => ({ name, slot })),
    groceryNames: data.groceries.slice(0, 20).map(({ name }) => name),
    remainingRoutines: data.routines.slice(0, 12).map(({ name, time }) => ({ name, time })),
    memory: workspace.memory.slice(-12).map(({ kind, text }) => ({ kind, text })),
  };
}
