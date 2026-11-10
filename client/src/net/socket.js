import { Emitter } from '../core/emitter.js';
import { store } from '../core/store.js';

export function normalizeServerUrl(input) {
  let raw = String(input ?? '').trim();
  if (!raw) raw = defaultServerUrl();
  if (!/^[a-z]+:\/\//i.test(raw)) raw = `ws://${raw}`;
  raw = raw.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  try {
    const url = new URL(raw);
    if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

export function defaultServerUrl() {
  // Endpoint inyectado por Vite en tiempo de compilación. Es la única fuente
  // de configuración del servidor para el jugador (no se pide IP/URL en la UI).
  const env = String(import.meta.env.VITE_SERVER_URL ?? '').trim();
  if (env) return env;
  // En builds nativos (APK) el endpoint de produccion siempre esta disponible.
  if (typeof window === 'undefined') return 'wss://almiargo-server.onrender.com/ws';
  const native = window.Capacitor?.isNativePlatform?.()
    || (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.() === 'android');
  if (native) return 'wss://almiargo-server.onrender.com/ws';
  const { protocol, hostname, port, host } = window.location;
  if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1' && port !== '5173') {
    return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}:8080/ws`;
  }
  return 'ws://localhost:8080/ws';
}

/**
 * Cliente WebSocket con reconexión automática por token y ping de latencia.
 */
class GameSocket extends Emitter {
  constructor() {
    super();
    this.ws = null;
    this.url = normalizeServerUrl(defaultServerUrl());
    // Limpia URLs guardadas por versiones antiguas: el endpoint ya no es editable.
    localStorage.removeItem('rucoy.server');
    this.token = localStorage.getItem('rucoy.token') || null;
    this.authenticated = false;
    this.manualClose = false;
    this.authProvider = 'session';
    this.lastAuthPayload = null;
    this.authFailed = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.pingStart = 0;
    this.latency = 0;
    this.connectTimer = null;
  }

  /**
   * Abre el WebSocket y envía el token en el primer payload. Para OAuth se
   * usa provider:'google' y el JWT del proveedor; para reconexiones se usa
   * el token de sesión interno emitido por el servidor.
   */
  connect({ token = null, provider = 'session' } = {}) {
    this.manualClose = false;
    this.authFailed = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    if (provider === 'google' || provider === 'apple') {
      if (!token) {
        this.emit('auth_error', { message: 'El proveedor no devolvió un token válido' });
        return;
      }
      // El JWT de Google no se persiste: el servidor responde con un
      // token de sesión interno que sí se guarda para reconectar sin UI.
      this.authProvider = provider;
      this.token = null;
      localStorage.removeItem('rucoy.token');
      this.lastAuthPayload = { type: 'auth', provider, token };
    } else {
      this.authProvider = 'session';
      if (token) {
        this.token = token;
        localStorage.setItem('rucoy.token', token);
      }
      if (!this.token) {
        this.emit('auth_error', { message: 'No hay una sesión guardada' });
        return;
      }
      this.lastAuthPayload = { type: 'auth', token: this.token };
    }

    this.open(this.lastAuthPayload);
  }

  open(authPayload) {
    this.cleanupSocket();
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.authenticated = false;
    this.lastAuthPayload = authPayload;
    this.emit('status', { state: 'connecting', url: this.url });

    // Si el teléfono no puede alcanzar la PC, el WebSocket puede tardar
    // mucho en disparar onerror. Un timeout explícito deja el error visible.
    this.connectTimer = setTimeout(() => {
      if (this.ws?.readyState === 1) return;
      this.authFailed = true;
      this.emit('debug', { message: 'timeout de conexión', url: this.url });
      this.emit('status', {
        state: 'error',
        message: `No se pudo conectar a ${this.url}. Revisa que el servidor esté encendido y que el teléfono esté en la misma Wi-Fi.`,
      });
      try { this.ws?.close(); } catch { /* ignore */ }
    }, 12000);

    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
      this.emit('status', { state: 'error', message: 'URL de servidor inválida' });
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
      this.authFailed = false;
      this.emit('status', { state: 'connected' });
      try {
        ws.send(JSON.stringify(authPayload));
      } catch { /* ignore */ }
      this.startPing();
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        this.emit('debug', {
          message: 'mensaje del servidor ilegible',
          bytes: String(event.data ?? '').length,
        });
        return;
      }
      if (msg?.type === 'auth_ok' || msg?.type === 'auth_error') {
        this.emit('debug', {
          message: 'mensaje de auth recibido',
          type: msg.type,
          bytes: String(event.data ?? '').length,
        });
      }
      this.handleMessage(msg);
    };

    ws.onerror = () => {
      this.authFailed = true;
      this.emit('status', {
        state: 'error',
        message: `No se pudo conectar al servidor (${this.url})`,
      });
    };

    ws.onclose = (event) => {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
      this.stopPing();
      const wasAuth = this.authenticated;
      this.authenticated = false;
      store.connected = false;

      // La cuenta se abrió en otro dispositivo: no reconectar en bucle.
      if (event.code === 4001) {
        this.token = null;
        localStorage.removeItem('rucoy.token');
        const reason = event.reason || 'Desconectado por nueva sesión';
        this.emit('status', { state: 'offline', code: 4001, reason });
        this.emit('session_replaced', { message: reason });
        return;
      }

      this.emit('status', { state: 'offline', code: event.code, reason: event.reason });
      if (!this.manualClose && wasAuth && this.token) this.scheduleReconnect();
      else if (!this.manualClose && !this.authFailed && !this.token) {
        this.emit('auth_error', { message: 'Conexión cerrada' });
      }
    };
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'hello':
        this.emit('hello', msg);
        break;
      case 'auth_ok':
        this.authenticated = true;
        this.authFailed = false;
        this.authProvider = msg.provider || this.authProvider;
        this.reconnectAttempts = 0;
        this.token = msg.token;
        localStorage.setItem('rucoy.token', msg.token);
        store.online = msg.online ?? 1;
        this.emit('debug', {
          message: 'auth_ok procesado',
          provider: msg.provider,
          needsCharacter: msg.needsCharacter === true,
          account: msg.account?.email,
          player: msg.player?.name,
        });
        this.emit('auth_ok', msg);
        if (msg.needsCharacter) {
          store.token = msg.token;
          this.emit('account_ready', msg);
        } else {
          store.setAuth(msg);
        }
        break;
      case 'auth_error':
        this.authenticated = false;
        this.authFailed = true;
        this.token = null;
        localStorage.removeItem('rucoy.token');
        this.emit('debug', { message: 'auth_error recibido', serverMessage: msg.message });
        this.emit('auth_error', msg);
        break;
      case 'character_error':
        this.emit('character_error', msg);
        break;
      case 'snapshot':
        store.applySnapshot(msg);
        this.emit('snapshot', msg);
        break;
      case 'event':
        store.applyEvent(msg);
        break;
      case 'chat':
        store.pushChat(msg);
        break;
      case 'pong':
        this.latency = Math.max(0, Date.now() - Number(msg.t || 0));
        store.latency = this.latency;
        this.emit('latency', this.latency);
        break;
      default:
        break;
    }
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState !== 1) return;
      this.pingStart = Date.now();
      this.sendPing(this.pingStart);
    }, 4000);
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 12) {
      this.emit('status', { state: 'failed' });
      return;
    }
    const delay = Math.min(1000 * this.reconnectAttempts, 8000);
    this.emit('status', { state: 'reconnecting', attempt: this.reconnectAttempts, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.emit('status', { state: 'connecting' });
      this.open({ type: 'auth', token: this.token });
    }, delay);
  }

  send(type, payload = {}) {
    if (this.ws?.readyState !== 1) return false;
    try {
      this.ws.send(JSON.stringify({ type, ...payload }));
      return true;
    } catch {
      return false;
    }
  }

  /** Envia un payload ya codificado (arrays compactos incluidos). */
  sendRaw(payload) {
    if (this.ws?.readyState !== 1) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  /** Movimiento compacto: [1, dx, dy, seq]. Ahorra ~55% de bytes. */
  sendMove(dx, dy, seq) {
    return this.sendRaw([1, dx, dy, seq]);
  }

  /** Ping compacto: [2, timestamp]. */
  sendPing(t = Date.now()) {
    return this.sendRaw([2, t]);
  }

  cleanupSocket() {
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
    if (!this.ws) return;
    const old = this.ws;
    this.ws = null;
    old.onopen = null;
    old.onmessage = null;
    old.onerror = null;
    old.onclose = null;
    try { old.close(); } catch { /* ignore */ }
  }

  disconnect() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPing();
    this.cleanupSocket();
    this.authenticated = false;
  }
}

export const socket = new GameSocket();
