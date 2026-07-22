import { APP_CONFIG } from '../config/app.js';
import { isApiConfigured } from './api.js';
import { fetchVirtualMachineStatus } from './azure.js';

export const fallbackStatus = Object.freeze({
  vm: 'unknown',
  powerState: 'unknown',
  dashboard: 'unknown',
  bot: 'unknown',
  region: 'North Central US',
  vmName: 'kyodobot-server',
  version: APP_CONFIG.version,
  checkedAt: null,
  source: 'local',
});

export async function getStatus() {
  if (!isApiConfigured()) return { ...fallbackStatus, apiConfigured: false };
  const remote = await fetchVirtualMachineStatus();
  return {
    ...fallbackStatus,
    ...remote,
    apiConfigured: true,
    source: 'azure',
  };
}
