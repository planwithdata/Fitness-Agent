import { shiftDay } from '../nutrition/core.js';

export const providers = { ironlog: 'IronLog', apple: 'Apple Health', shortcut: 'Health Shortcut', drtrust: 'DrTrust',
  blinkit: 'Blinkit', zomato: 'Zomato' };
export const ironLogStorageKey = 'ironlog:v1:sessions';
export const ironLogPreference = 'fitness-agent:ironlog-linked';
export const ironLogUrl = 'https://planwithdata.github.io/ProjectIronLog/#/home';

export function calendarDate(value) {
  const date = typeof value === 'string' ? value.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  try { return shiftDay(date, 0) === date ? date : ''; } catch { return ''; }
}

const tidy = (value, max = 100) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const label = value => tidy(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()).slice(0, 100);
const instant = value => {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(timestamp) ? timestamp : null;
};
const rounds = minutes => Math.min(1440, Math.max(1, Math.round(minutes)));

export function sessionMinutes(duration, unit, start, end) {
  const factor = { sec: 1 / 60, s: 1 / 60, min: 1, hr: 60, h: 60 }[unit];
  const numeric = Number(duration);
  if (factor && Number.isFinite(numeric) && numeric > 0) return rounds(numeric * factor);
  const first = instant(start);
  const last = instant(end);
  return first !== null && last !== null && last > first ? rounds((last - first) / 60000) : 0;
}

function importId(provider, value) {
  return provider + ':' + value;
}

function ironExercises(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 100).flatMap(entry => {
    const name = tidy(entry?.substitution?.label) || label(entry?.substitution?.performedId || entry?.exerciseId);
    if (!name) return [];
    const sets = Array.isArray(entry.sets) ? entry.sets.slice(0, 60).flatMap(set => {
      if (!set?.completed || !Number.isFinite(set.reps) || set.reps <= 0 || set.reps > 2000) return [];
      const kg = Number.isFinite(set.weightKg) && set.weightKg >= 0 && set.weightKg <= 10000 ? set.weightKg : null;
      return [{ reps: set.reps, kg }];
    }) : [];
    return sets.length ? [{ name, sets }] : [];
  });
}

export function ironLogSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.length > 50000) throw new Error('The IronLog workout list is invalid or too large.');
  const records = new Map();
  let skipped = 0;
  for (const session of sessions) {
    const date = calendarDate(session?.date);
    const id = tidy(session?.id, 80);
    if (session?.status !== 'completed' || !date || !id || id !== session.id) {
      skipped++;
      continue;
    }
    const key = importId('ironlog', id);
    const exercises = ironExercises(session.entries);
    const total = exercises.reduce((sum, item) => sum + item.sets.length, 0);
    records.set(key, {
      id: key, name: tidy(session.title) || label(session.dayId) || 'IronLog workout',
      type: 'Strength', date, minutes: sessionMinutes(session.durationSeconds, 'sec', session.startedAt, session.completedAt),
      created: tidy(session.completedAt, 50) || date,
      notes: total ? `${exercises.length} exercises · ${total} completed working sets` : '',
      imported: { provider: 'ironlog', exercises },
    });
  }
  return { records: [...records.values()], skipped };
}

export function ironLogBackup(backup) {
  if (backup?.app !== 'Project IronLog' || ![1, 2, 3, 4].includes(backup.schemaVersion)) {
    throw new Error('Choose a Project IronLog JSON backup (schema 1–4) from IronLog Settings.');
  }
  return ironLogSessions(backup.data?.sessions);
}

export function visibleWorkouts(saved, linked) {
  if (!linked.length) return saved;
  const linkedIds = new Set(linked.map(record => record.id));
  return [...saved.filter(record => !linkedIds.has(record.id)), ...linked];
}

export async function fileKey(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Non-adversarial identity for Apple XML exports. Identical source samples have no export UUID.
function healthKey(fields) {
  const value = JSON.stringify(fields);
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 1597334677);
  }
  return [first >>> 0, second >>> 0].map(part => part.toString(16).padStart(8, '0')).join('');
}

