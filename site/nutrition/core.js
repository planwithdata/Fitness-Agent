export const nutrients = {
  kcal: ['Calories', 'kcal'], protein: ['Protein', 'g'], carbs: ['Carbs', 'g'],
  fat: ['Fat', 'g'], fiber: ['Fiber', 'g'], sugar: ['Sugar', 'g'],
  saturatedFat: ['Saturated fat', 'g'], sodium: ['Sodium', 'mg'],
  calcium: ['Calcium', 'mg'], iron: ['Iron', 'mg'], potassium: ['Potassium', 'mg'],
  vitaminC: ['Vitamin C', 'mg'],
  vitaminB12: ['Vitamin B12', 'µg'], folate: ['Folate (DFE)', 'µg'],
  magnesium: ['Magnesium', 'mg'], zinc: ['Zinc', 'mg'], vitaminD: ['Vitamin D', 'µg'],
  addedSugar: ['Added sugar', 'g'],
};

export const nutrientKeys = Object.keys(nutrients);
export const targetKeys = ['kcal', 'protein', 'fiber', 'sodium', 'saturatedFat', 'addedSugar',
  'calcium', 'iron', 'potassium', 'vitaminC', 'vitaminB12', 'folate', 'magnesium', 'zinc', 'vitaminD', 'fat'];
export const upperTargets = ['fat', 'saturatedFat', 'sodium', 'addedSugar'];
export const weightGoals = { maintain: 'Maintain weight', gain: 'Gain weight', lose: 'Lose weight' };
export const meals = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
export const diets = ['any', 'vegetarian', 'vegan'];
export const backupVersion = 1;
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function today() {
  const parts = Object.fromEntries(dateFormat.formatToParts(new Date()).map(part => [part.type, part.value]));
  return [parts.year, parts.month, parts.day].join('-');
}

export function shiftDay(day, count) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function prettyDay(day) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(day + 'T12:00:00Z'));
}

export function parseQuantity(input) {
  const text = String(input).trim().replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').trim();
  if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    const number = Number(text);
    return positive(number) ? number : null;
  }
  const fraction = text.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/);
  if (!fraction) return null;
  const number = Number(fraction[1] || 0) + Number(fraction[2]) / Number(fraction[3]);
  return positive(number) ? number : null;
}

export function scaleNutrition(values, factor) {
  return Object.fromEntries(nutrientKeys.flatMap(key =>
    Number.isFinite(values[key]) ? [[key, values[key] * factor]] : []));
}

export function scaleMealEntries(entries, multiplier) {
  if (!positive(multiplier)) throw new Error('Enter a positive meal amount.');
  return entries.map(entry => {
    const quantity = entry.quantity * multiplier;
    const nutrients = scaleNutrition(entry.nutrients, multiplier);
    if (!positive(quantity) || !positive(quantity * entry.factor) || !nutrition(nutrients)) {
      throw new Error('This meal amount is outside the supported range.');
    }
    return { ...entry, quantity, nutrients };
  });
}

export function summarize(entries) {
  return Object.fromEntries(nutrientKeys.map(key => {
    const known = entries.filter(entry => Number.isFinite(entry.nutrients[key]));
    return [key, {
      value: known.length ? known.reduce((sum, entry) => sum + entry.nutrients[key], 0) : null,
      known: known.length,
      total: entries.length,
    }];
  }));
}

export function calculateRecipe(ingredients, cookedWeight) {
  if (!ingredients.length || !positive(cookedWeight)) throw new Error('Enter ingredients and a cooked weight.');
  const totals = summarize(ingredients.map(({ food, amount }) => ({
    nutrients: scaleNutrition(food.nutrients, amount / 100),
  })));
  return Object.fromEntries(nutrientKeys.filter(key => totals[key].known === ingredients.length)
    .map(key => [key, totals[key].value * 100 / cookedWeight]));
}

