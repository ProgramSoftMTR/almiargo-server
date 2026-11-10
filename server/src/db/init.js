import { createStore } from './index.js';
import { config } from '../config.js';

const store = await createStore();
console.log(`[db:init] driver "${config.storeDriver}" inicializado correctamente.`);
await store.close();
