import { Capacitor } from '@capacitor/core';

/**
 * Login del cliente (sólo Google):
 *
 * - Web de escritorio: Google Identity Services (GIS) con popup.
 * - Android/iOS (Capacitor): plugin nativo Google One Tap / Credential Manager.
 *   El plugin abre el selector de cuentas nativo de Google y devuelve el ID
 *   token por el bridge de Capacitor. No abre el navegador, no usa redirect
 *   URI y no requiere deep links ni intent-filters.
 *
 * El ID token se envía al servidor (`socket.connect({ provider, token })`) y
 * allí se valida firma, emisor, expiración y audience contra GOOGLE_CLIENT_ID.
 */

const GOOGLE_CLIENT_ID = String(
  (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID)
  || process.env.VITE_GOOGLE_CLIENT_ID
  || '',
).trim();

export const googleOAuthConfigured = GOOGLE_CLIENT_ID.length > 0;

const GIS_SRC = 'https://accounts.google.com/gsi/client';

const scriptCache = new Map();
let gisHost = null;

function loadScript(src) {
  if (scriptCache.has(src)) return scriptCache.get(src);
  const promise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.async = true;
    el.src = src;
    el.onload = () => resolve(true);
    el.onerror = () => reject(new Error('No se pudo cargar el SDK de Google'));
    document.getElementsByTagName('head')[0].appendChild(el);
  });
  scriptCache.set(src, promise);
  return promise;
}

/**
 * Android/iOS: Google One Tap / Credential Manager (nativo).
 *
 * @returns {Promise<{provider:'google', token:string}>} ID token JWT.
 */
async function signInWithGoogleNative() {
  // Import dinámico: el bundle web no descarga el plugin nativo.
  const mod = await import('capacitor-native-google-one-tap-signin');
  const auth = mod.GoogleOneTapAuth ?? mod.default?.GoogleOneTapAuth;
  if (!auth) {
    throw new Error('El plugin nativo de Google no está disponible en este build.');
  }

  // initialize es idempotente; el plugin lo recuerda entre llamadas.
  try {
    await auth.initialize({ clientId: GOOGLE_CLIENT_ID });
  } catch (err) {
    throw new Error(
      `No se pudo inicializar Google Sign-In.\n${err?.message || err}`,
    );
  }

  // Fuerza el selector de cuentas (no auto-login silencioso). En Android
  // muestra la hoja nativa de Credential Manager, sin salir de la app.
  const result = await auth.signInWithGoogleButtonFlowForNativePlatform();
  const success = result?.success;

  if (result?.isSuccess && success?.idToken) {
    return { provider: 'google', token: String(success.idToken) };
  }

  const code = result?.noSuccess?.noSuccessReasonCode;
  const detail = result?.noSuccess?.noSuccessAdditionalInfo || '';

  if (code === 'SIGN_IN_CANCELLED') {
    throw Object.assign(new Error('Inicio de sesión cancelado'), { cancelled: true });
  }

  throw new Error(
    detail
      ? `No se pudo iniciar sesión con Google.\n${detail}`
      : 'No se pudo iniciar sesión con Google en este dispositivo.',
  );
}

/**
 * Web de escritorio: Google Identity Services con popup.
 *
 * @returns {Promise<{provider:'google', token:string}>} ID token JWT.
 */
async function signInWithGoogleWeb() {
  await loadScript(GIS_SRC);

  const idToken = await new Promise((resolve, reject) => {
    let settled = false;
    const done = (token) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      resolve(token);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      reject(err);
    };

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (resp) => {
        console.log('[DEBUG] GIS initialize callback invocado');
        if (resp && resp.credential) done(resp.credential);
        else fail(new Error('Google no devolvió una credencial'));
      },
      itp_support: true,
      cancel_on_tap_outside: false,
      ux_mode: 'popup',
    });

    // Contenedor oculto para el botón oficial (popup determinista).
    if (!gisHost) {
      gisHost = document.createElement('div');
      gisHost.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
      document.body.appendChild(gisHost);
    }
    gisHost.textContent = '';
    window.google.accounts.id.renderButton(gisHost, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
    });

    const clickHidden = () => {
      const btn = gisHost.querySelector('div[role="button"], button');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    };
    if (!clickHidden()) {
      // El botón puede renderizarse de forma asíncrona.
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (clickHidden()) {
          clearInterval(timer);
        } else if (tries > 25) {
          clearInterval(timer);
          fail(new Error('No se pudo abrir el popup de Google'));
        }
      }, 100);
    }

    // Si el popup se cierra sin credencial, el foco vuelve a la ventana:
    // lo tratamos como cancelación para desbloquear los botones de login.
    function onFocus() {
      setTimeout(() => {
        if (!settled) {
          fail(Object.assign(new Error('Inicio de sesión cancelado'), { cancelled: true }));
        }
      }, 900);
    }
    window.addEventListener('focus', onFocus);
  });

  return { provider: 'google', token: idToken };
}

/**
 * Punto de entrada único para el botón de Google.
 *
 * @returns {Promise<{provider:'google', token:string}>} ID token JWT.
 */
export async function signInWithGoogle() {
  if (!googleOAuthConfigured) {
    throw new Error('Google Sign-In no está configurado en este build.');
  }
  if (Capacitor.isNativePlatform()) {
    return signInWithGoogleNative();
  }
  return signInWithGoogleWeb();
}