const normalize = text => text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function findFoods(foods, query, favorites = [], recent = []) {
  const words = normalize(query).split(' ').filter(Boolean);
  const ranks = new Map(recent.map((id, index) => [id, index]));
  const pinned = new Set(favorites);
  return foods.flatMap(food => {
    const name = normalize(food.name);
    const aliases = (food.aliases || []).map(normalize);
    const haystack = [name, ...aliases].join(' ');
    if (!words.every(word => haystack.includes(word))) return [];
    const phrase = words.join(' ');
    let score = 0;
    if (phrase) {
      if (name === phrase || aliases.includes(phrase)) score += 80;
      else if (name.startsWith(phrase)) score += 55;
      else if (aliases.some(alias => alias.startsWith(phrase))) score += 40;
      else if (name.includes(phrase)) score += 25;
    }
    if (pinned.has(food.id)) score += 20;
    if (ranks.has(food.id)) score += Math.max(1, 16 - ranks.get(food.id));
    return [{ food, score }];
  }).sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
    .map(result => result.food);
}

export function makeEntry(food, quantity, unit, factor, meal, day) {
  const amount = quantity * factor;
  if (!positive(amount)) throw new Error('Enter a valid portion.');
  return {
    id: crypto.randomUUID(), foodId: food.id, name: food.name, category: food.category,
    basis: food.basis, quantity, unit, factor, meal, day, createdAt: new Date().toISOString(),
    source: food.source, nutrients: scaleNutrition(food.nutrients, amount / 100),
  };
}

export function weeklyReview(state, end) {
  const start = shiftDay(end, -6);
  const byDay = new Map();
  for (const entry of state.entries) {
    if (entry.day < start || entry.day > end) continue;
    if (!byDay.has(entry.day)) byDay.set(entry.day, []);
    byDay.get(entry.day).push(entry);
  }
  const days = [...byDay].filter(([day]) => state.completed[day] === true).map(([, entries]) => ({
    totals: summarize(entries), entries,
  }));
  const coverage = key => days.filter(({ totals }) => totals[key].known === totals[key].total);
  const average = key => {
    const eligible = coverage(key);
    return { count: eligible.length, value: eligible.length
      ? eligible.reduce((sum, day) => sum + day.totals[key].value, 0) / eligible.length : null };
  };
  const proteinDays = coverage('protein');
  const calorieDays = coverage('kcal');
  const calorieGoal = state.settings.kcal;
  const below = state.settings.protein ? proteinDays.filter(day => day.totals.protein.value < state.settings.protein) : [];
  const proteinMeals = meals.map(meal => {
    const logged = below.map(day => day.entries.filter(entry => entry.meal === meal)).filter(entries => entries.length);
    return {
      meal, count: logged.length,
      average: logged.length ? logged.reduce((sum, entries) => sum + summarize(entries).protein.value, 0) / logged.length : Infinity,
    };
  }).filter(meal => meal.count >= 2).sort((a, b) => a.average - b.average);
  return {
    start, end, logged: byDay.size, complete: days.length,
    kcal: average('kcal'), protein: average('protein'), fiber: average('fiber'), belowProtein: below.length,
    aboveCalories: calorieGoal ? calorieDays.filter(day => day.totals.kcal.value > calorieGoal).length : 0,
    belowCalories: calorieGoal ? calorieDays.filter(day => day.totals.kcal.value < calorieGoal).length : 0,
    meal: proteinMeals[0], categories: [...new Set(days.flatMap(day => day.entries.map(entry => entry.category)))],
  };
}

