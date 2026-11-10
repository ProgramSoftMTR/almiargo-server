import { Emitter } from './emitter.js';

/** Bus de notificaciones UI (toasts, apertura de paneles) sin acoplar la escena. */
export const uiBus = new Emitter();
