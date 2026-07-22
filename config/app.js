export const APP_CONFIG = Object.freeze({
  name: 'Juliette Control Center',
  version: '0.3.0',
  environment: 'production',
  dashboardUrl: 'http://130.131.85.248:5000',
  statusPollMs: 15000,
  apiBaseUrl: '', // PR-003: pegar aquí la URL HTTPS de Azure Functions, sin slash final.
});
