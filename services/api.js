import { APP_CONFIG } from '../config/app.js';

const ACCESS_TOKEN_KEY = 'juliette_control_access_token';

export function isApiConfigured() {
  return Boolean(APP_CONFIG.apiBaseUrl && APP_CONFIG.apiBaseUrl.startsWith('https://'));
}

export function getAccessToken() {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY) || '';
}

export function setAccessToken(token) {
  const normalized = String(token || '').trim();
  if (normalized) sessionStorage.setItem(ACCESS_TOKEN_KEY, normalized);
  else sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}

export async function apiRequest(path, options = {}) {
  if (!isApiConfigured()) throw new Error('API_NOT_CONFIGURED');

  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${APP_CONFIG.apiBaseUrl}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });

    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }

    if (!response.ok) {
      const error = new Error(payload.error || `API_${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('API_TIMEOUT');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
