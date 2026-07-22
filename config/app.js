export const APP_CONFIG = Object.freeze({
  name: 'Juliette Control Center',
  version: '0.4.0',
  environment: 'production',
  dashboardUrl: 'http://130.131.85.248:5000',
  statusPollMs: 15000,
  startPollMs: 5000,
  apiTimeoutMs: 20000,
  // El script scripts/deploy-pr004.ps1 reemplaza este valor automáticamente.
  apiBaseUrl: apiBaseUrl: "https://juliette-control-api-cmaffwahhwgbcnh0.northcentralus-01.azurewebsites.net",
});
