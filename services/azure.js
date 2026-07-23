import { apiRequest } from './api.js';

export const fetchVirtualMachineStatus = () => apiRequest('/api/service/status');
export const startVirtualMachine = () => apiRequest('/api/service/start', {
  method: 'POST',
  body: '{}',
});
