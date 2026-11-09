import { calendarDate, makeMeasurement, measurements } from './import-model.js';

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const columns = ['weight', 'muscleRate', 'bodyWater', 'boneMass', 'bmr', 'visceralFat',
  'subcutaneousFat', 'bodyFat', 'protein', 'muscleMass', 'fatFreeMass'];
const reportHeader = /^body composition report(?:\s+pg\b|\s*$)/im;
const tableHeader = /^date\s+weight\s+bmr$/i;
const rowPrefix = /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s*[-–]\s*(\d{1,2}):(\d{2})\s*([AP]M)\s+(.+)$/i;
const readingTypes = /\s+(?:Device|Manual(?: Entry)?)$/i;
const cellPattern = /^(--|[–—]|N\/A)$|^(\d+(?:\.\d+)?)\s*(kg|%|kcal)$/i;

function rowTime(month, day, year, hour, minute, meridiem) {
  const monthNumber = months.indexOf(month.toLowerCase()) + 1;
  const date = calendarDate(`${year}-${String(monthNumber).padStart(2, '0')}-${day.padStart(2, '0')}`);
  if (!date || Number(hour) < 1 || Number(hour) > 12 || Number(minute) > 59) return null;
  const hours = Number(hour) % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  // Reports omit the zone. Use the same India-time basis as the workspace diary.
  const time = Date.parse(`${date}T${String(hours).padStart(2, '0')}:${minute}:00+05:30`);
  return { date, time };
}

export function parseDrTrustReport(text) {
  const lines = text.normalize('NFKC').split(/\r?\n/).map(line => line.trim().replace(/\s+/g, ' '));
  if (!reportHeader.test(lines.join('\n')) || !lines.some(line => tableHeader.test(line))
    || !lines.some(line => /\bvisceral\b.*\bprotein\b.*\breading\b/i.test(line))) {
    throw new Error('Choose a DrTrust 360 body composition PDF with a selectable-text reading history table.');
  }

  const health = new Map();
  let skipped = 0;
  for (const line of lines) {
    const row = rowPrefix.exec(line);
    if (!row) continue;
    const reading = rowTime(...row.slice(1, 7));
    const rest = row[7].replace(readingTypes, '').replace(/(\d)\s+(kg|%|kcal)(?=\s|$)/gi, '$1$2');
    const cells = rest.split(' ').map(cell => cellPattern.exec(cell));
    if (!reading || cells.length !== columns.length || cells.some((cell, index) =>
      !cell || (!cell[1] && cell[3].toLowerCase() !== measurements[columns[index]].unit))) {
      skipped++;
      continue;
    }
    for (const [index, kind] of columns.entries()) {
      if (cells[index][1]) continue;
      const item = makeMeasurement({ ...reading, kind, value: Number(cells[index][2]), source: 'DrTrust' }, 'drtrust');
      if (item) health.set(item.id, item);
    }
  }
  if (!health.size) throw new Error('No supported dated measurements were found in the DrTrust PDF.');
  return { workouts: [], health: [...health.values()], skipped };
}
