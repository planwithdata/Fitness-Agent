import { emptyWorkspace } from './domain.js';

const name = 'fitness-agent-workspace';
const store = 'workspace';
const key = 'state';

export function openWorkspace() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

export function loadWorkspace(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result ?? emptyWorkspace());
    request.onerror = () => reject(request.error);
  });
}

export function saveWorkspace(db, edit) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    const table = transaction.objectStore(store);
    const request = table.get(key);
    let state;
    let failure;
    request.onsuccess = () => {
      try {
        state = request.result ?? emptyWorkspace();
        edit(state);
        table.put(state, key);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(state);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Could not save your workspace.'));
  });
}