export function emptyState() {
  return { entries: [], foods: [], favorites: [], portions: [], savedMeals: [], completed: {},
    settings: { kcal: null, protein: null, diet: 'any', lastBackup: null } };
}

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;
const optionalString = value => value === undefined || string(value);
const positive = value => Number.isFinite(value) && value > 0 && value <= 1e7;
const basis = value => value === 'g' || value === 'ml';
const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const unique = values => new Set(values).size === values.length;
const source = value => record(value) && string(value.label) && optionalString(value.note)
  && (value.url === undefined || (string(value.url) && /^https?:\/\//i.test(value.url)));
const nutrition = value => record(value) && Number.isFinite(value.kcal) && Object.entries(value)
  .every(([key, amount]) => nutrientKeys.includes(key) && Number.isFinite(amount) && amount >= 0 && amount <= 1e10);
const portion = value => record(value) && string(value.label) && positive(value.amount);

export function isFood(food) {
  return record(food) && string(food.id) && string(food.name) && string(food.category)
    && basis(food.basis) && nutrition(food.nutrients) && source(food.source)
    && (food.aliases === undefined || (Array.isArray(food.aliases) && food.aliases.every(string)))
    && (food.portions === undefined || (Array.isArray(food.portions) && food.portions.every(portion)))
    && (food.recipe === undefined || (Array.isArray(food.recipe)
      && food.recipe.every(item => record(item) && string(item.id) && positive(item.amount))));
}

function isEntry(entry) {
  return record(entry) && string(entry.id) && string(entry.foodId) && string(entry.name)
    && string(entry.category) && basis(entry.basis) && positive(entry.quantity) && positive(entry.factor)
    && positive(entry.quantity * entry.factor) && string(entry.unit) && meals.includes(entry.meal)
    && isoDate(entry.day) && timestamp(entry.createdAt) && source(entry.source) && nutrition(entry.nutrients);
}

export function validateCatalog(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > 15000 || !list.every(isFood)
    || !unique(list.map(food => food.id))) {
    throw new Error('The food file contains invalid or duplicate records. See the example format in Settings.');
  }
  return list;
}

export function validateBackup(backup) {
  if (!record(backup) || backup.version !== backupVersion) throw new Error('This JSON is not a supported BabyNeKhanaKhaya? backup.');
  const state = backup.data;
  if (!record(state) || !record(state.settings) || !record(state.completed)
    || !Array.isArray(state.entries) || !state.entries.every(isEntry) || !unique(state.entries.map(entry => entry.id))
    || !Array.isArray(state.foods) || !state.foods.every(isFood) || !unique(state.foods.map(food => food.id))
    || !Array.isArray(state.favorites) || !state.favorites.every(string)
    || !Array.isArray(state.portions) || !state.portions.every(item => portion(item) && string(item.id) && string(item.foodId))
    || !unique(state.portions.map(item => item.id))
    || !Array.isArray(state.savedMeals) || !state.savedMeals.every(item => record(item) && string(item.id)
      && string(item.name) && Array.isArray(item.entries) && item.entries.length && item.entries.every(isEntry))
    || !unique(state.savedMeals.map(item => item.id))
    || !Object.entries(state.completed).every(([day, value]) => isoDate(day) && value === true)
    || !diets.includes(state.settings.diet)
    || !['kcal', 'protein'].every(key => state.settings[key] === null || positive(state.settings[key]))
    || (state.settings.goal !== undefined && !Object.hasOwn(weightGoals, state.settings.goal))
    || (state.settings.showReferences !== undefined && typeof state.settings.showReferences !== 'boolean')
    || (state.settings.nutrientTargets !== undefined && (!record(state.settings.nutrientTargets)
      || !Object.entries(state.settings.nutrientTargets).every(([key, value]) => targetKeys.slice(2).includes(key) && positive(value))))
    || !(state.settings.lastBackup === null || timestamp(state.settings.lastBackup))) {
    throw new Error('This backup has invalid diary data. Your current data has been kept.');
  }
  return state;
}

const csvCell = value => {
  let text = String(value ?? '');
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};

export function diaryCsv(entries) {
  const headers = ['Date', 'Meal', 'Food', 'Quantity', 'Unit', 'Base quantity', 'Base unit', 'Source',
    ...nutrientKeys.map(key => nutrients[key].join(' '))];
  const rows = entries.slice().sort((a, b) => a.day.localeCompare(b.day) || meals.indexOf(a.meal) - meals.indexOf(b.meal))
    .map(entry => [entry.day, entry.meal, entry.name, entry.quantity, entry.unit, entry.quantity * entry.factor,
      entry.basis, entry.source.label, ...nutrientKeys.map(key => entry.nutrients[key])]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
