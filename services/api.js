export const API_CONFIG={baseUrl:'',enabled:false};
export async function apiRequest(path,options={}){if(!API_CONFIG.enabled)throw new Error('API_NOT_CONFIGURED');const response=await fetch(`${API_CONFIG.baseUrl}${path}`,options);if(!response.ok)throw new Error(`API_${response.status}`);return response.json()}
