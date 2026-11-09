import { today, prettyDay, meals } from '../nutrition/core.js';
import { expenseTypes, workoutTypes } from './domain.js';

export const kinds = {
  workouts: { name: 'workout', icon: 'workout', tone: 'violet', fields: [
    ['name', 'Workout name', 'text', { max: 100, placeholder: 'Upper body, evening walk…' }],
    ['type', 'Type', 'select', { options: workoutTypes }],
    ['minutes', 'Minutes', 'number', { min: 1, max: 1440, step: 1 }],
    ['date', 'Date', 'date'],
    ['notes', 'Notes (optional)', 'textarea', { max: 500, optional: true }],
  ] },
  expenses: { name: 'expense', icon: 'spending', tone: 'blue', fields: [
    ['name', 'Description', 'text', { max: 100, placeholder: 'Weekly groceries…' }],
    ['type', 'Category', 'select', { options: expenseTypes }],
    ['amount', 'Amount (₹)', 'money', { min: .01, max: 1e7, step: .01 }],
    ['date', 'Date', 'date'],
  ] },
  meals: { name: 'meal plan', icon: 'nutrition', tone: 'orange', fields: [
    ['name', 'Meal name', 'text', { max: 100, placeholder: 'Chana and rice bowl' }],
    ['slot', 'Meal', 'select', { options: meals }],
    ['date', 'Date', 'date'],
    ['ingredients', 'Ingredients (optional)', 'ingredients', { max: 650, optional: true, placeholder: 'Chickpeas, rice, cucumber' }],
  ] },
  groceries: { name: 'grocery item', icon: 'basket', tone: 'mint', fields: [
    ['name', 'Item', 'text', { max: 100, placeholder: 'Rolled oats' }],
    ['quantity', 'Quantity (optional)', 'text', { max: 60, optional: true, placeholder: '500 g' }],
  ] },
  routines: { name: 'routine', icon: 'clock', tone: 'blue', fields: [
    ['name', 'Daily routine', 'text', { max: 100, placeholder: 'Pack lunch' }],
    ['time', 'Time', 'time'],
  ] },
  memory: { name: 'memory', icon: 'coach', tone: 'violet', fields: [
    ['kind', 'Category', 'select', { options: ['Food', 'Training', 'Routine', 'Other'] }],
    ['text', 'What should the coach remember?', 'textarea', { max: 350, placeholder: 'I usually cook for two.' }],
  ] },
};

export const profileFields = [
  ['name', 'Preferred name (optional)', 'text', { max: 40, optional: true }],
  ['workoutGoal', '7-day movement target (minutes)', 'number', { min: 0, max: 10080, step: 1 }],
  ['budget', 'Monthly food budget (₹)', 'money', { min: 0, max: 1e7, step: .01 }],
];

export const templates = [
  { name: 'Chana and rice bowl', slot: 'Lunch', ingredients: ['Chickpeas', 'Rice', 'Cucumber', 'Lemon'] },
  { name: 'Banana overnight oats', slot: 'Breakfast', ingredients: ['Rolled oats', 'Banana', 'Soy milk'] },
  { name: 'Moong dal khichdi', slot: 'Dinner', ingredients: ['Moong dal', 'Rice', 'Carrots', 'Cumin'] },
];

const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validText = (value, max, optional = false) => typeof value === 'string' && value.length <= max && (optional || Boolean(value.trim()));

function validField(value, type, options = {}) {
  if (type === 'number') return Number.isSafeInteger(value) && value >= options.min && value <= options.max;
  if (type === 'money') return Number.isSafeInteger(value) && value >= options.min * 100 && value <= options.max * 100;
  if (type === 'select') return options.options.includes(value);
  if (type === 'date') return validDate(value);
  if (type === 'time') return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (type === 'ingredients') return Array.isArray(value) && value.length <= 40 && value.every(item => validText(item, 100));
  return validText(value, options.max, options.optional);
}

function validFields(record, fields) {
  return record && typeof record === 'object' && fields.every(([key, , type, options]) => validField(record[key], type, options));
}