export function appleWorkout(attrs) {
  const { workoutActivityType, startDate, endDate, sourceName } = attrs;
  const date = calendarDate(startDate);
  if (!date || !tidy(workoutActivityType) || instant(startDate) === null || instant(endDate) === null) return null;
  const name = label(workoutActivityType.replace(/^HKWorkoutActivityType/, '')) || 'Workout';
  const type = /strength|weightlifting|functional training/i.test(name) ? 'Strength'
    : /run|walk|cycl|row|swim|elliptical|stair/i.test(name) ? 'Cardio'
      : /yoga|pilates|flexib|mind and body/i.test(name) ? 'Mobility' : 'Other';
  const source = tidy(sourceName);
  const id = importId('apple', healthKey([workoutActivityType, instant(startDate), instant(endDate), source]));
  return { id, name, type, date, created: new Date(instant(startDate)).toISOString(),
    minutes: sessionMinutes(attrs.duration, attrs.durationUnit, startDate, endDate),
    notes: source, imported: { provider: 'apple' } };
}

export const measurements = {
  weight: { label: 'Weight', unit: 'kg', max: 1500 },
  bodyFat: { label: 'Body fat', unit: '%', max: 100 },
  muscleMass: { label: 'Muscle mass', unit: 'kg', max: 1500 },
  muscleRate: { label: 'Muscle rate', unit: '%', max: 100 },
  bodyWater: { label: 'Body water', unit: '%', max: 100 },
  boneMass: { label: 'Bone mass', unit: 'kg', max: 1500 },
  bmr: { label: 'Reported BMR', unit: 'kcal', max: 30000 },
  visceralFat: { label: 'Visceral fat', unit: '%', max: 100 },
  subcutaneousFat: { label: 'Subcutaneous fat', unit: '%', max: 100 },
  protein: { label: 'Protein mass', unit: '%', max: 100 },
  fatFreeMass: { label: 'Weight without fat', unit: 'kg', max: 1500 },
};

export function newestMeasurements(items) {
  return [...items].sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? 0) - (a.time ?? 0));
}

export function measurementText({ kind, value }) {
  const unit = measurements[kind].unit;
  return value + (unit === '%' ? '' : ' ') + unit;
}

export function validMeasurementValue(kind, value) {
  return Object.hasOwn(measurements, kind) && Number.isFinite(value) && value > 0 && value <= measurements[kind].max;
}

export function makeMeasurement({ kind, date, time, value, source }, provider) {
  const rounded = Math.round(value * 1000) / 1000;
  if (!validMeasurementValue(kind, rounded)) return null;
  const key = healthKey([kind, time ?? date, rounded, source]);
  return { id: importId(provider, key), provider, date, time, kind, value: rounded, source };
}

export function bodyMeasurement(attrs, provider = 'apple') {
  const date = calendarDate(attrs.startDate);
  const raw = Number(attrs.value);
  const kind = { HKQuantityTypeIdentifierBodyMass: 'weight', HKQuantityTypeIdentifierBodyFatPercentage: 'bodyFat' }[attrs.type];
  const conversion = kind === 'weight' ? { kg: 1, lb: 0.45359237, g: 0.001 }[attrs.unit]
    : attrs.unit === '%' ? 1 : null;
  if (!date || !kind || !conversion || !(raw > 0)) return null;
  return makeMeasurement({ kind, date, time: instant(attrs.startDate), value: raw * conversion,
    source: tidy(attrs.sourceName) || providers[provider] }, provider);
}

export function shortcutMeasurements(text) {
  const entries = text.trim().split(/\r?\n/);
  if (entries.shift()?.trim().toLowerCase() !== 'date,weight_kg') {
    throw new Error('Use the Health Shortcut CSV header date,weight_kg.');
  }
  const health = new Map();
  let skipped = 0;
  for (const row of entries) {
    if (!row.trim()) continue;
    const parts = row.split(',').map(part => part.trim());
    const [date, value] = parts;
    const item = parts.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d+(?:\.\d+)?$/.test(value)
      ? bodyMeasurement({ type: 'HKQuantityTypeIdentifierBodyMass', startDate: date, value, unit: 'kg' }, 'shortcut') : null;
    if (item) health.set(item.id, item);
    else skipped++;
  }
  return { workouts: [], health: [...health.values()], skipped };
}

export function mergeUnique(existing, incoming) {
  const ids = new Set(existing.map(item => item.id));
  const added = [];
  for (const item of incoming) {
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    added.push(item);
  }
  return added;
}
