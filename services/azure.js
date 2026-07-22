import { apiRequest } from './api.js';

export async function startVirtualMachine() {
  return apiRequest('/api/vm/start', { method: 'POST', body: '{}' });
}

export async function fetchVirtualMachineStatus() {
  return apiRequest('/api/vm/status');
}

export async function fetchBridgeHealth() {
  return apiRequest('/api/health');
}
