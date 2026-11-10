import { config } from '../config.js';
import { MemoryStore } from './memory.js';

/**
 * Fábrica de stores. La persistencia de producción es Firebase Firestore;
 * el store JSON local fue eliminado (Render borra el disco en cada deploy).
 */
export async function createStore(driver = config.storeDriver) {
  let store;
  switch (driver) {
    case 'memory':
      store = new MemoryStore();
      break;
    case 'postgres': {
      const { PostgresStore } = await import('./postgres.js');
      store = new PostgresStore({ databaseUrl: config.databaseUrl, ssl: config.pgSsl });
      break;
    }
    case 'firestore':
    default: {
      const { FirestoreStore } = await import('./firestore.js');
      store = new FirestoreStore();
      break;
    }
  }
  await store.init();
  return store;
}

export { MemoryStore };