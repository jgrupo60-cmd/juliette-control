import { APP_CONFIG } from '../config/app.js';

const ACCESS_TOKEN_KEY = 'juliette_control_access_token';
const STAFF_NAME_KEY = 'juliette_control_staff_name';

export function isApiConfigured() { return Boolean(APP_CONFIG.apiBaseUrl?.startsWith('https://')); }
export function getAccessToken() { return sessionStorage.getItem(ACCESS_TOKEN_KEY) || ''; }
export function setAccessToken(token) { const value=String(token||'').trim(); value?sessionStorage.setItem(ACCESS_TOKEN_KEY,value):sessionStorage.removeItem(ACCESS_TOKEN_KEY); }
export function getStaffName() { return sessionStorage.getItem(STAFF_NAME_KEY) || ''; }
export function setStaffName(name) { const value=String(name||'').trim().slice(0,40); value?sessionStorage.setItem(STAFF_NAME_KEY,value):sessionStorage.removeItem(STAFF_NAME_KEY); }
export function clearStaffSession(){ setAccessToken(''); setStaffName(''); }

export async function apiRequest(path, options = {}) {
  if (!isApiConfigured()) throw new Error('API_NOT_CONFIGURED');
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token=getAccessToken(), staff=getStaffName();
  if(token) headers.set('Authorization',`Bearer ${token}`);
  if(staff) headers.set('X-Staff-Name',staff);
  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),options.timeoutMs||APP_CONFIG.apiTimeoutMs||70000);
  try{
    const response=await fetch(`${APP_CONFIG.apiBaseUrl}${path}`,{...options,headers,signal:controller.signal,cache:'no-store',mode:'cors'});
    let payload={}; try{payload=await response.json()}catch{}
    if(!response.ok){const error=new Error(payload.error||`API_${response.status}`);error.status=response.status;error.payload=payload;throw error}
    return payload;
  }catch(error){if(error.name==='AbortError')throw new Error('API_TIMEOUT');if(error instanceof TypeError)throw new Error('API_UNREACHABLE');throw error}finally{clearTimeout(timeout)}
}
