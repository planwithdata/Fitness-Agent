import { Unzip, UnzipInflate, SaxesParser } from '../vendor/health-codecs.js';
import { appleWorkout, bodyMeasurement, shortcutMeasurements } from './import-model.js';

const maxBytes = 400 * 1024 * 1024;
const bodyTypes = new Set(['HKQuantityTypeIdentifierBodyMass', 'HKQuantityTypeIdentifierBodyFatPercentage']);

export async function readHealthFile(file) {
  if (file.size > maxBytes) throw new Error('Choose an Apple Health export smaller than 400 MB.');
  if (/\.csv$/i.test(file.name)) {
    if (file.size > 2 * 1024 * 1024) throw new Error('Choose a Health Shortcut CSV smaller than 2 MB.');
    return shortcutMeasurements(await file.text());
  }

  const zipped = /\.zip$/i.test(file.name);
  const parser = new SaxesParser();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const workouts = new Map();
  const health = new Map();
  let total = 0;
  let skipped = 0;
  let rootFound = false;
  let selected = false;
  let complete = false;
  let failure;

  parser.on('doctype', content => {
    if (content.length > 100_000) throw new Error('The Apple Health file has an invalid header.');
  });
  parser.on('opentag', ({ name, attributes }) => {
    if (!rootFound) {
      if (name !== 'HealthData') throw new Error('This XML is not an Apple Health export.');
      rootFound = true;
      return;
    }
    let item;
    if (name === 'Workout') {
      item = appleWorkout(attributes);
      if (item) workouts.set(item.id, item);
      else skipped++;
    }
    if (name === 'Record' && bodyTypes.has(attributes.type)) {
      item = bodyMeasurement(attributes);
      if (item) health.set(item.id, item);
      else skipped++;
    }
    if (workouts.size + health.size > 50000) throw new Error('This export has too many supported measurements.');
  });

  function parse(chunk) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error('The uncompressed Apple Health XML exceeds 400 MB.');
    parser.write(decoder.decode(chunk, { stream: true }));
  }

  const zip = zipped ? new Unzip(entry => {
    if (selected || !/(?:^|\/)export\.xml$/i.test(entry.name)) return;
    selected = true;
    if (entry.originalSize > maxBytes) throw new Error('The uncompressed Apple Health XML exceeds 400 MB.');
    entry.ondata = (error, bytes, final) => {
      if (error) failure = new Error('Could not decompress the Apple Health export.');
      else if (!failure) {
        try { parse(bytes); } catch (problem) { failure = problem; }
      }
      if (final) complete = true;
    };
    entry.start();
  }) : null;
  zip?.register(UnzipInflate);

  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (zip) {
        // Bound each inflate step and stop as soon as export.xml is complete.
        for (let offset = 0; offset < value.length && !complete; offset += 16384) {
          zip.push(value.subarray(offset, offset + 16384));
          if (failure) throw failure;
        }
        if (complete) break;
      } else parse(value);
    }
    if (zip && !complete) zip.push(new Uint8Array(), true);
    if (failure) throw failure;
    if (zip && (!selected || !complete)) throw new Error('No complete export.xml was found in this ZIP.');
    parser.write(decoder.decode()).close();
    if (!rootFound) throw new Error('This XML is not an Apple Health export.');
    return { workouts: [...workouts.values()], health: [...health.values()], skipped };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
