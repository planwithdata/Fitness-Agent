import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync } from 'fflate';
import { readHealthFile } from '../site/lib/health-import.js';
import { ironLogBackup, ironLogSessions, mergeUnique, visibleWorkouts } from '../site/lib/import-model.js';
import { parseDrTrustReport } from '../site/lib/drtrust.js';
import { parseReceipt } from '../site/lib/receipt.js';
import { emptyWorkspace } from '../site/lib/domain.js';
import { workspaceFromBackup } from '../site/lib/records.js';
import { localReply } from '../site/lib/coach.js';

const ironSessions = [
  { id: 's1', dayId: 'upper-body', date: '2026-11-10', status: 'completed', durationSeconds: 2670,
    startedAt: '2026-11-10T08:00:00Z', completedAt: '2026-11-10T08:45:00Z',
    entries: [{ exerciseId: 'barbell-bench-press', substitution: { label: 'Dumbbell bench press' }, sets: [
      { completed: true, weightKg: 35, reps: 8 }, { completed: false, weightKg: 40, reps: 6 },
    ], warmupSets: [{ completed: true, weightKg: 10, reps: 15 }] }] },
  { id: 's2', dayId: 'legs', date: '2026-11-11', status: 'in-progress' },
  { id: 's3', dayId: 'rest', date: '2026-11-11', status: 'completed' },
];

test('IronLog supports the real backup envelope, completed sessions and working sets', () => {
  const result = ironLogBackup({ app: 'Project IronLog', schemaVersion: 4,
    data: { sessions: ironSessions, profile: { name: 'private' }, photos: [{ data: 'private' }] } });
  assert.equal(result.skipped, 1);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].minutes, 45);
  assert.equal(result.records[1].minutes, 0);
  assert.deepEqual(result.records[0].imported.exercises, [
    { name: 'Dumbbell bench press', sets: [{ kg: 35, reps: 8 }] },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private/);
  assert.throws(() => ironLogBackup({ app: 'Fitness Agent', schemaVersion: 4, data: { sessions: [] } }), /Project IronLog/);
  assert.deepEqual(mergeUnique(result.records, result.records), []);
  const linked = ironLogSessions([{ ...ironSessions[0], durationSeconds: 3600 }]).records;
  assert.deepEqual(visibleWorkouts(result.records, linked).map(item => item.minutes), [0, 60]);
});

const healthXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [<!ELEMENT HealthData ANY>]>
<HealthData locale="en_IN">
<ExportDate value="2026-11-11 08:00:00 +0530"/>
<Record type="HKQuantityTypeIdentifierBodyMass" sourceName="DrTrust &amp; scale" unit="kg" startDate="2026-11-10 00:05:00 +0530" value="75.2"/>
<Record type="HKQuantityTypeIdentifierBodyFatPercentage" sourceName="DrTrust" unit="%" startDate="2026-11-10 00:05:00 +0530" value="21"/>
<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Private device" unit="count/min" startDate="2026-11-10 05:00:00 +0530" value="61"/>
<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45" durationUnit="min" sourceName="Apple Watch" startDate="2026-11-10 06:00:00 +0530" endDate="2026-11-10 06:45:00 +0530" />
</HealthData>`;

test('Apple Health ZIP and XML import match and retain only selected health categories', async () => {
  const bytes = new TextEncoder().encode(healthXml);
  const archive = zipSync({ 'apple_health_export/other.xml': bytes, 'apple_health_export/export.xml': bytes });
  const raw = await readHealthFile(new File([bytes], 'export.xml'));
  const zipped = await readHealthFile(new File([archive], 'export.zip'));
  assert.deepEqual(zipped, raw);
  assert.equal(raw.workouts[0].minutes, 45);
  assert.equal(raw.workouts[0].type, 'Strength');
  assert.equal(raw.health[0].date, '2026-11-10');
  assert.equal(raw.health[0].source, 'DrTrust & scale');
  assert.equal(raw.health[1].value, 21);
  assert.doesNotMatch(JSON.stringify(raw), /Private device/);
  await assert.rejects(() => readHealthFile(new File(['<Invalid/>'], 'export.xml')), /Apple Health export/);
  await assert.rejects(() => readHealthFile(new File([zipSync({ 'unexpected.xml': bytes })], 'export.zip')), /export.xml/);
  const shortcut = await readHealthFile(new File(['date,weight_kg\n2026-11-10,75.2\n2026-02-31,70'], 'weight.csv'));
  assert.equal(shortcut.health[0].provider, 'shortcut');
  assert.equal(shortcut.skipped, 1);
});

test('receipt extraction detects Blinkit invoice rows and prefers an order-level amount', () => {
  const text = `Blinkit Order Summary
