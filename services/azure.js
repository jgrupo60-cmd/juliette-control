import {apiRequest} from './api.js';
export async function startVirtualMachine(){return apiRequest('/vm/start',{method:'POST'})}
export async function fetchVirtualMachineStatus(){return apiRequest('/vm/status')}