export function readFields(form, fields) {
  const input = new FormData(form);
  const record = {};
  for (const [key, label, type, options] of fields) {
    const value = String(input.get(key) ?? '').trim();
    const parsed = type === 'money' ? Math.round(Number(value) * 100) : type === 'number' ? Number(value)
      : type === 'ingredients' ? [...new Set(value.split(/[,\n]/).map(item => item.trim()).filter(Boolean))] : value;
    if (!validField(parsed, type, options)) throw new Error(`Check the ${label.toLowerCase()} field.`);
    record[key] = parsed;
  }
  return record;
}

function validImport(info, collection) {
  if (info === undefined) return true;
  if (collection === 'workouts') {
    return info?.provider === 'apple' || (info?.provider === 'ironlog' && Array.isArray(info.exercises)
      && info.exercises.length <= 100 && info.exercises.every(exercise => validText(exercise?.name, 100)
        && Array.isArray(exercise.sets) && exercise.sets.length <= 60 && exercise.sets.every(set =>
          Number.isFinite(set?.reps) && set.reps > 0 && set.reps <= 2000
          && (set.kg === null || Number.isFinite(set.kg) && set.kg >= 0 && set.kg <= 10000))));
  }
  return collection === 'expenses' && ['blinkit', 'zomato'].includes(info?.provider)
    && validText(info.orderId, 50, true) && Array.isArray(info.items) && info.items.length <= 100
    && info.items.every(item => validText(item?.name, 100) && (item.quantity === null
      || Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 999));
}

function validMeasurement(item) {
  return validText(item?.id, 100) && validDate(item.date) && validText(item.source, 100)
    && ['apple', 'shortcut'].includes(item.provider) && ['weight', 'bodyFat'].includes(item.kind)
    && (item.time === null || Number.isFinite(item.time))
    && Number.isFinite(item.value) && item.value > 0 && item.value <= (item.kind === 'weight' ? 1500 : 100);
}

export function workspaceFromBackup(input) {
  const data = input?.data;
  if (input?.format !== 'fitness-agent-workspace' || data?.version !== 1 || !validFields(data.profile, profileFields)) {
    throw new Error('Choose a supported Fitness Agent workspace backup.');
  }
  for (const [key, config] of Object.entries(kinds)) {
    const records = data[key];
    const validRecord = record => {
      const importedWorkout = key === 'workouts' && ['ironlog', 'apple'].includes(record?.imported?.provider);
      const fields = importedWorkout && record.minutes === 0 ? config.fields.filter(([field]) => field !== 'minutes') : config.fields;
      return validFields(record, fields) && validText(record.id, 100) && validText(record.created, 50) &&
        validImport(record.imported, key) &&
        (key !== 'groceries' || typeof record.done === 'boolean') &&
        (key !== 'routines' || record.doneOn === null || validDate(record.doneOn));
    };
    if (!Array.isArray(records) || records.length > 50000 || !records.every(validRecord) ||
      new Set(records.map(record => record.id)).size !== records.length) {
      throw new Error(`The backup has invalid ${key} data.`);
    }
  }
  if (!Array.isArray(data.messages) || data.messages.length > 60 || !data.messages.every(item => item
    && ['user', 'local', 'model'].includes(item.role) && validText(item.text, 6000))) {
    throw new Error('The backup has invalid coach history.');
  }
  const { profile, messages, version } = data;
  const records = Object.fromEntries(Object.keys(kinds).map(key => [key, data[key]]));
  const health = data.health === undefined ? [] : data.health;
  if (!Array.isArray(health) || health.length > 50000 || !health.every(validMeasurement)
    || new Set(health.map(item => item.id)).size !== health.length) {
    throw new Error('The backup has invalid health measurements.');
  }
  return { profile, messages, version, ...records, health };
}

export const defaults = {
  workouts: () => ({ date: today(), type: workoutTypes[0] }),
  expenses: () => ({ date: today(), type: expenseTypes[0] }),
  meals: date => ({ date, slot: 'Lunch' }),
  routines: () => ({ time: '08:00' }),
};

export const dateText = date => date === today() ? 'Today' : prettyDay(date);