Order ID: BLK-012345
Invoice Date: 10/11/2026
Sr. Product Description HSN Qty Amount
1 Rolled Oats 500 g 11041200 2 ₹320.00
2 Whole Milk 1 L 04012000 1 ₹68.00
Subtotal ₹388.00
Delivery Fee ₹12.00
Grand Total ₹400.00
Amount Paid ₹385.00`;
  assert.deepEqual(parseReceipt(text), { provider: 'blinkit', merchant: '', orderId: 'BLK-012345',
    date: '2026-11-10', amount: 38500, weakTotal: false,
    items: [{ name: 'Rolled Oats 500 g', quantity: 2 }, { name: 'Whole Milk 1 L', quantity: 1 }] });
});

test('Zomato line items, split amounts and ambiguous totals are reviewable', () => {
  const receipt = parseReceipt(`Zomato Food Order Summary
Restaurant: Local Kitchen
Order Number 572091132
Order Date: November 10, 2026
Your Order
2 x Roti ₹60
1 x Dal Tadka ₹180
Grand Total
₹249.50`);
  assert.equal(receipt.merchant, 'Local Kitchen');
  assert.equal(receipt.date, '2026-11-10');
  assert.equal(receipt.amount, 24950);
  assert.equal(receipt.items[0].name, 'Roti');
  assert.equal(parseReceipt('Blinkit\nTotal ₹20').weakTotal, true);
  assert.equal(parseReceipt('Blinkit\nGrand Total ₹20\nGrand Total ₹50').amount, null);
  assert.equal(parseReceipt('Blinkit\nItem Total ₹20\nDelivery Fee ₹50').amount, null);
});

test('workspace backups include import metadata while older backups remain supported', async () => {
  const data = emptyWorkspace();
  delete data.health;
  const backup = { format: 'fitness-agent-workspace', data };
  assert.deepEqual(workspaceFromBackup(backup).health, []);
  data.workouts = ironLogSessions(ironSessions).records;
  data.health = (await readHealthFile(new File([healthXml], 'export.xml'))).health;
  data.expenses.push({ id: 'blinkit:order:1', name: 'Blinkit', date: '2026-11-10', created: '2026-11-10',
    type: 'Groceries', amount: 12500, imported: { provider: 'blinkit', orderId: '00001', items: [{ name: 'Milk', quantity: 2 }] } });
  assert.deepEqual(workspaceFromBackup(backup), data);
  assert.match(localReply('What have I bought?', {}, data), /Milk.*1 order/);
  assert.match(localReply('What is my body weight?', {}, data), /75.2 kg/);
});


const drTrustHeader = `Body composition report Pg 4 of 6
MUSCLE BODY BONE VISCERAL SUB CUT. BODY PROTEIN MUSCLE WEIGHT READING
DATE WEIGHT BMR
RATE WATER MASS FAT FAT FAT MASS MASS W/O FAT TYPE`;

test('DrTrust imports dated values by column and preserves missing cells', () => {
  const row = 'Nov 10, 2026 - 12:01 AM 75.5Kg 78% 59% 3.1Kg 1750Kcal 6% 14% 19% 18% 61Kg 62Kg Device';
  const missing = 'Nov 09, 2026 - 12:01 PM 75.8Kg -- -- -- -- -- -- -- -- -- 62.5Kg Device';
  const malformed = row.replace('Nov 10', 'Nov 11').replace('1750Kcal', '1750Kg');
  const data = parseDrTrustReport([drTrustHeader, row, missing, row, malformed].join('\n'));
  assert.equal(data.health.length, 13);
  assert.equal(data.skipped, 1);
  assert.equal(data.health.find(item => item.kind === 'weight').time, Date.parse('2026-11-10T00:01:00+05:30'));
  assert.equal(data.health.find(item => item.kind === 'muscleMass').value, 61);
  assert.equal(data.health.find(item => item.kind === 'bodyFat').value, 19);
  assert.equal(data.health.find(item => item.date === '2026-11-09').time, Date.parse('2026-11-09T12:01:00+05:30'));
  assert.throws(() => parseDrTrustReport(row), /DrTrust 360/);
  assert.throws(() => parseDrTrustReport(drTrustHeader), /No supported dated measurements/);
});

test('saved DrTrust measurements restore and coach history stays source-specific', () => {
  const rows = [
    drTrustHeader,
    'Nov 10, 2026 - 10:00 AM 75Kg 78% 59% 3Kg 1750Kcal 6% 14% 19% 18% 61Kg 62Kg Device',
    'Nov 08, 2026 - 10:00 AM 76Kg 78% 59% 3Kg 1750Kcal 6% 14% 19% 18% 60Kg 62Kg Device',
  ];
  const data = emptyWorkspace();
  data.health = parseDrTrustReport(rows.join('\n')).health;
  assert.deepEqual(workspaceFromBackup({ format: 'fitness-agent-workspace', data }), data);
  assert.match(localReply('Compare my muscle mass', {}, data), /61 kg.*previous reading from that source was 60 kg/);
  assert.deepEqual(mergeUnique(data.health, parseDrTrustReport(rows.join('\n')).health), []);
  data.health[0].value = Infinity;
  assert.throws(() => workspaceFromBackup({ format: 'fitness-agent-workspace', data }), /invalid health measurements/);
});
