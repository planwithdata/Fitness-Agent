import { emptyState } from './core.js';

const databaseName = 'fitness-agent-nutrition-v1';
const calorieCounterName = 'daily-katori-diary';
const storeName = 'diary';
const stateKey = 'state';

export function openDiary() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

export function loadDiary(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(stateKey);
    request.onsuccess = () => resolve(request.result || emptyState());
    request.onerror = () => reject(request.error);
  });
}

export function readCalorieCounterDiary() {
  return new Promise((resolve, reject) => {
    // With no version argument an existing database opens at its current version.
    const open = indexedDB.open(calorieCounterName);
    let missing = false;
    open.onupgradeneeded = () => {
      missing = true;
      open.transaction.abort();
    };
    open.onerror = () => missing ? resolve(null) : reject(open.error);
    open.onsuccess = async () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      try {
        resolve(await loadDiary(db));
      } catch (error) {
        reject(error);
      } finally {
        db.close();
      }
    };
  });
}

export function updateDiary(db, update) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.get(stateKey);
    let updated;
    let error;
    request.onsuccess = () => {
      try {
        const state = request.result || emptyState();
        updated = update(state) ?? state;
        store.put(updated, stateKey);
      } catch (failure) {
        error = failure;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(updated);
    transaction.onabort = () => reject(error || transaction.error || new Error('The diary could not be saved.'));
  });
}
